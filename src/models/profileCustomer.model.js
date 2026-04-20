import mongoose from "mongoose";

const profileCustomerSchema = new mongoose.Schema(
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
      enum: ["Male", "Female", "Other", "male", "female", "other"],
      default: null,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], 
        required: true,
      },
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    playerId: {
      type: String,
      default: null,
    },
    role: {
      type: String, 
      default: null,
      enum: ["freelancer", "customer"],
      required: true,
    },
  },
  { timestamps: true }
);

profileCustomerSchema.index({ location: "2dsphere" });
profileCustomerSchema.index({ playerId: 1 });

export const ProfileCustomer = mongoose.model(
  "ProfileCustomer",
  profileCustomerSchema
);