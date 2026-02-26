import { Router } from "express";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import { body } from "express-validator";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { handlerSendOtp, handlerVerifyOtp,handlerRegisterCustomerProfile,handlerCurrentLoggedInCustomer } from "../controllers/authCustomer.controller.js";
const authCustomerRouter = Router();



authCustomerRouter.get(
    '/current-logged-in-customer',
    verifyTokenMiddleware,
    handlerCurrentLoggedInCustomer
);


authCustomerRouter.post(
    '/send-otp',
    [
        body('mobileNumber')
            .notEmpty().withMessage('Phone number is required')
            .isMobilePhone('en-IN').withMessage('Invalid phone number format'),
        validateMiddleware
    ],
    handlerSendOtp

);


authCustomerRouter.post(
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


authCustomerRouter.post(
    "/register",
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
        body("address")
            .notEmpty()
            .withMessage("Address is required")
            .isLength({ min: 5 })
            .withMessage("Address must be at least 5 characters"),
        body("role")
            .notEmpty()
            .withMessage("Role is required")
            .isIn(['customer'])
            .withMessage("Invalid role"),
                        
        validateMiddleware,
    ],

    handlerRegisterCustomerProfile
);


export { authCustomerRouter };