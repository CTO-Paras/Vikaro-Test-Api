import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/APIError.js";
import { verifyAccessToken } from "../utils/TokenHandler.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
const verifyTokenMiddleware = asyncHandler(async (req, res, next) => {
    let token;

    // 🔹 1️⃣ Check Authorization Header (Android / Postman)
    if (req.headers.authorization?.startsWith("Bearer")) {
        token = req.headers.authorization.split(" ")[1];
    }

    // // 🔹 2️⃣ If no header token, check Cookie (Web)
    if (!token && req.cookies?.token) {
        token = req.cookies.token;
    }

    // 🔹 3️⃣ If no token found
    if (!token) {
        throw new ApiError(401, "UNAUTHORISED REQUEST: NO TOKEN PROVIDED");
    }

        let decodedToken;

        try {
                decodedToken = verifyAccessToken(token);
        } catch (error) {
                throw new ApiError(401, "INVALID OR EXPIRED ACCESS TOKEN");
        }
        
        if (!decodedToken.role || !["freelancer", "customer"].includes(decodedToken.role)) {
                throw new ApiError(401, "INVALID OR MISSING ROLE IN ACCESS TOKEN");
        }

        let user;

        // 🔥 Role Based Fetch
    if (decodedToken.role === "freelancer") {
        user = await ProfileFreelancer.findById(decodedToken._id).select('');
    } else if (decodedToken.role === "customer") {
        user = await ProfileCustomer.findById(decodedToken._id).select('');
    }

    if (!user) {
        throw new ApiError(401, "USER NOT FOUND");
    }

    req.user = user;
    req.userRole = decodedToken.role;
    next();
});

const verifyFreelancerMiddleware = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        throw new ApiError(401, "UNAUTHORISED REQUEST: LOGIN REQUIRED");
    }

    const role = req.user?.role || req.userRole;
    if (role !== "freelancer") {
        throw new ApiError(403, "ONLY FREELANCER CAN ACCESS THIS ROUTE");
    }

    next();
});

const verifyCustomerMiddleware = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        throw new ApiError(401, "UNAUTHORISED REQUEST: LOGIN REQUIRED");
    }

    const role = req.user?.role || req.userRole;
    if (role !== "customer") {
        throw new ApiError(403, "ONLY CUSTOMER CAN ACCESS THIS ROUTE");
    }

    next();
});

export { verifyTokenMiddleware, verifyFreelancerMiddleware, verifyCustomerMiddleware };

