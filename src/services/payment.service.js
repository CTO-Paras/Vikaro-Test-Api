import { ApiError } from "../utils/APIError.js";
import { Job } from "../models/job.model.js";
import { Transaction } from "../models/transaction.model.js";
import { Wallet } from "../models/wallet.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { PaymentWebhookEvent } from "../models/paymentWebhookEvent.model.js";
import { JOB_WORKFLOW_EVENTS } from "../constants/jobWorkflowEvents.constant.js";
import { getIOInstance } from "../sockets/io.instance.js";
import { applyWalletEntry } from "./wallet.service.js";
import { WALLET_LEDGER_SOURCES } from "../constants/wallet.constant.js";
import {
  createRazorpayOrderService,
  verifyRazorpayPaymentSignatureService,
  verifyRazorpayWebhookSignatureService,
} from "./razorpay.service.js";
import { razorpayConfig } from "../config/razorpay.config.js";
import { getEnvPairValue } from "../utils/env.js";

const PLATFORM_COMMISSION_RATE = 0.2;
const FREELANCER_PAYOUT_RATE = 0.8;

const roundMoney = (value) => Number((Number(value) || 0).toFixed(2));
 
const calculateSettlement = (job) => {
  const amount = roundMoney(job?.amount);
  const baseAmount = roundMoney(job?.baseAmount || amount);
  const itemTotal = roundMoney(job?.itemTotal || baseAmount);
  const visitingFee = roundMoney(job?.visitingFee);
  const taxAmount = roundMoney(job?.taxAmount);
  const tipAmount = roundMoney(job?.tipAmount);
  const platformCommission = roundMoney(baseAmount * PLATFORM_COMMISSION_RATE);
  const freelancerBaseEarning = roundMoney(baseAmount * FREELANCER_PAYOUT_RATE);
  const freelancerVisitingFeeEarning = visitingFee;
  const freelancerSettlement = roundMoney(
    freelancerBaseEarning + freelancerVisitingFeeEarning + tipAmount
  );

  return {
    amount,
    unitAmount: roundMoney(job?.unitAmount || baseAmount),
    quantity: Number(job?.quantity || 1),
    baseAmount,
    itemTotal,
    visitingFee,
    taxAmount,
    tipAmount,
    platformCommission,
    freelancerBaseEarning,
    freelancerVisitingFeeEarning,
    freelancerSettlement,
  };
};

const buildPaymentSummary = (job) => {
  const settlement = calculateSettlement(job);

  return {
    unitAmount: settlement.unitAmount,
    quantity: settlement.quantity,
    baseAmount: settlement.baseAmount,
    itemTotal: settlement.itemTotal,
    visitingFee: settlement.visitingFee,
    taxAmount: settlement.taxAmount,
    tipAmount: settlement.tipAmount,
    totalAmount: settlement.amount,
    platformCommission: settlement.platformCommission,
    freelancerBaseEarning: settlement.freelancerBaseEarning,
    freelancerVisitingFeeEarning: settlement.freelancerVisitingFeeEarning,
    freelancerTipEarning: settlement.tipAmount,
    freelancerTotalEarning: settlement.freelancerSettlement,
  };
};

const buildJobPaymentSummary = async ({ job, transaction }) => {
  const customer = await ProfileCustomer.findById(job.customer_id)
    .select("fullname")
    .lean();

  return {
    jobId: job._id,
    transactionId: transaction?._id || null,
    category: job.category,
    subServiceName: job.service,
    freelancerId: job.acceptedBy,
    customerName: customer?.fullname || null,
  };
};

const applyJobWalletEntryOnce = async ({
  freelancerId,
  type,
  amount,
  source,
  referenceId,
  note,
}) => {
  const existingWallet = await Wallet.findOne({
    freelancerId,
    ledger: {
      $elemMatch: {
        source,
        referenceId,
      },
    },
  }).select("balance lifetimeEarnings");

  if (existingWallet) {
    return {
      wallet: existingWallet,
      balance: existingWallet.balance,
      lifetimeEarnings: existingWallet.lifetimeEarnings,
      existing: true,
    };
  }

  return applyWalletEntry({
    freelancerId,
    amount,
    type,
    source,
    referenceId,
    note,
  });
};

const creditFreelancerWalletSettlement = async ({ freelancerId, amount, jobId }) => {
  return applyJobWalletEntryOnce({
    freelancerId,
    amount,
    type: "credit",
    source: WALLET_LEDGER_SOURCES.PAYMENT_SETTLEMENT,
    referenceId: jobId,
    note: "Online job payment settlement",
  });
};

const debitFreelancerCommission = async ({ freelancerId, amount, jobId }) => {
  return applyJobWalletEntryOnce({
    freelancerId,
    amount,
    type: "debit",
    source: WALLET_LEDGER_SOURCES.PLATFORM_COMMISSION,
    referenceId: jobId,
    note: "Cash job commission deduction",
  });
};

const emitPaymentConfirmed = (job) => {
  getIOInstance().to(job.roomId || `job_${job._id}`).emit(JOB_WORKFLOW_EVENTS.PAYMENT_CONFIRMED, {
    jobId: job._id,
    amount: job.amount,
    freelancerId: job.acceptedBy,
    paymentStatus: "paid",
  });
};

const assertJobIsPayable = (job) => {
  if (job.status !== "completed") {
    throw new ApiError(400, "Payment allowed only for completed jobs");
  }

  if (!job.acceptedBy) {
    throw new ApiError(400, "Assigned freelancer not found for this job");
  }

  const payableAmount = Number(job.amount);
  if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
    throw new ApiError(400, "Payment amount is missing or invalid for this job");
  }
};

const assertFreelancerOwnership = ({ job, freelancerId }) => {
  if (job.acceptedBy.toString() !== freelancerId.toString()) {
    throw new ApiError(403, "Only assigned freelancer can perform payment actions");
  }
};

const recordTransaction = async ({
  job,
  provider = "manual",
  providerPaymentId = null,
  providerOrderId = null,
  providerSignature = null,
  providerWebhookEventId = null,
  paymentMethod = null,
  status = "pending",
}) => {
  const existing = await Transaction.findOne({ jobId: job._id });
  const transactionPayload = {
    jobId: job._id,
    customerId: job.customer_id,
    freelancerId: job.acceptedBy,
    amount: job.amount,
    provider,
    paymentMethod,
    status,
    paidAt: status === "paid" ? new Date() : null,
  };

  if (providerPaymentId) transactionPayload.providerPaymentId = providerPaymentId;
  if (providerOrderId) transactionPayload.providerOrderId = providerOrderId;
  if (providerSignature) transactionPayload.providerSignature = providerSignature;
  if (providerWebhookEventId) transactionPayload.providerWebhookEventId = providerWebhookEventId;

  if (existing) {
    existing.provider = provider;
    if (providerPaymentId) existing.providerPaymentId = providerPaymentId;
    if (providerOrderId) existing.providerOrderId = providerOrderId;
    if (providerSignature) existing.providerSignature = providerSignature;
    if (providerWebhookEventId) existing.providerWebhookEventId = providerWebhookEventId;
    existing.paymentMethod = paymentMethod;
    existing.status = status;
    if (status === "paid") existing.paidAt = new Date();
    await existing.save();
    return existing;
  }

  return Transaction.create(transactionPayload);
};

const buildPlatformUpiQrData = ({
  amount,
  referenceId,
  notePrefix = "Vikaro payment",
} = {}) => {
  const platformUpiId =
    getEnvPairValue({
      localKey: "VIKARO_LOCAL_UPI_ID",
      productionKey: "VIKARO_PRODUCTION_UPI_ID",
      fallbackKey: "VIKARO_UPI_ID",
    }) ||
    process.env.PLATFORM_UPI_ID ||
    null;
  const payeeName =
    getEnvPairValue({
      localKey: "VIKARO_LOCAL_UPI_NAME",
      productionKey: "VIKARO_PRODUCTION_UPI_NAME",
      fallbackKey: "VIKARO_UPI_NAME",
      defaultValue: "Vikaro",
    }) ||
    process.env.PLATFORM_UPI_NAME ||
    "Vikaro";

  if (!platformUpiId) {
    return {
      available: false,
      reason: "Vikaro UPI is not configured",
    };
  }

  const transactionNote = [notePrefix, referenceId].filter(Boolean).join(" ");
  const upiPayload = `upi://pay?pa=${encodeURIComponent(platformUpiId)}&pn=${encodeURIComponent(payeeName)}&am=${encodeURIComponent(String(amount))}&cu=INR&tn=${encodeURIComponent(transactionNote)}`;

  return {
    available: true,
    receiver: "platform",
    upiId: platformUpiId,
    payeeName,
    amount,
    currency: "INR",
    referenceId: referenceId || null,
    transactionNote,
    upiPayload,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiPayload)}`,
  };
};

const buildUpiQrData = ({ amount, jobId }) =>
  buildPlatformUpiQrData({
    amount,
    referenceId: jobId,
    notePrefix: "Vikaro job",
  });

const getExistingPaidTransaction = async (jobId) => {
  return Transaction.findOne({ jobId, status: "paid" }).sort({ paidAt: -1, updatedAt: -1 });
};

const buildManualProviderPaymentId = ({ jobId, paymentMethod, referenceNote = null }) => {
  const methodLabel = paymentMethod === "cash" ? "cash" : "upi";
  const normalizedReference = String(referenceNote || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 60);

  return normalizedReference
    ? `manual_${methodLabel}_${jobId}_${normalizedReference}`
    : `manual_${methodLabel}_${jobId}`;
};

const markPaymentAsPaid = async ({
  job,
  transaction,
  providerOrderId,
  providerPaymentId,
  providerSignature = null,
  providerWebhookEventId = null,
  paymentMethod = null,
  provider = null,
}) => {
  if (!transaction) {
    throw new ApiError(404, "Transaction not found");
  }

  if (String(transaction.jobId) !== String(job._id)) {
    throw new ApiError(400, "Transaction does not belong to this job");
  }

  if (String(transaction.freelancerId) !== String(job.acceptedBy)) {
    throw new ApiError(403, "Job ownership mismatch for payment settlement");
  }

  const lockUpdate = {
    status: "processing",
    paymentMethod: paymentMethod || transaction.paymentMethod,
    provider: provider || transaction.provider || "razorpay",
  };

  if (providerOrderId) lockUpdate.providerOrderId = providerOrderId;
  if (providerPaymentId) lockUpdate.providerPaymentId = providerPaymentId;
  if (providerSignature) lockUpdate.providerSignature = providerSignature;
  if (providerWebhookEventId) lockUpdate.providerWebhookEventId = providerWebhookEventId;

  const lockedTransaction = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: "pending" },
    { $set: lockUpdate },
    { returnDocument: "after" }
  );

  if (!lockedTransaction) {
    const latestTransaction = await Transaction.findById(transaction._id).select("status");

    if (latestTransaction?.status === "paid") {
      return Transaction.findById(transaction._id);
    }

    throw new ApiError(409, "Payment settlement already in progress");
  }

  const settlement = calculateSettlement(job);

  try {
    if (paymentMethod === "cash") {
      await debitFreelancerCommission({
        freelancerId: job.acceptedBy,
        amount: settlement.platformCommission,
        jobId: job._id,
      });
    } else {
      await creditFreelancerWalletSettlement({
        freelancerId: job.acceptedBy,
        amount: settlement.freelancerSettlement,
        jobId: job._id,
      });
    }

    lockedTransaction.provider = provider || lockedTransaction.provider || "razorpay";
    lockedTransaction.paymentMethod = paymentMethod || lockedTransaction.paymentMethod;
    lockedTransaction.status = "paid";
    lockedTransaction.paidAt = new Date();
    await lockedTransaction.save();

    job.paymentStatus = "paid";
    await job.save();

    emitPaymentConfirmed(job);
    return lockedTransaction;
  } catch (error) {
    await Transaction.updateOne(
      { _id: transaction._id, status: "processing" },
      { $set: { status: "pending" } }
    );

    throw error;
  }
};

const createRazorpayOrder = async ({ jobId, freelancerId }) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  assertJobIsPayable(job);
  assertFreelancerOwnership({ job, freelancerId });

  if (job.paymentStatus === "paid") {
    throw new ApiError(400, "Payment already completed for this job");
  }

  const existingPending = await Transaction.findOne({
    jobId: job._id,
    freelancerId: job.acceptedBy,
    provider: "razorpay",
    status: "pending",
    providerOrderId: { $ne: null },
  }).sort({ createdAt: -1 });

  if (existingPending?.providerOrderId) {
    return {
      keyId: razorpayConfig.keyId,
      amount: job.amount,
      currency: existingPending.currency || "INR",
      orderId: existingPending.providerOrderId,
      transactionId: existingPending._id,
      status: existingPending.status,
      existing: true,
      upiQr: buildUpiQrData({
        amount: job.amount,
        jobId: job._id,
      }),
      paymentSummary: buildPaymentSummary(job),
    };
  }

  const order = await createRazorpayOrderService({
    amountInRupees: job.amount,
    receipt: `job_${job._id}`,
    notes: {
      jobId: String(job._id),
      customerId: String(job.customer_id),
      freelancerId: String(job.acceptedBy),
    },
  });

  const transaction = await recordTransaction({
    job,
    provider: "razorpay",
    providerOrderId: order.id,
    paymentMethod: "online",
    status: "pending",
  });

  job.paymentStatus = "pending";
  await job.save();

  return {
    keyId: razorpayConfig.keyId,
    amount: job.amount,
    currency: order.currency,
    orderId: order.id,
    transactionId: transaction._id,
    status: transaction.status,
    existing: false,
    upiQr: buildUpiQrData({
      amount: job.amount,
      jobId: job._id,
    }),
    paymentSummary: buildPaymentSummary(job),
  };
};

const verifyRazorpayPayment = async ({
  jobId,
  freelancerId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  assertJobIsPayable(job);
  assertFreelancerOwnership({ job, freelancerId });

  const isValidSignature = verifyRazorpayPaymentSignatureService({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!isValidSignature) {
    throw new ApiError(400, "Invalid Razorpay payment signature");
  }

  const transaction = await Transaction.findOne({
    jobId: job._id,
    freelancerId: job.acceptedBy,
    providerOrderId: razorpayOrderId,
    provider: "razorpay",
    status: "pending",
  });

  if (!transaction) {
    const existingPaid = await Transaction.findOne({
      jobId: job._id,
      freelancerId: job.acceptedBy,
      providerOrderId: razorpayOrderId,
      provider: "razorpay",
      status: "paid",
    });

    if (existingPaid) {
      return {
        transaction: existingPaid,
        paymentStatus: "paid",
        verified: true,
        existing: true,
        paymentSummary: buildPaymentSummary(job),
      };
    }

    throw new ApiError(404, "Pending Razorpay transaction not found for this job");
  }

  const paidTransaction = await markPaymentAsPaid({
    job,
    transaction,
    provider: "razorpay",
    providerOrderId: razorpayOrderId,
    providerPaymentId: razorpayPaymentId,
    providerSignature: razorpaySignature,
    paymentMethod: "online",
  });

  return {
    transaction: paidTransaction,
    paymentStatus: "paid",
    verified: true,
    existing: false,
    paymentSummary: buildPaymentSummary(job),
  };
};

const handleRazorpayWebhook = async ({ rawBody, signature, eventId }) => {
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(JSON.stringify(rawBody || {}));

  const isValidSignature = verifyRazorpayWebhookSignatureService({
    rawBody: bodyBuffer,
    signature,
  });

  if (!isValidSignature) {
    throw new ApiError(400, "Invalid Razorpay webhook signature");
  }

  const payload = JSON.parse(bodyBuffer.toString("utf8"));
  const eventType = payload?.event || "unknown";

  if (eventId) {
    const alreadyProcessed = await PaymentWebhookEvent.findOne({ eventId });
    if (alreadyProcessed) {
      return { received: true, duplicate: true, eventType };
    }
  }

  const paymentEntity = payload?.payload?.payment?.entity || null;
  const providerOrderId = paymentEntity?.order_id || null;
  const providerPaymentId = paymentEntity?.id || null;

  if (eventType === "payment.captured") {
    const transaction = await Transaction.findOne({
      providerOrderId,
      provider: "razorpay",
    });

    if (!transaction) {
      if (eventId) {
        await PaymentWebhookEvent.create({
          eventId,
          eventType,
          status: "ignored",
          providerOrderId,
          providerPaymentId,
          reason: "Transaction not found for provider order",
        });
      }
      return { received: true, ignored: true, eventType };
    }

    if (transaction.status === "paid") {
      if (eventId) {
        await PaymentWebhookEvent.create({
          eventId,
          eventType,
          status: "processed",
          providerOrderId,
          providerPaymentId,
          reason: "Already settled",
        });
      }
      return { received: true, duplicate: true, eventType };
    }

    if (transaction.status === "processing") {
      return { received: true, duplicate: true, eventType };
    }

    const job = await Job.findById(transaction.jobId);
    if (!job) {
      throw new ApiError(404, "Job not found for webhook transaction");
    }

    await markPaymentAsPaid({
      job,
      transaction,
      provider: "razorpay",
      providerOrderId,
      providerPaymentId,
      providerWebhookEventId: eventId || null,
      paymentMethod: "online",
    });
  } else if (eventType === "payment.failed") {
    const transaction = await Transaction.findOne({ providerOrderId, provider: "razorpay" });
    if (transaction && transaction.status !== "paid") {
      transaction.status = "failed";
      transaction.providerPaymentId = providerPaymentId;
      transaction.providerWebhookEventId = eventId || null;
      await transaction.save();

      await Job.findByIdAndUpdate(transaction.jobId, { paymentStatus: "failed" });
    }
  }

  if (eventId) {
    await PaymentWebhookEvent.create({
      eventId,
      eventType,
      status: "processed",
      providerOrderId,
      providerPaymentId,
    });
  }

  return { received: true, eventType };
};

const settleCashPayment = async ({ jobId, freelancerId, referenceNote = null }) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  assertJobIsPayable(job);
  assertFreelancerOwnership({ job, freelancerId });

  const existingPaid = await getExistingPaidTransaction(job._id);
  if (existingPaid || job.paymentStatus === "paid") {
    throw new ApiError(400, "Payment already completed for this job");
  }

  let transaction = await Transaction.findOne({
    jobId: job._id,
    freelancerId: job.acceptedBy,
    paymentMethod: "cash",
    status: "pending",
  }).sort({ createdAt: -1 });

  if (!transaction) {
    transaction = await recordTransaction({
      job,
      provider: "manual",
      paymentMethod: "cash",
      status: "pending",
    });
  }

  const settledTransaction = await markPaymentAsPaid({
    job,
    transaction,
    paymentMethod: "cash",
    provider: "manual",
    providerPaymentId: buildManualProviderPaymentId({
      jobId: job._id,
      paymentMethod: "cash",
      referenceNote,
    }),
  });

  const paymentSummary = buildPaymentSummary(job);
  const jobSummary = await buildJobPaymentSummary({
    job,
    transaction: settledTransaction,
  });

  return {
    jobSummary,
    paymentStatus: "paid",
    commissionDebited: paymentSummary.platformCommission,
    paymentSummary,
  };
};

const settlePlatformUpiPayment = async ({ jobId, freelancerId, referenceNote = null }) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  assertJobIsPayable(job);
  assertFreelancerOwnership({ job, freelancerId });

  const existingPaid = await getExistingPaidTransaction(job._id);
  if (existingPaid || job.paymentStatus === "paid") {
    throw new ApiError(400, "Payment already completed for this job");
  }

  let transaction = await Transaction.findOne({
    jobId: job._id,
    freelancerId: job.acceptedBy,
    status: "pending",
  }).sort({ createdAt: -1 });

  if (!transaction) {
    transaction = await recordTransaction({
      job,
      provider: "manual",
      paymentMethod: "online",
      status: "pending",
    });
  }

  const settledTransaction = await markPaymentAsPaid({
    job,
    transaction,
    paymentMethod: "online",
    provider: "manual",
    providerPaymentId: buildManualProviderPaymentId({
      jobId: job._id,
      paymentMethod: "online",
      referenceNote,
    }),
  });

  const paymentSummary = buildPaymentSummary(job);
  const jobSummary = await buildJobPaymentSummary({
    job,
    transaction: settledTransaction,
  });

  return {
    jobSummary,
    paymentStatus: "paid",
    freelancerWalletCredited: paymentSummary.freelancerTotalEarning,
    paymentSummary,
  };
};

export {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  settleCashPayment,
  settlePlatformUpiPayment,
  buildPlatformUpiQrData,
};

