import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { ensureRole } from "../utils/role.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";

const handlerCheckSubscriptionStatus = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancer = await ProfileFreelancer.findById(req.user._id).select(
    "freeJobsUsed isProActive completedJobsCount"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const freeLimit = 7;
  const freeJobsRemaining = Math.max(0, freeLimit - freelancer.freeJobsUsed);
  const proRequired =
    !freelancer.isProActive && freelancer.freeJobsUsed >= freeLimit;

  const data = {
    isProActive: freelancer.isProActive,
    freeJobsUsed: freelancer.freeJobsUsed,
    completedJobsCount: freelancer.completedJobsCount,
    freeJobsRemaining,
    proRequired,
    proFee: 400,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Subscription status fetched"));
});
const handlerActivateProSubscription = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");
  
  const freelancer = await ProfileFreelancer.findByIdAndUpdate(
    req.user._id,
    { isProActive: true, proActivatedAt: new Date() },
    { new: true }
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, freelancer, "Pro subscription activated"));
});

export {
	handlerCheckSubscriptionStatus,
	handlerActivateProSubscription,
};
