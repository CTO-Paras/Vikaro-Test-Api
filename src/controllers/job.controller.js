import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Job } from "../models/job.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { io } from "../../index.js";
import { sendPushNotificationService } from "../services/notification.service.js";
import mongoose from "mongoose";

const JOB_DISPATCH_RADIUS_METERS = 1000;
const JOB_RESPONSE_TIMEOUT_MS = 30000;

const SOCKET_EVENTS = {
  JOB_REQUESTED: "jobRequested",
  JOB_EXPIRED: "jobExpired",
  JOB_ACCEPTED: "jobAccepted",
  JOB_UNAVAILABLE: "jobUnavailable",
};

const ensureRole = (user, role) => {
  if (!user || user.role !== role) {
    throw new ApiError(403, `Only ${role}s can perform this action`);
  }
};

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

const handlerCreateJob = asyncHandler(async (req, res) => {
  const { category, service, description } = req.body;
  const customer = req.user;
  ensureRole(customer, "customer");

  const customerCoordinates = customer?.location?.coordinates;
  if (!isValidCoordinates(customerCoordinates)) {
    throw new ApiError(400, "Customer address location not set");
  }

  const expiresAt = new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS);

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
    expiresAt,
  });

  const nearbyFreelancers = await ProfileFreelancer.find({
    skill: category,
    status: "online",
    isVerified: true,
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: customerCoordinates,
        },
        $maxDistance: JOB_DISPATCH_RADIUS_METERS,
      },
    },
  }).select("_id playerId");

  const notifiedFreelancerIds = nearbyFreelancers.map((freelancer) => freelancer._id);
  job.notifiedFreelancers = notifiedFreelancerIds;
  await job.save();

  const jobPayload = {
    ...job.toObject(),
    expiresAt,
  };

  for (const freelancer of nearbyFreelancers) {
    io.to(`freelancer_${freelancer._id}`).emit(SOCKET_EVENTS.JOB_REQUESTED, jobPayload);

    if (freelancer.playerId) {
      try {
        await sendPushNotificationService({
          playerIds: [freelancer.playerId],
          title: "New Job Request",
          message: `New ${service} job near you`,
          data: { jobId: job._id, expiresAt },
        });
      } catch (error) {
        console.error("Failed to send push notification:", error.message);
      }
    }
  }

  setTimeout(async () => {
    try {
      const expiredJob = await Job.findOneAndUpdate(
        {
          _id: job._id,
          status: "pending",
          expiresAt: { $lte: new Date() },
        },
        { status: "expired" },
        { new: true }
      );

      if (!expiredJob) return;

      const payload = {
        jobId: expiredJob._id,
        status: expiredJob.status,
      };

      io.to(`customer_${expiredJob.customer_id}`).emit(SOCKET_EVENTS.JOB_EXPIRED, payload);
      for (const freelancerId of expiredJob.notifiedFreelancers || []) {
        io.to(`freelancer_${freelancerId}`).emit(SOCKET_EVENTS.JOB_EXPIRED, payload);
      }
    } catch (error) {
      console.error("Failed to auto-expire job:", error.message);
    }
  }, JOB_RESPONSE_TIMEOUT_MS);

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        job,
        freelancersNotified: nearbyFreelancers.length,
        expiresAt,
      },
      "Job created successfully"
    )
  );
});

const handlerAcceptJob = asyncHandler(async (req, res) => {
  const { jobId } = req.body;
  const freelancer = req.user;

  ensureRole(freelancer, "freelancer");
  ensureValidObjectId(jobId, "jobId");

  const now = new Date();

  const job = await Job.findOneAndUpdate(
    {
      _id: jobId,
      status: "pending",
      notifiedFreelancers: freelancer._id,
      rejectedBy: { $nin: [freelancer._id] },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    },
    {
      status: "accepted",
      acceptedBy: freelancer._id,
    },
    { new: true }
  );

  if (!job) {
    throw new ApiError(
      400,
      "Job already accepted, expired, or not available for this freelancer"
    );
  }

  await ProfileFreelancer.findByIdAndUpdate(freelancer._id, { status: "busy" });

  const trackingRoomId = `job_${job._id}`;

  io.in(`customer_${job.customer_id}`).socketsJoin(trackingRoomId);
  io.in(`freelancer_${freelancer._id}`).socketsJoin(trackingRoomId);

  const acceptedPayload = { job, trackingRoomId };

  io.to(`customer_${job.customer_id}`).emit(SOCKET_EVENTS.JOB_ACCEPTED, acceptedPayload);
  io.to(`freelancer_${freelancer._id}`).emit(SOCKET_EVENTS.JOB_ACCEPTED, acceptedPayload);

  const remainingFreelancerIds = (job.notifiedFreelancers || []).filter(
    (freelancerId) => freelancerId.toString() !== freelancer._id.toString()
  );

  const unavailablePayload = {
    jobId: job._id,
    acceptedBy: freelancer._id,
    clearCard: true,
  };

  for (const freelancerId of remainingFreelancerIds) {
    io.to(`freelancer_${freelancerId}`).emit(
      SOCKET_EVENTS.JOB_UNAVAILABLE,
      unavailablePayload
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, { job, trackingRoomId }, "Job accepted successfully"));
});

export { handlerCreateJob, handlerAcceptJob };