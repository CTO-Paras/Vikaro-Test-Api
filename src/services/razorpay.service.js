import crypto from "crypto";
import Razorpay from "razorpay";
import { ApiError } from "../utils/APIError.js";
import { assertRazorpayConfig, razorpayConfig } from "../config/razorpay.config.js";

let razorpayInstance = null;

const normalizeErrorMessage = (error) => {
  if (!error) return "Unknown error";

  if (typeof error === "string") return error;

  const razorpayError = error.response?.data?.error || error.error;
  if (typeof razorpayError === "string") return razorpayError;

  if (razorpayError?.description) return razorpayError.description;
  if (razorpayError?.reason) return razorpayError.reason;
  if (razorpayError?.message) return razorpayError.message;

  if (error.response?.data?.message) return error.response.data.message;
  if (error.message) return typeof error.message === "string" ? error.message : JSON.stringify(error.message);

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

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
  let order;

  try {
    order = await client.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes,
    });
  } catch (error) {
    const statusCode = error?.statusCode || error?.response?.status || 500;
    throw new ApiError(statusCode, normalizeErrorMessage(error));
  }

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
