import { Job } from "../models/job.model.js";
import { Wallet } from "../models/wallet.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { WALLET_LEDGER_SOURCES } from "../constants/wallet.constant.js";
import mongoose from "mongoose";
import { ApiError } from "../utils/APIError.js";

// Only completed jobs create a credit entry for wallet-style history.
const JOB_HISTORY_COMPLETED_STATUS = "completed";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_JOBS_HISTORY_STATUS = "all";

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

const normalizePositiveInt = (value, defaultValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
};

const normalizeLimit = (value, defaultValue = DEFAULT_LIMIT) => {
  return Math.min(normalizePositiveInt(value, defaultValue), MAX_LIMIT);
};

const normalizeObjectId = (value, label) => {
  if (!mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${label} is invalid`);
  }

  return new mongoose.Types.ObjectId(value);
};

const normalizeJobsHistoryStatus = (value) => {
  const normalized = String(value || DEFAULT_JOBS_HISTORY_STATUS)
    .trim()
    .toLowerCase();

  if (["all", "completed", "cancel"].includes(normalized)) {
    return normalized;
  }

  return DEFAULT_JOBS_HISTORY_STATUS;
};

const formatHistoryDate = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatHistoryTime = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
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

const mapLedgerSourceToCategory = (source) => {
  switch (source) {
    case WALLET_LEDGER_SOURCES.PLATFORM_COMMISSION:
      return "commission";
    case WALLET_LEDGER_SOURCES.WITHDRAWAL:
      return "withdrawal";
    case WALLET_LEDGER_SOURCES.RECHARGE:
      return "recharge";
    case WALLET_LEDGER_SOURCES.REVERSAL:
      return "reversal";
    case WALLET_LEDGER_SOURCES.PAYMENT_SETTLEMENT:
      return "job";
    case WALLET_LEDGER_SOURCES.PENALTY:
      return "penalty";
    default:
      return "wallet";
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
    category: mapLedgerSourceToCategory(entry.source),
    status: "completed",
    createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(0),
  };
};

const groupHistoryByDate = (items) => {
  const groups = new Map();

  for (const item of items) {
    const createdAt = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
    const isoDateKey = createdAt.toISOString().slice(0, 10);

    if (!groups.has(isoDateKey)) {
      groups.set(isoDateKey, { sortAt: createdAt, items: [] });
    }

    const group = groups.get(isoDateKey);
    group.items.push({ ...item, createdAt });

    if (createdAt > group.sortAt) {
      group.sortAt = createdAt;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => b.sortAt - a.sortAt)
    .map((group) => {
      const items = group.items.sort((a, b) => b.createdAt - a.createdAt);
      const totalCredit = items
        .filter((item) => item.type === "credit")
        .reduce((total, item) => total + item.amount, 0);
      const totalDebit = items
        .filter((item) => item.type === "debit")
        .reduce((total, item) => total + item.amount, 0);

      return {
        date: formatHistoryDate(group.sortAt),
        totalCredit,
        totalDebit,
        netAmount: totalCredit - totalDebit,
        items: items.map((item) => ({
          time: formatHistoryTime(item.createdAt),
          title: item.title,
          subtitle: item.subtitle || "",
          amount: item.amount,
          type: item.type,
          category: item.category,
        })),
      };
    });
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
const getFreelancerHistory = async ({
  freelancerId,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
}) => {
  const freelancerObjectId = normalizeObjectId(freelancerId, "freelancerId");
  const numericPage = normalizePositiveInt(page, DEFAULT_PAGE);
  const numericLimit = normalizeLimit(limit, DEFAULT_LIMIT);
  const skip = (numericPage - 1) * numericLimit;

  const pipeline = [
    {
      $match: {
        acceptedBy: freelancerObjectId,
        status: JOB_HISTORY_COMPLETED_STATUS,
      },
    },
    {
      $project: {
        _id: 0,
        source: { $literal: "job" },
        createdAt: "$createdAt",
        amount: "$amount",
        customerId: "$customer_id",
        service: "$service",
      },
    },
    {
      $unionWith: {
        coll: "wallets",
        pipeline: [
          { $match: { freelancerId: freelancerObjectId } },
          { $unwind: "$ledger" },
          {
            $match: {
              "ledger.source": { $ne: WALLET_LEDGER_SOURCES.PAYMENT_SETTLEMENT },
            },
          },
          {
            $project: {
              _id: 0,
              source: { $literal: "wallet_ledger" },
              createdAt: "$ledger.createdAt",
              amount: "$ledger.amount",
              type: "$ledger.type",
              walletSource: "$ledger.source",
              note: "$ledger.note",
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];

  const rawItems = await Job.aggregate(pipeline);

  if (!rawItems.length) {
    return {
      history: [],
      page: numericPage,
      hasNextPage: false,
    };
  }

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
    customers.map((customer) => [String(customer._id), customer.fullname || "Customer"])
  );

  const historyItems = rawItems
    .map((item) => {
      if (item.source === "job") {
        return {
          title: item.service,
          subtitle: item.customerId
            ? customerNameById.get(String(item.customerId)) || "Customer"
            : "Customer",
          amount: Number(item.amount) || 0,
          type: "credit",
          category: "job",
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

      return null;
    })
    .filter(Boolean);

  const groupedHistory = groupHistoryByDate(historyItems);
  const history = groupedHistory.slice(skip, skip + numericLimit);

  return {
    history,
    page: numericPage,
    hasNextPage: skip + numericLimit < groupedHistory.length,
  };
};
const getFreelancerJobsHistory = async ({
  freelancerId,
  status = DEFAULT_JOBS_HISTORY_STATUS,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
}) => {
  const freelancerObjectId = normalizeObjectId(freelancerId, "freelancerId");
  const numericPage = normalizePositiveInt(page, DEFAULT_PAGE);
  const numericLimit = normalizeLimit(limit, DEFAULT_LIMIT);
  const skip = (numericPage - 1) * numericLimit;

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const filter = {
    acceptedBy: freelancerObjectId,
    createdAt: { $gte: since },
  };

  const normalizedStatus = normalizeJobsHistoryStatus(status);

  let statusFilter;
  if (normalizedStatus === "completed") {
    statusFilter = [JOB_HISTORY_COMPLETED_STATUS];
  } else if (normalizedStatus === "cancel") {
    statusFilter = JOB_HISTORY_CANCELLED_STATUSES;
  } else {
    statusFilter = JOB_HISTORY_ALL_STATUSES;
  }

  filter.status = { $in: statusFilter };

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .select(
        "service amount status cancelReason cancelledBy createdAt customer_id"
      )
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
