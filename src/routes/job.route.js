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
  handlerDeclineJobOffer,
  handlerRejectJob,
  handlerCancelJob,
  handlerGetActiveJob,
  handlerGetCustomerBookingHistory,
} from "../controllers/job.controller.js";

const jobRouter = Router();

const optionalFloatValidators = (fields, options, message) =>
  fields.map((field) =>
    body(field)
      .optional()
      .isFloat(options)
      .withMessage(`${field} ${message}`)
  );

const createJobValidators = [
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
  ...optionalFloatValidators(
    ["tipAmount", "tip"],
    { min: 0, max: 100000 },
    "must be a valid amount greater than or equal to 0"
  ),
  ...optionalFloatValidators(
    ["itemTotal", "itemsTotal", "subtotal", "serviceTotal", "baseAmount"],
    { min: 0, max: 1000000 },
    "must be a valid amount greater than or equal to 0"
  ),
  ...optionalFloatValidators(
    [
      "visitingFee",
      "visitFee",
      "visitingCharge",
      "visitingCharges",
      "taxAmount",
      "tax",
      "gstAmount",
      "gst",
    ],
    { min: 0, max: 100000 },
    "must be a valid amount greater than or equal to 0"
  ),
  ...optionalFloatValidators(
    ["finalAmount", "payableAmount", "grandTotal", "orderTotal", "totalAmount", "amount"],
    { gt: 0, max: 1000000 },
    "must be a valid amount greater than 0"
  ),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ max: 500 })
    .withMessage("Description can be at most 500 characters long"),
  validateMiddleware,
];

jobRouter.get(
  "/active",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  handlerGetActiveJob
);

jobRouter.post(
  "/create-job",
  createJobLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
  createJobValidators,
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
  "/decline-offer",
  jobActionLimiterMiddleware,
  verifyTokenMiddleware,
  verifyFreelancerMiddleware,
  body("jobId")
    .notEmpty()
    .withMessage("jobId is required")
    .isMongoId()
    .withMessage("Invalid jobId"),
  validateMiddleware,
  handlerDeclineJobOffer
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
