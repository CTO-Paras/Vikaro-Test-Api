import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
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
    bankAccountNumber: {
      type: String,
      required: true,
    },
    ifscCode: {
      type: String,
      required: true,
    },
    accountHolderName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["requested", "processing", "completed", "rejected"],
      default: "requested",
    },
    remarks: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    walletDebitApplied: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ freelancerId: 1, createdAt: -1 });

export const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);