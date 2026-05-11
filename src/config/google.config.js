import { getEnvPairValue } from "../utils/env.js";

const googleConfig = {
  mapsApiKey: getEnvPairValue({
    localKey: "GOOGLE_MAPS_LOCAL_API_KEY",
    productionKey: "GOOGLE_MAPS_PRODUCTION_API_KEY",
    fallbackKey: "GOOGLE_MAPS_API_KEY",
  }),
  geocodeBaseUrl: "https://maps.googleapis.com/maps/api/geocode/json",
  distanceMatrixBaseUrl: "https://maps.googleapis.com/maps/api/distancematrix/json",
  directionsBaseUrl: "https://maps.googleapis.com/maps/api/directions/json",
};

const assertGoogleConfig = () => {
  if (!googleConfig.mapsApiKey) {
    throw new Error("Google configuration missing: GOOGLE_MAPS_API_KEY");
  }
};

export { googleConfig, assertGoogleConfig };
