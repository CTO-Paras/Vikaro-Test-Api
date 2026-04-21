import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import {
  createSubscriptionOrder,
  verifySubscriptionPayment,
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

export {
	handlerCheckSubscriptionStatus,
	handlerCreateProSubscriptionOrder,
	handlerVerifyProSubscriptionPayment,
};
