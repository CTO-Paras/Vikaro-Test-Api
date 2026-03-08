import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from '../utils/APIResponce.js';
import { sendOTPService, verifyOTPService } from "../services/otp.service.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { generateAccessToken } from "../utils/TokenHandler.js";
import { uploadOnCloudinaryService } from "../services/cloudinary.service.js";


const handlerCurrentLoggedInFreelancer = asyncHandler(async (req, res) => {
  const freelancer = req.user;
  res.status(200).json(new ApiResponse(true, freelancer, "Current logged-in freelancer retrieved successfully"));
})


const handlerSendOtp = asyncHandler(async (req, res) => {

  const { mobileNumber, playerId } = req.body;
  const freelancer = await ProfileFreelancer.findOne({ mobileNumber });
  if (freelancer && playerId) {
    const existingPlayer = await ProfileFreelancer.findOne({ playerId });
    if (!existingPlayer) {
      freelancer.playerId = playerId;
      await freelancer.save();
    }
  }

  await sendOTPService(mobileNumber, playerId);

  return res.status(200).json(
    new ApiResponse(200, null, "OTP sent successfully")
  );

});

const handlerVerifyOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, otp } = req.body;

  await verifyOTPService(mobileNumber, otp);

  const freelancer = await ProfileFreelancer.findOne({ mobileNumber }).select('');

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
    coordinates,
    address,
    role,
    playerId
  } = req.body;

  if (!coordinates || coordinates.length !== 2) {
    throw new ApiError(400, "Valid coordinates are required");
  }

  /* Check duplicate mobile */
  const existingFreelancer = await ProfileFreelancer.findOne({ mobileNumber });

  if (existingFreelancer) {
    throw new ApiError(400, "Freelancer already registered with this number");
  }

  /* Check if playerId already used */
  let finalPlayerId = null;

  if (playerId) {
    const existingPlayer = await ProfileFreelancer.findOne({ playerId });

    if (!existingPlayer) {
      finalPlayerId = playerId;
    }
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
    location: {
      type: "Point",
      coordinates,
    },
    role,
    playerId: finalPlayerId
  });

  const accessToken = await generateAccessToken(freelancer);

  const freelancerData = await ProfileFreelancer.findById(freelancer._id).select('');

  return res.status(201).json(
    new ApiResponse(
      201,
      { freelancer: freelancerData, accessToken },
      "Freelancer profile created successfully"
    )
  );

});

export { handlerSendOtp, handlerVerifyOtp, handlerRegisterFreelancerProfile, handlerCurrentLoggedInFreelancer };


