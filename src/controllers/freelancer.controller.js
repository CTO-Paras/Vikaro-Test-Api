import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import { redisClientConfig } from "../config/redis.config.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import {
  getFreelancerHistory,
  getFreelancerJobsHistory,
} from "../services/freelancerHistory.service.js";

const FREELANCER_HISTORY_CACHE_PREFIX = "cache:freelancer:history:";
const FREELANCER_HISTORY_CACHE_TTL_SECONDS = 90;
const MAX_LIMIT = 50;

const normalizePositiveInt = (value, defaultValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
};

const normalizeLimit = (value, defaultValue = 10) => {
  return Math.min(normalizePositiveInt(value, defaultValue), MAX_LIMIT);
};

const normalizeJobsHistoryStatus = (value) => {
  const normalized = String(value || "all").trim().toLowerCase();
  if (["all", "completed", "cancel"].includes(normalized)) {
    return normalized;
  }
  return "all";
};

const normalizeCoordinatePair = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;

  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  return [longitude, latitude];
};

const normalizeCoordinates = (value) => {
  const directCoordinates = normalizeCoordinatePair(value);
  if (directCoordinates) {
    return directCoordinates;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const parsedCoordinates = normalizeCoordinatePair(parsed);
      if (parsedCoordinates) return parsedCoordinates;
    } catch {
      // Keep going to support "lng,lat" string format.
    }
  }

  if (typeof value === "object" && value !== null) {
    const objectCoordinates = normalizeCoordinatePair(value.coordinates || value.coords);
    if (objectCoordinates) {
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
    const commaCoordinates = normalizeCoordinatePair(parts);
    if (commaCoordinates) return commaCoordinates;
  }

  return null;
};

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
    await redisClientConfig.set(key, JSON.stringify(value), {
      EX: ttlSeconds,
    });
  } catch {
    // Non-blocking cache write.
  }
};

const buildFreelancerHistoryCacheKey = ({ freelancerId, page, limit }) =>
  `${FREELANCER_HISTORY_CACHE_PREFIX}${freelancerId}:timeline:p:${page}:l:${limit}`;

const buildFreelancerJobsHistoryCacheKey = ({ freelancerId, status, page, limit }) =>
  `${FREELANCER_HISTORY_CACHE_PREFIX}${freelancerId}:jobs:s:${status}:p:${page}:l:${limit}`;

const invalidateFreelancerHistoryCache = async (freelancerId) => {
  if (!freelancerId || !redisClientConfig.isOpen) return;

  const historyPrefix = `${FREELANCER_HISTORY_CACHE_PREFIX}${freelancerId}:`;
  const keysToDelete = [];

  try {
    for await (const key of redisClientConfig.scanIterator({ MATCH: `${historyPrefix}*` })) {
      keysToDelete.push(key);
    }

    // Keep current-auth cache in sync with status/location changes.
    keysToDelete.push(`cache:freelancer:current:${freelancerId}`);

    if (keysToDelete.length > 0) {
      await redisClientConfig.del([...new Set(keysToDelete)]);
    }
  } catch {
    // Non-blocking cache invalidation.
  }
};

const handlerGetFreelancerHistory = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id?.toString?.();
  const page = normalizePositiveInt(req.query?.page, 1);
  const limit = normalizeLimit(req.query?.limit, 10);

  const cacheKey = buildFreelancerHistoryCacheKey({
    freelancerId,
    page,
    limit,
  });

  const cachedData = await redisGetJson(cacheKey);
  if (cachedData) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Freelancer history fetched"));
  }

  const data = await getFreelancerHistory({
    freelancerId,
    page,
    limit,
  });

  await redisSetJson(cacheKey, data, FREELANCER_HISTORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Freelancer history fetched"));
});

const handlerGetFreelancerJobsHistory = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id?.toString?.();
  const page = normalizePositiveInt(req.query?.page, 1);
  const limit = normalizeLimit(req.query?.limit, 10);
  const status = normalizeJobsHistoryStatus(req.query?.status);

  const cacheKey = buildFreelancerJobsHistoryCacheKey({
    freelancerId,
    status,
    page,
    limit,
  });

  const cachedData = await redisGetJson(cacheKey);
  if (cachedData) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Freelancer jobs history fetched"));
  }

  const data = await getFreelancerJobsHistory({
    freelancerId,
    status,
    page,
    limit,
  });

  await redisSetJson(cacheKey, data, FREELANCER_HISTORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Freelancer jobs history fetched"));
});

const handlerToggleFreelancerStatus = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id;

  if (!freelancerId) {
    throw new ApiError(404, "Freelancer not found");
  }

  const freelancer = await ProfileFreelancer.findById(freelancerId);

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (!freelancer.isVerified) {
    throw new ApiError(403, "Account not verified");
  }

  if (freelancer.freeJobsUsed >= 7 && !freelancer.isProActive) {
    throw new ApiError(403, "Free limit reached. Please upgrade to PRO.");
  }

  const coordinates = normalizeCoordinates(
    req.body?.coordinates ??
      req.body?.location ??
      req.body?.coords ??
      req.body?.position ??
      req.query?.coordinates
  );

  const savedCoordinates = Array.isArray(freelancer.location?.coordinates)
    ? normalizeCoordinatePair(freelancer.location.coordinates)
    : null;

  const newStatus = freelancer.status === "offline" ? "online" : "offline";

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

  await invalidateFreelancerHistoryCache(freelancer._id?.toString?.());

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        status: newStatus,
        location: freelancer.location,
      },
      `Freelancer is now ${newStatus}`
    )
  );
});

export {
  handlerGetFreelancerHistory,
  handlerGetFreelancerJobsHistory,
  handlerToggleFreelancerStatus,
};
