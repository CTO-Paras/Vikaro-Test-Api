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
const getCategoryByIdCacheKey = (categoryId) => `${CATEGORY_CACHE_PREFIX}id:${categoryId}`;
const getCategoryServicesCacheKey = (categoryId) => `${CATEGORY_CACHE_PREFIX}services:${categoryId}`;
const getSubServiceDetailsCacheKey = (categoryId, serviceId, subServiceId) =>
  `${CATEGORY_CACHE_PREFIX}sub:${categoryId}:${serviceId}:${subServiceId}`;

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

  if (cachedData) {
    return res
      .status(200)
      .json(new ApiResponse(200, cachedData, "Categories fetched successfully"));
  }

  const data = await Category.find();
  await redisSetJson(cacheKey, data, CATEGORY_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Categories fetched successfully"));
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