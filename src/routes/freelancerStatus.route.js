import { Router } from 'express';
import { verifyTokenMiddleware } from '../middlewares/auth.middleware.js';
import { handlerToggleFreelancerStatus } from '../controllers/freelancerStatus.controller.js';
import { freelancerStatusLimiterMiddleware } from '../middlewares/rateLimit.middleware.js';
const freelancerStatusRouter = Router();


freelancerStatusRouter.patch(
    "/toggle-status",
    freelancerStatusLimiterMiddleware,
    verifyTokenMiddleware,
    handlerToggleFreelancerStatus
);

export { freelancerStatusRouter };