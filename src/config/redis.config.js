import { createClient } from "redis";

const redisUrl =
  process.env.REDIS_LOCAL_URL ||
  process.env.REDIS_PRODUCTION_URL ||
  "redis://127.0.0.1:6379";

const maskedRedisUrl = redisUrl.replace(/:(.*)@/, ":****@");

const redisClientConfig = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error("Redis reconnect retries exhausted");
      return Math.min(retries * 200, 3000);
    },
  },
});

redisClientConfig.on("connect", () => {
  console.log("Redis connected on " + maskedRedisUrl);
});

redisClientConfig.on("ready", () => {
  console.log("Redis client is ready to accept commands");
});

redisClientConfig.on("reconnecting", () => {
  console.warn("Redis reconnecting...");
});

redisClientConfig.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

const connectRedisConfig = async () => {
  if (redisClientConfig.isOpen) return;
  await redisClientConfig.connect();
};

const disconnectRedisConfig = async () => {
  if (!redisClientConfig.isOpen) return;
  await redisClientConfig.quit();
};

export { redisClientConfig, connectRedisConfig, disconnectRedisConfig };