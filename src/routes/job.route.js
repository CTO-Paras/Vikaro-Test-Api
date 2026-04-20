import { Router } from "express";
import { body, query } from "express-validator";
import {
    verifyCustomerMiddleware,
    verifyTokenMiddleware,
} from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
    createJobLimiterMiddleware,
    jobActionLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
    handlerCreateJob,
    handlerAcceptJob,
    handlerRejectJob,
    handlerCancelJob,
    handlerGetCustomerBookingHistory
} from "../controllers/job.controller.js";

const jobRouter = Router();

jobRouter.post(
    "/create-job",
    createJobLimiterMiddleware,
    verifyTokenMiddleware,
    body("categoryId")
        .notEmpty()
        .withMessage("categoryId is required")
        .isMongoId()
        .withMessage("Invalid categoryId"),
    body("serviceId")
        .notEmpty()
        .withMessage("serviceId is required")
        .isMongoId()
        .withMessage("Invalid serviceId"),
    body("subServiceId")
        .notEmpty()
        .withMessage("subServiceId is required")
        .isMongoId()
        .withMessage("Invalid subServiceId"),
    body("description")
        .trim()
        .notEmpty()
        .withMessage("Description is required")
        .isLength({ max: 500 })
        .withMessage("Description can be at most 500 characters long"),
    validateMiddleware,
    handlerCreateJob
);

jobRouter.post(
    "/accept-job",
    jobActionLimiterMiddleware,
    verifyTokenMiddleware,
    body("jobId")
        .notEmpty()
        .withMessage("jobId is required")
        .isMongoId()
        .withMessage("Invalid jobId"),
    validateMiddleware,
    handlerAcceptJob
);

jobRouter.post(
    "/reject-job",
    jobActionLimiterMiddleware,
    verifyTokenMiddleware,
    body("jobId")
        .notEmpty()
        .withMessage("jobId is required")
        .isMongoId()
        .withMessage("Invalid jobId"),
    body("afterAccept")
        .optional()
        .isBoolean()
        .withMessage("afterAccept must be boolean"),
    body("reason")
        .optional()
        .isLength({ min: 3, max: 300 })
        .withMessage("reason must be between 3 and 300 characters"),
    validateMiddleware,
    handlerRejectJob
);

jobRouter.post(
    "/cancel-job",
    jobActionLimiterMiddleware,
    verifyTokenMiddleware,
    body("jobId")
        .notEmpty()
        .withMessage("jobId is required")
        .isMongoId()
        .withMessage("Invalid jobId"),
    body("reason")
        .optional()
        .isLength({ min: 3, max: 300 })
        .withMessage("reason must be between 3 and 300 characters"),
    body("acceptFine")
        .optional()
        .isBoolean()
        .withMessage("acceptFine must be boolean"),
    validateMiddleware,
    handlerCancelJob
);


jobRouter.route("/customer/history").get(
    jobActionLimiterMiddleware,
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    query("status")
        .optional()
        .isIn([
            "all",
            "pending",
            "accepted",
            "rejected",
            "rejected_timeout",
            "arrived",
            "started",
            "completion_pending",
            "in_progress",
            "completed",
            "issue_reported",
            "cancelled",
            "cancelled_by_customer",
            "cancelled_by_freelancer",
            "expired",
        ])
        .withMessage("Invalid status filter"),
    validateMiddleware,
    handlerGetCustomerBookingHistory
);

export { jobRouter };