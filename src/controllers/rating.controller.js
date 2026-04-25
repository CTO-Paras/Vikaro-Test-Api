import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { ensureRole } from "../utils/role.js";
import { FreelancerRating } from "../models/freelancerRating.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { Job } from "../models/job.model.js";
import { Category } from "../models/category.model.js";
import { redisClientConfig } from "../config/redis.config.js";

const COMPLETED_JOB_STATUS = "completed";
const FREELANCER_RATING_CACHE_TTL_SECONDS = 60; // 1 minute
const SUBSERVICE_RATING_CACHE_TTL_SECONDS = 60; // 1 minute

const buildFreelancerRatingCacheKey = (freelancerId) => `cache:rating:freelancer:${freelancerId}`;
const buildSubServiceRatingCacheKey = (categoryId, serviceId, subServiceId) =>
  `cache:rating:subservice:${categoryId}:${serviceId}:${subServiceId}`;

const redisGetJson = async (key) => {
  if (!redisClientConfig.isOpen) return null;
  try {
    const rawValue = await redisClientConfig.get(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
};

const redisSetJson = async (key, value, ttlSeconds) => {
  if (!redisClientConfig.isOpen) return;
  try {
    await redisClientConfig.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Non-blocking cache write
  }
};

const redisDelKey = async (key) => {
  if (!key || !redisClientConfig.isOpen) return;
  try {
    await redisClientConfig.del(key);
  } catch {
    // Non-blocking
  }
};

const applyFreelancerRatingAggregate = async ({ freelancerId, ratingValue }) => {
  await ProfileFreelancer.updateOne(
    { _id: freelancerId },
    [
      {
        $set: {
          ratingCount: { $add: [{ $ifNull: ["$ratingCount", 0] }, 1] },
          ratingTotal: { $add: [{ $ifNull: ["$ratingTotal", 0] }, ratingValue] },
        },
      },
      {
        $set: {
          ratingAverage: {
            $cond: [
              { $gt: ["$ratingCount", 0] },
              { $divide: ["$ratingTotal", "$ratingCount"] },
              0,
            ],
          },
        },
      },
    ]
  );
};

const applySubServiceRatingAggregate = async ({
  categoryId,
  serviceId,
  subServiceId,
  ratingValue,
}) => {
  if (!categoryId || !serviceId || !subServiceId) return;

  const category = await Category.findById(categoryId);
  if (!category) return;

  const service = category.services.id(serviceId);
  if (!service) return;

  const subService = service.subServices.id(subServiceId);
  if (!subService) return;

  const currentCount = Number(subService.totalBookingCount) || 0;
  const currentTotal = Number(subService.ratingTotal) || 0;
  const nextCount = currentCount + 1;
  const nextTotal = currentTotal + ratingValue;

  subService.totalBookingCount = nextCount;
  subService.ratingTotal = nextTotal;
  subService.averageRating = Number((nextTotal / nextCount).toFixed(2));

  await category.save();
};


const handlerSubmitFreelancerRating = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");

  const {
    jobId,
    overallRating,
    feedback,
  } = req.body;

  const job = await Job.findById(jobId).select(
    "customer_id acceptedBy status categoryId serviceId subServiceId"
  );
  if (!job) throw new ApiError(404, "Job not found");

  if (job.customer_id.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only rate your own job");
  }

  if (!job.acceptedBy) {
    throw new ApiError(400, "Job does not have assigned freelancer");
  }

  if (job.status !== COMPLETED_JOB_STATUS) {
    throw new ApiError(400, "Only completed jobs can be rated");
  }

  const existingRating = await FreelancerRating.exists({ jobId });
  if (existingRating) {
    throw new ApiError(409, "This job has already been rated");
  }

  const ratingValue = Number(overallRating);
  let rating;
  try {
    rating = await FreelancerRating.create({
      jobId,
      freelancerId: job.acceptedBy,
      customerId: req.user._id,
      categoryId: job.categoryId || undefined,
      serviceId: job.serviceId || undefined,
      subServiceId: job.subServiceId || undefined,
      overallRating: ratingValue,
      feedback,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "This job has already been rated");
    }
    throw error;
  }

  await Promise.all([
    applyFreelancerRatingAggregate({
      freelancerId: job.acceptedBy,
      ratingValue,
    }),
    applySubServiceRatingAggregate({
      categoryId: job.categoryId,
      serviceId: job.serviceId,
      subServiceId: job.subServiceId,
      ratingValue,
    }),
  ]);

  // Invalidate caches for this freelancer and subservice so subsequent reads are fresh
  try {
    await Promise.all([
      redisDelKey(buildFreelancerRatingCacheKey(job.acceptedBy?.toString?.())),
      redisDelKey(
        buildSubServiceRatingCacheKey(
          job.categoryId?.toString?.(),
          job.serviceId?.toString?.(),
          job.subServiceId?.toString?.()
        )
      ),
    ]);
  } catch {
    // Non-blocking; rating write succeeded regardless of cache state
  }

  return res
    .status(200)
    .json(new ApiResponse(200, rating, "Rating submitted"));
});
const handlerGetFreelancerRatingStats = asyncHandler(async (req, res) => {
  const { freelancerId } = req.params;

  // Try cache first
  const cacheKey = buildFreelancerRatingCacheKey(freelancerId);
  const cached = await redisGetJson(cacheKey);
  if (cached) {
    return res.status(200).json(new ApiResponse(200, cached, "Rating stats fetched (cache)"));
  }

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "fullname ratingAverage ratingCount completedJobsCount"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const recentFeedback = await FreelancerRating.find({ freelancerId })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("overallRating feedback createdAt");

  const data = {
    freelancer,
    recentFeedback,
  };

  // Cache non-blocking
  redisSetJson(cacheKey, data, FREELANCER_RATING_CACHE_TTL_SECONDS).catch(() => {});

  return res.status(200).json(new ApiResponse(200, data, "Rating stats fetched"));
});

const handlerGetSubServiceRatingStats = asyncHandler(async (req, res) => {
  const { categoryId, serviceId, subServiceId } = req.params;

  const cacheKey = buildSubServiceRatingCacheKey(categoryId, serviceId, subServiceId);
  const cached = await redisGetJson(cacheKey);
  if (cached) {
    return res.status(200).json(new ApiResponse(200, cached, "Subservice rating stats fetched (cache)"));
  }

  const category = await Category.findById(categoryId).select("title services");
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  const service = category.services.id(serviceId);
  if (!service) {
    throw new ApiError(404, "Service not found");
  }

  const subService = service.subServices.id(subServiceId);
  if (!subService) {
    throw new ApiError(404, "Subservice not found");
  }

  const recentFeedback = await FreelancerRating.find({
    categoryId,
    serviceId,
    subServiceId,
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("overallRating feedback createdAt freelancerId")
    .populate("freelancerId", "fullname");

  const data = {
    category: {
      _id: category._id,
      title: category.title,
    },
    service: {
      _id: service._id,
      name: service.name,
    },
    subService: {
      _id: subService._id,
      name: subService.name,
      averageRating: Number(subService.averageRating) || 0,
      totalBookingCount: Number(subService.totalBookingCount) || 0,
      ratingTotal: Number(subService.ratingTotal) || 0,
    },
    recentFeedback,
  };

  // Cache the computed stats
  redisSetJson(cacheKey, data, SUBSERVICE_RATING_CACHE_TTL_SECONDS).catch(() => {});

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Subservice rating stats fetched"));
});
export {
	handlerSubmitFreelancerRating,
	handlerGetFreelancerRatingStats,
	handlerGetSubServiceRatingStats,
};
