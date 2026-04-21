import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";

const normalizeCoordinates = (value) => {
  if (Array.isArray(value) && value.length === 2) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length === 2) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && value !== null) {
    const objectCoordinates = value.coordinates || value.coords;
    if (Array.isArray(objectCoordinates) && objectCoordinates.length === 2) {
      return objectCoordinates;
    }

    const longitude = value.longitude ?? value.lng;
    const latitude = value.latitude ?? value.lat;
    if (Number.isFinite(Number(longitude)) && Number.isFinite(Number(latitude))) {
      return [Number(longitude), Number(latitude)];
    }
  }

  if (typeof value === "string" && value.includes(",")) {
    const parts = value.split(",").map((part) => Number(part.trim()));
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return parts;
    }
  }

  return null;
};

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
  if (freelancer.freeJobsUsed >= 7 && !freelancer.isProActive) {
    throw new ApiError(
      403,
      "Free limit reached. Please upgrade to PRO."
    );
  }

  const coordinates = normalizeCoordinates(
    req.body?.coordinates ??
    req.body?.location ??
    req.body?.coords ??
    req.body?.position ??
    req.query?.coordinates
  );

  const savedCoordinates = Array.isArray(freelancer.location?.coordinates)
    ? freelancer.location.coordinates
    : null;

  /* toggle status */
  const newStatus =
    freelancer.status === "offline" ? "online" : "offline";

  if (newStatus === "online") {
    const finalCoordinates = coordinates || savedCoordinates;

    if (!finalCoordinates || finalCoordinates.length !== 2) {
      throw new ApiError(400, "coordinates are required to go online");
    }

    freelancer.location = {
      type: "Point",
      coordinates: finalCoordinates,
    };
  }

  freelancer.status = newStatus;
  await freelancer.save();
  
  return res.status(200).json({
    message: `Freelancer is now ${newStatus}`,
    status: newStatus,
  });

});

export { handlerToggleFreelancerStatus };