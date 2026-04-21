import { Router } from "express";
import { body } from "express-validator";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  paymentWebhookLimiterMiddleware,
  paymentActionLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerCreateRazorpayOrder,
  handlerVerifyRazorpayPayment,
  handlerRazorpayWebhook,
  handlerSettleCashPayment,
} from "../controllers/payment.controller.js";

const jobPaymentRouter = Router();

jobPaymentRouter.post(
  "/payment-webhook",
  paymentWebhookLimiterMiddleware,
  handlerRazorpayWebhook
);

jobPaymentRouter.post(
  "/payment-order",
  paymentActionLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  validateMiddleware,
  handlerCreateRazorpayOrder
);

jobPaymentRouter.post(
  "/payment-verify",
  paymentActionLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("razorpayOrderId").notEmpty().withMessage("razorpayOrderId is required"),
  body("razorpayPaymentId").notEmpty().withMessage("razorpayPaymentId is required"),
  body("razorpaySignature").notEmpty().withMessage("razorpaySignature is required"),
  validateMiddleware,
  handlerVerifyRazorpayPayment
);

jobPaymentRouter.post(
  "/payment-cash-settle",
  paymentActionLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("referenceNote").optional().isString(),
  validateMiddleware,
  handlerSettleCashPayment
);

export { jobPaymentRouter };
