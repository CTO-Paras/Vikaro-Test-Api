import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendOTPService ,verifyOTPService } from "../services/otp.service.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { generateAccessToken } from "../utils/TokenHandler.js";



const handlerCurrentLoggedInCustomer=asyncHandler(async(req,res)=>{
  const customer = req.user;
  res.status(200).json(new ApiResponse(true, customer, "Current logged-in customer retrieved successfully"));
})



const handlerSendOtp = asyncHandler(async (req, res) => {

  const { mobileNumber, playerId } = req.body;
  const customer = await ProfileCustomer.findOne({ mobileNumber });
  if (customer && playerId) {
    const existingPlayer = await ProfileCustomer.findOne({ playerId });
    if (!existingPlayer) {
      customer.playerId = playerId;
      await customer.save();
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

    const customer = await ProfileCustomer.findOne({ mobileNumber }).select('');

    // 🔥 If customer already exists → LOGIN
    if (customer) {
        const accessToken = await generateAccessToken(customer);

        return res.status(200).json(
            new ApiResponse(
                200,
                { isNewUser: false, customer, accessToken },
                "Customer logged in successfully"
            )
        );
    }

    // 🔥 If customer does NOT exist → ask for profile
    return res.status(200).json(
        new ApiResponse(
            200,
            { isNewUser: true },
            "OTP verified. Please complete profile."
        )
    );
});


const handlerRegisterCustomerProfile = asyncHandler(async (req, res) => {
  const {
    mobileNumber,
    fullname,
    address,
    coordinates,
    role,
    playerId
  } = req.body;

  if (!coordinates || coordinates.length !== 2) {
    throw new ApiError(400, "Valid coordinates are required");
  }

  // Check duplicate
  const existingCustomer = await ProfileCustomer.findOne({ mobileNumber });

  if (existingCustomer) {
    throw new ApiError(400, "Customer already registered with this number");
  }

  let finalPlayerId = null;

  if (playerId) {
    const existingCustomerPlayer = await ProfileCustomer.findOne({ playerId });
    const existingFreelancerPlayer = await ProfileFreelancer.findOne({ playerId });

    if (!existingCustomerPlayer && !existingFreelancerPlayer) {
      finalPlayerId = playerId;
    }
  }
  

  const customer = await ProfileCustomer.create({
    mobileNumber,
    fullname,
    address,
    role,
    location: {
      type: "Point",
      coordinates,
    },
     playerId: finalPlayerId
  });

  const accessToken = await generateAccessToken(customer);

  const customerData = await ProfileCustomer.findById(customer._id).select('');

  return res.status(201).json(
    new ApiResponse(
      201,
      { customer: customerData, accessToken },
      "Customer profile created successfully"
    )
  );
});



export { handlerSendOtp, handlerVerifyOtp, handlerCurrentLoggedInCustomer, handlerRegisterCustomerProfile };