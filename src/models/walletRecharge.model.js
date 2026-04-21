import mongoose from "mongoose";

const walletRechargeSchema = new mongoose.Schema(
  {
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
      enum: ["razorpay"],
      default: "razorpay",
    },
    providerOrderId: {
      type: String,
      required: true,
    },
    providerPaymentId: {
      type: String,
    },
    providerSignature: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "cancelled"],
      default: "pending",
    },
    walletCreditApplied: {
      type: Boolean,
      default: false,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    notes: {
      referenceId: {
        type: String,
        default: null,
      },
    },
  },
  { timestamps: true }
);

walletRechargeSchema.index({ freelancerId: 1, createdAt: -1 });
walletRechargeSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true });
walletRechargeSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true });

export const WalletRecharge = mongoose.model("WalletRecharge", walletRechargeSchema);
