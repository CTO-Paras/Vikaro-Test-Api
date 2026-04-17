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

export { normalizeMobileNumber };
