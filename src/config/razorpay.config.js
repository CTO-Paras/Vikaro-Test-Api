const razorpayConfig = {
  keyId: process.env.RAZORPAY_KEY_ID,
  keySecret: process.env.RAZORPAY_KEY_SECRET,
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
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
