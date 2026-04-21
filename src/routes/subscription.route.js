
import { Router } from "express";
import { body } from "express-validator";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { subscriptionActionLimiterMiddleware } from "../middlewares/rateLimit.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  handlerCheckSubscriptionStatus,
  handlerCreateProSubscriptionOrder,
  handlerVerifyProSubscriptionPayment,
} from "../controllers/subscription.controller.js";
const subscriptionFreelancerRouter = Router();

subscriptionFreelancerRouter.get(
  "/subscription-status",
  subscriptionActionLimiterMiddleware,
  verifyTokenMiddleware,
  handlerCheckSubscriptionStatus
);

subscriptionFreelancerRouter.post(
  "/buy",
  subscriptionActionLimiterMiddleware,
  verifyTokenMiddleware,
  handlerCreateProSubscriptionOrder
);

subscriptionFreelancerRouter.post(
  "/verify",
  subscriptionActionLimiterMiddleware,
  verifyTokenMiddleware,
  body("razorpayOrderId").notEmpty().withMessage("razorpayOrderId is required"),
  body("razorpayPaymentId").notEmpty().withMessage("razorpayPaymentId is required"),
  body("razorpaySignature").notEmpty().withMessage("razorpaySignature is required"),
  validateMiddleware,
  handlerVerifyProSubscriptionPayment
);

export { subscriptionFreelancerRouter };
