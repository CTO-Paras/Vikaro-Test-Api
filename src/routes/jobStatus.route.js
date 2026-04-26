import { Router } from "express";
import { body } from "express-validator";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  workflowGeneralLimiterMiddleware,
  workflowLocationLimiterMiddleware,
  workflowOtpGenerateLimiterMiddleware,
  workflowOtpVerifyLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerAcceptJobWorkflow,
  handlerSendJobDetails,
  handlerUpdateFreelancerLocation,
  handlerGenerateJobOtp,
  handlerVerifyJobOtp,
  handlerMarkJobCompleted,
  handlerConfirmJobCompletion,
  handlerReportJobIssue,
} from "../controllers/jobWorkflow.controller.js";

const jobStatusRouter = Router();

jobStatusRouter.post(
  "/accept",
  workflowGeneralLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  validateMiddleware,
  handlerAcceptJobWorkflow
);

jobStatusRouter.post(
  "/details",
  workflowGeneralLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  validateMiddleware,
  handlerSendJobDetails
);

jobStatusRouter.patch(
  "/location",
  workflowLocationLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("coordinates").isArray({ min: 2, max: 2 }).withMessage("coordinates must be [lng, lat]"),
  validateMiddleware,
  handlerUpdateFreelancerLocation
);

jobStatusRouter.post(
  "/otp-generate",
  workflowOtpGenerateLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  validateMiddleware,
  handlerGenerateJobOtp
);

jobStatusRouter.post(
  "/otp-verify",
  workflowOtpVerifyLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("otp").isLength({ min: 4, max: 8 }).withMessage("Invalid OTP"),
  validateMiddleware,
  handlerVerifyJobOtp
);

jobStatusRouter.post(
  "/complete-mark",
  workflowGeneralLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  validateMiddleware,
  handlerMarkJobCompleted
);

jobStatusRouter.post(
  "/complete-confirm",
  workflowGeneralLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  validateMiddleware,
  handlerConfirmJobCompletion
);

jobStatusRouter.post(
  "/complete-report-issue",
  workflowGeneralLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("issueDetails").optional().isLength({ min: 3, max: 500 }).withMessage("Issue details length invalid"),
  validateMiddleware,
  handlerReportJobIssue
);

export { jobStatusRouter };
