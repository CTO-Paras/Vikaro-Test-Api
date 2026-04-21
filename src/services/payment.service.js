import { ApiError } from "../utils/APIError.js";
import { Job } from "../models/job.model.js";
import { Transaction } from "../models/transaction.model.js";
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

const PLATFORM_COMMISSION_RATE = 0.2;
const FREELANCER_PAYOUT_RATE = 0.8;
 
const calculateSettlement = (jobAmount) => {
  const amount = Number(jobAmount || 0);
  const platformCommission = Number((amount * PLATFORM_COMMISSION_RATE).toFixed(2));
  const freelancerSettlement = Number((amount * FREELANCER_PAYOUT_RATE).toFixed(2));

  return {
    amount,
    platformCommission,
    freelancerSettlement,
  };
};

const creditFreelancerWalletSettlement = async ({ freelancerId, amount, jobId }) => {
  return applyWalletEntry({
    freelancerId,
    amount,
    type: "credit",
    source: WALLET_LEDGER_SOURCES.PAYMENT_SETTLEMENT,
    referenceId: jobId,
    note: "Online job payment settlement",
  });
};

const debitFreelancerCommission = async ({ freelancerId, amount, jobId }) => {
  return applyWalletEntry({
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

  if (existing) {
    existing.provider = provider;
    existing.providerPaymentId = providerPaymentId;
    existing.providerOrderId = providerOrderId;
    existing.providerSignature = providerSignature;
    existing.providerWebhookEventId = providerWebhookEventId;
    existing.paymentMethod = paymentMethod;
    existing.status = status;
    if (status === "paid") existing.paidAt = new Date();
    await existing.save();
    return existing;
  }

  return Transaction.create({
    jobId: job._id,
    customerId: job.customer_id,
    freelancerId: job.acceptedBy,
    amount: job.amount,
    provider,
    providerPaymentId,
    providerOrderId,
    providerSignature,
    providerWebhookEventId,
    paymentMethod,
    status,
    paidAt: status === "paid" ? new Date() : null,
  });
};

const getExistingPaidTransaction = async (jobId) => {
  return Transaction.findOne({ jobId, status: "paid" }).sort({ paidAt: -1, updatedAt: -1 });
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

  const settlement = calculateSettlement(job.amount);

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
    lockedTransaction.providerOrderId = providerOrderId || lockedTransaction.providerOrderId;
    lockedTransaction.providerPaymentId = providerPaymentId || lockedTransaction.providerPaymentId;
    lockedTransaction.providerSignature = providerSignature || lockedTransaction.providerSignature;
    lockedTransaction.providerWebhookEventId =
      providerWebhookEventId || lockedTransaction.providerWebhookEventId;
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
    providerPaymentId: referenceNote,
  });

  return {
    transaction: settledTransaction,
    paymentStatus: "paid",
    commissionDebited: Number((Number(job.amount || 0) * PLATFORM_COMMISSION_RATE).toFixed(2)),
  };
};

export {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  settleCashPayment,
};
