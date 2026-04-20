const SOCKET_EVENTS = {
  FREELANCER_ONLINE: "freelancerOnline",
  UPDATE_LOCATION: "updateLocation",
  FREELANCER_OFFLINE: "freelancerOffline",
  DISCONNECT: "disconnect",
  JOB_UPDATE_LOCATION: "job:update-location",
  JOB_VERIFY_OTP: "job:verify-otp",
  JOB_MARK_COMPLETED: "job:mark-completed",
  LIVE_TRACKING: "liveTracking",
};

const AUTH_ERROR_MESSAGES = {
  TOKEN_MISSING: "Unauthorized: token missing",
  ROLE_REQUIRED: "Unauthorized: customer or freelancer access required",
  INVALID_TOKEN: "Unauthorized: invalid token",
};

const ACK_MESSAGES = {
  FREELANCER_NOT_FOUND: "Freelancer not found",
  FREELANCER_NOT_VERIFIED: "Freelancer is not verified",
  INVALID_COORDINATES: "Invalid coordinates",
  FAILED_ONLINE: "Failed to set freelancer online",
  NOT_ONLINE_VERIFIED: "Freelancer is not in online verified state",
  LOCATION_THROTTLED: "Location update throttled",
  FAILED_UPDATE_LOCATION: "Failed to update location",
  FAILED_OFFLINE: "Failed to set freelancer offline",
  JOB_ID_REQUIRED: "jobId is required",
  FAILED_ACCEPT_JOB: "Failed to accept job",
  FAILED_REJECT_JOB: "Failed to reject job",
  FAILED_REJECT_AFTER_ACCEPT: "Failed to reject accepted job",
  MANUAL_REJECT_DISABLED: "Manual reject for pending job requests is disabled",
};

export { SOCKET_EVENTS, AUTH_ERROR_MESSAGES, ACK_MESSAGES };
