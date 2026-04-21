import { Router } from "express";
import { body } from "express-validator";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  walletReadLimiterMiddleware,
  walletWithdrawLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerGetWalletSummary,
  handlerGetDailyEarnings,
  handlerGetWeeklyEarnings,
  handlerWithdrawWalletBalance,
  handlerProcessWithdrawal,
  handlerRechargeWallet,
  handlerVerifyWalletRecharge,
} from "../controllers/wallet.controller.js";

const WalletFreelancerRouter = Router();

WalletFreelancerRouter.get(
  "/wallet-summary",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  handlerGetWalletSummary
);

WalletFreelancerRouter.get(
  "/wallet-daily",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  handlerGetDailyEarnings
);

WalletFreelancerRouter.get(
  "/wallet-weekly",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  handlerGetWeeklyEarnings
);

WalletFreelancerRouter.post(
  "/wallet-withdraw",
  walletWithdrawLimiterMiddleware,
  verifyTokenMiddleware,
  body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0"),
  body("bankAccountNumber").notEmpty().withMessage("bankAccountNumber is required"),
  body("ifscCode").notEmpty().withMessage("ifscCode is required"),
  body("accountHolderName").notEmpty().withMessage("accountHolderName is required"),
  validateMiddleware,
  handlerWithdrawWalletBalance
);

WalletFreelancerRouter.post(
  "/wallet-withdraw-process",
  walletWithdrawLimiterMiddleware,
  verifyTokenMiddleware,
  body("withdrawalId").isMongoId().withMessage("Invalid withdrawalId"),
  body("approve").isBoolean().withMessage("approve must be boolean"),
  body("remarks").optional().isString(),
  validateMiddleware,
  handlerProcessWithdrawal
);

WalletFreelancerRouter.post(
  "/wallet-recharge",
  walletWithdrawLimiterMiddleware,
  verifyTokenMiddleware,
  body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0"),
  body("referenceId").optional().isString(),
  validateMiddleware,
  handlerRechargeWallet
);

WalletFreelancerRouter.post(
  "/wallet-recharge-verify",
  walletWithdrawLimiterMiddleware,
  verifyTokenMiddleware,
  body("razorpayOrderId").notEmpty().withMessage("razorpayOrderId is required"),
  body("razorpayPaymentId").notEmpty().withMessage("razorpayPaymentId is required"),
  body("razorpaySignature").notEmpty().withMessage("razorpaySignature is required"),
  validateMiddleware,
  handlerVerifyWalletRecharge
);

export { WalletFreelancerRouter };