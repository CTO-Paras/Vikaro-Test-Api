import { Router } from "express";
import { uploadMiddleware } from "../middlewares/multer.middleware.js"; // Adjust path
import { handlerCreateCategoryWithImage } from "../controllers/service.controller.js";

const serviceRouter = Router();

// 'image' is the key name we will use in Postman
serviceRouter.route("/add-category-pro").post(
    uploadMiddleware.single("image"), 
    handlerCreateCategoryWithImage
);

export {serviceRouter};