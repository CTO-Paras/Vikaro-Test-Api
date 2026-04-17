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
  handlerGeneratePaymentQr,
  handlerConfirmPayment,
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
  "/payment-qr",
  paymentActionLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("freelancerUpiId").optional().isString(),
  validateMiddleware,
  handlerGeneratePaymentQr
);

jobPaymentRouter.post(
  "/payment-confirm",
  paymentActionLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("paymentMethod")
    .isIn(["online", "cash"])
    .withMessage("paymentMethod must be online or cash"),
  body("transactionId")
    .optional()
    .isMongoId()
    .withMessage("transactionId must be a valid MongoId"),
  body("transactionId").custom((value, { req }) => {
    if (req.body.paymentMethod === "online" && !value) {
      throw new Error("transactionId is required for online payment confirmation");
    }
    return true;
  }),
  body("providerPaymentId").optional().isString(),
  validateMiddleware,
  handlerConfirmPayment
);

export { jobPaymentRouter };
