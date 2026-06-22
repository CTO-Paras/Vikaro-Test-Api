import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import {
  createSubscriptionOrder,
  verifySubscriptionPayment,
  checkSubscriptionPayment,
  getSubscriptionStatus,
} from "../services/subscription.service.js";

const handlerCheckSubscriptionStatus = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const data = await getSubscriptionStatus({ freelancerId: req.user._id });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Subscription status fetched"));
});

const handlerCreateProSubscriptionOrder = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const data = await createSubscriptionOrder({
    freelancerId: req.user._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Subscription order created"));
});

const handlerVerifyProSubscriptionPayment = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const data = await verifySubscriptionPayment({
    freelancerId: req.user._id,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Subscription payment verified"));
});

const handlerCheckProSubscriptionPayment = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { subscriptionId } = req.body;

  const data = await checkSubscriptionPayment({
    freelancerId: req.user._id,
    subscriptionId,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, data.message || "Subscription payment checked"));
});

export {
  handlerCheckSubscriptionStatus,
  handlerCreateProSubscriptionOrder,
  handlerVerifyProSubscriptionPayment,
  handlerCheckProSubscriptionPayment,
};