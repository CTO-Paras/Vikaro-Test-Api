import { ApiError } from "./APIError.js";

const ensureRole = (user, role) => {
  if (!user || user.role !== role) {
    throw new ApiError(403, `Only ${role}s can perform this action`);
  }
};

export { ensureRole };