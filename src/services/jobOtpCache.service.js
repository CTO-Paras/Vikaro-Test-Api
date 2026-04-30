import { connectRedisConfig, redisClientConfig } from "../config/redis.config.js";

const buildJobOtpCacheKey = (jobId) => `job:service-otp:${jobId}`;

const getOtpTtlSeconds = (expiresAt) => {
  if (!expiresAt) return 0;
  const expiryTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryTime)) return 0;
  return Math.max(1, Math.floor((expiryTime - Date.now()) / 1000));
};

const cacheJobOtp = async ({ jobId, otp, expiresAt, generatedAt }) => {
  const ttlSeconds = getOtpTtlSeconds(expiresAt);
  if (!jobId || !otp || ttlSeconds <= 0) return;

  try {
    await connectRedisConfig();
    await redisClientConfig.set(
      buildJobOtpCacheKey(jobId),
      JSON.stringify({
        otp,
        expiresAt,
        generatedAt,
      }),
      { EX: ttlSeconds }
    );
  } catch {
    // OTP hash in Mongo remains the source of truth; cache is only for restore display.
  }
};

const getCachedJobOtp = async (jobId) => {
  if (!jobId) return null;

  try {
    await connectRedisConfig();
    const rawValue = await redisClientConfig.get(buildJobOtpCacheKey(jobId));
    if (!rawValue) return null;

    const data = JSON.parse(rawValue);
    if (!data?.otp || !data?.expiresAt) return null;
    if (new Date(data.expiresAt).getTime() <= Date.now()) return null;

    return data;
  } catch {
    return null;
  }
};

export { cacheJobOtp, getCachedJobOtp };
