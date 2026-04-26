import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { verifyAccessToken } from "../utils/TokenHandler.js";
import { calculateDistance, calculateETA } from "./maps.service.js";
import { redisClientConfig, connectRedisConfig } from "../config/redis.config.js";

import {
	SOCKET_EVENTS,
	AUTH_ERROR_MESSAGES,
	ACK_MESSAGES,
} from "../constants/socket.constant.js";
import {
	SOCKET_EVENTS as JOB_SOCKET_EVENTS,
	rejectAcceptedJobForFreelancer,
} from "./jobDispatch.service.js";
import {
	acceptJob,
	updateFreelancerLocation,
	verifyJobOTP,
	markJobCompleted,
} from "./jobWorkflow.service.js";
const socketIdToFreelancerId = new Map();
const freelancerIdToSocketIds = new Map();
const locationThrottleBySocketId = new Map();

const LOCATION_UPDATE_THROTTLE_MS = 2000;
const MIN_MOVEMENT_METERS = 10; // skip updates below this
const SIGNIFICANT_MOVEMENT_METERS = 50; // force DB sync above this
const MIN_DB_UPDATE_INTERVAL_MS = 15000; // 15 seconds
const isSocketDebugEnabled = process.env.SOCKET_DEBUG === "true";

const buildErrorAck = (statusCode, message, data = null) => {
	return {
		success: false,
		statusCode,
		message,
		data,
	};
};

const buildSuccessAck = (statusCode, data = null, message = "Success") => {
	return {
		success: statusCode < 400,
		statusCode,
		message,
		data,
	};
};

const socketDebugLog = (...args) => {
	if (!isSocketDebugEnabled) return;
	console.log(...args);
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

	const separatorIndex = rawAuthHeader.indexOf(" ");
	if (separatorIndex < 0) return null;

	const scheme = rawAuthHeader.slice(0, separatorIndex);
	const token = rawAuthHeader.slice(separatorIndex + 1);
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
	const emitToRoom = (room, event, eventPayload) => socket.server.to(room).emit(event, eventPayload);

	if (userId && role) {
		socket.join(`${role}_${userId}`);
	}

	if (role !== "freelancer") {
		socketDebugLog(`[socket] connected socketId=${socket.id} role=${role} userId=${userId}`);
		socket.on(SOCKET_EVENTS.DISCONNECT, (reason) => {
			socketDebugLog(`[socket] disconnected socketId=${socket.id} role=${role} userId=${userId} reason=${reason}`);
		});
		return;
	}

	const freelancerId = userId;
	addSocketMapping(freelancerId, socket.id);

	socketDebugLog(`[socket] connected socketId=${socket.id} freelancerId=${freelancerId}`);

	socket.on(SOCKET_EVENTS.FREELANCER_ONLINE, async (payload, ack) => {
		try {
			const profile = await ProfileFreelancer.findById(freelancerId).select("_id isVerified").lean();
			if (!profile) {
				safeAck(ack, buildErrorAck(404, ACK_MESSAGES.FREELANCER_NOT_FOUND));
				return;
			}

			if (!profile.isVerified) {
				await ProfileFreelancer.updateOne({ _id: freelancerId }, { $set: { status: "offline" } });
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

			await ProfileFreelancer.updateOne(
				{ _id: freelancerId },
				{ $set: { status: "online", location: { type: "Point", coordinates } } }
			);

			socket.data.online = true;
			socket.data.verified = true;

			socketDebugLog(
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

	/**
	 * Handle live freelancer location updates.
	 *
	 * Responsibilities:
	 * - Validate socket auth state and incoming payload.
	 * - Throttle very frequent updates at socket level (time-based).
	 * - Ignore small movements to reduce noise in tracking (distance-based).
	 * - Cache latest location snapshot in Redis for real-time reads (short TTL).
	 * - Persist location to MongoDB as a throttled, backup data store.
	 * - Emit distance and ETA updates to the relevant customer room.
	 */
	socket.on(SOCKET_EVENTS.UPDATE_LOCATION, async (payload, ack) => {
		try {
			// 1) Basic auth/online checks
			if (socket.data.online !== true || socket.data.verified !== true) {
				safeAck(ack, buildErrorAck(403, ACK_MESSAGES.NOT_ONLINE_VERIFIED));
				return;
			}

			// 2) Payload validation
			const coordinates = parseCoordinates(payload?.coordinates);
			if (!coordinates) {
				safeAck(ack, buildErrorAck(400, ACK_MESSAGES.INVALID_COORDINATES));
				return;
			}

			const jobId = payload?.jobId;
			if (!jobId) {
				safeAck(ack, buildErrorAck(400, ACK_MESSAGES.JOB_ID_REQUIRED));
				return;
			}

			const now = Date.now();

			// 3) Time-based throttling (silent): drop overly frequent updates to
			// reduce pressure on Redis, MongoDB and network without sending errors.
			const lastProcessedAt = locationThrottleBySocketId.get(socket.id) || 0;
			if (now - lastProcessedAt < LOCATION_UPDATE_THROTTLE_MS) {
				safeAck(ack, buildSuccessAck(200, { throttled: true }, ACK_MESSAGES.LOCATION_THROTTLED));
				return;
			}

			// 4) Movement-based optimization using last in-memory coordinates
			const previousCoordinates = socket.data.lastLocationCoordinates || null;
			let distanceFromLastMeters = null;
			if (previousCoordinates) {
				({ distanceMeters: distanceFromLastMeters } = calculateDistance(previousCoordinates, coordinates));
			}

			// Cache latest coordinates in socket memory for the next diff
			// calculation and to avoid re-reading from external stores.
			socket.data.lastLocationCoordinates = coordinates;
			socket.data.lastLocationAt = now;
			locationThrottleBySocketId.set(socket.id, now);

			// Run the shared job workflow location logic before side writes so an
			// invalid/unassigned job cannot create tracking data. This emits
			// job:location:updated and triggers arrival side effects such as
			// phone reveal and OTP generation when the distance threshold is met.
			const workflowLocation = await updateFreelancerLocation({
				jobId,
				freelancerId,
				coordinates,
				persistFreelancerLocation: false,
			});

			const customerId =
				workflowLocation.customerId?.toString?.() || String(workflowLocation.customerId || "");
			const { distanceMeters, distanceKm } = workflowLocation;

			// If freelancer hasn't moved more than MIN_MOVEMENT_METERS, skip Redis,
			// Mongo and live-tracking emits to avoid GPS jitter. The workflow call
			// above has already checked the distance threshold and OTP generation.
			if (distanceFromLastMeters !== null && distanceFromLastMeters < MIN_MOVEMENT_METERS) {
				safeAck(ack, buildSuccessAck(200, workflowLocation, "Job location checked"));
				return;
			}

			// 5) Redis: real-time, in-memory store with a short TTL (60s) used
			// by other services/consumers to read the freshest known location.
			try {
				await connectRedisConfig();
				const redisKey = `freelancer:${freelancerId}`;
				const redisValue = JSON.stringify({
					freelancerId,
					jobId,
					coordinates,
					updatedAt: now,
				});
				await redisClientConfig.set(redisKey, redisValue, { EX: 60 });
			} catch (redisError) {
				console.error(
					`[socket] updateLocation redis error socketId=${socket.id} freelancerId=${freelancerId}:`,
					redisError.message
				);
			}

			// 6) MongoDB: durable backup store; writes are throttled by time and
			// only performed when the freelancer has moved significantly.
			const lastDbSyncAt = socket.data.lastDbSyncAt || 0;
			const lastDbSyncCoordinates = socket.data.lastDbSyncCoordinates || null;
			let shouldSyncDb = false;

			if (!lastDbSyncAt) {
				shouldSyncDb = true;
			} else if (now - lastDbSyncAt >= MIN_DB_UPDATE_INTERVAL_MS) {
				shouldSyncDb = true;
			} else if (lastDbSyncCoordinates) {
				let distanceFromLastDbMeters = null;
				({ distanceMeters: distanceFromLastDbMeters } = calculateDistance(lastDbSyncCoordinates, coordinates));
				if (distanceFromLastDbMeters > SIGNIFICANT_MOVEMENT_METERS) {
					shouldSyncDb = true;
				}
			}

			if (shouldSyncDb) {
				await ProfileFreelancer.updateOne(
					{ _id: freelancerId },
					{ $set: { location: { type: "Point", coordinates } } }
				);
				socket.data.lastDbSyncAt = now;
				socket.data.lastDbSyncCoordinates = coordinates;
			}

			const { etaMinutes, etaText } = calculateETA(distanceMeters);

			emitToRoom(
				`customer_${customerId}`,
				SOCKET_EVENTS.LIVE_TRACKING,
				{
					freelancerId,
					jobId,
					coordinates,
					distanceMeters,
					distanceKm,
					etaMinutes,
					etaText,
				}
			);

			socketDebugLog(
				`[socket] updateLocation socketId=${socket.id} freelancerId=${freelancerId} jobId=${jobId} coordinates=${coordinates.join(",")} distanceMeters=${distanceMeters} etaMinutes=${etaMinutes}`
			);

			safeAck(ack, buildSuccessAck(200, { ...workflowLocation, etaMinutes, etaText }));
		} catch (error) {
			console.error(
				`[socket] updateLocation error socketId=${socket.id} freelancerId=${freelancerId}:`,
				error.message
			);
			safeAck(
				ack,
				buildErrorAck(
					error?.statusCode || 500,
					error?.message || ACK_MESSAGES.FAILED_UPDATE_LOCATION
				)
			);
		}
	});

	socket.on(SOCKET_EVENTS.FREELANCER_OFFLINE, async (_payload, ack) => {
		try {
			socket.data.online = false;
			const activeSocketCount = removeSocketMapping(freelancerId, socket.id);
			locationThrottleBySocketId.delete(socket.id);

			let status = "online";
			if (activeSocketCount === 0) {
				await ProfileFreelancer.updateOne({ _id: freelancerId }, { $set: { status: "offline" } });
				status = "offline";
			}

			socketDebugLog(
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

	socket.on(JOB_SOCKET_EVENTS.JOB_ACCEPT, async (payload, ack) => {
		try {
			const jobId = payload?.jobId;
			if (!jobId) {
				safeAck(ack, buildErrorAck(400, ACK_MESSAGES.JOB_ID_REQUIRED));
				return;
			}

			const result = await acceptJob({
				jobId,
				freelancerId,
			});

			safeAck(
				ack,
				buildSuccessAck(200, result, "Job accepted successfully")
			);
		} catch (error) {
			safeAck(ack, buildErrorAck(error?.statusCode || 500, error?.message || ACK_MESSAGES.FAILED_ACCEPT_JOB));
		}
	});

	socket.on(SOCKET_EVENTS.JOB_UPDATE_LOCATION, async (payload, ack) => {
		try {
			const jobId = payload?.jobId;
			const coordinates = payload?.coordinates;
			const result = await updateFreelancerLocation({ jobId, freelancerId, coordinates });
			safeAck(ack, buildSuccessAck(200, result, "Job location updated"));
		} catch (error) {
			safeAck(ack, buildErrorAck(error?.statusCode || 500, error?.message || ACK_MESSAGES.FAILED_UPDATE_LOCATION));
		}
	});

	socket.on(SOCKET_EVENTS.JOB_VERIFY_OTP, async (payload, ack) => {
		try {
			const jobId = payload?.jobId;
			const otp = payload?.otp;
			const result = await verifyJobOTP({ jobId, freelancerId, otp });
			safeAck(ack, buildSuccessAck(200, result, "OTP verified and job started"));
		} catch (error) {
			safeAck(ack, buildErrorAck(error?.statusCode || 500, error?.message || "Failed to verify OTP"));
		}
	});

	socket.on(SOCKET_EVENTS.JOB_MARK_COMPLETED, async (payload, ack) => {
		try {
			const jobId = payload?.jobId;
			const result = await markJobCompleted({ jobId, freelancerId });
			safeAck(ack, buildSuccessAck(200, result, "Completion request sent"));
		} catch (error) {
			safeAck(ack, buildErrorAck(error?.statusCode || 500, error?.message || "Failed to mark job completed"));
		}
	});

	socket.on(JOB_SOCKET_EVENTS.JOB_REJECT, async (payload, ack) => {
		try {
			const jobId = payload?.jobId;
			const afterAccept = Boolean(payload?.afterAccept);
			const reason = payload?.reason;
			if (!jobId) {
				safeAck(ack, buildErrorAck(400, ACK_MESSAGES.JOB_ID_REQUIRED));
				return;
			}

			if (!afterAccept) {
				safeAck(ack, buildErrorAck(403, ACK_MESSAGES.MANUAL_REJECT_DISABLED));
				return;
			}

			const result = await rejectAcceptedJobForFreelancer({
				jobId,
				freelancerId,
				reason,
				emitToRoom,
			});

			safeAck(
				ack,
				buildSuccessAck(200, result, "Job cancelled by freelancer and reassigned")
			);
		} catch (error) {
			safeAck(
				ack,
				buildErrorAck(
					error?.statusCode || 500,
					error?.message || (payload?.afterAccept ? ACK_MESSAGES.FAILED_REJECT_AFTER_ACCEPT : ACK_MESSAGES.FAILED_REJECT_JOB)
				)
			);
		}
	});

	socket.on(SOCKET_EVENTS.DISCONNECT, async (reason) => {
		try {
			locationThrottleBySocketId.delete(socket.id);

			const mappedFreelancerId =
				socketIdToFreelancerId.get(socket.id) || socket.data.userId;

			if (!mappedFreelancerId) {
				socketDebugLog(`[socket] disconnected socketId=${socket.id} reason=${reason}`);
				return;    
			}

			const activeSocketCount = removeSocketMapping(mappedFreelancerId, socket.id);

			if (activeSocketCount === 0) {
				await ProfileFreelancer.updateOne({ _id: mappedFreelancerId }, { $set: { status: "offline" } });
			}

			socketDebugLog(
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
