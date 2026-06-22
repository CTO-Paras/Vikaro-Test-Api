import { ApiError } from "../utils/APIError.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { Subscription } from "../models/subscription.model.js";
import { razorpayConfig } from "../config/razorpay.config.js";
import {
  createRazorpayOrderService,
  createRazorpayPaymentLinkService,
  fetchRazorpayPaymentLinkService,
  verifyRazorpayPaymentSignatureService,
} from "./razorpay.service.js";
import { redisClientConfig } from "../config/redis.config.js";
import { buildPlatformUpiQrData } from "./payment.service.js";

const PRO_SUBSCRIPTION_PRICE_INR = 499;
const PAYMENT_LINK_TTL_SECONDS = 24 * 60 * 60;
const QR_CODE_BASE_URL = "https://api.qrserver.com/v1/create-qr-code/";

const SUBSCRIPTION_PLAN = Object.freeze({
  key: "pro_monthly",
  name: "Pro Subscription",
  amount: PRO_SUBSCRIPTION_PRICE_INR,
  currency: "INR",
  durationDays: 180,
});

const FREE_JOB_LIMIT = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const addDays = (date, days) => new Date(date.getTime() + days * MS_PER_DAY);
const buildSubscriptionReceipt = (freelancerId) =>
  `sub_${String(freelancerId).slice(-8)}_${Date.now().toString(36)}`;

const buildSubscriptionUpiQrData = (subscription) =>
  buildPlatformUpiQrData({
    amount: subscription.amount,
    referenceId: subscription._id,
    notePrefix: "Vikaro Pro subscription",
  });

const buildPaymentLinkQrData = ({ subscription, paymentLinkUrl }) => {
  if (!paymentLinkUrl) {
    return {
      available: false,
      reason: "Razorpay payment link is not available",
    };
  }

  return {
    available: true,
    provider: "razorpay",
    type: "payment_link",
    amount: subscription.amount,
    currency: subscription.currency,
    referenceId: subscription._id,
    paymentUrl: paymentLinkUrl,
    qrUrl: `${QR_CODE_BASE_URL}?size=300x300&data=${encodeURIComponent(paymentLinkUrl)}`,
  };
};

const buildPaymentLinkResponse = (subscription) => ({
  id: subscription.providerPaymentLinkId || null,
  url: subscription.providerPaymentLinkUrl || null,
  status: subscription.status,
});

const extractPaymentIdFromPaymentLink = (paymentLink) => {
  const payments = paymentLink?.payments;

  if (Array.isArray(payments)) {
    const capturedPayment = payments.find((payment) => payment?.status === "captured") || payments[0];
    return capturedPayment?.payment_id || capturedPayment?.id || null;
  }

  return payments?.payment_id || payments?.id || null;
};

const buildSubscriptionSummary = (subscription, now = new Date()) => {
  if (!subscription) return null;

  const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
  const activatedAt = subscription.activatedAt ? new Date(subscription.activatedAt) : null;
  const isExpired = Boolean(expiresAt && expiresAt.getTime() <= now.getTime());

  return {
    id: subscription._id,
    planKey: subscription.planKey,
    planName: subscription.planName,
    amount: subscription.amount,
    currency: subscription.currency,
    status: subscription.status,
    providerOrderId: subscription.providerOrderId,
    providerPaymentId: subscription.providerPaymentId,
    providerPaymentLinkId: subscription.providerPaymentLinkId,
    providerPaymentLinkUrl: subscription.providerPaymentLinkUrl,
    activatedAt,
    expiresAt,
    isExpired,
    remainingDays:
      expiresAt == null
        ? null
        : Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY)),
  };
};

const getLatestSubscription = async (freelancerId) => {
  return Subscription.findOne({ freelancerId }).sort({ createdAt: -1 });
};

const invalidateFreelancerSubscriptionCache = async (freelancerId) => {
  try {
    if (redisClientConfig.isOpen) {
      await redisClientConfig.del(`cache:freelancer:current:${freelancerId}`);
    }
  } catch {
    // non-blocking
  }
};

const syncFreelancerSubscriptionState = async ({ freelancer, subscription }) => {
  const now = new Date();
  const shouldBeActive = Boolean(subscription && subscription.status === "paid" && subscription.expiresAt && new Date(subscription.expiresAt).getTime() > now.getTime());
  let modified = false;

  if (shouldBeActive) {
    const needsUpdate = !freelancer.isProActive || !freelancer.proActivatedAt;
    if (needsUpdate) {
      freelancer.isProActive = true;
      freelancer.proActivatedAt = subscription.activatedAt || now;
      await freelancer.save();
      modified = true;
    }
  } else if (freelancer.isProActive) {
    freelancer.isProActive = false;
    freelancer.proActivatedAt = null;
    await freelancer.save();
    modified = true;
  }

  if (subscription && subscription.status === "paid" && subscription.expiresAt && new Date(subscription.expiresAt).getTime() <= now.getTime() && subscription.status !== "expired") {
    subscription.status = "expired";
    await subscription.save();
    modified = true;
  }

  if (modified) {
    await invalidateFreelancerSubscriptionCache(freelancer._id);
  }

  return {
    freelancer,
    activeSubscription: shouldBeActive ? buildSubscriptionSummary(subscription, now) : null,
  };
};

const markSubscriptionPaid = async ({ freelancer, subscription, providerPaymentId = null, providerSignature = null }) => {
  const latestPaidSubscription = await Subscription.findOne({
    freelancerId: subscription.freelancerId,
    status: "paid",
    provider: "razorpay",
    _id: { $ne: subscription._id },
  }).sort({ createdAt: -1 });

  const now = new Date();
  const baseDate =
    latestPaidSubscription?.expiresAt && new Date(latestPaidSubscription.expiresAt).getTime() > now.getTime()
      ? new Date(latestPaidSubscription.expiresAt)
      : now;

  if (providerPaymentId) subscription.providerPaymentId = providerPaymentId;
  if (providerSignature) subscription.providerSignature = providerSignature;
  subscription.status = "paid";
  subscription.activatedAt = now;
  subscription.expiresAt = addDays(baseDate, SUBSCRIPTION_PLAN.durationDays);
  await subscription.save();

  freelancer.isProActive = true;
  freelancer.proActivatedAt = now;
  await freelancer.save();

  await invalidateFreelancerSubscriptionCache(freelancer._id);

  return {
    subscription: buildSubscriptionSummary(subscription),
    freelancer,
    paymentStatus: "paid",
    verified: true,
  };
};

const createPaymentLinkForSubscription = async ({ subscription, freelancer }) => {
  const expireBy = Math.floor(Date.now() / 1000) + PAYMENT_LINK_TTL_SECONDS;
  const paymentLink = await createRazorpayPaymentLinkService({
    amountInRupees: subscription.amount,
    referenceId: subscription._id,
    description: "Vikaro Pro Subscription",
    customer: {
      name: freelancer.fullname || "Vikaro Freelancer",
      contact: freelancer.mobileNumber || undefined,
    },
    notes: {
      freelancerId: String(subscription.freelancerId),
      subscriptionId: String(subscription._id),
      planKey: subscription.planKey,
      orderId: subscription.providerOrderId || "",
    },
    expireBy,
  });

  subscription.providerPaymentLinkId = paymentLink.id;
  subscription.providerPaymentLinkUrl = paymentLink.short_url;
  await subscription.save();

  return paymentLink;
};

const buildCreateSubscriptionResponse = ({ subscription, existing }) => ({
  keyId: razorpayConfig.keyId,
  amount: subscription.amount,
  currency: subscription.currency,
  orderId: subscription.providerOrderId,
  subscriptionId: subscription._id,
  paymentLink: buildPaymentLinkResponse(subscription),
  paymentQr: buildPaymentLinkQrData({
    subscription,
    paymentLinkUrl: subscription.providerPaymentLinkUrl,
  }),
  upiQr: buildSubscriptionUpiQrData(subscription),
  fallbackUpiQr: buildSubscriptionUpiQrData(subscription),
  plan: SUBSCRIPTION_PLAN,
  existing,
});

const createSubscriptionOrder = async ({ freelancerId }) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "fullname mobileNumber role isProActive proActivatedAt freeJobsUsed completedJobsCount"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const pendingSubscription = await Subscription.findOne({
    freelancerId,
    status: "pending",
    planKey: SUBSCRIPTION_PLAN.key,
    provider: "razorpay",
  }).sort({ createdAt: -1 });

  if (pendingSubscription?.providerOrderId) {
    if (!pendingSubscription.providerPaymentLinkId || !pendingSubscription.providerPaymentLinkUrl) {
      await createPaymentLinkForSubscription({
        subscription: pendingSubscription,
        freelancer,
      });
    }

    return buildCreateSubscriptionResponse({
      subscription: pendingSubscription,
      existing: true,
    });
  }

  const order = await createRazorpayOrderService({
    amountInRupees: SUBSCRIPTION_PLAN.amount,
    receipt: buildSubscriptionReceipt(freelancerId),
    notes: {
      freelancerId: String(freelancerId),
      planKey: SUBSCRIPTION_PLAN.key,
    },
  });

  const subscription = await Subscription.create({
    freelancerId,
    planKey: SUBSCRIPTION_PLAN.key,
    planName: SUBSCRIPTION_PLAN.name,
    amount: SUBSCRIPTION_PLAN.amount,
    currency: order.currency || SUBSCRIPTION_PLAN.currency,
    provider: "razorpay",
    providerOrderId: order.id,
    razorpayReceipt: order.receipt || null,
    status: "pending",
  });

  await createPaymentLinkForSubscription({ subscription, freelancer });

  return buildCreateSubscriptionResponse({
    subscription,
    existing: false,
  });
};

const verifySubscriptionPayment = async ({
  freelancerId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "isProActive proActivatedAt"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const isValidSignature = verifyRazorpayPaymentSignatureService({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!isValidSignature) {
    throw new ApiError(400, "Invalid Razorpay payment signature");
  }

  const subscription = await Subscription.findOne({
    freelancerId,
    provider: "razorpay",
    providerOrderId: razorpayOrderId,
  });

  if (!subscription) {
    throw new ApiError(404, "Pending subscription not found for this order");
  }

  if (subscription.status === "paid") {
    return {
      subscription: buildSubscriptionSummary(subscription),
      paymentStatus: "paid",
      verified: true,
      existing: true,
    };
  }

  if (subscription.status !== "pending") {
    throw new ApiError(400, "Only pending subscriptions can be verified");
  }

  return {
    ...(await markSubscriptionPaid({
      freelancer,
      subscription,
      providerPaymentId: razorpayPaymentId,
      providerSignature: razorpaySignature,
    })),
    existing: false,
  };
};

const checkSubscriptionPayment = async ({ freelancerId, subscriptionId }) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "isProActive proActivatedAt"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    freelancerId,
    provider: "razorpay",
  });

  if (!subscription) {
    throw new ApiError(404, "Subscription not found");
  }

  if (subscription.status === "paid") {
    return {
      subscription: buildSubscriptionSummary(subscription),
      paymentStatus: "paid",
      isProActive: true,
      verified: true,
      existing: true,
      message: "Payment already verified",
    };
  }

  if (subscription.status !== "pending") {
    return {
      subscription: buildSubscriptionSummary(subscription),
      paymentStatus: subscription.status,
      isProActive: false,
      verified: false,
      message: `Subscription is ${subscription.status}`,
    };
  }

  if (!subscription.providerPaymentLinkId) {
    throw new ApiError(400, "Payment link not found. Please create subscription order again.");
  }

  const paymentLink = await fetchRazorpayPaymentLinkService(subscription.providerPaymentLinkId);
  const amountPaid = Number(paymentLink?.amount_paid) || 0;
  const requiredAmount = Math.round(Number(subscription.amount) * 100);

  if (paymentLink?.status === "paid" && amountPaid >= requiredAmount) {
    const providerPaymentId = extractPaymentIdFromPaymentLink(paymentLink);
    const paidResult = await markSubscriptionPaid({
      freelancer,
      subscription,
      providerPaymentId,
    });

    return {
      ...paidResult,
      isProActive: true,
      existing: false,
      message: "Payment verified and Pro activated",
    };
  }

  if (["expired", "cancelled"].includes(paymentLink?.status)) {
    subscription.status = paymentLink.status;
    await subscription.save();

    return {
      subscription: buildSubscriptionSummary(subscription),
      paymentStatus: paymentLink.status,
      isProActive: false,
      verified: false,
      message: `Payment link is ${paymentLink.status}`,
    };
  }

  return {
    subscription: buildSubscriptionSummary(subscription),
    paymentStatus: paymentLink?.status || "pending",
    isProActive: false,
    verified: false,
    paymentLink: {
      id: paymentLink?.id || subscription.providerPaymentLinkId,
      url: paymentLink?.short_url || subscription.providerPaymentLinkUrl,
      status: paymentLink?.status || "pending",
      amountPaid,
      requiredAmount,
    },
    message: "Payment not completed yet",
  };
};

const getSubscriptionStatus = async ({ freelancerId }) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "freeJobsUsed isProActive proActivatedAt completedJobsCount"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const latestSubscription = await getLatestSubscription(freelancerId);
  const latestPaidSubscription = latestSubscription?.status === "paid" ? latestSubscription : await Subscription.findOne({
    freelancerId,
    status: "paid",
  }).sort({ createdAt: -1 });

  const { activeSubscription } = await syncFreelancerSubscriptionState({
    freelancer,
    subscription: latestPaidSubscription,
  });

  const freeJobsRemaining = Math.max(0, FREE_JOB_LIMIT - freelancer.freeJobsUsed);
  const proRequired = !freelancer.isProActive && freelancer.freeJobsUsed >= FREE_JOB_LIMIT;

  return {
    isProActive: freelancer.isProActive,
    freeJobsUsed: freelancer.freeJobsUsed,
    completedJobsCount: freelancer.completedJobsCount,
    freeJobsRemaining,
    proRequired,
    proFee: SUBSCRIPTION_PLAN.amount,
    plan: SUBSCRIPTION_PLAN,
    activeSubscription,
  };
};

export {
  SUBSCRIPTION_PLAN,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  checkSubscriptionPayment,
  getSubscriptionStatus,
};