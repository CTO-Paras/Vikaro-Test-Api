import mongoose from "mongoose";

const profileFreelancerSchema = new mongoose.Schema(
  {
    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    fullname: {
      type: String,
      required: true,
      trim: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isProMember: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["online", "offline", "busy"],
      default: "offline", // Better default
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

    experience: {
      type: String,
      enum: ["0-1", "1-2", "2-4", "4+"],
      required: true,
    },

    skill: {
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

    address: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export const ProfileFreelancer = mongoose.model(
  "ProfileFreelancer",
  profileFreelancerSchema
);