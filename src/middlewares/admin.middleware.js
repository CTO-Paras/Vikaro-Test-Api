import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/APIError.js";
import { Admin } from "../models/admin.model.js";
import { verifyAccessToken } from "../utils/TokenHandler.js";

const verifyAdminMiddleware = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    token = req.cookies?.adminToken || req.cookies?.token;
  }

  if (!token) {
    throw new ApiError(401, "UNAUTHORISED REQUEST: ADMIN TOKEN NOT FOUND");
  }

  let decodedToken;
  try {
    decodedToken = verifyAccessToken(token);
  } catch (error) {
    throw new ApiError(401, "INVALID OR EXPIRED ADMIN TOKEN");
  }

  if (!decodedToken?._id) {
    throw new ApiError(401, "INVALID ADMIN TOKEN PAYLOAD");
  }

  const admin = await Admin.findById(decodedToken._id).select(
    "-password -specialCode"
  );

  if (!admin) {
    throw new ApiError(401, "ADMIN NOT FOUND");
  }

  if (!admin.isActive) {
    throw new ApiError(403, "ADMIN ACCOUNT IS INACTIVE");
  }

  if (!["admin", "super_admin"].includes(admin.role)) {
    throw new ApiError(403, "INVALID ADMIN ROLE");
  }

  req.admin = admin;
  next();
});

const verifySuperAdminMiddleware = asyncHandler(async (req, res, next) => {
  if (!req.admin) {
    throw new ApiError(401, "ADMIN AUTH REQUIRED");
  }

  if (req.admin.role !== "super_admin") {
    throw new ApiError(403, "SUPER ADMIN ACCESS REQUIRED");
  }

  next();
});

const verifyOnlyAdminMiddleware = asyncHandler(async (req, res, next) => {
  if (!req.admin) {
    throw new ApiError(401, "ADMIN AUTH REQUIRED");
  }

  if (req.admin.role !== "admin") {
    throw new ApiError(403, "ADMIN ACCESS REQUIRED");
  }

  next();
});

export {
  verifyAdminMiddleware,
  verifySuperAdminMiddleware,
  verifyOnlyAdminMiddleware,
};
