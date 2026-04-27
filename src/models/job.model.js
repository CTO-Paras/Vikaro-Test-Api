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
        "Electrical",
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
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    subServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
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
    customerCancellationFineApplied: {
      type: Boolean,
      default: false,
    },
    customerCancellationFineAmount: {
      type: Number,
      default: 0,
      min: 0,
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
    expiresAt: {
      type: Date,
      default: null,
    },
    requestTimeoutAt: {
      type: Date,
      default: null,
    },
    arrivalTimeoutAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

jobSchema.index({ jobLocation: "2dsphere" });
jobSchema.index({ status: 1, currentFreelancer: 1, expiresAt: 1 });
jobSchema.index({ status: 1, activeFreelancers: 1, expiresAt: 1 });
jobSchema.index({ status: 1, expiresAt: 1, arrivalTimeoutAt: 1 });
jobSchema.index({ customer_id: 1, createdAt: -1 });
jobSchema.index({ acceptedBy: 1, status: 1, updatedAt: -1 });
// Optimised index for freelancer job history queries
jobSchema.index({ acceptedBy: 1, status: 1, createdAt: -1 });
jobSchema.index({ category: 1, status: 1, createdAt: -1 });

jobSchema.methods.setServiceOtp = async function setServiceOtp(otp, ttlMs) {
  // Default TTL (minutes) can be configured via JOB_OTP_TTL_MINUTES env var.
  // If not provided, default to 30 minutes for increased safety.
  const defaultTtlMinutes =
    Number.parseInt(process.env.JOB_OTP_TTL_MINUTES || "30", 10) || 30;
  const defaultTtlMs = defaultTtlMinutes * 60 * 1000;
  const effectiveTtlMs = typeof ttlMs === "number" ? ttlMs : defaultTtlMs;

  this.serviceOtpHash = await bcrypt.hash(String(otp), 10);
  this.serviceOtpExpiresAt = new Date(Date.now() + effectiveTtlMs);
};

jobSchema.methods.verifyServiceOtp = async function verifyServiceOtp(otp) {
  if (!this.serviceOtpHash || !this.serviceOtpExpiresAt) return false;
  if (this.serviceOtpExpiresAt.getTime() < Date.now()) return false;
  return bcrypt.compare(String(otp), this.serviceOtpHash);
};

export const Job = mongoose.model("Job", jobSchema);
