import jwt from "jsonwebtoken";

const generateAccessToken = async (user) => {
   return jwt.sign(
      { _id: user._id, fullname: user.fullname, mobileNumber: user.mobileNumber },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
   );
};

export { generateAccessToken };