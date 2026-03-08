import mongoose from "mongoose";

const profileCustomerSchema = new mongoose.Schema(
  {
    jobs: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },
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
      default: null
    },
    role:{
        type:String, 
        default:null,
        enum:["freelancer","customer"],
        required:true      
    },

  },
  { timestamps: true }
);

profileCustomerSchema.index({ location: "2dsphere" });

export const ProfileCustomer = mongoose.model(
  "ProfileCustomer",
  profileCustomerSchema
);