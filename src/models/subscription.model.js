import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
      required: true,
    },
    planKey: {
      type: String,
      enum: ["pro_monthly"],
      default: "pro_monthly",
      required: true,
    },
    planName: {
      type: String,
      default: "Pro Subscription",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    provider: {
      type: String,
      enum: ["razorpay"],
      default: "razorpay",
    },
    providerOrderId: {
      type: String,
    },
    providerPaymentId: {
      type: String,
    },
    providerPaymentLinkId: {
      type: String,
    },
    providerPaymentLinkUrl: {
      type: String,
    },
    providerSignature: {
      type: String,
    },
    razorpayReceipt: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "expired", "cancelled"],
      default: "pending",
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ freelancerId: 1, createdAt: -1 });
subscriptionSchema.index({ freelancerId: 1, status: 1, createdAt: -1 });
subscriptionSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true });
subscriptionSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true });
subscriptionSchema.index({ providerPaymentLinkId: 1 }, { unique: true, sparse: true });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);