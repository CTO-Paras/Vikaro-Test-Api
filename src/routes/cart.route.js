import express from "express";
import { body, param } from "express-validator";
import {
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
} from "../middlewares/auth.middleware.js";
import { validateMiddleware } from "../middlewares/validate.middleware.js";
import {
    handlerAddToCart,
    handlerGetCart,
    handlerRemoveFromCart
} from "../controllers/cart.controller.js";

const cartRouter = express.Router();


cartRouter.get("/",
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    handlerGetCart
);


cartRouter.post(

    "/add",
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    [
        body("categoryId")
            .notEmpty()
            .withMessage("categoryId is required")
            .isMongoId()
            .withMessage("categoryId must be a valid id"),
        body("serviceId")
            .notEmpty()
            .withMessage("serviceId is required")
            .isMongoId()
            .withMessage("serviceId must be a valid id"),
        body("subServiceId")
            .notEmpty()
            .withMessage("subServiceId is required")
            .isMongoId()
            .withMessage("subServiceId must be a valid id"),
        validateMiddleware,
    ],
    handlerAddToCart
);



cartRouter.delete(
    "/remove/:subServiceId",
    verifyTokenMiddleware,
    verifyCustomerMiddleware,
    [
        param("subServiceId")
            .notEmpty()
            .withMessage("subServiceId is required")
            .isMongoId()
            .withMessage("subServiceId must be a valid id"),
        validateMiddleware,
    ],
    handlerRemoveFromCart
);

export { cartRouter };