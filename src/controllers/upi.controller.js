import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { redisClientConfig } from "../config/redis.config.js";

const buildCurrentFreelancerCacheKey = (freelancerId) => `cache:freelancer:current:${freelancerId}`;

const redisDelKey = async (key) => {
  if (!key || !redisClientConfig.isOpen) return;
  try {
    await redisClientConfig.del(key);
  } catch {
    // non-blocking
  }
};

const handlerAddFreelancerUpi = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;
  const { upiId } = req.body;

  if (!upiId) {
    throw new ApiError(400, "UPI ID is required");
  }

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "upiId isUpiVerified"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (freelancer.upiId) {
    throw new ApiError(400, "UPI already added");
  }

  // normalize UPI id: trim and lower-case for consistent storage
  freelancer.upiId = String(upiId).trim().toLowerCase();
  freelancer.isUpiVerified = false;

  await freelancer.save();

  // Invalidate cached current freelancer so clients see updated UPI immediately
  try {
    await redisDelKey(buildCurrentFreelancerCacheKey(freelancerId?.toString?.()));
  } catch {
    // non-blocking
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        null,
        "UPI added successfully. Waiting for verification"
      )
    );
});

const handlerVerifyFreelancerUpi = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "upiId isUpiVerified"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (!freelancer.upiId) {
    throw new ApiError(400, "UPI not found");
  }

  if (freelancer.isUpiVerified) {
    return res.status(200).json(
      new ApiResponse(
        200,
        { upiId: freelancer.upiId, isUpiVerified: true },
        "UPI already verified"
      )
    );
  }

  freelancer.isUpiVerified = true;
  await freelancer.save();

  // Invalidate cached current freelancer so clients see updated verification state
  try {
    await redisDelKey(buildCurrentFreelancerCacheKey(freelancerId?.toString?.()));
  } catch {
    // non-blocking
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      { upiId: freelancer.upiId, isUpiVerified: true },
      "UPI verified successfully"
    )
  );
});

const handlerGetFreelancerUpi = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "upiId isUpiVerified"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const upiId = freelancer.upiId || null;
  const isUpiVerified = !!(upiId && freelancer.isUpiVerified);

  return res.status(200).json(
    new ApiResponse(
      200,
      { upiId, isUpiVerified },
      "UPI fetched successfully"
    )
  );
});

export {
  handlerAddFreelancerUpi,
  handlerVerifyFreelancerUpi,
  handlerGetFreelancerUpi,
};
