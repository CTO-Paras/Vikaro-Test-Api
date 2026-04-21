import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileCustomer",
      required: true,
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
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
      enum: ["razorpay", "manual"],
      default: "razorpay",
    },
    providerPaymentId: {
      type: String,
      default: null,
    },
    providerOrderId: {
      type: String,
      default: null,
    },
    providerSignature: {
      type: String,
      default: null,
    },
    providerWebhookEventId: {
      type: String,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["online", "cash",null],
      default: null,
    },
    status: {
      type: String,
      enum: ["pending","processing", "paid", "failed", "refunded"],
      default: "pending",
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

transactionSchema.index({ freelancerId: 1, createdAt: -1 });
transactionSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true });
transactionSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true });

export const Transaction = mongoose.model("Transaction", transactionSchema);
