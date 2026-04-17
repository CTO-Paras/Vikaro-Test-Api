import mongoose from "mongoose";
import { Job } from "../models/job.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { enqueuePushNotificationJob } from "./notification.service.js";
import { ApiError } from "../utils/APIError.js";
import { JOB_DISPATCH_SOCKET_EVENTS as SOCKET_EVENTS } from "../constants/jobDispatchEvents.constant.js";
import { getFreelancerWalletBalance } from "./wallet.service.js";
import { calculateDistance } from "./maps.service.js";
import { MIN_ALLOWED_BALANCE } from "../constants/wallet.constant.js";

const JOB_DISPATCH_RADIUS_METERS = 1000;
const JOB_RESPONSE_TIMEOUT_MS = 30000;
const JOB_DISPATCH_BATCH_SIZE = 4;
const CANCEL_WINDOW_DAYS = 30;
const CANCEL_RESTRICTION_DAYS = 30;
const MAX_CANCELS_WITHIN_WINDOW = 3;

const dispatchTimers = new Map();
const jobArrivalTimers = new Map();

const JOB_ARRIVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const clearArrivalTimer = (jobId) => {
  const key = jobId.toString();
  const existing = jobArrivalTimers.get(key);
  if (!existing) return;
  clearTimeout(existing);
  jobArrivalTimers.delete(key);
};

const scheduleArrivalTimer = (jobId, freelancerId, emitToRoom) => {
  clearArrivalTimer(jobId);

  const key = jobId.toString();
  const timer = setTimeout(async () => {
    try {
      const job = await Job.findById(jobId).select("status acceptedBy customer_id roomId");
      if (!job) return;

      if (job.status === "accepted") {
        const autoCancelled = await Job.findOneAndUpdate(
          {
            _id: jobId,
            status: "accepted",
          },
          {
            status: "auto_cancelled_timeout",
            cancelReason: "Freelancer did not arrive in time",
            cancelledBy: "system",
            requestTimeoutAt: new Date(),
            expiresAt: new Date(),
            $addToSet: { rejectedBy: job.acceptedBy },
          },
          { new: true }
        );

        if (!autoCancelled) return;

        clearDispatchTimer(autoCancelled._id);
        clearArrivalTimer(autoCancelled._id);

        if (autoCancelled.acceptedBy) {
          await ProfileFreelancer.findByIdAndUpdate(autoCancelled.acceptedBy, { status: "online" });
        }

        const notifyPayload = {
          jobId: autoCancelled._id,
          status: autoCancelled.status,
          message: "Freelancer did not arrive in time",
          timestamp: new Date().toISOString(),
        };
        

        emitJobEvent(emitToRoom, "freelancer", job.acceptedBy, SOCKET_EVENTS.JOB_REJECT, notifyPayload, [SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER]);
        emitJobEvent(emitToRoom, "customer", job.customer_id, SOCKET_EVENTS.JOB_REJECT, notifyPayload, [SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER]);

        await dispatchToNextFreelancer({
          jobId: autoCancelled._id,
          emitToRoom,
          finalStatusWhenEmpty: "rejected_timeout",
          redistributedBy: null,
          redistributionReason: "auto_cancelled_timeout",
        });
      }
    } catch (error) {
      console.error("Failed to auto-cancel accepted job on arrival timeout:", error.message || error);
    }
  }, JOB_ARRIVAL_TIMEOUT_MS);

  jobArrivalTimers.set(key, timer);
};

const buildRoom = (role, userId) => `${role}_${userId}`;

const emitJobEvent = (emitToRoom, role, userId, event, payload, aliases = []) => {
  emitToRoom(buildRoom(role, userId), event, payload);
  aliases.forEach((aliasEvent) => {
    emitToRoom(buildRoom(role, userId), aliasEvent, payload);
  });
};

const toIdString = (value) => value?.toString();

const ensureValidObjectId = (value, fieldName = "id") => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
};

const isValidCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;

  const [lng, lat] = coordinates;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
};

const clearDispatchTimer = (jobId) => {
  const key = jobId.toString();
  const existing = dispatchTimers.get(key);
  if (!existing) return;
  clearTimeout(existing);
  dispatchTimers.delete(key);
};

const restoreExpiredRestrictions = async () => {
  const now = new Date();
  await ProfileFreelancer.updateMany(
    {
      accountStatus: "temporarily_unverified",
      restrictionUntil: { $lte: now },
    },
    {
      $set: {
        accountStatus: "active",
        restrictionUntil: null,
        cancelCount: 0,
      },
    }
  );
};

const ensureFreelancerCanAcceptJobs = async (freelancerId) => {
  await restoreExpiredRestrictions();

  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "accountStatus restrictionUntil"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer profile not found");
  }

  const isRestricted =
    freelancer.accountStatus === "temporarily_unverified" &&
    freelancer.restrictionUntil &&
    freelancer.restrictionUntil.getTime() > Date.now();

  if (isRestricted) {
    throw new ApiError(
      403,
      `Account temporarily unverified until ${freelancer.restrictionUntil.toISOString()}`
    );
  }

  const walletBalance = await getFreelancerWalletBalance(freelancerId);
  if (walletBalance <= MIN_ALLOWED_BALANCE) {
    throw new ApiError(403, "Recharge wallet to continue accepting jobs.");
  }
};

const recordFreelancerCancellation = async ({ freelancerId, jobId, reason }) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId);
  if (!freelancer) {
    throw new ApiError(404, "Freelancer profile not found");
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const recentHistory = (freelancer.cancelHistory || []).filter(
    (entry) => entry?.cancelledAt && new Date(entry.cancelledAt) >= windowStart
  );

  recentHistory.push({
    jobId,
    reason: reason || "Cancelled by freelancer",
    cancelledAt: now,
  });

  freelancer.cancelHistory = recentHistory;
  freelancer.cancelCount = recentHistory.length;

  const restrictionApplied = recentHistory.length >= MAX_CANCELS_WITHIN_WINDOW;
  let restrictionUntil = null;

  if (restrictionApplied) {
    restrictionUntil = new Date(now.getTime() + CANCEL_RESTRICTION_DAYS * 24 * 60 * 60 * 1000);
    freelancer.accountStatus = "temporarily_unverified";
    freelancer.restrictionUntil = restrictionUntil;
    freelancer.status = "offline";
  }

  await freelancer.save();

  return {
    penaltyApplied: restrictionApplied,
    cancelCount: freelancer.cancelCount,
    restrictionUntil: restrictionUntil || freelancer.restrictionUntil,
  };
};

const scheduleDispatchTimer = (jobId, freelancerIds, emitToRoom) => {
  clearDispatchTimer(jobId);

  const key = jobId.toString();
  const timer = setTimeout(async () => {
    try {
      await expireFreelancerBatch({
        jobId,
        freelancerIds,
        emitToRoom,
      });
    } catch (error) {
      console.error("Failed to auto-expire freelancer batch response:", error.message);
    }
  }, JOB_RESPONSE_TIMEOUT_MS);

  dispatchTimers.set(key, timer);
};

const getNearbyFreelancers = async ({ category, customerCoordinates }) => {
  await restoreExpiredRestrictions();

  return ProfileFreelancer.find({
    skill: category,
    status: "online",
    isVerified: true,
    $or: [{ accountStatus: { $exists: false } }, { accountStatus: "active" }],
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: customerCoordinates,
        },
        $maxDistance: JOB_DISPATCH_RADIUS_METERS,
      },
    },
  }).select("_id");
};

const getQueuedFreelancers = (job) => {
  const rejected = new Set((job.rejectedBy || []).map(toIdString));
  const expired = new Set((job.expiredBy || []).map(toIdString));

  return (job.notifiedFreelancers || []).filter((freelancerId) => {
    const id = toIdString(freelancerId);
    return !rejected.has(id) && !expired.has(id);
  });
};

const settleJobWhenQueueEmpty = async ({ job, emitToRoom, finalStatus = "rejected_timeout" }) => {
  const finalized = await Job.findOneAndUpdate(
    {
      _id: job._id,
      status: "pending",
      activeFreelancers: { $size: 0 },
      notifiedFreelancers: { $size: 0 },
    },
    {
      status: finalStatus,
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
    },
    { new: true }
  );

  if (!finalized) return null;

  clearDispatchTimer(finalized._id);

  emitJobEvent(
    emitToRoom,
    "customer",
    finalized.customer_id,
    SOCKET_EVENTS.JOB_EXPIRED,
    {
      jobId: finalized._id,
      status: finalized.status,
      timestamp: new Date().toISOString(),
    },
    [SOCKET_EVENTS.JOB_REQUEST_EXPIRED]
  );

  return finalized;
};

const dispatchToNextFreelancer = async ({
  jobId,
  emitToRoom,
  finalStatusWhenEmpty = "rejected_timeout",
  redistributedBy = null,
  redistributionReason = null,
}) => {
  const pendingJob = await Job.findById(jobId);
  if (!pendingJob || pendingJob.status !== "pending") return pendingJob;

  const hasActiveBatch = Array.isArray(pendingJob.activeFreelancers) && pendingJob.activeFreelancers.length > 0;
  if (hasActiveBatch) {
    return pendingJob;
  }

  const queuedFreelancers = getQueuedFreelancers(pendingJob);
  const nextBatch = queuedFreelancers.slice(0, JOB_DISPATCH_BATCH_SIZE);

  if (nextBatch.length === 0) {
    return settleJobWhenQueueEmpty({
      job: pendingJob,
      emitToRoom,
      finalStatus: finalStatusWhenEmpty,
    });
  }

  const requestTimeoutAt = new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS);

  const assignedJob = await Job.findOneAndUpdate(
    {
      _id: pendingJob._id,
      status: "pending",
      activeFreelancers: { $size: 0 },
    },
    {
      currentFreelancer: null,
      activeFreelancers: nextBatch,
      requestTimeoutAt,
      expiresAt: requestTimeoutAt,
    },
    { new: true }
  );

  if (!assignedJob) {
    return Job.findById(jobId);
  }

  const payload = {
    job: assignedJob,
    requestTimeoutAt,
    expiresAt: requestTimeoutAt,
    responseTimeoutMs: JOB_RESPONSE_TIMEOUT_MS,
  };

  nextBatch.forEach((freelancerId) => {
    emitJobEvent(
      emitToRoom,
      "freelancer",
      freelancerId,
      SOCKET_EVENTS.JOB_INCOMING,
      payload,
      [SOCKET_EVENTS.JOB_REQUEST_SENT]
    );
  });

  if (redistributionReason) {
    emitJobEvent(
      emitToRoom,
      "customer",
      assignedJob.customer_id,
      SOCKET_EVENTS.JOB_REDISTRIBUTED,
      {
        jobId: assignedJob._id,
        redistributedBy,
        reason: redistributionReason,
        nextFreelancerIds: nextBatch,
        timestamp: new Date().toISOString(),
      }
    );
  }

  try {
    const freelancers = await ProfileFreelancer.find({ _id: { $in: nextBatch } }).select("playerId");
    const playerIds = freelancers
      .map((freelancer) => freelancer.playerId)
      .filter((playerId) => typeof playerId === "string" && playerId.trim().length > 0);

    if (playerIds.length > 0) {
      await enqueuePushNotificationJob({
        playerIds,
        title: "New Job Request",
        message: `New ${assignedJob.service} job near you`,
        data: { jobId: assignedJob._id, requestTimeoutAt },
      });
    }
  } catch (error) {
    console.error("Failed to send job push notification:", error.message);
  }

  scheduleDispatchTimer(assignedJob._id, nextBatch, emitToRoom);

  return assignedJob;
};

const createJobAndDispatch = async ({ customer, category, service, description, emitToRoom }) => {
  const customerCoordinates = customer?.location?.coordinates;

  if (!isValidCoordinates(customerCoordinates)) {
    throw new ApiError(400, "Customer address location not set");
  }

  const nearbyFreelancers = await getNearbyFreelancers({
    category,
    customerCoordinates,
  });

  const candidateFreelancerIds = nearbyFreelancers.map((freelancer) => freelancer._id);

  const job = await Job.create({
    customer_id: customer._id,
    category,
    service,
    description,
    jobLocation: {
      type: "Point",
      coordinates: customerCoordinates,
    },
    status: "pending",
    notifiedFreelancers: candidateFreelancerIds,
    activeFreelancers: [],
    requestTimeoutAt: new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS),
    expiresAt: new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS),
  });

  //  TASK 10 FIX: handle no freelancers case
  if (candidateFreelancerIds.length === 0) {
    await Job.findByIdAndUpdate(job._id, {
      status: "expired",
      expiresAt: new Date(),
    });

    // ✅ Socket event (existing)
    emitJobEvent(
      emitToRoom,
      "customer",
      job.customer_id,
      SOCKET_EVENTS.JOB_EXPIRED,
      {
        jobId: job._id,
        status: "expired",
        reason: "no_available_freelancers",
      }
    );

    // fix for push notification not sent when no freelancers are available
    if (customer?.playerId) {
      try {
        await enqueuePushNotificationJob({
          playerIds: [customer.playerId],
          title: "No Freelancers Available",
          message: "No freelancers available right now. Please try again later.",
          data: { jobId: job._id },
        });
      } catch (error) {
        console.error("Failed to send push notification:", error.message);
      }
    }

    return {
      job: await Job.findById(job._id),
      freelancersNotified: 0,
      expiresAt: null,
    };
  }

  const dispatchedJob = await dispatchToNextFreelancer({
    jobId: job._id,
    emitToRoom,
    finalStatusWhenEmpty: "rejected_timeout",
  });

  return {
    job: dispatchedJob,
    freelancersNotified: candidateFreelancerIds.length,
    expiresAt: dispatchedJob?.expiresAt || null,
  };
};

const acceptJobForFreelancer = async ({
  jobId,
  freelancerId,
  emitToRoom,
  joinRoom,
}) => {
  ensureValidObjectId(jobId, "jobId");
  await ensureFreelancerCanAcceptJobs(freelancerId);

  const now = new Date();

  const liveOfferJob = await Job.findOne({
    _id: jobId,
    status: "pending",
    activeFreelancers: freelancerId,
    notifiedFreelancers: freelancerId,
    rejectedBy: { $nin: [freelancerId] },
    expiredBy: { $nin: [freelancerId] },
    expiresAt: { $gt: now },
  }).select("activeFreelancers");

  if (!liveOfferJob) {
    throw new ApiError(
      400,
      "Job already accepted, expired, rejected, or not available for this freelancer"
    );
  }

  const activeBatch = liveOfferJob.activeFreelancers || [];

  const job = await Job.findOneAndUpdate(
    {
      _id: jobId,
      status: "pending",
      activeFreelancers: freelancerId,
      notifiedFreelancers: freelancerId,
      rejectedBy: { $nin: [freelancerId] },
      expiredBy: { $nin: [freelancerId] },
      expiresAt: { $gt: now },
    },
    {
      status: "accepted",
      acceptedBy: freelancerId,
      currentFreelancer: null,
      activeFreelancers: [],
      $pull: { notifiedFreelancers: { $in: activeBatch } },
    },
    { new: true }
  );

  if (!job) {
    throw new ApiError(
      400,
      "Job already accepted, expired, rejected, or not available for this freelancer"
    );
  }

  clearDispatchTimer(job._id);

  await ProfileFreelancer.findByIdAndUpdate(freelancerId, { status: "busy" });

  const trackingRoomId = `job_${job._id}`;
  joinRoom(`customer_${job.customer_id}`, trackingRoomId);
  joinRoom(`freelancer_${freelancerId}`, trackingRoomId);

  const payload = { job, trackingRoomId };
  emitJobEvent(
    emitToRoom,
    "customer",
    job.customer_id,
    SOCKET_EVENTS.JOB_ACCEPT,
    payload,
    [SOCKET_EVENTS.JOB_ACCEPTED]
  );
  emitJobEvent(
    emitToRoom,
    "freelancer",
    freelancerId,
    SOCKET_EVENTS.JOB_ACCEPT,
    payload,
    [SOCKET_EVENTS.JOB_ACCEPTED]
  );

  const otherOfferedFreelancers = activeBatch.filter(
    (activeFreelancerId) => toIdString(activeFreelancerId) !== toIdString(freelancerId)
  );

  otherOfferedFreelancers.forEach((otherFreelancerId) => {
    emitJobEvent(emitToRoom, "freelancer", otherFreelancerId, SOCKET_EVENTS.JOB_EXPIRED, {
      jobId: job._id,
      status: "taken_by_other_freelancer",
    });
  });

  // Start arrival timer: if freelancer doesn't start job within timeout, auto-cancel
  try {
    scheduleArrivalTimer(job._id, freelancerId, emitToRoom);
  } catch (err) {
    console.error("Failed to schedule arrival timer:", err?.message || err);
  }

  return { job, trackingRoomId };
};

const rejectAcceptedJobForFreelancer = async ({
  jobId,
  freelancerId,
  emitToRoom,
  reason,
}) => {
  ensureValidObjectId(jobId, "jobId");

  // Prevent cancellation when freelancer is very close to customer
  //                                  task by 
  try {
    const jobSnapshot = await Job.findById(jobId).select("jobLocation acceptedBy status");
    const freelancerSnapshot = await ProfileFreelancer.findById(freelancerId).select(
      "location"
    );

    const jobCoords = jobSnapshot?.jobLocation?.coordinates;
    const freelancerCoords = freelancerSnapshot?.location?.coordinates;

    if (isValidCoordinates(jobCoords) && isValidCoordinates(freelancerCoords)) {
      const { distanceMeters } = calculateDistance(freelancerCoords, jobCoords);
      if (Number(distanceMeters) < 50) {
        throw new ApiError(400, "You are too close to the customer to cancel");
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // non-fatal: proceed with cancellation if distance check fails unexpectedly
    console.error("Distance check failed:", err?.message || err);
  }

  const cancelledJob = await Job.findOneAndUpdate(
    {
      _id: jobId,
      acceptedBy: freelancerId,
      status: { $in: ["accepted", "arrived", "started", "in_progress", "completion_pending"] },
    },
    {
      status: "cancelled_by_freelancer",
      cancelReason: reason || "Freelancer cancelled after acceptance",
      cancelledBy: "freelancer",
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
      $addToSet: { rejectedBy: freelancerId },
    },
    { new: true }
  );

  if (!cancelledJob) {
    throw new ApiError(400, "Only assigned freelancer can reject an active accepted job");
  }

  clearDispatchTimer(cancelledJob._id);
  clearArrivalTimer(cancelledJob._id);

  await ProfileFreelancer.findByIdAndUpdate(freelancerId, { status: "online" });

  const penalty = await recordFreelancerCancellation({
    freelancerId,
    jobId: cancelledJob._id,
    reason,
  });

  const notifyPayload = {
    jobId: cancelledJob._id,
    freelancerId,
    status: "cancelled_by_freelancer",
    message: reason || "Freelancer cancelled the accepted job",
    timestamp: new Date().toISOString(),
    penaltyApplied: penalty.penaltyApplied,
    cancelCount: penalty.cancelCount,
    restrictionUntil: penalty.restrictionUntil,
  };

  emitJobEvent(emitToRoom, "freelancer", freelancerId, SOCKET_EVENTS.JOB_REJECT, notifyPayload, [
    SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER,
  ]);
  emitJobEvent(
    emitToRoom,
    "customer",
    cancelledJob.customer_id,
    SOCKET_EVENTS.JOB_REJECT,
    notifyPayload,
    [SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER]
  );

  const readyForRedispatch = await Job.findOneAndUpdate(
    {
      _id: cancelledJob._id,
      status: "cancelled_by_freelancer",
    },
    {
      status: "pending",
      acceptedBy: null,
      currentFreelancer: null,
      activeFreelancers: [],
      customerPhoneVisibleToFreelancer: false,
      serviceOtpHash: null,
      serviceOtpExpiresAt: null,
      serviceStartedAt: null,
      completionMarkedAt: null,
      completionConfirmedAt: null,
      issueDetails: null,
      paymentStatus: "unpaid",
      paymentQrUrl: null,
      cancelReason: null,
      cancelledBy: null,
      requestTimeoutAt: new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS),
      expiresAt: new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS),
      $pull: { activeFreelancers: freelancerId, notifiedFreelancers: freelancerId },
    },
    { new: true }
  );

  if (!readyForRedispatch) {
    throw new ApiError(409, "Job state changed before redistribution");
  }

  await dispatchToNextFreelancer({
    jobId: cancelledJob._id,
    emitToRoom,
    finalStatusWhenEmpty: "rejected_timeout",
    redistributedBy: freelancerId,
    redistributionReason: "freelancer_cancelled",
  });

  return {
    job: await Job.findById(cancelledJob._id),
    penalty,
  };
};

const cancelJobByCustomer = async ({ jobId, customerId, reason, emitToRoom }) => {
  ensureValidObjectId(jobId, "jobId");

  const nowIso = new Date().toISOString();

  const pendingSnapshot = await Job.findOne({
    _id: jobId,
    customer_id: customerId,
    status: "pending",
  }).select("activeFreelancers notifiedFreelancers");

  const offeredFreelancers = pendingSnapshot
    ? [...(pendingSnapshot.activeFreelancers || []), ...(pendingSnapshot.notifiedFreelancers || [])]
    : [];

  const pendingCancelled = await Job.findOneAndUpdate(
    {
      _id: jobId,
      customer_id: customerId,
      status: "pending",
    },
    {
      status: "cancelled",
      cancelReason: reason || "Cancelled by customer",
      cancelledBy: "customer",
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
      activeFreelancers: [],
    },
    { new: true }
  );

  if (pendingCancelled) {
    clearDispatchTimer(pendingCancelled._id);

    offeredFreelancers.forEach((freelancerId) => {
      emitJobEvent(
        emitToRoom,
        "freelancer",
        freelancerId,
        SOCKET_EVENTS.JOB_EXPIRED,
        {
          jobId: pendingCancelled._id,
          reason: reason || "Cancelled by customer",
          status: "cancelled",
          timestamp: nowIso,
        },
        [SOCKET_EVENTS.JOB_CANCELLED_BY_CUSTOMER]
      );
    });

    return pendingCancelled;
  }

  const acceptedCancelled = await Job.findOneAndUpdate(
    {
      _id: jobId,
      customer_id: customerId,
      status: { $in: ["accepted", "arrived", "started", "in_progress", "completion_pending"] },
    },
    {
      status: "cancelled_by_customer",
      cancelReason: reason || "Cancelled by customer",
      cancelledBy: "customer",
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
    },
    { new: true }
  );

  if (!acceptedCancelled) {
    throw new ApiError(400, "Job cannot be cancelled in current state");
  }

  clearDispatchTimer(acceptedCancelled._id);

  if (acceptedCancelled.acceptedBy) {
    await ProfileFreelancer.findByIdAndUpdate(acceptedCancelled.acceptedBy, { status: "online" });

    clearArrivalTimer(acceptedCancelled._id);

    emitJobEvent(
      emitToRoom,
      "freelancer",
      acceptedCancelled.acceptedBy,
      SOCKET_EVENTS.JOB_EXPIRED,
      {
        jobId: acceptedCancelled._id,
        reason: acceptedCancelled.cancelReason,
        status: "cancelled_by_customer",
        timestamp: nowIso,
      },
      [SOCKET_EVENTS.JOB_CANCELLED_BY_CUSTOMER]
    );
  }

  return acceptedCancelled;
};

const expireFreelancerBatch = async ({
  jobId,
  freelancerIds,
  emitToRoom,
}) => {
  if (!Array.isArray(freelancerIds) || freelancerIds.length === 0) return null;

  const job = await Job.findOneAndUpdate(
    {
      _id: jobId,
      status: "pending",
      activeFreelancers: { $in: freelancerIds },
    },
    {
      $addToSet: { expiredBy: { $each: freelancerIds } },
      $pull: {
        notifiedFreelancers: { $in: freelancerIds },
        activeFreelancers: { $in: freelancerIds },
      },
    },
    { new: true }
  );

  if (!job) return null;

  clearDispatchTimer(job._id);

  freelancerIds.forEach((freelancerId) => {
    emitJobEvent(
      emitToRoom,
      "freelancer",
      freelancerId,
      SOCKET_EVENTS.JOB_EXPIRED,
      {
        jobId: job._id,
        freelancerId,
        status: "rejected_timeout",
        timestamp: new Date().toISOString(),
      },
      [SOCKET_EVENTS.JOB_REQUEST_EXPIRED]
    );
  });

  emitJobEvent(
    emitToRoom,
    "customer",
    job.customer_id,
    SOCKET_EVENTS.JOB_EXPIRED,
    {
      jobId: job._id,
      freelancerIds,
      status: "rejected_timeout",
      timestamp: new Date().toISOString(),
    },
    [SOCKET_EVENTS.JOB_REQUEST_EXPIRED]
  );

  await dispatchToNextFreelancer({
    jobId: job._id,
    emitToRoom,
    finalStatusWhenEmpty: "rejected_timeout",
    redistributionReason: "request_timeout",
  });

  return job;
};

export {
  SOCKET_EVENTS,
  createJobAndDispatch,
  acceptJobForFreelancer,
  rejectAcceptedJobForFreelancer,
  cancelJobByCustomer,
  clearArrivalTimer,
};
