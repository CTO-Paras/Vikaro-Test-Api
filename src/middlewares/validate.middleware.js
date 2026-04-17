import { validationResult } from "express-validator";
import { ApiError } from "../utils/APIError.js";

const validateMiddleware = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        console.log(errors.array());
        throw new ApiError(400, "Validation failed", errors.array());
    }

    next();
};

export { validateMiddleware }