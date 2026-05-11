import { getEnvPairValue } from "../utils/env.js";

const numVerifyConfig = {
  baseUrl: "https://apilayer.net/api/validate",
  apiKey: getEnvPairValue({
    localKey: "NUMVERIFY_LOCAL_API_KEY",
    productionKey: "NUMVERIFY_PRODUCTION_API_KEY",
    fallbackKey: "NUMVERIFY_API_KEY",
  }),
};

export { numVerifyConfig };
