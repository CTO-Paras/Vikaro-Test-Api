import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { verifyAccessToken } from "../utils/TokenHandler.js";
import { ApiError } from "../utils/APIError.js";
import { ApiResponse } from "../utils/APIResponce.js";
const SOCKET_EVENTS = {
	FREELANCER_ONLINE: "freelancerOnline",
	UPDATE_LOCATION: "updateLocation",
	FREELANCER_OFFLINE: "freelancerOffline",
	DISCONNECT: "disconnect",
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
};

const socketIdToFreelancerId = new Map();
const freelancerIdToSocketIds = new Map();
const locationThrottleBySocketId = new Map();

const LOCATION_UPDATE_THROTTLE_MS = 5000;

const buildErrorAck = (statusCode, message, data = null) => {
	const apiError = new ApiError(statusCode, message);
	return {
		success: apiError.success,
		statusCode: apiError.statusCode,
		message: apiError.message,
		data,
	};
};

const buildSuccessAck = (statusCode, data = null, message = "Success") => {
	const apiResponse = new ApiResponse(statusCode, data, message);
	return {
		success: apiResponse.success,
		statusCode: apiResponse.statusCode,
		message: apiResponse.message,
		data: apiResponse.data,
	};
};

const safeAck = (ack, payload) => {
	if (typeof ack !== "function") return;

	try {
		ack(payload);
	} catch (error) {
		console.error("[socket] Ack callback failed:", error.message);
	}
};

const getTokenFromSocket = (socket) => {
	const authToken = socket?.handshake?.auth?.token;
	if (typeof authToken === "string" && authToken.trim()) {
		return authToken.trim();
	}

	const rawAuthHeader = socket?.handshake?.headers?.authorization;
	if (typeof rawAuthHeader !== "string") return null;

	const [scheme, token] = rawAuthHeader.split(" ");
	if (scheme !== "Bearer" || !token) return null;

	return token.trim() || null;
};

const parseCoordinates = (value) => {
	if (!Array.isArray(value) || value.length !== 2) return null;

	const [lng, lat] = value;
	const validNumbers =
		Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;

	if (!validNumbers) return null;

	return [lng, lat];
};

const addSocketMapping = (freelancerId, socketId) => {
	socketIdToFreelancerId.set(socketId, freelancerId);

	const socketIds = freelancerIdToSocketIds.get(freelancerId) || new Set();
	socketIds.add(socketId);
	freelancerIdToSocketIds.set(freelancerId, socketIds);
};

const removeSocketMapping = (freelancerId, socketId) => {
	socketIdToFreelancerId.delete(socketId);

	const socketIds = freelancerIdToSocketIds.get(freelancerId);
	if (!socketIds) return 0;

	socketIds.delete(socketId);
	if (socketIds.size === 0) {
		freelancerIdToSocketIds.delete(freelancerId);
		return 0;
	}

	return socketIds.size;
};

const authenticateFreelancerSocketService = (socket, next) => {
	try {
		const token = getTokenFromSocket(socket);
		if (!token) {
			return next(new Error(AUTH_ERROR_MESSAGES.TOKEN_MISSING));
		}

		const decoded = verifyAccessToken(token);
		if (!decoded || !decoded._id || !["freelancer", "customer"].includes(decoded.role)) {
			return next(new Error(AUTH_ERROR_MESSAGES.ROLE_REQUIRED));
		}

		socket.data.userId = decoded._id.toString();
		socket.data.role = decoded.role;
		socket.data.online = false;
		socket.data.verified = false;

		return next();
	} catch (error) {
		return next(new Error(AUTH_ERROR_MESSAGES.INVALID_TOKEN));
	}
};

const registerFreelancerSocketEventsService = (socket) => {
	const userId = socket.data.userId;
	const role = socket.data.role;

	if (userId && role) {
		socket.join(`${role}_${userId}`);
	}

	if (role !== "freelancer") {
		console.log(`[socket] connected socketId=${socket.id} role=${role} userId=${userId}`);
		socket.on(SOCKET_EVENTS.DISCONNECT, (reason) => {
			console.log(`[socket] disconnected socketId=${socket.id} role=${role} userId=${userId} reason=${reason}`);
		});
		return;
	}

	const freelancerId = userId;
	addSocketMapping(freelancerId, socket.id);

	console.log(`[socket] connected socketId=${socket.id} freelancerId=${freelancerId}`);

	socket.on(SOCKET_EVENTS.FREELANCER_ONLINE, async (payload, ack) => {
		try {
			const profile = await ProfileFreelancer.findById(freelancerId).select("_id isVerified");

			if (!profile) {
				safeAck(ack, buildErrorAck(404, ACK_MESSAGES.FREELANCER_NOT_FOUND));
				return;
			}

			if (!profile.isVerified) {
				await ProfileFreelancer.findByIdAndUpdate(freelancerId, { status: "offline" });
				socket.data.online = false;
				socket.data.verified = false;
				safeAck(ack, buildErrorAck(403, ACK_MESSAGES.FREELANCER_NOT_VERIFIED));
				return;
			}

			const coordinates = parseCoordinates(payload?.coordinates);
			if (!coordinates) {
				safeAck(ack, buildErrorAck(400, ACK_MESSAGES.INVALID_COORDINATES));
				return;
			}

			await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
				status: "online",
				location: { type: "Point", coordinates },
			});

			socket.data.online = true;
			socket.data.verified = true;

			console.log(
				`[socket] freelancerOnline socketId=${socket.id} freelancerId=${freelancerId} coordinates=${coordinates.join(",")}`
			);

			safeAck(ack, buildSuccessAck(200, { status: "online" }));
		} catch (error) {
			console.error(
				`[socket] freelancerOnline error socketId=${socket.id} freelancerId=${freelancerId}:`,
				error.message
			);
			safeAck(ack, buildErrorAck(500, ACK_MESSAGES.FAILED_ONLINE));
		}
	});

	socket.on(SOCKET_EVENTS.UPDATE_LOCATION, async (payload, ack) => {
		try {
			if (socket.data.online !== true || socket.data.verified !== true) {
				safeAck(ack, buildErrorAck(403, ACK_MESSAGES.NOT_ONLINE_VERIFIED));
				return;
			}

			const coordinates = parseCoordinates(payload?.coordinates);
			if (!coordinates) {
				safeAck(ack, buildErrorAck(400, ACK_MESSAGES.INVALID_COORDINATES));
				return;
			}

			const now = Date.now();
			const lastUpdateAt = locationThrottleBySocketId.get(socket.id) || 0;
			const elapsed = now - lastUpdateAt;

			if (elapsed < LOCATION_UPDATE_THROTTLE_MS) {
				safeAck(
					ack,
					buildErrorAck(429, ACK_MESSAGES.LOCATION_THROTTLED, {
						retryAfterMs: LOCATION_UPDATE_THROTTLE_MS - elapsed,
					})
				);
				return;
			}

			await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
				location: { type: "Point", coordinates },
			});

			locationThrottleBySocketId.set(socket.id, now);

			console.log(
				`[socket] updateLocation socketId=${socket.id} freelancerId=${freelancerId} coordinates=${coordinates.join(",")}`
			);

			safeAck(ack, buildSuccessAck(200));
		} catch (error) {
			console.error(
				`[socket] updateLocation error socketId=${socket.id} freelancerId=${freelancerId}:`,
				error.message
			);
			safeAck(ack, buildErrorAck(500, ACK_MESSAGES.FAILED_UPDATE_LOCATION));
		}
	});

	socket.on(SOCKET_EVENTS.FREELANCER_OFFLINE, async (_payload, ack) => {
		try {
			socket.data.online = false;
			const activeSocketCount = removeSocketMapping(freelancerId, socket.id);
			locationThrottleBySocketId.delete(socket.id);

			let status = "online";
			if (activeSocketCount === 0) {
				await ProfileFreelancer.findByIdAndUpdate(freelancerId, { status: "offline" });
				status = "offline";
			}

			console.log(
				`[socket] freelancerOffline socketId=${socket.id} freelancerId=${freelancerId} remainingSockets=${activeSocketCount}`
			);

			safeAck(ack, buildSuccessAck(200, { status }));
		} catch (error) {
			console.error(
				`[socket] freelancerOffline error socketId=${socket.id} freelancerId=${freelancerId}:`,
				error.message
			);
			safeAck(ack, buildErrorAck(500, ACK_MESSAGES.FAILED_OFFLINE));
		}
	});

	socket.on(SOCKET_EVENTS.DISCONNECT, async (reason) => {
		try {
			locationThrottleBySocketId.delete(socket.id);

			const mappedFreelancerId =
				socketIdToFreelancerId.get(socket.id) || socket.data.userId;

			if (!mappedFreelancerId) {
				console.log(`[socket] disconnected socketId=${socket.id} reason=${reason}`);
				return;
			}

			const activeSocketCount = removeSocketMapping(mappedFreelancerId, socket.id);

			if (activeSocketCount === 0) {
				await ProfileFreelancer.findByIdAndUpdate(mappedFreelancerId, { status: "offline" });
			}

			console.log(
				`[socket] disconnected socketId=${socket.id} freelancerId=${mappedFreelancerId} reason=${reason} remainingSockets=${activeSocketCount}`
			);
		} catch (error) {
			console.error(
				`[socket] disconnect error socketId=${socket.id} freelancerId=${socket.data.userId}:`,
				error.message
			);
		}
	});
};

export { authenticateFreelancerSocketService, registerFreelancerSocketEventsService };
