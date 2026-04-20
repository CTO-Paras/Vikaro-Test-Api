import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { ensureRole } from "../utils/role.js";
import { FreelancerRating } from "../models/freelancerRating.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { Job } from "../models/job.model.js";

const updateFreelancerAverageRating = async (freelancerId) => {
  const [stats] = await FreelancerRating.aggregate([
	{ $match: { freelancerId } },
	{
	  $group: {
		_id: "$freelancerId",
		ratingAverage: { $avg: "$overallRating" },
		ratingCount: { $sum: 1 },
	  },
	},
  ]);

  const ratingAverage = stats ? Number(stats.ratingAverage.toFixed(2)) : 0;
  const ratingCount = stats ? stats.ratingCount : 0;

  await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
	ratingAverage,
	ratingCount,
  });

  return { ratingAverage, ratingCount };
};


const handlerSubmitFreelancerRating = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");

  const {
    jobId,
    overallRating,
    feedback,
  } = req.body;

  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");

  if (job.customer_id.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only rate your own job");
  }

  if (!job.acceptedBy) {
    throw new ApiError(400, "Job does not have assigned freelancer");
  }

  const rating = await FreelancerRating.findOneAndUpdate(
    { jobId },
    {
      jobId,
      freelancerId: job.acceptedBy,
      customerId: req.user._id,
      overallRating,
      feedback,
    },
    { upsert: true, new: true }
  );

  await updateFreelancerAverageRating(job.acceptedBy);

  return res
    .status(200)
    .json(new ApiResponse(200, rating, "Rating submitted"));
});
const handlerGetFreelancerRatingStats = asyncHandler(async (req, res) => {
  const { freelancerId } = req.params;

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "fullname ratingAverage ratingCount overallRating completedJobsCount"
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

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Rating stats fetched"));
});
export {
	handlerSubmitFreelancerRating,
	handlerGetFreelancerRatingStats,
};
