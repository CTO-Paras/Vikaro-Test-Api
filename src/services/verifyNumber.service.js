import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import axios from "axios";
import { numVerifyConfig } from "../config/numverify.config.js";


const verifyNumberService = async (phoneNumber) => {

  if (!numVerifyConfig.apiKey) {
    throw new ApiError(500, "Numverify API key not configured");
  }

  try {

    const response = await axios.get(
      numVerifyConfig.baseUrl,
      {
        params: {
          access_key: numVerifyConfig.apiKey,
          number: `${phoneNumber}`
        }
      }
    );

    const data = response.data;

    if (!data.valid || data.line_type !== "mobile") {
      throw new ApiError(400, "Enter a valid mobile number");
    }

    return data;

  } catch (error) {
    throw new ApiError(
      500,
      error.response?.data?.error?.info || "Phone validation failed"
    );
  }
};

export { verifyNumberService };