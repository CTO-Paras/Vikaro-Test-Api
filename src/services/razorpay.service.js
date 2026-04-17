import crypto from "crypto";
import Razorpay from "razorpay";
import { ApiError } from "../utils/APIError.js";
import { assertRazorpayConfig, razorpayConfig } from "../config/razorpay.config.js";

let razorpayInstance = null;

const getRazorpayClient = () => {
  if (razorpayInstance) return razorpayInstance;

  try {
    assertRazorpayConfig(false);
  } catch (error) {
    throw new ApiError(500, error.message);
  }

  razorpayInstance = new Razorpay({
    key_id: razorpayConfig.keyId,
    key_secret: razorpayConfig.keySecret,
  });

  return razorpayInstance;
};

const createRazorpayOrderService = async ({ amountInRupees, receipt, notes = {} }) => {
  const amountPaise = Math.round(Number(amountInRupees) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new ApiError(400, "Invalid order amount");
  }

  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes,
  });

  return order;
};

const verifyRazorpayPaymentSignatureService = ({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new ApiError(400, "Razorpay order id, payment id and signature are required");
  }

  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", razorpayConfig.keySecret)
    .update(payload)
    .digest("hex");

  return expectedSignature === razorpaySignature;
};

const verifyRazorpayWebhookSignatureService = ({ rawBody, signature }) => {
  try {
    assertRazorpayConfig(true);
  } catch (error) {
    throw new ApiError(500, error.message);
  }

  if (!rawBody || !signature) {
    throw new ApiError(400, "Webhook signature and body are required");
  }

  const expectedSignature = crypto
    .createHmac("sha256", razorpayConfig.webhookSecret)
    .update(rawBody)
    .digest("hex");

  return expectedSignature === signature;
};

export {
  createRazorpayOrderService,
  verifyRazorpayPaymentSignatureService,
  verifyRazorpayWebhookSignatureService,
};
