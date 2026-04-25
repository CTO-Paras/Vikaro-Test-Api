import { Router } from "express";
import { body, param } from "express-validator";
import {
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
} from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  ratingSubmitLimiterMiddleware,
  ratingReadLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerSubmitFreelancerRating,
  handlerGetFreelancerRatingStats,
  handlerGetSubServiceRatingStats,
} from "../controllers/rating.controller.js";

const ratingFreelancerRouter = Router();

ratingFreelancerRouter.post(
  "/rating",
  ratingSubmitLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
  body("jobId")
    .trim()
    .notEmpty()
    .withMessage("jobId is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid jobId"),
  body("overallRating")
    .notEmpty()
    .withMessage("overallRating is required")
    .bail()
    .isFloat({ min: 1, max: 5 })
    .withMessage("overallRating must be between 1 and 5")
    .toFloat(),
  body("feedback")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("feedback too long"),
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

ratingFreelancerRouter.get(
  "/rating-subservice/:categoryId/:serviceId/:subServiceId",
  ratingReadLimiterMiddleware,
  verifyTokenMiddleware,
  param("categoryId").isMongoId().withMessage("Invalid categoryId"),
  param("serviceId").isMongoId().withMessage("Invalid serviceId"),
  param("subServiceId").isMongoId().withMessage("Invalid subServiceId"),
  validateMiddleware,
  handlerGetSubServiceRatingStats
);

export { ratingFreelancerRouter };
