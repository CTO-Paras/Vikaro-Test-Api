import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { redisClientConfig } from "../config/redis.config.js";

const UPI_VERIFICATION_WAIT_HOURS = 24;
const UPI_PENDING_MESSAGE =
  "UPI verification is pending. Please wait up to 24 hours.";

const buildCurrentFreelancerCacheKey = (freelancerId) =>
  `cache:freelancer:current:${freelancerId}`;

const redisDelKey = async (key) => {
  if (!key || !redisClientConfig.isOpen) return;
  try {
    await redisClientConfig.del(key);
  } catch {
    // non-blocking
  }
};

const buildUpiStatusResponse = (freelancer) => {
  const upiId = freelancer?.upiId || null;
  const isUpiVerified = !!(upiId && freelancer?.isUpiVerified);
  const upiVerificationStatus = !upiId
    ? "not_submitted"
    : isUpiVerified
      ? "verified"
      : freelancer?.upiVerificationStatus || "pending";

  return {
    upiId,
    isUpiVerified,
    upiVerificationStatus,
    upiSubmittedAt: freelancer?.upiSubmittedAt || null,
    upiVerifiedAt: freelancer?.upiVerifiedAt || null,
    verificationWaitHours: UPI_VERIFICATION_WAIT_HOURS,
    canWithdraw: isUpiVerified,
    message: isUpiVerified
      ? "UPI verified. You can withdraw money."
      : upiId
        ? UPI_PENDING_MESSAGE
        : "Please add your UPI ID for withdrawal.",
  };
};

const handlerAddFreelancerUpi = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;
  const { upiId } = req.body;

  if (!upiId) {
    throw new ApiError(400, "UPI ID is required");
  }

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "upiId isUpiVerified upiVerificationStatus upiSubmittedAt upiVerifiedAt"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (freelancer.upiId) {
    throw new ApiError(400, "UPI already added");
  }

  freelancer.upiId = String(upiId).trim().toLowerCase();
  freelancer.isUpiVerified = false;
  freelancer.upiVerificationStatus = "pending";
  freelancer.upiSubmittedAt = new Date();
  freelancer.upiVerifiedAt = null;

  await freelancer.save();

  await redisDelKey(buildCurrentFreelancerCacheKey(freelancerId?.toString?.()));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildUpiStatusResponse(freelancer),
      UPI_PENDING_MESSAGE
    )
  );
});

const handlerVerifyFreelancerUpi = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "upiId isUpiVerified upiVerificationStatus upiSubmittedAt upiVerifiedAt"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (!freelancer.upiId) {
    throw new ApiError(400, "UPI not found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      buildUpiStatusResponse(freelancer),
      freelancer.isUpiVerified ? "UPI already verified" : UPI_PENDING_MESSAGE
    )
  );
});

const handlerGetFreelancerUpi = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "upiId isUpiVerified upiVerificationStatus upiSubmittedAt upiVerifiedAt"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  return res.status(200).json(
    new ApiResponse(200, buildUpiStatusResponse(freelancer), "UPI fetched successfully")
  );
});

export {
  handlerAddFreelancerUpi,
  handlerVerifyFreelancerUpi,
  handlerGetFreelancerUpi,
};
