import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/APIError.js";
import jwt from "jsonwebtoken";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
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
        decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (error) {
        throw new ApiError(401, "INVALID OR EXPIRED ACCESS TOKEN");
    }

    const user = await ProfileFreelancer.findById(decodedToken._id);

    if (!user) {
        throw new ApiError(401, "USER NOT FOUND");
    }

    req.user = user;
    next();
});

export { verifyTokenMiddleware };