import mongoose from "mongoose";

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
    service:{
      type: String,
      required: true,
    },
    description: {
      type: String
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
      enum: ["pending", "accepted", "completed", "cancelled"],
      default: "pending",
    },
   
  },
  { timestamps: true }
);

jobSchema.index({ location: "2dsphere" });

export const Job = mongoose.model("Job", jobSchema);