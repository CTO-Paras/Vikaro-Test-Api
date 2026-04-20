import mongoose from "mongoose";

const walletLedgerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    source: {
      type: String,
      enum: [
        "payment_settlement",
        "platform_commission",
        "withdrawal",
        "reversal",
        "penalty",
        "correction",
        "recharge",
      ],
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },
    note: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const walletSchema = new mongoose.Schema(
  {
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: -20,
    },
    lifetimeEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    ledger: {
      type: [walletLedgerSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export const Wallet = mongoose.model("Wallet", walletSchema);