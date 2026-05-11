import { createClient } from "redis";
import { isProductionEnv } from "../utils/env.js";

const getRedisUrl = () => {
  const localUrl = process.env.REDIS_LOCAL_URL || "redis://127.0.0.1:6379";
  const productionUrl = process.env.REDIS_PRODUCTION_URL;

  return isProductionEnv() ? productionUrl || localUrl : localUrl || productionUrl;
};

const redisUrl = getRedisUrl();

const maskedRedisUrl = redisUrl.replace(/:(.*)@/, ":****@");

const createRedisClientConfig = (clientName = "Redis") => {
  const client = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          return new Error(`${clientName} reconnect retries exhausted`);
        }
        return Math.min(retries * 200, 3000);
      },
    },
  });

  client.on("connect", () => {
    console.log(`${clientName} connected on ${maskedRedisUrl}`);
  });

  client.on("ready", () => {
    console.log(`${clientName} is ready to accept commands`);
  });

  client.on("reconnecting", () => {
    console.warn(`${clientName} reconnecting...`);
  });

  client.on("error", (err) => {
    console.error(`Redis Error (${clientName}):`, err);
  });

  return client;
};

const redisClientConfig = createRedisClientConfig("Redis");

const connectRedisConfig = async () => {
  if (redisClientConfig.isOpen) return;
  await redisClientConfig.connect();
};

const disconnectRedisConfig = async () => {
  if (!redisClientConfig.isOpen) return;
  await redisClientConfig.close();
};

export {
  redisClientConfig,
  createRedisClientConfig,
  connectRedisConfig,
  disconnectRedisConfig,
};
