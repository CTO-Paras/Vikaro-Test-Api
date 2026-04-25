import { Router } from "express";
import {
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
} from "../middlewares/auth.middleware.js";
import {
  freelancerStatusLimiterMiddleware,
  walletReadLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerGetFreelancerHistory,
  handlerGetFreelancerJobsHistory,
  handlerToggleFreelancerStatus,
} from "../controllers/freelancer.controller.js";

const freelancerRouter = Router();

freelancerRouter.patch(
  "/status/toggle-status",
  freelancerStatusLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerToggleFreelancerStatus
);

freelancerRouter.get(
  "/history",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerGetFreelancerHistory
);

freelancerRouter.get(
  "/jobs-history",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  handlerGetFreelancerJobsHistory
);

export { freelancerRouter };
