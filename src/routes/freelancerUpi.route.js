import { Router } from "express";
import { body } from "express-validator";
import {
  verifyFreelancerMiddleware,
  verifyTokenMiddleware,
} from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  authReadLimiterMiddleware,
  walletWithdrawLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerAddFreelancerUpi,
  handlerVerifyFreelancerUpi,
  handlerGetFreelancerUpi,
} from "../controllers/upi.controller.js";

const freelancerUpiRouter = Router();

// POST /api/v1/freelancer/upi/add
freelancerUpiRouter.post(
  "/add",
  walletWithdrawLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  [
    body("upiId")
      .notEmpty()
      .withMessage("UPI ID is required")
      .matches(/^[\w.-]+@[\w]+$/)
      .withMessage("Invalid UPI ID format"),
    validateMiddleware,
  ],
  handlerAddFreelancerUpi
);

// PATCH /api/v1/freelancer/upi/verify
freelancerUpiRouter.patch(
  "/verify",
  walletWithdrawLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerVerifyFreelancerUpi
);

// GET /api/v1/freelancer/upi
freelancerUpiRouter.get(
  "/",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerGetFreelancerUpi
);

export { freelancerUpiRouter };
