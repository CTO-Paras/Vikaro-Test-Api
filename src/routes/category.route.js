import express from "express";
import { body, param } from "express-validator";
import { uploadMiddleware } from "../middlewares/multer.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
  verifyAdminMiddleware,
  verifySuperAdminMiddleware,
} from "../middlewares/admin.middleware.js";
import {
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
} from "../middlewares/auth.middleware.js";
import {
  authReadLimiterMiddleware,
  jobActionLimiterMiddleware,
} from "../middlewares/rateLimit.middleware.js";
import {
  createCategory,
  addService,
  addSubService,
  getAllCategories,
  getCategoryById,
  getServicesByCategory,
  getSubServiceDetails
} from "../controllers/category.controller.js";

const categoryRouter = express.Router();


categoryRouter.post(
  "/",
  jobActionLimiterMiddleware,
  verifyAdminMiddleware,
  verifySuperAdminMiddleware,
  [
    body("title")
      .notEmpty()
      .withMessage("Category title is required")
      .isString()
      .withMessage("Category title must be a string"),
    validateMiddleware,
  ],
  createCategory
);


categoryRouter.post(
  "/:categoryId/service",
  jobActionLimiterMiddleware,
  verifyAdminMiddleware,
  verifySuperAdminMiddleware,
  uploadMiddleware.fields([
    { name: "logoImage", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 },
  ]),
  [
    param("categoryId").isMongoId().withMessage("Invalid categoryId"),
    body("name")
      .notEmpty()
      .withMessage("Service name is required")
      .isString()
      .withMessage("Service name must be a string"),
    body("logoImage")
      .optional()
      .isString()
      .withMessage("logoImage must be a string URL"),
    body("bannerImage")
      .optional()
      .isString()
      .withMessage("bannerImage must be a string URL"),
    validateMiddleware,
  ],
  addService
);


categoryRouter.post(
  "/:categoryId/service/:serviceId/subservice",
  jobActionLimiterMiddleware,
  verifyAdminMiddleware,
  verifySuperAdminMiddleware,
  uploadMiddleware.single("image"),
  [
    param("categoryId").isMongoId().withMessage("Invalid categoryId"),
    param("serviceId").isMongoId().withMessage("Invalid serviceId"),
    body("name")
      .notEmpty()
      .withMessage("Subservice name is required")
      .isString()
      .withMessage("Subservice name must be a string"),
    body("price")
      .trim()
      .notEmpty()
      .withMessage("Subservice price is required")
      .isFloat({ min: 0 })
      .withMessage("Subservice price must be a valid number greater than or equal to 0"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be a string"),
    body("image").custom((_, { req }) => {
      if (!req.file) {
        throw new Error("Image file is required");
      }
      return true;
    }),
    validateMiddleware,
  ],
  addSubService
);


categoryRouter.get(
  "/",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
  getAllCategories
);


categoryRouter.get(
  "/:id",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
  [param("id").isMongoId().withMessage("Invalid category id"), validateMiddleware],
  getCategoryById
);


categoryRouter.get(
  "/:categoryId/services",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
  [param("categoryId").isMongoId().withMessage("Invalid categoryId"), validateMiddleware],
  getServicesByCategory
);

// 🔥 GET SUBSERVICE DETAILS
categoryRouter.get(
  "/:categoryId/service/:serviceId/subservice/:subServiceId",
  authReadLimiterMiddleware,
  verifyTokenMiddleware,
  verifyCustomerMiddleware,
  [
    param("categoryId").isMongoId().withMessage("Invalid categoryId"),
    param("serviceId").isMongoId().withMessage("Invalid serviceId"),
    param("subServiceId").isMongoId().withMessage("Invalid subServiceId"),
    validateMiddleware,
  ],
  getSubServiceDetails
);

export { categoryRouter };