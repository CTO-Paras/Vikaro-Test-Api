import mongoose from "mongoose";
import bcrypt from "bcrypt";

const jobSchema = new mongoose.Schema(
  {
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileCustomer",
      required: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
      default: null,
    },
    category: {
      type: String,
      enum: [
        "Plumbing",
        "Electrician",
        "Carpenter",
        "Painter",
        "AC Repair",
        "Mechanic",
      ],
      required: true,
    },
    service: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
    },

    jobLocation: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "rejected",
        "rejected_timeout",
        "arrived",
        "started",
        "completion_pending",
        "in_progress",
        "completed",
        "issue_reported",
        "cancelled",
        "cancelled_by_customer",
        "cancelled_by_freelancer",
        "expired",
      ],
      default: "pending",
    },
    cancelReason: {
      type: String,
      default: null,
    },
    cancelledBy: {
      type: String,
      enum: ["customer", "freelancer", "system", null],
      default: null,
    },
    notifiedFreelancers: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ProfileFreelancer",
        },
      ],
      default: [],
    },
    activeFreelancers: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ProfileFreelancer",
        },
      ],
      default: [],
    },
    rejectedBy: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ProfileFreelancer",
        },
      ],
      default: [],
    },
    expiredBy: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ProfileFreelancer",
        },
      ],
      default: [],
    },
    currentFreelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
      default: null,
    },
    roomId: {
      type: String,
      default: null,
    },
    customerPhoneVisibleToFreelancer: {
      type: Boolean,
      default: false,
    },
    serviceOtpHash: {
      type: String,
      default: null,
      select: false,
    },
    serviceOtpExpiresAt: {
      type: Date,
      default: null,
    },
    serviceStartedAt: {
      type: Date,
      default: null,
    },
    completionMarkedAt: {
      type: Date,
      default: null,
    },
    completionConfirmedAt: {
      type: Date,
      default: null,
    },
    issueDetails: {
      type: String,
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "failed"],
      default: "unpaid",
    },
    paymentQrUrl: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    requestTimeoutAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

jobSchema.index({ jobLocation: "2dsphere" });
jobSchema.index({ status: 1, currentFreelancer: 1, expiresAt: 1 });
jobSchema.index({ status: 1, activeFreelancers: 1, expiresAt: 1 });
jobSchema.index({ customer_id: 1, createdAt: -1 });
jobSchema.index({ acceptedBy: 1, status: 1, updatedAt: -1 });
// Optimised index for freelancer job history queries
jobSchema.index({ acceptedBy: 1, status: 1, createdAt: -1 });
jobSchema.index({ category: 1, status: 1, createdAt: -1 });

jobSchema.methods.setServiceOtp = async function setServiceOtp(otp, ttlMs = 10 * 60 * 1000) {
  this.serviceOtpHash = await bcrypt.hash(String(otp), 10);
  this.serviceOtpExpiresAt = new Date(Date.now() + ttlMs);
};

jobSchema.methods.verifyServiceOtp = async function verifyServiceOtp(otp) {
  if (!this.serviceOtpHash || !this.serviceOtpExpiresAt) return false;
  if (this.serviceOtpExpiresAt.getTime() < Date.now()) return false;
  return bcrypt.compare(String(otp), this.serviceOtpHash);
};

export const Job = mongoose.model("Job", jobSchema);