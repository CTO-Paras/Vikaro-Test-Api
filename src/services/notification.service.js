import { ApiError } from "../utils/APIError.js";
import { oneSignalConfig } from "../config/oneSignal.config.js";
import axios from "axios";
import { redisClientConfig } from "../config/redis.config.js";

const PUSH_QUEUE_KEY = "queue:push-notifications";

let pushWorkerRunning = false;
let pushWorkerPromise = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildOneSignalPayload = ({ playerIds, title, message, data }) => ({
  app_id: oneSignalConfig.appId,
  include_player_ids: playerIds,
  headings: { en: title },
  contents: { en: message },
  data: data || {},
});

const sendPushNotificationService = async ({ playerIds, title, message, data }) => {
  try {
    const response = await axios.post(oneSignalConfig.baseUrl, buildOneSignalPayload({
      playerIds,
      title,
      message,
      data,
    }), {
      headers: {
        Authorization: `Basic ${oneSignalConfig.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error("Error sending push notification:", error);
    throw new ApiError(500, "Failed to send push notification");
  }
};

const enqueuePushNotificationJob = async (payload) => {
  if (!redisClientConfig.isOpen) {
    await sendPushNotificationService(payload);
    return { queued: false, reason: "redis-unavailable" };
  }

  await redisClientConfig.rPush(
    PUSH_QUEUE_KEY,
    JSON.stringify({
      payload,
      createdAt: new Date().toISOString(),
    })
  );

  return { queued: true };
};

const processPushQueue = async () => {
  while (pushWorkerRunning) {
    try {
      if (!redisClientConfig.isOpen) {
        await wait(1000);
        continue;
      }

      const result = await redisClientConfig.blPop(PUSH_QUEUE_KEY, 3);
      if (!result || !result.element) continue;

      const parsed = JSON.parse(result.element);
      await sendPushNotificationService(parsed.payload);
    } catch (error) {
      console.error("Push queue worker error:", error.message);
      await wait(500);
    }
  }
};

const startPushNotificationWorker = () => {
  if (pushWorkerRunning) return;
  pushWorkerRunning = true;
  pushWorkerPromise = processPushQueue();
};

const stopPushNotificationWorker = async () => {
  pushWorkerRunning = false;
  if (pushWorkerPromise) {
    await pushWorkerPromise;
    pushWorkerPromise = null;
  }
};

export {
  sendPushNotificationService,
  enqueuePushNotificationJob,
  startPushNotificationWorker,
  stopPushNotificationWorker,
};