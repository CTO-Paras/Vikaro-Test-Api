import jwt from "jsonwebtoken";
import { getEnvPairValue } from "./env.js";

const getAccessTokenSecret = () =>
   getEnvPairValue({
      localKey: "ACCESS_TOKEN_LOCAL_SECRET",
      productionKey: "ACCESS_TOKEN_PRODUCTION_SECRET",
      fallbackKey: "ACCESS_TOKEN_SECRET",
   });

const getAccessTokenExpiry = () =>
   getEnvPairValue({
      localKey: "ACCESS_TOKEN_LOCAL_EXPIRY",
      productionKey: "ACCESS_TOKEN_PRODUCTION_EXPIRY",
      fallbackKey: "ACCESS_TOKEN_EXPIRY",
   });

const generateAccessToken = async (user) => {
   return jwt.sign(
      { _id: user._id, fullname: user.fullname, mobileNumber: user.mobileNumber, role: user.role },
      getAccessTokenSecret(),
      { expiresIn: getAccessTokenExpiry() }
   );
};

const verifyAccessToken = (token) => {
   return jwt.verify(token, getAccessTokenSecret());
};

export { generateAccessToken, verifyAccessToken };
