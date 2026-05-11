import { getEnvPairValue } from "../utils/env.js";

const razorpayConfig = {
  keyId: getEnvPairValue({
    localKey: "RAZORPAY_LOCAL_KEY_ID",
    productionKey: "RAZORPAY_PRODUCTION_KEY_ID",
    fallbackKey: "RAZORPAY_KEY_ID",
  }),
  keySecret: getEnvPairValue({
    localKey: "RAZORPAY_LOCAL_KEY_SECRET",
    productionKey: "RAZORPAY_PRODUCTION_KEY_SECRET",
    fallbackKey: "RAZORPAY_KEY_SECRET",
  }),
  webhookSecret: getEnvPairValue({
    localKey: "RAZORPAY_LOCAL_WEBHOOK_SECRET",
    productionKey: "RAZORPAY_PRODUCTION_WEBHOOK_SECRET",
    fallbackKey: "RAZORPAY_WEBHOOK_SECRET",
  }),
};

const assertRazorpayConfig = (requireWebhookSecret = false) => {
  if (!razorpayConfig.keyId || !razorpayConfig.keySecret) {
    throw new Error("Razorpay configuration missing: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET");
  }

  if (requireWebhookSecret && !razorpayConfig.webhookSecret) {
    throw new Error("Razorpay webhook configuration missing: RAZORPAY_WEBHOOK_SECRET");
  }
};

export { razorpayConfig, assertRazorpayConfig };
