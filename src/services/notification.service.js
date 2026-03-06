import { ApiError } from "../utils/APIError.js";
import { oneSignalConfig } from "../config/oneSignal.config.js";
import axios from "axios";


const sendPushNotificationService = async ({ playerIds, title, message, data }) => {
  try {
    const response = await axios.post(
      oneSignalConfig.baseUrl,
      {
        app_id: oneSignalConfig.appId,
        include_player_ids: playerIds,
      headings: { en: title },
      contents: { en: message },
      data: data || {}
    },
    {
      headers: {
        Authorization: `Basic ${oneSignalConfig.apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
} catch (error) {
  console.error("Error sending push notification:", error);
  throw new ApiError(500, "Failed to send push notification");
}       
};

export { sendPushNotificationService };