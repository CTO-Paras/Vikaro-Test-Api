import mongoose from "mongoose";

const paymentWebhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["processed", "ignored", "failed"],
      default: "processed",
    },
    providerOrderId: {
      type: String,
      default: null,
    },
    providerPaymentId: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

paymentWebhookEventSchema.index({ createdAt: -1 });

export const PaymentWebhookEvent = mongoose.model("PaymentWebhookEvent", paymentWebhookEventSchema);
