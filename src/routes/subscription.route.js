
import { Router } from "express";
import { verifyTokenMiddleware } from "../middlewares/auth.middleware.js";
import { subscriptionActionLimiterMiddleware } from "../middlewares/rateLimit.middleware.js";
import {
  handlerCheckSubscriptionStatus,
  handlerActivateProSubscription,
} from "../controllers/subscription.controller.js";
const subscriptionFreelancerRouter = Router();

subscriptionFreelancerRouter.get(
  "/subscription-status",
  subscriptionActionLimiterMiddleware,
  verifyTokenMiddleware,
  handlerCheckSubscriptionStatus
);

subscriptionFreelancerRouter.post(
  "/subscription-activate",
  subscriptionActionLimiterMiddleware,
  verifyTokenMiddleware,
  handlerActivateProSubscription
);

export { subscriptionFreelancerRouter };
