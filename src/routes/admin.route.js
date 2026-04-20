import express from "express";
import { body } from "express-validator";
import {
    handlerAdminLogin,
    handlerCurrentLoggedInAdmin,
} from "../controllers/admin.controller.js";
import { verifyAdminMiddleware } from "../middlewares/admin.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";

const adminRouter = express.Router();

adminRouter.get(
    "/login",
    [
        body("email")
            .notEmpty()
            .withMessage("Email is required")
            .isEmail()
            .withMessage("Invalid email format"),
        body("password")
            .notEmpty()
            .withMessage("Password is required")
            .isLength({ min: 6 })
            .withMessage("Password must be at least 6 characters"),
        body("specialCode")
            .notEmpty()
            .withMessage("Special code is required")
            .isLength({ min: 4, max: 4 })
            .withMessage("Special code must be 4 digits")
            .isNumeric()
            .withMessage("Special code must be numeric"),
        validateMiddleware,
    ],
    handlerAdminLogin
);


adminRouter.get("/current-logged-in",
    verifyAdminMiddleware,
    handlerCurrentLoggedInAdmin);

export { adminRouter };
