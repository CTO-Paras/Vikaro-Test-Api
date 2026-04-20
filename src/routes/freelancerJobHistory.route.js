import { Router } from "express";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { walletReadLimiterMiddleware } from "../middlewares/rateLimit.middleware.js";
import {
  handlerGetFreelancerHistory,
  handlerGetFreelancerJobsHistory,
} from "../controllers/freelancerHistory.controller.js";

const freelancerJobHistoryRouter = Router();

freelancerJobHistoryRouter.get(
  "/history",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  handlerGetFreelancerHistory
);

freelancerJobHistoryRouter.get(
  "/jobs-history",
  walletReadLimiterMiddleware,
  verifyTokenMiddleware,
  handlerGetFreelancerJobsHistory
);

export { freelancerJobHistoryRouter };
