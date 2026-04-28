import { Router } from "express";
import { body, query } from "express-validator";
import {
  verifyCustomerMiddleware,
  verifyFreelancerMiddleware,
  verifyTokenMiddleware,
} from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  authReadLimiterMiddleware,
  createJobLimiterMiddleware,
  jobActionLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  handlerCreateJob,
  handlerAcceptJob,
  handlerRejectJob,
  handlerCancelJob,
  handlerGetCustomerBookingHistory,
} from "../controllers/job.controller.js";

const jobRouter = Router();

jobRouter.post(
  "/create-job",
  createJobLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
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
  body("quantity")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("quantity must be an integer between 1 and 100"),
  body("tipAmount")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("tipAmount must be a valid amount greater than or equal to 0"),
  body("tip")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("tip must be a valid amount greater than or equal to 0"),
  body("itemTotal")
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage("itemTotal must be a valid amount greater than or equal to 0"),
  body("itemsTotal")
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage("itemsTotal must be a valid amount greater than or equal to 0"),
  body("subtotal")
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage("subtotal must be a valid amount greater than or equal to 0"),
  body("serviceTotal")
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage("serviceTotal must be a valid amount greater than or equal to 0"),
  body("baseAmount")
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage("baseAmount must be a valid amount greater than or equal to 0"),
  body("visitingFee")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("visitingFee must be a valid amount greater than or equal to 0"),
  body("visitFee")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("visitFee must be a valid amount greater than or equal to 0"),
  body("visitingCharge")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("visitingCharge must be a valid amount greater than or equal to 0"),
  body("visitingCharges")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("visitingCharges must be a valid amount greater than or equal to 0"),
  body("taxAmount")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("taxAmount must be a valid amount greater than or equal to 0"),
  body("tax")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("tax must be a valid amount greater than or equal to 0"),
  body("gstAmount")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("gstAmount must be a valid amount greater than or equal to 0"),
  body("gst")
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("gst must be a valid amount greater than or equal to 0"),
  body("finalAmount")
    .optional()
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage("finalAmount must be a valid amount greater than 0"),
  body("payableAmount")
    .optional()
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage("payableAmount must be a valid amount greater than 0"),
  body("grandTotal")
    .optional()
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage("grandTotal must be a valid amount greater than 0"),
  body("orderTotal")
    .optional()
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage("orderTotal must be a valid amount greater than 0"),
  body("totalAmount")
    .optional()
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage("totalAmount must be a valid amount greater than 0"),
  body("amount")
    .optional()
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage("amount must be a valid amount greater than 0"),
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
  verifyFreelancerMiddleware,
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
  verifyFreelancerMiddleware,
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
  verifyCustomerMiddleware,
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

jobRouter
  .route("/customer/history")
  .get(
    authReadLimiterMiddleware,
    jobActionLimiterMiddleware,
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    query("page").optional().isInt({ min: 1 }).withMessage("Invalid page"),
    query("limit").optional().isInt({ min: 1, max: 50 }).withMessage("Invalid limit"),
    validateMiddleware,
    handlerGetCustomerBookingHistory
  );

export { jobRouter };
