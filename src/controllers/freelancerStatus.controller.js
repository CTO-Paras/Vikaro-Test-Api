import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";

const handlerToggleFreelancerStatus = asyncHandler(async (req, res) => {

  const loggedInFreelancer = req.user;

  if (!loggedInFreelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const freelancer = await ProfileFreelancer.findById(loggedInFreelancer._id);

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  /* must be verified */
  if (!freelancer.isVerified) {
    throw new ApiError(403, "Account not verified");
  }

  /* FREE LIMIT CHECK */
  if (freelancer?.jobs?.length >= 7 && !freelancer.isProMember) {
    throw new ApiError(
      403,
      "Free limit reached. Please upgrade to PRO."
    );
  }

  /* toggle status */
  const newStatus =
    freelancer.status === "offline" ? "online" : "offline";


  freelancer.status = newStatus;
  await freelancer.save();
  
  return res.status(200).json({
    message: `Freelancer is now ${newStatus}`,
    status: newStatus,
  });

});

export { handlerToggleFreelancerStatus };