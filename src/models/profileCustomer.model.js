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

export const ProfileCustomer = mongoose.model(
  "ProfileCustomer",
  profileCustomerSchema
);