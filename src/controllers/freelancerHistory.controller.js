import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import {
  getFreelancerHistory,
  getFreelancerJobsHistory,
} from "../services/freelancerHistory.service.js";

const handlerGetFreelancerHistory = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { page = 1, limit = 10 } = req.query;

  const data = await getFreelancerHistory({
    freelancerId: req.user._id,
    page,
    limit,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Freelancer history fetched"));
});

const handlerGetFreelancerJobsHistory = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { page = 1, limit = 10, status = "all" } = req.query;

  const data = await getFreelancerJobsHistory({
    freelancerId: req.user._id,
    status,
    page,
    limit,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Freelancer jobs history fetched"));
});

export { handlerGetFreelancerHistory, handlerGetFreelancerJobsHistory };
