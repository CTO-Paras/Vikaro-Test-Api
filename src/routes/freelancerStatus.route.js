import { Router } from 'express';
import { verifyTokenMiddleware } from '../middlewares/auth.middleware.js';
import { handlerToggleFreelancerStatus } from '../controllers/freelancerStatus.controller.js';
const freelancerStatusRouter = Router();


freelancerStatusRouter.patch(
    "/toggle-status",
    verifyTokenMiddleware,
    handlerToggleFreelancerStatus
);

export { freelancerStatusRouter };