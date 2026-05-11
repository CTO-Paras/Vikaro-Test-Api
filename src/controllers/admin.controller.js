import bcrypt from "bcrypt";
import { Admin } from "../models/admin.model.js";
import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { generateAccessToken } from "../utils/TokenHandler.js";
import { redisClientConfig } from "../config/redis.config.js";
import { optionsConfig } from "../config/options.config.js";

const CURRENT_ADMIN_CACHE_TTL_SECONDS = 2 * 60;
const CURRENT_ADMIN_SUCCESS_MESSAGE = "Current logged-in admin fetched successfully";

const buildCurrentAdminCacheKey = (adminId) => `cache:admin:current:${adminId}`;

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

const toSafeAdmin = (admin) => ({
	_id: admin?._id,
	name: admin?.name,
	email: admin?.email,
	role: admin?.role,
	isActive: admin?.isActive,
	profileImage: admin?.profileImage,
	lastLoginAt: admin?.lastLoginAt,
});

const cacheCurrentAdmin = async (admin) => {
	const adminId = admin?._id?.toString?.();
	if (!adminId) return;

	await redisSetJson(
		buildCurrentAdminCacheKey(adminId),
		admin,
		CURRENT_ADMIN_CACHE_TTL_SECONDS
	);
};

const handlerAdminLogin = asyncHandler(async (req, res) => {
	const { email, password, specialCode } = req.body;

	if (!email || !password || !specialCode) {
		throw new ApiError(400, "Email, password and special code are required");
	}

	const admin = await Admin.findOne({ email: String(email).toLowerCase().trim() }).select(
		"+password +specialCode"
	);

	if (!admin) {
		throw new ApiError(401, "Invalid login credentials");
	}

	if (!admin.isActive) {
		throw new ApiError(403, "Admin account is inactive");
	}

	const isPasswordValid = await bcrypt.compare(String(password), admin.password);
	if (!isPasswordValid) {
		throw new ApiError(401, "Invalid login credentials");
	}

	if (String(admin.specialCode) !== String(specialCode)) {
		throw new ApiError(401, "Invalid login credentials");
	}

	let accessToken;
	try {
		accessToken = await generateAccessToken({
			_id: admin._id,
			fullname: admin.name,
			mobileNumber: admin.mobileNumber,
			role: admin.role,
		});
	} catch (error) {
		throw new ApiError(500, "Access token secret is not configured");
	}

	admin.lastLoginAt = new Date();
	await admin.save({ validateBeforeSave: false });

	const safeAdmin = toSafeAdmin(admin);
	await cacheCurrentAdmin(safeAdmin);

	return res
		.status(200)
		.cookie("adminToken", accessToken, {
			...optionsConfig,
			maxAge: 24 * 60 * 60 * 1000,
		})
		.json(new ApiResponse(200, { admin: safeAdmin }, "Admin login successful"));
});

const handlerCurrentLoggedInAdmin = asyncHandler(async (req, res) => {
	if (!req.admin) {
		throw new ApiError(401, "Admin not authenticated");
	}

	const adminId = req.admin?._id?.toString?.();
	if (adminId) {
		const cachedAdmin = await redisGetJson(buildCurrentAdminCacheKey(adminId));

		if (cachedAdmin) {
			return res
				.status(200)
				.json(new ApiResponse(200, cachedAdmin, CURRENT_ADMIN_SUCCESS_MESSAGE));
		}
	}

	const safeAdmin = toSafeAdmin(req.admin);
	if (adminId) {
		await cacheCurrentAdmin(safeAdmin);
	}

	return res
		.status(200)
		.json(new ApiResponse(200, safeAdmin, CURRENT_ADMIN_SUCCESS_MESSAGE));
});

export { handlerAdminLogin, handlerCurrentLoggedInAdmin };
