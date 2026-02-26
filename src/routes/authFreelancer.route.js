import { Router } from 'express';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { handlerSendOtp, handlerVerifyOtp, handlerRegisterFreelancerProfile, handlerCurrentLoggedInFreelancer, } from '../controllers/authFreelancer.controller.js';
import { body } from 'express-validator';
import { verifyTokenMiddleware } from '../middlewares/auth.middleware.js';
import { uploadMiddleware } from '../middlewares/multer.middleware.js';
import { sendOtpLimiterMiddleware, verifyOtpLimiterMiddleware } from '../middlewares/rateLimit.middleware.js';
const authFreelancerRouter = Router();


authFreelancerRouter.get(
  '/current-logged-in-freelancer',
  verifyTokenMiddleware,
  handlerCurrentLoggedInFreelancer
);

authFreelancerRouter.post(
  '/send-otp',
  [
    body('mobileNumber')
      .notEmpty().withMessage('Phone number is required')
      .isMobilePhone('en-IN').withMessage('Invalid phone number format'),
    validateMiddleware
  ],
  handlerSendOtp

);

authFreelancerRouter.post(
  '/verify-otp',
  [
    body('mobileNumber')
      .notEmpty().withMessage('Phone number is required')
      .isMobilePhone('en-IN').withMessage('Invalid phone number format'),
    body('otp')
      .notEmpty().withMessage('OTP is required')
      .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
      .isNumeric().withMessage('OTP must be numeric'),
    validateMiddleware
  ],
  handlerVerifyOtp
);

authFreelancerRouter.post(
  "/register",
  uploadMiddleware.single("profilePicture"),
  [
    body("mobileNumber")
      .notEmpty()
      .withMessage("Mobile number is required")
      .isMobilePhone("en-IN")
      .withMessage("Invalid mobile number format"),

    body("fullname")
      .notEmpty()
      .withMessage("Full name is required")
      .isLength({ min: 3 })
      .withMessage("Full name must be at least 3 characters"),

    body("vehicleType")
      .notEmpty()
      .withMessage("Vehicle type is required")
      .isIn(["Bike", "scooter", "Don't have a vehicle"])
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
        "Electrician",
        "Carpenter",
        "Painter",
        "AC Repair",
        "Mechanic",
      ])
      .withMessage("Invalid skill"),

    body("address")
      .notEmpty()
      .withMessage("Address is required")
      .isLength({ min: 5 })
      .withMessage("Address must be at least 5 characters"),

    body("role")
      .notEmpty()
      .withMessage("Role is required")
      .isIn(['freelancer'])
      .withMessage("Invalid role"),

    validateMiddleware,
  ],

  handlerRegisterFreelancerProfile
);

export { authFreelancerRouter };