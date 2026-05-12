import { Category } from "../models/category.model.js";
import mongoose from "mongoose";
import { buildCategoryMediaFolders, uploadOnCloudinaryService } from "../services/cloudinary.service.js";
import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { redisClientConfig } from "../config/redis.config.js";

const CATEGORY_CACHE_PREFIX = "cache:category:";
const CATEGORY_CACHE_TTL_SECONDS = 2 * 60;

const normalizeString = (value) => String(value || "").trim();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ensureObjectIdParam = (value, label) => {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    throw new ApiError(400, `${label} is required`);
  }
  if (!mongoose.isValidObjectId(normalizedValue)) {
    throw new ApiError(400, `${label} is invalid`);
  }
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

const getAllCategoriesCacheKey = () => `${CATEGORY_CACHE_PREFIX}all`;
const getPopularSubServicesCacheKey = () => `${CATEGORY_CACHE_PREFIX}popular-subservices`;
const getCategorySearchCacheKey = (query, limit) =>
  `${CATEGORY_CACHE_PREFIX}search-subservices:${query.toLowerCase()}:l:${limit}`;
const getCategoryByIdCacheKey = (categoryId) => `${CATEGORY_CACHE_PREFIX}id:${categoryId}`;
const getCategoryServicesCacheKey = (categoryId) => `${CATEGORY_CACHE_PREFIX}services:${categoryId}`;
const getSubServiceDetailsCacheKey = (categoryId, serviceId, subServiceId) =>
  `${CATEGORY_CACHE_PREFIX}sub:${categoryId}:${serviceId}:${subServiceId}`;

const mapCategorySubServices = (categories = []) => {
  const items = [];

  categories.forEach((category) => {
    (category.services || []).forEach((service) => {
      (service.subServices || []).forEach((subService, index) => {
        items.push({
          categoryId: category._id,
          categoryName: category.title,
          serviceId: service._id,
          serviceName: service.name,
          serviceLogoImage: service.logoImage || null,
          serviceBannerImage: service.bannerImage || null,
          subServiceId: subService._id,
          name: subService.name,
          image: subService.image || null,
          price: Number(subService.price) || 0,
          quantity: Number(subService.quantity) || 1,
          averageRating: Number(subService.averageRating) || 0,
          totalBookingCount: Number(subService.totalBookingCount) || 0,
          parentUpdatedAt: category.updatedAt || category.createdAt || null,
          orderIndex: index,
        });
      });
    });
  });

  return items;
};

const pickPopularSubServices = (items = [], limit = 3) => {
  const hasBookings = items.some((item) => item.totalBookingCount > 0);

  return [...items]
    .sort((a, b) => {
      if (hasBookings) {
        return (
          b.totalBookingCount - a.totalBookingCount ||
          b.averageRating - a.averageRating ||
          String(a.name).localeCompare(String(b.name))
        );
      }

      return (
        new Date(b.parentUpdatedAt || 0).getTime() -
          new Date(a.parentUpdatedAt || 0).getTime() ||
        b.orderIndex - a.orderIndex ||
        String(a.name).localeCompare(String(b.name))
      );
    })
    .slice(0, limit)
    .map(({ parentUpdatedAt, orderIndex, ...item }) => item);
};

const normalizeSearchText = (value) =>
  normalizeString(value).toLowerCase().replace(/\s+/g, " ");

const getEditDistance = (left, right) => {
  const a = normalizeSearchText(left);
  const b = normalizeSearchText(right);
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
};

const scoreSearchSuggestion = (query, item) => {
  const normalizedQuery = normalizeSearchText(query);
  const fields = [
    item.name,
    item.serviceName,
    item.categoryName,
    item.description,
  ].filter(Boolean);

  let bestScore = 0;

  fields.forEach((field) => {
    const value = normalizeSearchText(field);
    const words = value.split(" ").filter(Boolean);
    const parts = [value, ...words].filter(Boolean);
    const distances = parts.map((part) => getEditDistance(normalizedQuery, part));
    const minDistance = Math.min(...distances);

    if (value === normalizedQuery) bestScore = Math.max(bestScore, 100);
    if (value.startsWith(normalizedQuery)) bestScore = Math.max(bestScore, 90);
    if (words.some((word) => word.startsWith(normalizedQuery))) {
      bestScore = Math.max(bestScore, 82);
    }
    if (parts.some((part) => normalizedQuery.startsWith(part) && part.length >= 3)) {
      bestScore = Math.max(bestScore, 78);
    }
    if (minDistance <= 1) bestScore = Math.max(bestScore, 75);
    if (minDistance === 2) bestScore = Math.max(bestScore, 65);
    if (value.includes(normalizedQuery)) bestScore = Math.max(bestScore, 50);
  });

  return bestScore;
};

const mapCategorySearchItems = (categories = []) => {
  const items = [];

  categories.forEach((category) => {
    (category.services || []).forEach((service) => {
      (service.subServices || []).forEach((subService) => {
        items.push({
          type: "subservice",
          categoryId: category._id,
          categoryName: category.title,
          serviceId: service._id,
          serviceName: service.name,
          serviceLogoImage: service.logoImage || null,
          serviceBannerImage: service.bannerImage || null,
          subServiceId: subService._id,
          name: subService.name,
          image: subService.image || null,
          price: Number(subService.price) || 0,
          quantity: Number(subService.quantity) || 1,
          description: subService.description || null,
          averageRating: Number(subService.averageRating) || 0,
          totalBookingCount: Number(subService.totalBookingCount) || 0,
        });
      });
    });
  });

  return items;
};

const searchCategoryItems = ({ items, query, limit }) => {
  const seen = new Set();

  return items
    .map((item) => ({
      ...item,
      score: scoreSearchSuggestion(query, item),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.totalBookingCount - a.totalBookingCount ||
        String(a.name).localeCompare(String(b.name))
    )
    .filter((item) => {
      const key = `${item.type}:${item.categoryId || ""}:${item.serviceId || ""}:${item.subServiceId || ""}:${normalizeSearchText(item.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ score, description, ...item }) => item);
};

const uploadOptionalImageFromField = async (req, fieldName, folder) => {
  const filePath = req?.files?.[fieldName]?.[0]?.path;
  if (!filePath) return null;

  const uploaded = await uploadOnCloudinaryService(filePath, folder);
  if (!uploaded?.secure_url) {
    throw new ApiError(500, `${fieldName} upload failed`);
  }

  return uploaded.secure_url;
};

const invalidateCategoryCache = async () => {
  if (!redisClientConfig.isOpen) return;

  try {
    const keysToDelete = [];
    for await (const key of redisClientConfig.scanIterator({ MATCH: `${CATEGORY_CACHE_PREFIX}*` })) {
      keysToDelete.push(key);
    }

    if (keysToDelete.length > 0) {
      await redisClientConfig.del(keysToDelete);
    }
  } catch {
    // Non-blocking cache invalidation.
  }
};

export const createCategory = asyncHandler(async (req, res) => {
  const title = normalizeString(req.body?.title);

  if (!title) {
    throw new ApiError(400, "Category title is required");
  }

  const categoryExists = await Category.exists({ title: new RegExp(`^${escapeRegExp(title)}$`, "i") });
  if (categoryExists) {
    throw new ApiError(409, "Category with this title already exists");
  }

  const category = await Category.create({
    title,
    services: [],
  });

  await invalidateCategoryCache();

  return res
    .status(201)
    .json(new ApiResponse(201, category, "Category created successfully"));
});

// ADD SERVICE INTO CATEGORY
export const addService = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const name = normalizeString(req.body?.name);
  const logoImageFromBody = normalizeString(req.body?.logoImage) || null;
  const bannerImageFromBody = normalizeString(req.body?.bannerImage) || null;

  ensureObjectIdParam(categoryId, "Category id");

  if (!name) {
    throw new ApiError(400, "Service name is required");
  }

  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  const serviceExists = category.services.some(
    (service) => normalizeString(service.name).toLowerCase() === name.toLowerCase()
  );

  if (serviceExists) {
    throw new ApiError(409, "Service already exists in this category");
  }

  const mediaFolders = buildCategoryMediaFolders({
    categoryTitle: category.title,
    serviceName: name,
  });

  const uploadedLogoImage = await uploadOptionalImageFromField(
    req,
    "logoImage",
    mediaFolders.serviceLogo
  );
  const uploadedBannerImage = await uploadOptionalImageFromField(
    req,
    "bannerImage",
    mediaFolders.serviceBanner
  );

  category.services.push({
    name,
    logoImage: uploadedLogoImage || logoImageFromBody || undefined,
    bannerImage: uploadedBannerImage || bannerImageFromBody || undefined,
    subServices: [],
  });

  await category.save();
  await invalidateCategoryCache();

  return res
    .status(200)
    .json(new ApiResponse(200, category, "Service added successfully"));
});

// ADD SUBSERVICE (main pricing)
export const addSubService = asyncHandler(async (req, res) => {
  const { categoryId, serviceId } = req.params;
  const name = normalizeString(req.body?.name);
  const description = normalizeString(req.body?.description);
  const parsedPrice = Number(req.body?.price);

  ensureObjectIdParam(categoryId, "Category id");
  ensureObjectIdParam(serviceId, "Service id");

  if (!name) {
    throw new ApiError(400, "Subservice name is required");
  }

  if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
    throw new ApiError(400, "Valid subservice price is required");
  }

  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  const service = category.services.id(serviceId);
  if (!service) {
    throw new ApiError(404, "Service not found");
  }

  const subServiceExists = service.subServices.some(
    (subService) => normalizeString(subService.name).toLowerCase() === name.toLowerCase()
  );

  if (subServiceExists) {
    throw new ApiError(409, "Subservice already exists in this service");
  }

  const localFilePath = req.file?.path;
  if (!localFilePath) {
    throw new ApiError(400, "Image file is required");
  }

  const mediaFolders = buildCategoryMediaFolders({
    categoryTitle: category.title,
    serviceName: service.name,
    subServiceName: name,
  });

  const cloudinaryResponse = await uploadOnCloudinaryService(
    localFilePath,
    mediaFolders.subServiceImage
  );
  if (!cloudinaryResponse?.secure_url) {
    throw new ApiError(500, "Cloudinary upload failed");
  }

  service.subServices.push({
    name,
    price: parsedPrice,
    description: description || undefined,
    image: cloudinaryResponse.secure_url,
  });

  await category.save();
  await invalidateCategoryCache();

  return res
    .status(200)
    .json(new ApiResponse(200, category, "Subservice added successfully"));
});

// GET ALL CATEGORIES (full nested data)
export const getAllCategories = asyncHandler(async (_req, res) => {
  const cacheKey = getAllCategoriesCacheKey();
  const cachedData = await redisGetJson(cacheKey);

  if (Array.isArray(cachedData)) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Categories fetched successfully"));
  }

  const data = await Category.find().sort({ createdAt: -1 }).lean();
  await redisSetJson(cacheKey, data, CATEGORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Categories fetched successfully"));
});

// GET TOP 3 POPULAR SUBSERVICES
export const getPopularSubServices = asyncHandler(async (_req, res) => {
  const cacheKey = getPopularSubServicesCacheKey();
  const cachedData = await redisGetJson(cacheKey);

  if (Array.isArray(cachedData)) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Popular subservices fetched successfully"));
  }

  const categories = await Category.find()
    .select("title services createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const subServices = mapCategorySubServices(categories);
  const data = pickPopularSubServices(subServices, 3);

  await redisSetJson(cacheKey, data, CATEGORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Popular subservices fetched successfully"));
});

// SEARCH CATEGORIES, SERVICES, AND SUBSERVICES
export const searchCategorySuggestions = asyncHandler(async (req, res) => {
  const query = normalizeString(req.query?.q || req.query?.query);
  const requestedLimit = Number.parseInt(req.query?.limit || "8", 10);
  const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 8, 5), 10);

  if (!query) {
    const categories = await Category.find()
      .select("title services createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();
    const data = pickPopularSubServices(mapCategorySubServices(categories), Math.min(limit, 10));

    return res
      .status(200)
      .json(new ApiResponse(200, data, "Search suggestions fetched successfully"));
  }

  const cacheKey = getCategorySearchCacheKey(query, limit);
  const cachedData = await redisGetJson(cacheKey);

  if (Array.isArray(cachedData)) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Search suggestions fetched successfully"));
  }

  const categories = await Category.find()
    .select("title services")
    .sort({ createdAt: -1 })
    .lean();
  const items = mapCategorySearchItems(categories);
  const matchedData = searchCategoryItems({ items, query, limit });
  const data =
    matchedData.length > 0
      ? matchedData
      : pickPopularSubServices(mapCategorySubServices(categories), limit);

  await redisSetJson(cacheKey, data, CATEGORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Search suggestions fetched successfully"));
});

// GET SINGLE CATEGORY
export const getCategoryById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  ensureObjectIdParam(id, "Category id");

  const cacheKey = getCategoryByIdCacheKey(id);
  const cachedData = await redisGetJson(cacheKey);
  if (cachedData) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Category fetched successfully"));
  }

  const data = await Category.findById(id);
  if (!data) {
    throw new ApiError(404, "Category not found");
  }

  await redisSetJson(cacheKey, data, CATEGORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Category fetched successfully"));
});

// GET SERVICES BY CATEGORY
export const getServicesByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  ensureObjectIdParam(categoryId, "Category id");

  const cacheKey = getCategoryServicesCacheKey(categoryId);
  const cachedServices = await redisGetJson(cacheKey);
  if (cachedServices) {
    return res.status(200).json({
      success: true,
      services: cachedServices,
    });
  }

  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  await redisSetJson(cacheKey, category.services, CATEGORY_CACHE_TTL_SECONDS);

  return res.status(200).json({
    success: true,
    services: category.services,
  });
});

// GET SINGLE SUBSERVICE DETAILS
export const getSubServiceDetails = asyncHandler(async (req, res) => {
  const { categoryId, serviceId, subServiceId } = req.params;
  ensureObjectIdParam(categoryId, "Category id");
  ensureObjectIdParam(serviceId, "Service id");
  ensureObjectIdParam(subServiceId, "Subservice id");

  const cacheKey = getSubServiceDetailsCacheKey(categoryId, serviceId, subServiceId);
  const cachedSubService = await redisGetJson(cacheKey);
  if (cachedSubService) {
    return res.status(200).json(
      new ApiResponse(200, cachedSubService, "Subservice details fetched successfully")
    );
  }

  const category = await Category.findById(categoryId);
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

  const subServiceData = {
    name: subService.name,
    price: subService.price,
    quantity: subService.quantity,
    image: subService.image,
    description: subService.description,
    averageRating: subService.averageRating,
    totalBookingCount: subService.totalBookingCount,
  };

  await redisSetJson(cacheKey, subServiceData, CATEGORY_CACHE_TTL_SECONDS);

  return res.status(200).json(
    new ApiResponse(
      200,
      subServiceData,
      "Subservice details fetched successfully"
    )
  );
});
