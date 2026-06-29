import { Router } from "express";
import { body } from "express-validator";
import { isOtpBypassMobileNumber } from "../utils/phoneNumber.js";
import {
  handlerSendOtp,
  handlerVerifyOtp,
  handlerRegisterFreelancerProfile,
  handlerCurrentLoggedInFreelancer,
  handlerUpdateFreelancerProfile,
  handlerLogoutFreelancer,
} from "../controllers/authFreelancer.controller.js";
import { verifyTokenMiddleware,verifyFreelancerMiddleware } from "../middlewares/auth.middleware.js";
import { uploadMiddleware } from "../middlewares/multer.middleware.js";
import {
  sendOtpLimiterMiddleware,
  verifyOtpLimiterMiddleware,
  registerLimiterMiddleware,
  authReadLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";

const authFreelancerRouter = Router();

authFreelancerRouter.get( 
  "/current-logged-in",
  authReadLimiterMiddleware, 
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerCurrentLoggedInFreelancer
);

authFreelancerRouter.post(
  "/send-otp", 
  sendOtpLimiterMiddleware,
  [
    body("mobileNumber")
      .notEmpty()
      .withMessage("Phone number is required")
      .if((value) => !isOtpBypassMobileNumber(value, "freelancer"))
      .isMobilePhone("any")
      .withMessage("Invalid phone number format"),
    body("role")
      .notEmpty()
      .withMessage("Role is required")
      .isIn(["freelancer"])
      .withMessage("Invalid role"),
    body("playerId").notEmpty().withMessage("Player ID is required"),
    validateMiddleware,
  ],
  handlerSendOtp
);

authFreelancerRouter.post(
  "/verify-otp",
  verifyOtpLimiterMiddleware,
  [
    body("mobileNumber")
      .notEmpty()
      .withMessage("Phone number is required")
      .if((value) => !isOtpBypassMobileNumber(value, "freelancer"))
      .isMobilePhone("any")
      .withMessage("Invalid phone number format"),
    body("role")
      .notEmpty()
      .withMessage("Role is required")
      .isIn(["freelancer"])
      .withMessage("Invalid role"),
    body("otp")
      .notEmpty()
      .withMessage("OTP is required")
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP must be 6 digits")
      .isNumeric()
      .withMessage("OTP must be numeric"),
    validateMiddleware,
  ],
  handlerVerifyOtp
);

authFreelancerRouter.post(
  "/register",
  registerLimiterMiddleware,
  uploadMiddleware.single("profilePicture"),
  [
    body("mobileNumber")
      .notEmpty()
      .withMessage("Mobile number is required")
      .isMobilePhone("any")
      .withMessage("Invalid mobile number format"),

    body("fullname")
      .notEmpty()
      .withMessage("Full name is required")
      .isLength({ min: 3 })
      .withMessage("Full name must be at least 3 characters"),

    body("vehicleType")
      .notEmpty()
      .withMessage("Vehicle type is required")
      .isIn(["Bike", "scooter", "Other", "Don't have a vehicle"])
      .withMessage("Invalid vehicle type"),

    body("experience")
      .notEmpty()
      .withMessage("Experience is required")
      .isIn(["0-1", "1-2", "2-4", "4+"])
      .withMessage("Invalid experience value"),

    body("skill")
      .notEmpty()
      .withMessage("Skill is required")
      .isIn([
        "Plumbing",
        "Electrical",
        "Carpenter",
        "Painter",
        "AC Repair",
        "Mechanic",
      ])
      .withMessage("Invalid skill"),

    body("gender")
      .notEmpty()
      .withMessage("Gender is required")
      .isIn(["male", "female", "other"])
      .withMessage("Gender must be 'male', 'female' or 'other'"),

    body("address")
      .notEmpty()
      .withMessage("Address is required")
      .isLength({ min: 5 })
      .withMessage("Address must be at least 5 characters"),

    body("coordinates")
      .notEmpty()
      .withMessage("Coordinates are required")
      .isArray({ min: 2, max: 2 })
      .withMessage("Coordinates must be [lng, lat]"),

    body("role")
      .notEmpty()
      .withMessage("Role is required")
      .isIn(["freelancer"])
      .withMessage("Invalid role"),

    body("playerId").notEmpty().withMessage("Player ID is required"),

    validateMiddleware,
  ],
  handlerRegisterFreelancerProfile
);

authFreelancerRouter.patch(
  "/update-profile",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  uploadMiddleware.single("profilePicture"),
  [
    body("fullname")
      .optional()
      .isString()
      .withMessage("Full name must be a string")
      .isLength({ min: 3 })
      .withMessage("Full name must be at least 3 characters"),
    body("mobileNumber")
      .optional()
      .isMobilePhone("any")
      .withMessage("Invalid mobile number format"),
    body("otp")
      .optional()
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP must be 6 digits")
      .isNumeric()
      .withMessage("OTP must be numeric"),
    body("address")
      .optional()
      .isString()
      .withMessage("Address must be a string"),
    validateMiddleware,
  ],
  handlerUpdateFreelancerProfile
);

authFreelancerRouter.post(
  "/logout",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerLogoutFreelancer
);




export { authFreelancerRouter };