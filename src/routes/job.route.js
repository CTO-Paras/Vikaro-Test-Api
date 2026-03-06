import { Router } from "express";
import { verifyTokenMiddleware } from '../middlewares/auth.middleware.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { body } from "express-validator";
import { categoryServices } from "../constants/services.constant.js";
const jobRouter = Router();



jobRouter.post(
    "/create-job",
    [
        body("category")
            .notEmpty()
            .withMessage("Category is required"),

        body("service")
            .notEmpty()
            .withMessage("Service is required")
            .custom((value, { req }) => {
                const category = req.body.category;

                if (!categoryServices[category]) {
                    throw new Error("Invalid category");
                }

                if (!categoryServices[category].includes(value)) {
                    throw new Error("Service does not belong to the selected category");
                }

                return true;
            }),

        body("description")
            .optional()
            .isLength({ max: 500 })
            .withMessage("Description can be at most 500 characters long"),

        validateMiddleware,
    ],
    verifyTokenMiddleware,
);



export { jobRouter };   