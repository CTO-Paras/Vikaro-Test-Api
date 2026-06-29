const normalizeMobileNumber = (mobileNumber) => {
	const raw = String(mobileNumber || "").trim();

	if (!raw) {
		return "";
	}

	const digits = raw.replace(/\D/g, "");
	if (!digits) {
		return "";
	}

	if (digits.length === 10) {
		return `+91${digits}`;
	}

	return `+${digits}`;
};

const isOtpBypassMobileNumber = (mobileNumber, role) => {
  const mobileNumberEnvKey =
    role === "freelancer"
      ? "OTP_BYPASS_FREELANCER_MOBILE_NUMBER"
      : role === "customer"
        ? "OTP_BYPASS_CUSTOMER_MOBILE_NUMBER"
        : null;

  if (!mobileNumberEnvKey) return false;

  const configuredMobileNumber = normalizeMobileNumber(
    process.env[mobileNumberEnvKey]
  );

  return (
    Boolean(configuredMobileNumber) &&
    normalizeMobileNumber(mobileNumber) === configuredMobileNumber
  );
};

export { normalizeMobileNumber, isOtpBypassMobileNumber };
