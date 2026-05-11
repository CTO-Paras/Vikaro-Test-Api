import { getEnvPairValue } from "../utils/env.js";

const oneSignalConfig = {
  appId: getEnvPairValue({
    localKey: "ONESIGNAL_LOCAL_APP_ID",
    productionKey: "ONESIGNAL_PRODUCTION_APP_ID",
    fallbackKey: "ONESIGNAL_APP_ID",
  }),
  apiKey: getEnvPairValue({
    localKey: "ONESIGNAL_LOCAL_API_KEY",
    productionKey: "ONESIGNAL_PRODUCTION_API_KEY",
    fallbackKey: "ONESIGNAL_API_KEY",
  }),
  baseUrl: "https://onesignal.com/api/v1/notifications"
};
export { oneSignalConfig };
