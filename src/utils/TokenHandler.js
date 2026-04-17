import jwt from "jsonwebtoken";

const generateAccessToken = async (user) => {
   return jwt.sign(
      { _id: user._id, fullname: user.fullname, mobileNumber: user.mobileNumber, role: user.role },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
   );
};

const verifyAccessToken = (token) => {
   return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
};

export { generateAccessToken, verifyAccessToken };