import { ApiError } from "../utils/APIError.js";

const isProduction = process.env.NODE_ENV === "production";

const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const configuredOrigins = parseOrigins(
  process.env.CORS_ORIGIN || process.env.CLIENT_URL
);

const localOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",  
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

const allowedOrigins = [
  ...new Set([...configuredOrigins, ...(!isProduction ? localOrigins : [])]),
];

const isOriginAllowed = (origin) => {
  if (!origin || origin === "null") return true;
  return allowedOrigins.includes(origin);
};

const corsConfig = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman)
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new ApiError(403, "CORS Error: Origin not allowed"));
    }
  },
  credentials: true, // IMPORTANT for cookies (Web)
};

export { corsConfig, allowedOrigins, isOriginAllowed };
