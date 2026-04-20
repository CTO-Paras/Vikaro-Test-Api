import { ApiError } from "../utils/APIError.js";

const allowedOrigins = [
  "http://localhost:5173",     // React development server
];

const corsConfig = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman)
   if (!origin || origin === "null") return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new ApiError(403, "CORS Error: Origin not allowed"));
    }
  },
  credentials: true, // IMPORTANT for cookies (Web)
};

export { corsConfig, allowedOrigins };  