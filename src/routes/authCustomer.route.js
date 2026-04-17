import { Router } from "express";
import { body } from "express-validator";
import {
    handlerSendOtp,
    handlerVerifyOtp,
    handlerRegisterCustomerProfile,
    handlerCurrentLoggedInCustomer,
    handlerUpdateCustomerAddress,
    handlerUpdateCustomerProfile,
} from "../controllers/authCustomer.controller.js";
import {
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
} from "../middlewares/auth.middleware.js";
import {
    sendOtpLimiterMiddleware,
    verifyOtpLimiterMiddleware,
    registerLimiterMiddleware,
    authReadLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";

const authCustomerRouter = Router();

authCustomerRouter.get(
    "/current-logged-in",
    authReadLimiterMiddleware,
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    handlerCurrentLoggedInCustomer
);

authCustomerRouter.post(
    "/send-otp",
    sendOtpLimiterMiddleware,
    [
        body("mobileNumber")
            .notEmpty()
            .withMessage("Phone number is required")
            .isMobilePhone("any")
            .withMessage("Invalid phone number format"),
        body("role")
            .notEmpty()
            .withMessage("Role is required")
            .isIn(["customer"])
            .withMessage("Invalid role"),
        body("playerId").optional(),
        validateMiddleware,
    ],
    handlerSendOtp
);

authCustomerRouter.post(
    "/verify-otp",
    verifyOtpLimiterMiddleware,
    [
        body("mobileNumber")
            .notEmpty()
            .withMessage("Phone number is required")
            .isMobilePhone("any")
            .withMessage("Invalid phone number format"),
        body("role")
            .notEmpty()
            .withMessage("Role is required")
            .isIn(["customer"])
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

authCustomerRouter.post(
    "/register",
    registerLimiterMiddleware,
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
        body("gender")
            .notEmpty() 
            .withMessage("Gender is required")
            .isIn(["Male", "Female", "Other", "male", "female", "other"])
            .withMessage("Invalid gender value"),
        body("role")
            .notEmpty()
            .withMessage("Role is required")
            .isIn(["customer"])
            .withMessage("Invalid role"),

        body("playerId").notEmpty().withMessage("Player ID is required"),
        validateMiddleware,
    ],
    handlerRegisterCustomerProfile
);

authCustomerRouter.patch(
    "/update-address",
    authReadLimiterMiddleware,
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    [
        body("address")
            .optional()
            .isLength({ min: 5 })
            .withMessage("Address must be at least 5 characters"),
        body("coordinates")
            .optional()
            .isArray({ min: 2, max: 2 })
            .withMessage("Coordinates must be [lng, lat]"),
        validateMiddleware,
    ],
    handlerUpdateCustomerAddress
);

authCustomerRouter.patch(
    "/update-profile",
    authReadLimiterMiddleware,
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    [
        body("fullname")
            .optional()
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
        validateMiddleware,
    ],
    handlerUpdateCustomerProfile
);

export { authCustomerRouter };