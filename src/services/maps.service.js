import { ApiError } from "../utils/APIError.js";
import axios from "axios";

const getAddressFromCoordinatesService = async (latitude, longitude) => {

    if (!latitude || !longitude) {
        throw new ApiError(400, "Latitude and Longitude are required");
    }

    try {
        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json`,
            {
                params: {
                    latlng: `${latitude},${longitude}`,
                    key: process.env.GOOGLE_MAPS_API_KEY
                }
            }
        );

        const data = response.data;

        console.log("Google API Response:", data); // check in terminal

        if (data.status !== "OK" || data.results.length === 0) {
            throw new ApiError(404, "Address not found for the given coordinates");
        }

        const address = data.results[0].formatted_address;

        console.log("Resolved Address:", address); // debug log

        return address;

    } catch (error) {
        console.error("Error fetching address from coordinates:", error.message);
        throw new ApiError(500, "Failed to fetch address from coordinates");
    }
};

export { getAddressFromCoordinatesService };