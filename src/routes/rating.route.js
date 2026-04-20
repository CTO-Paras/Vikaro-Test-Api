import { Router } from "express";
import { body, param } from "express-validator";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  ratingSubmitLimiterMiddleware,
  ratingReadLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerSubmitFreelancerRating,
  handlerGetFreelancerRatingStats,
} from "../controllers/rating.controller.js";

const ratingFreelancerRouter = Router();

ratingFreelancerRouter.post(
  "/rating",
  ratingSubmitLimiterMiddleware,
  verifyTokenMiddleware,
  body("jobId").isMongoId().withMessage("Invalid jobId"),
  body("overallRating").isFloat({ min: 1, max: 5 }).withMessage("overallRating must be between 1 and 5"),
  body("feedback").optional().isLength({ max: 500 }).withMessage("feedback too long"),
  validateMiddleware,
  handlerSubmitFreelancerRating
);

ratingFreelancerRouter.get(
  "/rating-freelancer/:freelancerId",
  ratingReadLimiterMiddleware,
  verifyTokenMiddleware,
  param("freelancerId").isMongoId().withMessage("Invalid freelancerId"),
  validateMiddleware,
  handlerGetFreelancerRatingStats
);

export { ratingFreelancerRouter };
