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

  if (transaction.status !== "pending") {
    throw new ApiError(400, "Only pending transactions can be confirmed");
  }

  if (String(transaction.jobId) !== String(job._id)) {
    throw new ApiError(400, "Transaction does not belong to this job");
  }

  if (String(transaction.freelancerId) !== String(job.acceptedBy)) {
    throw new ApiError(403, "Job ownership mismatch for payment settlement");
  }

  const settlement = calculateSettlement(job.amount);

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

  transaction.provider = provider || transaction.provider || "manual";
  transaction.providerOrderId = providerOrderId || transaction.providerOrderId;
  transaction.providerPaymentId = providerPaymentId || transaction.providerPaymentId;
  transaction.providerSignature = providerSignature || transaction.providerSignature;
  transaction.providerWebhookEventId =
    providerWebhookEventId || transaction.providerWebhookEventId;
  transaction.paymentMethod = paymentMethod || transaction.paymentMethod;
  transaction.status = "paid";
  transaction.paidAt = new Date();
  await transaction.save();

  job.paymentStatus = "paid";
  await job.save();

  emitPaymentConfirmed(job);
  return transaction;
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

  if (job.paymentStatus === "paid") {
    throw new ApiError(400, "Payment already completed for this job");
  }

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

const generatePaymentQR = async ({ jobId, freelancerId, freelancerUpiId = "freelancer@upi" }) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  assertJobIsPayable(job);
  assertFreelancerOwnership({ job, freelancerId });

  if (job.paymentStatus === "paid") {
    throw new ApiError(400, "Payment already completed for this job");
  }

  const amount = Number(job.amount || 0).toFixed(2);
  const upiPayload = `upi://pay?pa=${encodeURIComponent(freelancerUpiId)}&pn=Vikaro&am=${amount}&cu=INR&tn=Job-${job._id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiPayload)}`;

  let transaction = await Transaction.findOne({
    jobId: job._id,
    freelancerId: job.acceptedBy,
    paymentMethod: "online",
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

  transaction.qrPayload = upiPayload;
  transaction.qrUrl = qrUrl;
  transaction.paymentMethod = "online";
  transaction.provider = "manual";
  await transaction.save();

  job.paymentStatus = "pending";
  job.paymentQrUrl = qrUrl;
  await job.save();

  getIOInstance().to(job.roomId || `job_${job._id}`).emit(JOB_WORKFLOW_EVENTS.PAYMENT_QR_GENERATED, {
    jobId: job._id,
    amount: job.amount,
    qrUrl,
    qrPayload: upiPayload,
  });

  return {
    transactionId: transaction._id,
    paymentMethod: "online",
    amount: job.amount,
    qrUrl,
    qrPayload: upiPayload,
  };
};

const confirmPayment = async ({
  jobId,
  transactionId,
  providerPaymentId,
  paymentMethod,
  actorRole,
  actorId,
}) => {
  if (!["online", "cash"].includes(paymentMethod)) {
    throw new ApiError(400, "paymentMethod must be online or cash");
  }

  if (actorRole !== "freelancer") {
    throw new ApiError(403, "Only assigned freelancer can confirm payment");
  }

  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  assertJobIsPayable(job);
  assertFreelancerOwnership({ job, freelancerId: actorId });

  const alreadyPaidTransaction = await Transaction.findOne({
    jobId: job._id,
    status: "paid",
  });

  if (alreadyPaidTransaction) {
    throw new ApiError(400, "Payment already completed for this job");
  }

  if (job.paymentStatus === "paid") {
    throw new ApiError(400, "Payment already completed for this job");
  }

  let transaction = null;

  if (paymentMethod === "cash") {
    transaction = await Transaction.findOne({
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
  } else {
    if (!transactionId) {
      throw new ApiError(400, "transactionId is required for online payment confirmation");
    }

    const transactionQuery = {
      jobId: job._id,
      freelancerId: job.acceptedBy,
      paymentMethod: "online",
      status: "pending",
    };

    transaction = await Transaction.findOne({
      _id: transactionId,
      ...transactionQuery,
    });

    if (!transaction) {
      throw new ApiError(404, "Pending online transaction not found for this job");
    }
  }

  return markPaymentAsPaid({
    job,
    transaction,
    providerPaymentId,
    paymentMethod,
  });
};

export {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  generatePaymentQR,
  confirmPayment,
};
