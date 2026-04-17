
import bcrypt from "bcrypt";
import axios from "axios";
import { redisClientConfig } from "../config/redis.config.js";
import { ApiError } from "../utils/APIError.js";
import { normalizeMobileNumber } from "../utils/phoneNumber.js";

const OTP_EXPIRY = 5 * 60;
const MAX_ATTEMPTS = 3;

const OTP_HASH_ROUNDS = Math.min(
  Math.max(parseInt(process.env.OTP_BCRYPT_ROUNDS || "6", 10), 4),
  12
);

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const parseOtpState = (rawValue) => {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);

    if (
      parsed &&
      typeof parsed.hashedOTP === "string" &&
      Number.isInteger(parsed.attemptCount)
    ) {
      return parsed;
    }
  } catch {
    // Legacy key format stores only the hash string.
  }

  if (typeof rawValue === "string") {
    return {
      hashedOTP: rawValue,
      attemptCount: null,
      legacy: true,
    };
  }

  return null;
};

const sendSMS = async (phone, otp) => {
  try {
    const response = await axios.post(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        route: "dlt",
        sender_id: "VKARO",
        message:
          "Your OTP for login is {#var#}. It is valid for 5 minutes. Do not share this OTP with anyone. - VKARO",
        variables_values: otp,
        flash: 0,
        numbers: phone.toString(),
      },
      {
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.return !== true) {
      throw new Error("SMS sending failed");
    }

    return true;
  } catch (error) {
    console.error("SMS ERROR:", error.response?.data || error.message);
    throw new ApiError(500, "Failed to send OTP SMS");
  }
};

const sendOTPService = async (phone, role, playerId) => {
  const normalizedPhone = normalizeMobileNumber(phone);

  if (!normalizedPhone) {
    throw new ApiError(400, "Mobile number is required");
  }

  const normalizedRole =
    typeof role === "string" ? role.toLowerCase() : null;

  const validRoles = ["customer", "freelancer"];

  if (!normalizedRole || !validRoles.includes(normalizedRole)) {
    throw new ApiError(400, "Invalid or missing role for OTP");
  }

  const otp = generateOTP();
  const hashedOTP = await bcrypt.hash(otp, OTP_HASH_ROUNDS);

  const otpKey = `otp:${normalizedPhone}:${normalizedRole}`;
  const otpState = JSON.stringify({
    hashedOTP,
    attemptCount: 0,
  });

  try {
    // await sendSMS(normalizedPhone, otp);
    await redisClientConfig.set(otpKey, otpState, {
      EX: OTP_EXPIRY,
    });

    console.log("Generated OTP for", normalizedPhone, ":", otp);
    return true;
  } catch (error) {
    console.error("SEND OTP ERROR:", error.message);
    throw new ApiError(500, "Failed to send OTP");
  }
};

const verifyOTPService = async (phone, role, userOTP) => {
  const normalizedPhone = normalizeMobileNumber(phone);

  if (!normalizedPhone) {
    throw new ApiError(400, "Mobile number is required");
  }

  const normalizedRole =
    typeof role === "string" ? role.toLowerCase() : null;

  const validRoles = ["customer", "freelancer"];

  if (!normalizedRole || !validRoles.includes(normalizedRole)) {
    throw new ApiError(
      400,
      "Invalid or missing role for OTP verification"
    );
  }

  const otpKey = `otp:${normalizedPhone}:${normalizedRole}`;
  const attemptsKey = `otp_attempts:${normalizedPhone}:${normalizedRole}`;

  const rawOtpState = await redisClientConfig.get(otpKey);
  const otpState = parseOtpState(rawOtpState);

  if (!otpState) {
    throw new ApiError(
      400,
      "OTP expired, not found, or role mismatch"
    );
  }

  let attemptCount = otpState.attemptCount;

  if (attemptCount === null) {
    const rawAttemptCount = await redisClientConfig.get(attemptsKey);
    attemptCount = parseInt(rawAttemptCount, 10) || 0;
  }


  if (attemptCount >= MAX_ATTEMPTS) {
    throw new ApiError(
      400,
      "Too many attempts. Try again later."
    );
  }

  const isMatch = await bcrypt.compare(userOTP, otpState.hashedOTP);

  if (!isMatch) {
    if (otpState.attemptCount === null) {
      await redisClientConfig.incr(attemptsKey);
    } else {
      await redisClientConfig.set(
        otpKey,
        JSON.stringify({
          hashedOTP: otpState.hashedOTP,
          attemptCount: attemptCount + 1,
        }),
        { KEEPTTL: true }
      );
    }

    throw new ApiError(400, "Invalid OTP");
  }

  await redisClientConfig.del(otpKey, attemptsKey);

  return true;
};

export { sendOTPService, verifyOTPService };