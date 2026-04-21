import { ApiError } from "../utils/APIError.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { Subscription } from "../models/subscription.model.js";
import { razorpayConfig } from "../config/razorpay.config.js";
import {
  createRazorpayOrderService,
  verifyRazorpayPaymentSignatureService,
} from "./razorpay.service.js";

const PRO_SUBSCRIPTION_PRICE_INR = 499;

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

const syncFreelancerSubscriptionState = async ({ freelancer, subscription }) => {
  const now = new Date();
  const shouldBeActive = Boolean(subscription && subscription.status === "paid" && subscription.expiresAt && new Date(subscription.expiresAt).getTime() > now.getTime());

  if (shouldBeActive) {
    const needsUpdate = !freelancer.isProActive || !freelancer.proActivatedAt;
    if (needsUpdate) {
      freelancer.isProActive = true;
      freelancer.proActivatedAt = subscription.activatedAt || now;
      await freelancer.save();
    }
  } else if (freelancer.isProActive) {
    freelancer.isProActive = false;
    freelancer.proActivatedAt = null;
    await freelancer.save();
  }

  if (subscription && subscription.status === "paid" && subscription.expiresAt && new Date(subscription.expiresAt).getTime() <= now.getTime() && subscription.status !== "expired") {
    subscription.status = "expired";
    await subscription.save();
  }

  return {
    freelancer,
    activeSubscription: shouldBeActive ? buildSubscriptionSummary(subscription, now) : null,
  };
};

const createSubscriptionOrder = async ({ freelancerId }) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "fullname role isProActive proActivatedAt freeJobsUsed completedJobsCount"
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
    return {
      keyId: razorpayConfig.keyId,
      amount: pendingSubscription.amount,
      currency: pendingSubscription.currency,
      orderId: pendingSubscription.providerOrderId,
      subscriptionId: pendingSubscription._id,
      plan: SUBSCRIPTION_PLAN,
      existing: true,
    };
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

  return {
    keyId: razorpayConfig.keyId,
    amount: subscription.amount,
    currency: subscription.currency,
    orderId: order.id,
    subscriptionId: subscription._id,
    plan: SUBSCRIPTION_PLAN,
    existing: false,
  };
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

  const latestPaidSubscription = await Subscription.findOne({
    freelancerId,
    status: "paid",
    provider: "razorpay",
  }).sort({ createdAt: -1 });

  const now = new Date();
  const baseDate =
    latestPaidSubscription?.expiresAt && new Date(latestPaidSubscription.expiresAt).getTime() > now.getTime()
      ? new Date(latestPaidSubscription.expiresAt)
      : now;

  subscription.providerPaymentId = razorpayPaymentId;
  subscription.providerSignature = razorpaySignature;
  subscription.status = "paid";
  subscription.activatedAt = now;
  subscription.expiresAt = addDays(baseDate, SUBSCRIPTION_PLAN.durationDays);
  await subscription.save();

  freelancer.isProActive = true;
  freelancer.proActivatedAt = now;
  await freelancer.save();

  return {
    subscription: buildSubscriptionSummary(subscription),
    freelancer,
    paymentStatus: "paid",
    verified: true,
    existing: false,
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
  getSubscriptionStatus,
};