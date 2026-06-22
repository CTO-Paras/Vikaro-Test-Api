import mongoose from "mongoose";

const counterSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    value: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

export const Counter = mongoose.model("Counter", counterSchema);
const profileFreelancerSchema = new mongoose.Schema(
  {
    mobileNumber: {
      type: String,
      required: true,
      unique: true,
    }, 

    fullname: {
      type: String,
      required: true,
      trim: true,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["online", "offline", "busy"],
      default: "offline",
    },

    vehicleType: {
      type: String,
      enum: [
        "Bike",
        'scooter',
        "Other",
        "Don't have a vehicle",
      ],
      required: true,
    },

    profilePicture: {
      type: String,
      default: null,
      required: false,
    },

    upiId: {
      type: String,
      default: null,
    },

    isUpiVerified: {
      type: Boolean,
      default: false,
    },

    upiVerificationStatus: {
      type: String,
      enum: ["not_submitted", "pending", "verified", "rejected"],
      default: "not_submitted",
    },

    upiSubmittedAt: {
      type: Date,
      default: null,
    },

    upiVerifiedAt: {
      type: Date,
      default: null,
    },

    experience: {
      type: String,
      enum: ["0-1", "1-2", "2-4", "4+"],
      required: true,
    },

    skill: {
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

    address: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    freelancerUniqueId: {
      type: String,
      trim: true,
      immutable: true,
    },
    playerId: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      default: null,
      enum: ["freelancer", "customer"],
      required: true
    },
    dailyJobCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    completedJobsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    freeJobsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    isProActive: {
      type: Boolean,
      default: false,
    },
    proActivatedAt: {
      type: Date,
      default: null,
    },
    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    ratingTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    dailyEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    lifetimeEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    cancelCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    cancelHistory: {
      type: [
        {
          jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Job",
            required: true,
          },
          reason: {
            type: String,
            default: "Cancelled by freelancer",
          },
          cancelledAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    accountStatus: {
      type: String,
      enum: ["active", "temporarily_unverified", "wallet_due"],
      default: "active",
    },
    restrictionUntil: {
      type: Date,
      default: null,
    },
  },

  { timestamps: true }
);


profileFreelancerSchema.index({ location: "2dsphere" });
profileFreelancerSchema.index({ skill: 1, status: 1, isVerified: 1 });
profileFreelancerSchema.index({ playerId: 1 });
profileFreelancerSchema.index({ freelancerUniqueId: 1 }, { unique: true, sparse: true });


export const ProfileFreelancer = mongoose.model(
  "ProfileFreelancer",
  profileFreelancerSchema
);

