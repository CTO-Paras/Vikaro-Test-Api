import mongoose from "mongoose";

const freelancerRatingSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      unique: true,
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileCustomer",
      required: true,
    },
    overallRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    feedback: {
      type: String,
      default: "",
      maxlength: 500,
    },
  },
  { timestamps: true }
);

freelancerRatingSchema.index({ freelancerId: 1, createdAt: -1 });

export const FreelancerRating = mongoose.model("FreelancerRating", freelancerRatingSchema);
