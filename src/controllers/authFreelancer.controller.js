import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { sendOTPService, verifyOTPService } from "../services/otp.service.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { Transaction } from "../models/transaction.model.js";
import { generateAccessToken } from "../utils/TokenHandler.js";
import {
  CLOUDINARY_FOLDERS,
  uploadOnCloudinaryService,
} from "../services/cloudinary.service.js";
import { normalizeMobileNumber } from "../utils/phoneNumber.js";
import { redisClientConfig } from "../config/redis.config.js";
import {
  ensureFreelancerUniqueId,
  getNextFreelancerUniqueId,
} from "../services/freelancerUniqueId.service.js";

const CURRENT_FREELANCER_CACHE_TTL_SECONDS = 2 * 60;
const FREELANCER_LOOKUP_SELECT_FIELDS =
  "_id freelancerUniqueId playerId mobileNumber fullname gender vehicleType experience skill address profilePicture location role status isVerified upiId isUpiVerified upiVerificationStatus upiSubmittedAt upiVerifiedAt freeJobsUsed isProActive proActivatedAt completedJobsCount ratingAverage ratingCount walletBalance dailyEarnings lifetimeEarnings accountStatus restrictionUntil";
const CURRENT_FREELANCER_SUCCESS_MESSAGE =
  "Current logged-in freelancer retrieved successfully";

const buildCurrentFreelancerCacheKey = (freelancerId) =>
  `cache:freelancer:current:${freelancerId}`;

const toPlainObject = (value) => (value?.toObject ? value.toObject() : value);

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

const getStatsLast24h = async (freelancerId) => {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const stats = await Transaction.aggregate([
    {
      $match: {
        freelancerId,
        status: "paid",
        paidAt: { $gte: since, $lt: now },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    from: since,
    to: now,
    totalEarnings: stats[0]?.total || 0,
    jobsPaid: stats[0]?.count || 0,
  };
};

const getFreelancerByMobileFromDb = async (normalizedMobile) => {
  return ProfileFreelancer.findOne({
    mobileNumber: normalizedMobile,
  })
    .select(FREELANCER_LOOKUP_SELECT_FIELDS)
    .lean();
};

const cacheCurrentFreelancer = async (freelancer) => {
  const freelancerId = freelancer?._id?.toString?.();
  if (!freelancerId) return;

  await redisSetJson(
    buildCurrentFreelancerCacheKey(freelancerId),
    freelancer,
    CURRENT_FREELANCER_CACHE_TTL_SECONDS
  );
};

const deleteCurrentFreelancerCache = async (freelancerId) => {
  if (!freelancerId || !redisClientConfig.isOpen) return;

  try {
    await redisClientConfig.del(buildCurrentFreelancerCacheKey(freelancerId));
  } catch {
    // Non-blocking cache delete.
  }
};

const findAvailablePlayerId = async (playerId) => {
  if (!playerId) return null;

  const [existingFreelancerPlayer, existingCustomerPlayer] = await Promise.all([
    ProfileFreelancer.exists({ playerId }),
    ProfileCustomer.exists({ playerId }),
  ]);

  if (!existingFreelancerPlayer && !existingCustomerPlayer) {
    return playerId;
  }

  return null;
};

const handlerCurrentLoggedInFreelancer = asyncHandler(async (req, res) => {
  const freelancerId = req.user?._id?.toString?.();
  const freelancerUniqueId = await ensureFreelancerUniqueId(freelancerId);
  let freelancer = null;

  if (freelancerId) {
    freelancer = await redisGetJson(
      buildCurrentFreelancerCacheKey(freelancerId)
    );
  }

  if (!freelancer) {
    freelancer = toPlainObject(req.user);
    await cacheCurrentFreelancer(freelancer);
  }

  if (freelancer.freelancerUniqueId !== freelancerUniqueId) {
    freelancer = { ...freelancer, freelancerUniqueId };
    await cacheCurrentFreelancer(freelancer);
  }

  const statsLast24h = await getStatsLast24h(freelancer._id);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        freelancer,
        statsLast24h,
      },
      CURRENT_FREELANCER_SUCCESS_MESSAGE
    )
  );
});

const handlerSendOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, playerId, role } = req.body;
  const normalizedMobile = normalizeMobileNumber(mobileNumber);
  let freelancer = await getFreelancerByMobileFromDb(normalizedMobile);

  if (freelancer && playerId) {
    const existingPlayer = await ProfileFreelancer.exists({ playerId });

    if (!existingPlayer) {
      await ProfileFreelancer.updateOne(
        { _id: freelancer._id },
        { $set: { playerId } }
      );
      freelancer.playerId = playerId;
      await deleteCurrentFreelancerCache(freelancer._id?.toString?.());
    }
  }

  await sendOTPService(normalizedMobile, role, playerId);

  return res
    .status(200)
    .json(new ApiResponse(200, null, "OTP sent successfully"));
});

const handlerVerifyOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, otp, role } = req.body;
  const normalizedMobile = normalizeMobileNumber(mobileNumber);

  await verifyOTPService(normalizedMobile, role, otp);

  const freelancer = await getFreelancerByMobileFromDb(normalizedMobile);

  if (freelancer) {
    freelancer.freelancerUniqueId = await ensureFreelancerUniqueId(freelancer._id);
    const accessToken = await generateAccessToken(freelancer);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { isNewUser: false, freelancer, accessToken },
          "Freelancer logged in successfully"
        )
      );
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { isNewUser: true },
        "OTP verified. Please complete profile."
      )
    );
});

const handlerRegisterFreelancerProfile = asyncHandler(async (req, res) => {
  const {
    mobileNumber,
    fullname,
    gender,
    vehicleType,
    experience,
    skill,
    coordinates,
    address,
    role,
    playerId,
  } = req.body;

  const normalizedMobile = normalizeMobileNumber(mobileNumber);

  if (!coordinates || coordinates.length !== 2) {
    throw new ApiError(400, "Valid coordinates are required");
  }

  const allowedGenders = ["male", "female", "other"];
  if (!gender || !allowedGenders.includes(String(gender).toLowerCase())) {
    throw new ApiError(400, "Gender must be 'male', 'female' or 'other'");
  }

  const [existingFreelancer, existingCustomer] = await Promise.all([
    ProfileFreelancer.exists({ mobileNumber: normalizedMobile }),
    ProfileCustomer.exists({ mobileNumber: normalizedMobile }),
  ]);

  if (existingFreelancer) {
    throw new ApiError(400, "Freelancer already registered with this number");
  }

  if (existingCustomer) {
    throw new ApiError(400, "This mobile number is already registered as a customer");
  }

  const finalPlayerId = await findAvailablePlayerId(playerId);
  const freelancerUniqueId = await getNextFreelancerUniqueId();

  let pictureUrl = null;

  if (req.file && req.file.path) {
    const picture = await uploadOnCloudinaryService(
      req.file.path,
      CLOUDINARY_FOLDERS.FREELANCER_PROFILE
    );

    if (!picture) {
      throw new ApiError(400, "Cloudinary upload failed");
    }

    pictureUrl = picture.secure_url || picture.url;
  }

  const freelancer = await ProfileFreelancer.create({
    mobileNumber: normalizedMobile,
    fullname,
    gender: String(gender).toLowerCase(),
    vehicleType,
    experience,
    skill,
    address,
    profilePicture: pictureUrl,
    location: {
      type: "Point",
      coordinates,
    },
    role,
    freelancerUniqueId,
    playerId: finalPlayerId,
  });

  const freelancerObject = toPlainObject(freelancer);
  await cacheCurrentFreelancer(freelancerObject);

  const accessToken = await generateAccessToken(freelancer);

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { freelancer, accessToken },
        "Freelancer profile created successfully"
      )
    );
});

const handlerUpdateFreelancerProfile = asyncHandler(async (req, res) => {
  const freelancerId = req.user?._id;

  if (!freelancerId) {
    throw new ApiError(401, "UNAUTHORISED REQUEST: USER NOT FOUND IN CONTEXT");
  }

  const freelancer = await ProfileFreelancer.findById(freelancerId);

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  const { fullname, mobileNumber, address, otp } = req.body;

  if (typeof mobileNumber !== "undefined") {
    const normalizedMobile = normalizeMobileNumber(mobileNumber);

    if (!normalizedMobile) {
      throw new ApiError(400, "Valid mobile number is required");
    }

    if (normalizedMobile !== freelancer.mobileNumber) {
      const [existingFreelancer, existingCustomer] = await Promise.all([
        ProfileFreelancer.exists({
          mobileNumber: normalizedMobile,
          _id: { $ne: freelancerId },
        }),
        ProfileCustomer.exists({ mobileNumber: normalizedMobile }),
      ]);

      if (existingFreelancer || existingCustomer) {
        throw new ApiError(
          400,
          "Another user is already registered with this mobile number"
        );
      }

      if (!otp) {
        await sendOTPService(
          normalizedMobile,
          "freelancer",
          freelancer.playerId
        );

        return res
          .status(200)
          .json(
            new ApiResponse(
              200,
              { otpSent: true, mobileNumber: normalizedMobile },
              "OTP sent successfully. Verify OTP to update mobile number"
            )
          );
      }

      await verifyOTPService(normalizedMobile, "freelancer", String(otp));

      freelancer.mobileNumber = normalizedMobile;
    }
  }

  if (typeof fullname !== "undefined") {
    freelancer.fullname = fullname;
  }

  if (typeof address !== "undefined") {
    freelancer.address = address;
  }

  if (req.file && req.file.path) {
    const picture = await uploadOnCloudinaryService(
      req.file.path,
      CLOUDINARY_FOLDERS.FREELANCER_PROFILE
    );

    if (!picture) {
      throw new ApiError(400, "Profile picture upload failed");
    }

    freelancer.profilePicture = picture.secure_url || picture.url;
  }

  await freelancer.save();

  const updatedFreelancer = await ProfileFreelancer.findById(
    freelancerId
  ).select(FREELANCER_LOOKUP_SELECT_FIELDS);

  const updatedFreelancerObject = toPlainObject(updatedFreelancer);
  await cacheCurrentFreelancer(updatedFreelancerObject);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { freelancer: updatedFreelancer },
        "Profile updated successfully"
      )
    );
});

const handlerLogoutFreelancer = asyncHandler(async (req, res) => {
  const freelancerId = req.user?._id?.toString?.();

  await deleteCurrentFreelancerCache(freelancerId);

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Freelancer logged out successfully"));
});

export {
  handlerSendOtp,
  handlerVerifyOtp,
  handlerRegisterFreelancerProfile,
  handlerCurrentLoggedInFreelancer,
  handlerUpdateFreelancerProfile,
  handlerLogoutFreelancer,
};


