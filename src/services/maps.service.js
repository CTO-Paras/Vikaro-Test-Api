import { ApiError } from "../utils/APIError.js";
import axios from "axios";
import { assertGoogleConfig, googleConfig } from "../config/google.config.js";

const toRad = (value) => (value * Math.PI) / 180;

const calculateDistance = (fromCoordinates, toCoordinates) => {
    if (!Array.isArray(fromCoordinates) || !Array.isArray(toCoordinates)) {
        throw new ApiError(400, "Both source and destination coordinates are required");
    }

    const [fromLng, fromLat] = fromCoordinates;
    const [toLng, toLat] = toCoordinates;

    const earthRadiusMeters = 6371000;
    const dLat = toRad(toLat - fromLat);
    const dLng = toRad(toLng - fromLng);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceMeters = earthRadiusMeters * c;

    return {
        distanceMeters,
        distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    };
};

const calculateETA = (distanceMeters, averageSpeedKmph = 25) => {
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
        throw new ApiError(400, "distanceMeters must be a positive number");
    }

    const metersPerMinute = (averageSpeedKmph * 1000) / 60;
    const etaMinutes = Math.max(1, Math.ceil(distanceMeters / metersPerMinute));

    return {
        etaMinutes,
        etaText: `${etaMinutes} min`,
    };
};

const getDistanceMatrix = async ({ origin, destination }) => {
    if (!origin || !destination) {
        throw new ApiError(400, "origin and destination are required");
    }

    try {
        assertGoogleConfig();

        const response = await axios.get(googleConfig.distanceMatrixBaseUrl, {
            params: {
                origins: `${origin[1]},${origin[0]}`,
                destinations: `${destination[1]},${destination[0]}`,
                key: googleConfig.mapsApiKey,
            },
        });

        const element = response?.data?.rows?.[0]?.elements?.[0];
        if (element?.status !== "OK") {
            throw new ApiError(400, "Could not compute distance matrix");
        }

        return {
            distanceText: element.distance?.text,
            distanceValue: element.distance?.value,
            durationText: element.duration?.text,
            durationValue: element.duration?.value,
            raw: response.data,
        };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, "Failed to fetch distance matrix");
    }
};

const getRouteData = async ({ origin, destination }) => {
    if (!origin || !destination) {
        throw new ApiError(400, "origin and destination are required");
    }

    try {
        assertGoogleConfig();

        const response = await axios.get(googleConfig.directionsBaseUrl, {
            params: {
                origin: `${origin[1]},${origin[0]}`,
                destination: `${destination[1]},${destination[0]}`,
                key: googleConfig.mapsApiKey,
            },
        });

        const route = response?.data?.routes?.[0];
        if (!route) {
            throw new ApiError(404, "No route found");
        }

        return {
            polyline: route.overview_polyline?.points || "",
            legs: route.legs || [],
            summary: route.summary || "",
            raw: response.data,
        };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, "Failed to fetch route data");
    }
};

export {
    calculateDistance,
    calculateETA,
    getDistanceMatrix,
    getRouteData,
};