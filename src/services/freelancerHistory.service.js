import { Job } from "../models/job.model.js";
import { Wallet } from "../models/wallet.model.js";
import { Transaction } from "../models/transaction.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { WALLET_LEDGER_SOURCES } from "../constants/wallet.constant.js";

// Only completed jobs create a credit entry for wallet-style history.
const JOB_HISTORY_COMPLETED_STATUS = "completed";

// Job status sets used for job history filters
const JOB_HISTORY_CANCELLED_STATUSES = [
  "cancelled",
  "cancelled_by_customer",
  "cancelled_by_freelancer",
];

const JOB_HISTORY_ALL_STATUSES = [
  JOB_HISTORY_COMPLETED_STATUS,
  ...JOB_HISTORY_CANCELLED_STATUSES,
  "missed",
];

const formatHistoryDate = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const mapJobToHistoryItem = (job) => {
  if (!job) return null;

  const createdAt = job.createdAt ? new Date(job.createdAt) : new Date(0);
  const base = {
    title: job.service,
    subtitle: job.customer_id?.fullname || "Customer",
    amount: Number(job.amount) || 0,
    createdAt,
  };

  if (job.status === JOB_HISTORY_COMPLETED_STATUS) {
    return {
      ...base,
      type: "credit",
      sign: "+",
      status: "completed",
    };
  }
  // Cancelled jobs do not directly show as debit here.
  // Any monetary penalty will appear via wallet ledger entries.
  return null;
};

const mapLedgerSourceToTitle = (source) => {
  switch (source) {
    case WALLET_LEDGER_SOURCES.PLATFORM_COMMISSION:
      return "Vikaro Commission";
    case WALLET_LEDGER_SOURCES.WITHDRAWAL:
      return "Transfer to Bank";
    case WALLET_LEDGER_SOURCES.RECHARGE:
      return "Wallet Recharge";
    case WALLET_LEDGER_SOURCES.REVERSAL:
      // Treat reversal as commission/penalty cleared bonus
      return "Commission Cleared";
    case WALLET_LEDGER_SOURCES.PAYMENT_SETTLEMENT:
      return "Job Payment";
    case WALLET_LEDGER_SOURCES.PENALTY:
      return "Penalty";
    case WALLET_LEDGER_SOURCES.CORRECTION:
      return "Wallet Adjustment";
    default:
      return "Wallet Update";
  }
};

const mapLedgerEntryToHistoryItem = (entry) => {
  if (!entry) return null;

  const type = entry.type === "debit" ? "debit" : "credit";
  const sign = type === "credit" ? "+" : "-";

  return {
    title: mapLedgerSourceToTitle(entry.source),
    subtitle: entry.note || entry.source || null,
    amount: Number(entry.amount) || 0,
    sign,
    type,
    status: "completed",
    createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(0),
  };
};

const groupHistoryByDate = (items) => {
  const groups = new Map();

  for (const item of items) {
    const dateKey = formatHistoryDate(item.createdAt);
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey).push(item);
  }
  // Sort groups by date descending for a stable timeline order
  return Array.from(groups.entries())
    .sort((a, b) => new Date(b[0]) - new Date(a[0]))
    .map(([date, groupedItems]) => ({
      date,
      items: groupedItems,
    }));
};

const mapJobToJobHistoryItem = (job) => {
  const customerName = job.customer_id?.fullname || "Customer";
  const amount = Number(job.amount) || 0;
  const createdAt = job.createdAt ? new Date(job.createdAt) : new Date(0);

  let status = "completed";
  let cancelReason = null;

  switch (job.status) {
    case "completed":
      status = "completed";
      break;
    case "cancelled_by_customer":
      status = "cancelled";
      cancelReason = "by Customer";
      break;
    case "cancelled_by_freelancer":
      status = "cancelled";
      cancelReason = "by Freelancer";
      break;
    case "cancelled":
      status = "cancelled";
      cancelReason = job.cancelReason || null;
      break;
    case "missed":
      status = "missed";
      break;
    default:
      status = job.status || "completed";
  }

  return {
    service: job.service,
    customerName,
    status,
    cancelReason,
    amount,
    createdAt,
  };
};
const getFreelancerHistory = async ({ freelancerId, page = 1, limit = 10 }) => {
  const numericPage = Number(page) > 0 ? Number(page) : 1;
  const numericLimit = Number(limit) > 0 ? Number(limit) : 10;
  const skip = (numericPage - 1) * numericLimit;

  // Build aggregation starting from Transaction as primary source
  const pipeline = [
    {
      $match: {
        freelancerId,
      },
    },
    {
      $project: {
        _id: 0,
        source: { $literal: "transaction" },
        createdAt: "$createdAt",
        amount: "$amount",
        status: "$status",
        jobId: "$jobId",
        provider: "$provider",
        paymentMethod: "$paymentMethod",
      },
    },
    {
      $unionWith: {
        coll: "jobs",
        pipeline: [
          {
            $match: {
              acceptedBy: freelancerId,
              status: JOB_HISTORY_COMPLETED_STATUS,
            },
          },
          {
            $project: {
              _id: 0,
              source: { $literal: "job" },
              createdAt: "$createdAt",
              amount: "$amount",
              status: "$status",
              jobId: "$_id",
              customerId: "$customer_id",
              service: "$service",
            },
          },
        ],
      },
    },
    {
      $unionWith: {
        coll: "wallets",
        pipeline: [
          { $match: { freelancerId } },
          { $unwind: "$ledger" },
          {
            $project: {
              _id: 0,
              source: { $literal: "wallet_ledger" },
              createdAt: "$ledger.createdAt",
              amount: "$ledger.amount",
              type: "$ledger.type",
              walletSource: "$ledger.source",
              note: "$ledger.note",
              jobId: "$ledger.jobId",
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: numericLimit },
  ];

  const [rawItems, completedJobsCount, transactionsCount, walletLedgerCountAgg] =
    await Promise.all([
      Transaction.aggregate(pipeline),
      Job.countDocuments({
        acceptedBy: freelancerId,
        status: JOB_HISTORY_COMPLETED_STATUS,
      }),
      Transaction.countDocuments({ freelancerId }),
      Wallet.aggregate([
        { $match: { freelancerId } },
        { $unwind: "$ledger" },
        { $count: "count" },
      ]),
    ]);

  const walletLedgerCount = walletLedgerCountAgg[0]?.count || 0;
  const total = completedJobsCount + transactionsCount + walletLedgerCount;

  if (!rawItems.length) {
    return {
      history: [],
      pagination: {
        total,
        page: numericPage,
        limit: numericLimit,
      },
    };
  }

  // Resolve customer names for job-based entries
  const customerIdSet = new Set(
    rawItems
      .filter((item) => item.source === "job" && item.customerId)
      .map((item) => String(item.customerId))
  );

  const customers = customerIdSet.size
    ? await ProfileCustomer.find({ _id: { $in: Array.from(customerIdSet) } })
        .select("fullname")
        .lean()
    : [];

  const customerNameById = new Map(
    customers.map((c) => [String(c._id), c.fullname || "Customer"])
  );

  const historyItems = rawItems
    .map((item) => {
      if (item.source === "job") {
        const customerName = item.customerId
          ? customerNameById.get(String(item.customerId)) || "Customer"
          : "Customer";

        return {
          title: item.service,
          subtitle: customerName,
          amount: Number(item.amount) || 0,
          sign: "+",
          type: "credit",
          status: "completed",
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(0),
        };
      }

      if (item.source === "wallet_ledger") {
        return mapLedgerEntryToHistoryItem({
          type: item.type,
          amount: item.amount,
          source: item.walletSource,
          note: item.note,
          createdAt: item.createdAt,
        });
      }

      if (item.source === "transaction") {
        // Generic transaction entry based on payment transaction record
        const createdAt = item.createdAt ? new Date(item.createdAt) : new Date(0);
        const amount = Number(item.amount) || 0;
        const subtitleBase =
          item.paymentMethod === "cash"
            ? "Cash payment"
            : item.paymentMethod === "online"
            ? "Online payment"
            : item.provider || null;

        return {
          title: "Job Payment",
          subtitle: subtitleBase,
          amount,
          sign: "+",
          type: "credit",
          status: item.status || "completed",
          createdAt,
        };
      }

      return null;
    })
    .filter(Boolean);

  const groupedHistory = groupHistoryByDate(historyItems);

  return {
    history: groupedHistory,
    pagination: {
      total,
      page: numericPage,
      limit: numericLimit,
    },
  };
};

const getFreelancerJobsHistory = async ({
  freelancerId,
  status = "all",
  page = 1,
  limit = 10,
}) => {
  const numericPage = Number(page) > 0 ? Number(page) : 1;
  const numericLimit = Number(limit) > 0 ? Number(limit) : 10;
  const skip = (numericPage - 1) * numericLimit;

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const filter = {
    acceptedBy: freelancerId,
    createdAt: { $gte: since },
  };

  let statusFilter;
  if (status === "completed") {
    statusFilter = [JOB_HISTORY_COMPLETED_STATUS];
  } else if (status === "cancel") {
    statusFilter = JOB_HISTORY_CANCELLED_STATUSES;
  } else {
    statusFilter = JOB_HISTORY_ALL_STATUSES;
  }

  filter.status = { $in: statusFilter };

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .select("service amount status cancelReason cancelledBy createdAt customer_id")
      .populate("customer_id", "fullname")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(numericLimit)
      .lean(),
    Job.countDocuments(filter),
  ]);

  const jobItems = (jobs || []).map(mapJobToJobHistoryItem);

  return {
    jobs: jobItems,
    pagination: {
      total,
      page: numericPage,
      limit: numericLimit,
    },
  };
};

export { getFreelancerHistory, getFreelancerJobsHistory };
