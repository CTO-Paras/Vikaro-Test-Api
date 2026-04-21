import "dotenv/config";
import bcrypt from "bcrypt";
import { connectDB, disconnectDB } from "../src/db/index.js";
import { Admin } from "../src/models/admin.model.js";

const FOUR_DIGIT_SPECIAL_CODE_REGEX = /^\d{4}$/;


const isValidFourDigitSpecialCode = (value) => {
  return FOUR_DIGIT_SPECIAL_CODE_REGEX.test(String(value || ""));
}

const main = async () => {
  const name = process.env.SUPER_ADMIN_NAME || "Super Admin";
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const specialCode = process.env.SUPER_ADMIN_SPECIAL_CODE;

  if (!email || !password || !specialCode) {
    throw new Error(
      "Missing envs: SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_SPECIAL_CODE are required"
    );
  }

  if (!isValidFourDigitSpecialCode(specialCode)) {
    throw new Error("SUPER_ADMIN_SPECIAL_CODE must be exactly 4 digits");
  }

  await connectDB();

  const hashedPassword = await bcrypt.hash(password, 10);

  const updated = await Admin.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    {
      $set: {
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        specialCode: String(specialCode),
        role: "super_admin",
        isActive: true,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  console.log(`Super admin ready: ${updated.email} (${updated.role})`);
};

main()
  .catch((error) => {
    console.error("Failed to create/update super admin:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
