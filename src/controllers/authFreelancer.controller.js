import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from '../utils/APIResponce.js';
import { sendOTPService, verifyOTPService } from "../services/sms.service.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { generateAccessToken } from "../utils/generateToken.js";
import { uploadOnCloudinaryService } from "../services/cloudinary.service.js";


const handlerCurrentLoggedInFreelancer=asyncHandler(async(req,res)=>{
  const freelancer = req.user;
  res.status(200).json(new ApiResponse(true, freelancer, "Current logged-in freelancer retrieved successfully"));
})


const handlerSendOtp = asyncHandler(async (req, res) => {
    const { mobileNumber } = req.body;
    await sendOTPService(mobileNumber);
    res.status(200).json(new ApiResponse(true, "OTP sent successfully"));
});

const handlerVerifyOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, otp } = req.body;

  await verifyOTPService(mobileNumber, otp);

  const freelancer = await ProfileFreelancer.findOne({ mobileNumber });

  // 🔥 If freelancer already exists → LOGIN
  if (freelancer) {
    const accessToken = await generateAccessToken(freelancer);

    return res.status(200).json(
      new ApiResponse(
        200,
        { isNewUser: false, freelancer, accessToken },
        "Freelancer logged in successfully"
      )
    );
  }

  // 🔥 If freelancer does NOT exist → ask for profile
  return res.status(200).json(
    new ApiResponse(
      200,
      { isNewUser: true },
      "OTP verified. Please complete profile."
    )
  );
});

const handlerRegisterFreelancerProfile = asyncHandler(async (req, res) => {
  const {
    mobileNumber,
    fullname,
    vehicleType,
    experience,
    skill,
    address,
    role
  } = req.body;

  // Check duplicate
  const existingFreelancer = await ProfileFreelancer.findOne({ mobileNumber });

  if (existingFreelancer) {
    throw new ApiError(400, "Freelancer already registered with this number");
  }

  let pictureUrl = null;

  if (req.file && req.file.path) {
    const picture = await uploadOnCloudinaryService(req.file.path);
    if (!picture) {
      throw new ApiError(400, "Cloudinary upload failed");
    }
    pictureUrl = picture.secure_url || picture.url;
  }

  const freelancer = await ProfileFreelancer.create({
    mobileNumber,
    fullname,
    vehicleType,
    experience,
    skill,
    address,
    profilePicture: pictureUrl,
    role: role
  });

  const accessToken = await generateAccessToken(freelancer);

  return res.status(201).json(
    new ApiResponse(
      201,
      { freelancer, accessToken },
      "Freelancer profile created successfully"
    )
  );
});


export { handlerSendOtp, handlerVerifyOtp, handlerRegisterFreelancerProfile, handlerCurrentLoggedInFreelancer };   


