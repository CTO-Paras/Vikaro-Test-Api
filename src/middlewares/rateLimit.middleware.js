import rateLimit from "express-rate-limit";

// 🔥 Limit for sending OTP
const sendOtpLimiterMiddleware = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // max 5 requests per IP
  message: {
    success: false,
    message: "Too many OTP requests. Please try again after 10 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔥 Limit for verifying OTP
const verifyOtpLimiterMiddleware = rateLimit({ 
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many verification attempts. Please try again later.",
  },
});

export { sendOtpLimiterMiddleware, verifyOtpLimiterMiddleware };
