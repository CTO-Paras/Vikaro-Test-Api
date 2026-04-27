import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendOTPService, verifyOTPService } from "../services/otp.service.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { generateAccessToken } from "../utils/TokenHandler.js";
import { normalizeMobileNumber } from "../utils/phoneNumber.js";
import { redisClientConfig } from "../config/redis.config.js";

const CURRENT_CUSTOMER_CACHE_TTL_SECONDS = 2 * 60;
const CUSTOMER_LOOKUP_SELECT_FIELDS =
  "_id playerId mobileNumber role fullname address gender location";
const CURRENT_CUSTOMER_SUCCESS_MESSAGE =
  "Current logged-in customer retrieved successfully";

const buildCurrentCustomerCacheKey = (customerId) =>
  `cache:customer:current:${customerId}`;

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

const buildMobileCandidates = (mobileNumber) => {
  const rawMobile = String(mobileNumber || "").trim();
  const normalizedMobile = normalizeMobileNumber(rawMobile);
  const digits = rawMobile.replace(/\D/g, "");

  return [
    ...new Set(
      [
        normalizedMobile,
        rawMobile,
        digits,
        digits.length === 10 ? `+91${digits}` : null,
        digits.length > 10 ? `+${digits}` : null,
      ].filter(Boolean)
    ),
  ];
};

const getCustomerByMobileFromDb = async (mobileCandidates) => {
  return ProfileCustomer.findOne({
    mobileNumber: { $in: mobileCandidates },
  })
    .select(CUSTOMER_LOOKUP_SELECT_FIELDS)
    .lean();
};

const cacheCurrentCustomer = async (customer) => {
  const customerId = customer?._id?.toString?.();
  if (!customerId) return;

  await redisSetJson(
    buildCurrentCustomerCacheKey(customerId),
    customer,
    CURRENT_CUSTOMER_CACHE_TTL_SECONDS
  );
};

const deleteCurrentCustomerCache = async (customerId) => {
  if (!customerId || !redisClientConfig.isOpen) return;

  try {
    await redisClientConfig.del(buildCurrentCustomerCacheKey(customerId));
  } catch {
    // Non-blocking cache delete.
  }
};

const findAvailablePlayerId = async (playerId) => {
  if (!playerId) return null;

  const [existingCustomerPlayer, existingFreelancerPlayer] = await Promise.all([
    ProfileCustomer.exists({ playerId }),
    ProfileFreelancer.exists({ playerId }),
  ]);

  if (!existingCustomerPlayer && !existingFreelancerPlayer) {
    return playerId;
  }

  return null;
};

const normalizeGenderValue = (gender) => {
  if (typeof gender !== "string") return gender;
  return gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase();
};

/////////////////////Main handlers for customer auth and profile management/////////////////////

const handlerCurrentLoggedInCustomer = asyncHandler(async (req, res) => {
  const customerId = req.user?._id?.toString?.();

  if (customerId) {
    const cachedCustomer = await redisGetJson(
      buildCurrentCustomerCacheKey(customerId)
    );

    if (cachedCustomer) {
      return res
        .status(200)
        .json(
          new ApiResponse(200, cachedCustomer, CURRENT_CUSTOMER_SUCCESS_MESSAGE)
        );
    }
  }

  const customer = toPlainObject(req.user);

  if (customerId) await cacheCurrentCustomer(customer);

  res
    .status(200)
    .json(new ApiResponse(200, customer, CURRENT_CUSTOMER_SUCCESS_MESSAGE));
});

const handlerSendOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, playerId, role } = req.body;
  const normalizedMobile = normalizeMobileNumber(mobileNumber);
  const mobileCandidates = buildMobileCandidates(mobileNumber);

  let customer = await getCustomerByMobileFromDb(mobileCandidates);

  if (customer && playerId) {
    const existingPlayer = await ProfileCustomer.exists({ playerId });

    if (!existingPlayer) {
      await ProfileCustomer.updateOne(
        { _id: customer._id },
        { $set: { playerId } }
      );
      customer.playerId = playerId;
      await deleteCurrentCustomerCache(customer._id?.toString?.());
    }
  }

  await sendOTPService(normalizedMobile, role, playerId);

  return res
    .status(200)
    .json(new ApiResponse(200, null, "OTP sent successfully"));
});

const handlerVerifyOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, otp, role } = req.body;
  const mobileCandidates = buildMobileCandidates(mobileNumber);
  const normalizedMobile = normalizeMobileNumber(mobileNumber);

  await verifyOTPService(normalizedMobile, role, otp);

  const customer = await getCustomerByMobileFromDb(mobileCandidates);

  if (customer) {
    const accessToken = await generateAccessToken(customer);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { isNewUser: false, customer, accessToken },
          "Customer logged in successfully"
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

const handlerRegisterCustomerProfile = asyncHandler(async (req, res) => {
  const {
    mobileNumber,
    fullname,
    address,
    coordinates,
    role,
    playerId,
    gender,
  } = req.body;
  const normalizedGender = normalizeGenderValue(gender);

  const normalizedMobile = normalizeMobileNumber(mobileNumber);
  const mobileCandidates = buildMobileCandidates(mobileNumber);

  if (!coordinates || coordinates.length !== 2) {
    throw new ApiError(400, "Valid coordinates are required");
  }

  const existingCustomer = await ProfileCustomer.exists({
    mobileNumber: { $in: mobileCandidates },
  });

  if (existingCustomer) {
    throw new ApiError(400, "Customer already registered with this number");
  }

  const finalPlayerId = await findAvailablePlayerId(playerId);

  const customer = await ProfileCustomer.create({
    mobileNumber: normalizedMobile,
    fullname,
    address,
    role,
    gender: normalizedGender,
    location: {
      type: "Point",
      coordinates,
    },
    playerId: finalPlayerId,
  });

  const customerObject = toPlainObject(customer);
  await cacheCurrentCustomer(customerObject);

  const accessToken = await generateAccessToken(customer);

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { customer, accessToken },
        "Customer profile created successfully"
      )
    );
});

const handlerUpdateCustomerAddress = asyncHandler(async (req, res) => {
  const customerId = req.user?._id;

  if (!customerId) {
    throw new ApiError(401, "UNAUTHORISED REQUEST: USER NOT FOUND IN CONTEXT");
  }

  const customer = await ProfileCustomer.findById(customerId);

  if (!customer) {
    throw new ApiError(404, "Customer not found");
  }

  const { address, coordinates } = req.body;

  if (typeof address !== "undefined") {
    customer.address = address;
  }

  if (typeof coordinates !== "undefined") {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      throw new ApiError(400, "Coordinates must be [lng, lat]");
    }

    customer.location = {
      type: "Point",
      coordinates,
    };
  }

  await customer.save();

  const updatedCustomer = await ProfileCustomer.findById(customerId).select(
    CUSTOMER_LOOKUP_SELECT_FIELDS
  );
  const updatedCustomerObject = toPlainObject(updatedCustomer);

  await cacheCurrentCustomer(updatedCustomerObject);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { customer: updatedCustomer },
        "Customer profile updated successfully"
      )
    );
});

const handlerUpdateCustomerProfile = asyncHandler(async (req, res) => {
  const customerId = req.user?._id;

  if (!customerId) {
    throw new ApiError(401, "UNAUTHORISED REQUEST: USER NOT FOUND IN CONTEXT");
  }

  const customer = await ProfileCustomer.findById(customerId);

  if (!customer) {
    throw new ApiError(404, "Customer not found");
  }

  const { fullname, mobileNumber, otp } = req.body;

  if (typeof mobileNumber !== "undefined") {
    const normalizedMobile = normalizeMobileNumber(mobileNumber);

    if (!normalizedMobile) {
      throw new ApiError(400, "Valid mobile number is required");
    }

    if (normalizedMobile !== customer.mobileNumber) {
      const mobileCandidates = buildMobileCandidates(mobileNumber);
      const existingCustomer = await ProfileCustomer.exists({
        mobileNumber: { $in: mobileCandidates },
        _id: { $ne: customerId },
      });

      if (existingCustomer) {
        throw new ApiError(
          400,
          "Another customer is already registered with this mobile number"
        );
      }

      if (!otp) {
        await sendOTPService(normalizedMobile, "customer", customer.playerId);

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

      await verifyOTPService(normalizedMobile, "customer", String(otp));
      customer.mobileNumber = normalizedMobile;
    }
  }

  if (typeof fullname !== "undefined") {
    customer.fullname = fullname;
  }

  await customer.save();

  const updatedCustomer = await ProfileCustomer.findById(customerId).select(
    CUSTOMER_LOOKUP_SELECT_FIELDS
  );
  const updatedCustomerObject = toPlainObject(updatedCustomer);

  await cacheCurrentCustomer(updatedCustomerObject);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { customer: updatedCustomer },
        "Customer basic profile updated successfully"
      )
    );
});

const handlerLogoutCustomer = asyncHandler(async (req, res) => {
  const customerId = req.user?._id?.toString?.();

  await deleteCurrentCustomerCache(customerId);

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Customer logged out successfully"));
});

export {
  handlerSendOtp,
  handlerVerifyOtp,
  handlerCurrentLoggedInCustomer,
  handlerRegisterCustomerProfile,
  handlerUpdateCustomerAddress,
  handlerUpdateCustomerProfile,
  handlerLogoutCustomer,
};
