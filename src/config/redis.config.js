import { createClient } from "redis";

const redisClientConfig = createClient({
  url: process.env.REDIS_LOCAL_URL,
}); 

redisClientConfig.on("connect", () => {
  console.log("Redis Connected On " + process.env.REDIS_LOCAL_URL);
});

redisClientConfig.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

const connectRedisConfig = async () => {
  await redisClientConfig.connect();
};

export { redisClientConfig, connectRedisConfig };