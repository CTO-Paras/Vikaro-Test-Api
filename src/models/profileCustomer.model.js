import mongoose from "mongoose";

const profileCustomerSchema = new mongoose.Schema(
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
    role:{
        type:String, 
        default:null,
        enum:["freelancer","customer"],
        required:true      
    }
  },
  { timestamps: true }
);

profileCustomerSchema.index({ location: "2dsphere" });

export const ProfileCustomer = mongoose.model(
  "ProfileCustomer",
  profileCustomerSchema
);