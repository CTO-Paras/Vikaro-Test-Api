import rateLimit from "express-rate-limit";

const buildRateLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message,
    },
});

const apiRateLimiterMiddleware = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: "Too many requests. Please try again shortly.",
});

const sendOtpLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "Too many OTP requests. Please try again after 10 minutes.",
});

const verifyOtpLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Too many verification attempts. Please try again later.",
});

const registerLimiterMiddleware = buildRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 8,
  message: "Too many registration attempts. Please try again after 30 minutes.",
});

const authReadLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: "Too many auth requests. Please try again in a minute.",
});

const freelancerStatusLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: "Status changed too frequently. Please wait a moment.",
});

const createJobLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Too many job create requests. Please try again later.",
});

const jobActionLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 80,
  message: "Too many job actions. Slow down and try again.",
});

const workflowGeneralLimiterMiddleware = buildRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 150,
  message: "Too many workflow requests. Please try again shortly.",
});

const workflowLocationLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: "Too many location updates. Please slow down.",
});

const workflowOtpGenerateLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many OTP generation requests. Please try again later.",
});

const workflowOtpVerifyLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Too many OTP verification requests. Please try again later.",
});

const paymentWebhookLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: "Too many webhook events. Please try again later.",
});

const paymentActionLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: "Too many payment requests. Please try again later.",
});

const walletReadLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: "Too many wallet read requests. Please try again in a minute.",
});

const walletWithdrawLimiterMiddleware = buildRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 12,
  message: "Too many withdrawal requests. Please try again later.",
});

const subscriptionActionLimiterMiddleware = buildRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many subscription requests. Please try again later.",
});

const ratingSubmitLimiterMiddleware = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: "Too many rating submissions. Please try again later.",
});

const ratingReadLimiterMiddleware = buildRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 80,
  message: "Too many rating read requests. Please try again in a minute.",
});

export {
  apiRateLimiterMiddleware,
  sendOtpLimiterMiddleware,
  verifyOtpLimiterMiddleware,
  registerLimiterMiddleware,
  authReadLimiterMiddleware,
  freelancerStatusLimiterMiddleware,
  createJobLimiterMiddleware,
  jobActionLimiterMiddleware,
  workflowGeneralLimiterMiddleware,
  workflowLocationLimiterMiddleware,
  workflowOtpGenerateLimiterMiddleware,
  workflowOtpVerifyLimiterMiddleware,
  paymentWebhookLimiterMiddleware,
  paymentActionLimiterMiddleware,
  walletReadLimiterMiddleware,
  walletWithdrawLimiterMiddleware,
  subscriptionActionLimiterMiddleware,
  ratingSubmitLimiterMiddleware,
  ratingReadLimiterMiddleware,
};
