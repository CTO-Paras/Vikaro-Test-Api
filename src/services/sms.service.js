import bcrypt from "bcrypt";
import { redisClientConfig } from "../config/redis.config.js";
import { ApiError } from "../utils/APIError.js";

const OTP_EXPIRY = 1000; 
const MAX_ATTEMPTS = 3;

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendOTPService = async (phone) => {
  const otp = generateOTP();
  const hashedOTP = await bcrypt.hash(otp, 10);

  
//send otp to the phoine number 

  // Store OTP with expiry
  await redisClientConfig.set(
    `otp:${phone}`,
    hashedOTP,
    {
      EX: OTP_EXPIRY,
    }
  );

  // Reset attempts
  await redisClientConfig.set(`otp_attempts:${phone}`, 0, {
    EX: OTP_EXPIRY,
  });

  console.log("Generated OTP:", otp); 

  return true;
};

const verifyOTPService = async (phone, userOTP) => {
  const key = `otp:${phone}`;
  const attemptsKey = `otp_attempts:${phone}`;

  const storedOTP = await redisClientConfig.get(key);

  if (!storedOTP) {
    throw new ApiError(400, "OTP expired or not found");
  }

  const attemptCount = parseInt(await redisClientConfig.get(attemptsKey)) || 0;

  if (attemptCount >= MAX_ATTEMPTS) {
    throw new ApiError(400, "Too many attempts. Try later.");
  }

  const isMatch = await bcrypt.compare(userOTP, storedOTP);


  if (!isMatch) {
    await redisClientConfig.incr(attemptsKey);
    throw new ApiError(400, "Invalid OTP");
  }

  // OTP correct → delete keys
  await redisClientConfig.del(key);
  await redisClientConfig.del(attemptsKey);

  return true;
};

export { sendOTPService, verifyOTPService };