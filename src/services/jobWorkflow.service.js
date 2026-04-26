import { ApiError } from "../utils/APIError.js";
import { Job } from "../models/job.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { acceptJobForFreelancer, clearArrivalTimer } from "./jobDispatch.service.js";
import {
  calculateDistance,
  calculateETA,
  getDistanceMatrix,
  getRouteData,
} from "./maps.service.js";
import { JOB_WORKFLOW_EVENTS } from "../constants/jobWorkflowEvents.constant.js";
import { getIOInstance } from "../sockets/io.instance.js";
import { emitLiveNotification } from "./notification.service.js";

// Distance threshold (meters) for revealing customer phone and allowing OTP generation.
// Configurable via JOB_DISTANCE_THRESHOLD_METERS env var; default is 1000 (1 km).
const DISTANCE_THRESHOLD_METERS = Math.max(
  0,
  Number.parseInt(process.env.JOB_DISTANCE_THRESHOLD_METERS || "1000", 10) || 1000
);

// Bug fix for freeJobsUsed not incrementing when job is completed, even for non-pro freelancers. Also added return of updated freelancer for potential future use.
const trackFreeJobsUsed = async (freelancerId) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId);

  if (!freelancer) throw new ApiError(404, "Freelancer not found");

  const updateQuery = {
    $inc: {
      completedJobsCount: 1,
    },
  };

  if (!freelancer.isProActive) {
    updateQuery.$inc.freeJobsUsed = 1;
  }

  const updatedFreelancer = await ProfileFreelancer.findByIdAndUpdate(
    freelancerId,
    updateQuery,
    { returnDocument: "after" }
  );

  return updatedFreelancer;
};


const ensureJobForFreelancer = async (jobId, freelancerId) => {
  const job = await Job.findById(jobId).select("+serviceOtpHash");
  if (!job) throw new ApiError(404, "Job not found");
  if (!job.acceptedBy || job.acceptedBy.toString() !== freelancerId.toString()) {
    throw new ApiError(403, "Job is not assigned to this freelancer");
  }
  return job;
};

const createJobRoom = async (job) => {
  const roomId = job.roomId || `job_${job._id}`;
  if (!job.roomId) {
    await Job.updateOne(
      { _id: job._id, roomId: null },
      { $set: { roomId } }
    );
    job.roomId = roomId;
  }
  return roomId;
};

const joinJobRoom = (roomId, userId, role) => {
  const io = getIOInstance();
  io.in(`${role}_${userId}`).socketsJoin(roomId);
  io.to(`${role}_${userId}`).emit(JOB_WORKFLOW_EVENTS.JOB_ROOM_JOINED, { roomId });
};

const acceptJob = async ({ jobId, freelancerId }) => {
  const result = await acceptJobForFreelancer({
    jobId,
    freelancerId,
    emitToRoom: (room, event, payload) => getIOInstance().to(room).emit(event, payload),
    joinRoom: (sourceRoom, targetRoom) => getIOInstance().in(sourceRoom).socketsJoin(targetRoom),
  });

  const roomId = await createJobRoom(result.job);

  joinJobRoom(roomId, result.job.customer_id, "customer");
  joinJobRoom(roomId, freelancerId, "freelancer");

  await sendJobDetails({ jobId: result.job._id, freelancerId });

  return { ...result, roomId };
};

const sendJobDetails = async ({ jobId, freelancerId }) => {
  const job = await ensureJobForFreelancer(jobId, freelancerId);
  const [customer, freelancer] = await Promise.all([
    ProfileCustomer.findById(job.customer_id).select("fullname mobileNumber location address").lean(),
    ProfileFreelancer.findById(freelancerId).select("location mobileNumber").lean(),
  ]);

  if (!customer || !freelancer) {
    throw new ApiError(404, "Customer or freelancer profile not found");
  }

  const localDistance = calculateDistance(
    freelancer.location.coordinates,
    customer.location.coordinates
  );

  const localEta = calculateETA(localDistance.distanceMeters);

  let routeData = null;
  let distanceMatrix = null;

  const [routeDataResult, distanceMatrixResult] = await Promise.allSettled([
    getRouteData({
      origin: freelancer.location.coordinates,
      destination: customer.location.coordinates,
    }),
    getDistanceMatrix({
      origin: freelancer.location.coordinates,
      destination: customer.location.coordinates,
    }),
  ]);

  if (routeDataResult.status === "fulfilled") {
    routeData = routeDataResult.value;
  }

  if (distanceMatrixResult.status === "fulfilled") {
    distanceMatrix = distanceMatrixResult.value;
  }

  const payload = {
    jobId: job._id,
    description: job.description,
    paymentAmount: job.amount,
    customerLocation: customer.location,
    customerPhone: customer?.mobileNumber || null,
    freelancerPhone: freelancer?.mobileNumber || null,
    distance: distanceMatrix
      ? {
          text: distanceMatrix.distanceText,
          meters: distanceMatrix.distanceValue,
        }
      : {
          text: `${localDistance.distanceKm} km`,
          meters: localDistance.distanceMeters,
        },
    eta: distanceMatrix
      ? {
          text: distanceMatrix.durationText,
          seconds: distanceMatrix.durationValue,
        }
      : {
          text: localEta.etaText,
          seconds: localEta.etaMinutes * 60,
        },
    routeData,
  };

  getIOInstance().to(`freelancer_${freelancerId}`).emit(JOB_WORKFLOW_EVENTS.JOB_DETAILS, payload);
  emitLiveNotification({
    recipientId: freelancerId,
    recipientRole: "freelancer",
    type: "JOB_DETAILS",
    title: "Job details available",
    message: `You have a new ${job.service} job request`,
    data: payload,
  });
  return payload;
};

const checkDistanceThreshold = (distanceMeters, thresholdMeters = DISTANCE_THRESHOLD_METERS) => {
  return distanceMeters <= thresholdMeters;
};

const getRoomSocketCount = (roomId) => {
  const room = getIOInstance().sockets.adapter.rooms.get(roomId);
  return room?.size || 0;
};

const emitOtpGeneratedToCustomer = (customerId, payload) => {
  const io = getIOInstance();
  const roomId = `customer_${customerId}`;
  const socketCount = getRoomSocketCount(roomId);

  io.to(roomId).emit(JOB_WORKFLOW_EVENTS.JOB_OTP_GENERATED, payload);
  io.to(roomId).emit("JOB_OTP_GENERATED", payload);

  if (process.env.JOB_FLOW_DEBUG === "true") {
    console.log(
      `[job-workflow] otp emitted room=${roomId} sockets=${socketCount} jobId=${payload.jobId} generatedAt=${payload.generatedAt}`
    );
  }

  return {
    roomId,
    socketCount,
    events: [JOB_WORKFLOW_EVENTS.JOB_OTP_GENERATED, "JOB_OTP_GENERATED"],
  };
};

const isValidCoordinatePair = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;

  const [lng, lat] = coordinates;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
};

const revealCustomerPhone = async ({ jobId, freelancerId, job: preloadedJob = null }) => {
  const job = preloadedJob || await ensureJobForFreelancer(jobId, freelancerId);
  if (!job.customerPhoneVisibleToFreelancer) {
    job.customerPhoneVisibleToFreelancer = true;
    await job.save();
  }

  const customer = await ProfileCustomer.findById(job.customer_id).select("mobileNumber");

  // Debug log (redacted) to help identify why customer phone may be null in payloads.
  try {
    const redactedPhone = customer?.mobileNumber
      ? String(customer.mobileNumber).replace(/\d(?=\d{4})/g, "*")
      : null;
    if (process.env.JOB_FLOW_DEBUG === "true") {
      console.log(
        `[job-workflow] revealCustomerPhone jobId=${job._id} customerId=${job.customer_id} phone=${redactedPhone} visible=${job.customerPhoneVisibleToFreelancer}`
      );
    }
  } catch (err) {
    // non-fatal: proceed even if logging fails
    console.error("Failed to redact/log customer phone:", err?.message || err);
  }

  const payload = {
    jobId: job._id,
    customerPhone: customer?.mobileNumber || null,
    canCallCustomer: Boolean(customer?.mobileNumber),
  };

  getIOInstance().to(`freelancer_${freelancerId}`).emit(
    JOB_WORKFLOW_EVENTS.CUSTOMER_PHONE_REVEALED,
    payload
  );
  emitLiveNotification({
    recipientId: freelancerId,
    recipientRole: "freelancer",
    type: "CUSTOMER_PHONE_REVEALED",
    title: "Customer phone revealed",
    message: "You are close enough to contact the customer",
    data: payload,
  });

  return payload;
};

const updateFreelancerLocation = async ({
  jobId,
  freelancerId,
  coordinates,
  persistFreelancerLocation = true,
}) => {
  if (!isValidCoordinatePair(coordinates)) {
    throw new ApiError(400, "coordinates must be [lng, lat]");
  }

  const job = await ensureJobForFreelancer(jobId, freelancerId);
  const [customer] = await Promise.all([
    ProfileCustomer.findById(job.customer_id).select("location").lean(),
    persistFreelancerLocation
      ? ProfileFreelancer.updateOne(
          { _id: freelancerId },
          { $set: { location: { type: "Point", coordinates } } }
        )
      : Promise.resolve(),
  ]);

  if (!isValidCoordinatePair(customer?.location?.coordinates)) {
    throw new ApiError(400, "Customer location is not set");
  }

  const { distanceMeters, distanceKm } = calculateDistance(
    coordinates,
    customer.location.coordinates
  );

  const roomId = job.roomId || `job_${job._id}`;
  const withinDistanceThreshold = checkDistanceThreshold(distanceMeters);
  const payload = {
    jobId: job._id,
    customerId: job.customer_id,
    freelancerId,
    roomId,
    freelancerCoordinates: coordinates,
    distanceMeters,
    distanceKm,
    distanceThresholdMeters: DISTANCE_THRESHOLD_METERS,
    withinDistanceThreshold,
    otpGenerated: false,
  };

  if (withinDistanceThreshold) {
    await revealCustomerPhone({ jobId, freelancerId, job });

    // Auto-generate OTP when freelancer crosses the distance threshold
    // (only if OTP isn't already generated and job is in accepted state).
    try {
      const shouldAutoGenerateOtp = !job?.serviceOtpHash && !job?.serviceOtpExpiresAt && job?.status === "accepted";
      if (shouldAutoGenerateOtp) {
        const otpData = await generateJobOTP({
          jobId,
          customerId: job.customer_id,
          freelancerCoordinates: coordinates,
          customerCoordinates: customer.location.coordinates,
        });
        payload.otpGenerated = true;
        payload.otpExpiresAt = otpData.expiresAt;
        payload.otpGeneratedAt = otpData.generatedAt;
        payload.otpDelivery = otpData.delivery;
      }
    } catch (err) {
      // Non-fatal: log and continue so location updates aren't blocked by OTP failures
      console.error("Auto OTP generation failed:", err?.message || err);
      payload.otpGenerationError = err?.message || "Failed to generate OTP";
    }
  }

  getIOInstance().to(roomId).emit(JOB_WORKFLOW_EVENTS.LOCATION_UPDATED, payload);

  return payload;
};

const generateJobOTP = async ({
  jobId,
  customerId,
  freelancerCoordinates = null,
  customerCoordinates = null,
}) => {
  const job = await Job.findById(jobId).select("+serviceOtpHash");
  if (!job) throw new ApiError(404, "Job not found");
  if (job.customer_id.toString() !== customerId.toString()) {
    throw new ApiError(403, "You can generate OTP only for your own job");
  }
  if (!job.acceptedBy) throw new ApiError(400, "Job is not accepted yet");

  const canGenerateOtpStatuses = new Set(["accepted", "arrived"]);
  if (!canGenerateOtpStatuses.has(job.status)) {
    throw new ApiError(
      400,
      `OTP can be generated only when job is accepted or arrived (current status: ${job.status})`
    );
  }

  // Ensure freelancer is within allowed threshold before generating OTP
  let freelancerCoords = freelancerCoordinates;
  let customerCoords = customerCoordinates;

  if (!isValidCoordinatePair(freelancerCoords) || !isValidCoordinatePair(customerCoords)) {
    const [freelancer, customer] = await Promise.all([
      ProfileFreelancer.findById(job.acceptedBy).select("location").lean(),
      ProfileCustomer.findById(job.customer_id).select("location").lean(),
    ]);

    freelancerCoords = freelancer?.location?.coordinates;
    customerCoords = customer?.location?.coordinates;
  }

  if (!isValidCoordinatePair(freelancerCoords) || !isValidCoordinatePair(customerCoords)) {
    throw new ApiError(400, "Could not determine locations to validate arrival");
  }

  const { distanceMeters } = calculateDistance(freelancerCoords, customerCoords);
  if (Number(distanceMeters) > DISTANCE_THRESHOLD_METERS) {
    throw new ApiError(400, "Freelancer has not arrived yet");
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  await job.setServiceOtp(otp);
  job.status = "arrived";
  await job.save();

  const payload = {
    jobId: job._id,
    otp,
    expiresAt: job.serviceOtpExpiresAt,
    status: job.status,
    distanceMeters,
    distanceThresholdMeters: DISTANCE_THRESHOLD_METERS,
    generatedAt: new Date().toISOString(),
  };

  const delivery = emitOtpGeneratedToCustomer(customerId, payload);
  emitLiveNotification({
    recipientId: customerId,
    recipientRole: "customer",
    type: "JOB_OTP_GENERATED",
    title: "OTP generated",
    message: "Share this OTP with the freelancer to start the job",
    data: payload,
  });

  return { ...payload, delivery };
};

const startJob = async ({ jobId, freelancerId }) => {
  const job = await ensureJobForFreelancer(jobId, freelancerId);
  job.status = "started";
  job.serviceStartedAt = new Date();
  job.serviceOtpHash = null;
  job.serviceOtpExpiresAt = null;
  await job.save();

  // clear arrival timer once job has started
  try {
    clearArrivalTimer(job._id);
  } catch (err) {
    console.error("Failed to clear arrival timer on job start:", err?.message || err);
  }

  getIOInstance().to(job.roomId || `job_${job._id}`).emit(JOB_WORKFLOW_EVENTS.JOB_STARTED, {
    jobId: job._id,
    status: job.status,
    startedAt: job.serviceStartedAt,
  });
  emitLiveNotification({
    recipientId: freelancerId,
    recipientRole: "freelancer",
    type: "JOB_STARTED",
    title: "Job started",
    message: "The service has started successfully",
    data: { jobId: job._id, status: job.status },
  });
  emitLiveNotification({
    recipientId: job.customer_id,
    recipientRole: "customer",
    type: "JOB_STARTED",
    title: "Job started",
    message: "Your freelancer has started the job",
    data: { jobId: job._id, status: job.status },
  });

  return job;
};

const verifyJobOTP = async ({ jobId, freelancerId, otp }) => {
  const job = await ensureJobForFreelancer(jobId, freelancerId);
  const isValid = await job.verifyServiceOtp(otp);

  if (!isValid) {
    throw new ApiError(400, "Invalid or expired OTP");
  }

  return startJob({ jobId, freelancerId });
};

const sendCompletionConfirmation = async (job) => {
  getIOInstance().to(`customer_${job.customer_id}`).emit(JOB_WORKFLOW_EVENTS.JOB_COMPLETION_REQUESTED, {
    jobId: job._id,
    status: job.status,
    amount: job.amount,
  });
  emitLiveNotification({
    recipientId: job.customer_id,
    recipientRole: "customer",
    type: "JOB_COMPLETION_REQUESTED",
    title: "Completion requested",
    message: "The freelancer marked the job as completed",
    data: { jobId: job._id, status: job.status, amount: job.amount },
  });
};

const markJobCompleted = async ({ jobId, freelancerId }) => {
  const job = await ensureJobForFreelancer(jobId, freelancerId);
  if (!["started", "in_progress"].includes(job.status)) {
    throw new ApiError(400, "Job is not in progress");
  }


  job.status = "completion_pending";
  job.completionMarkedAt = new Date();
  await job.save();

  await sendCompletionConfirmation(job);

  return job;
};

const confirmJobCompletion = async ({ jobId, customerId }) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  if (job.customer_id.toString() !== customerId.toString()) {
    throw new ApiError(403, "You can only confirm your own job");
  }
  if (job.status !== "completion_pending") {
    throw new ApiError(400, "Job is not awaiting completion confirmation");
  }
  job.status = "completed";
  job.completionConfirmedAt = new Date();
  await job.save();

  if (!job.acceptedBy) {
    throw new ApiError(400, "No freelancer assigned to this job");
  }

  await trackFreeJobsUsed(job.acceptedBy);

  getIOInstance().to(job.roomId || `job_${job._id}`).emit(JOB_WORKFLOW_EVENTS.JOB_COMPLETED, {
    jobId: job._id,
    status: job.status,
  });
  emitLiveNotification({
    recipientId: job.acceptedBy,
    recipientRole: "freelancer",
    type: "JOB_COMPLETED",
    title: "Job completed",
    message: "The customer confirmed job completion",
    data: { jobId: job._id, status: job.status },
  });
  emitLiveNotification({
    recipientId: job.customer_id,
    recipientRole: "customer",
    type: "JOB_COMPLETED",
    title: "Job completed",
    message: "You confirmed the job completion",
    data: { jobId: job._id, status: job.status },
  });

  return job;
};

const reportJobIssue = async ({ jobId, customerId, issueDetails }) => {
  const job = await Job.findById(jobId);
  if (!job) throw new ApiError(404, "Job not found");
  if (job.customer_id.toString() !== customerId.toString()) {
    throw new ApiError(403, "You can only report issue for your own job");
  }

  job.status = "issue_reported";
  job.issueDetails = issueDetails || "Issue reported by customer";
  await job.save();

  getIOInstance().to(job.roomId || `job_${job._id}`).emit(JOB_WORKFLOW_EVENTS.JOB_ISSUE_REPORTED, {
    jobId: job._id,
    status: job.status,
    issueDetails: job.issueDetails,
  });
  emitLiveNotification({
    recipientId: job.acceptedBy,
    recipientRole: "freelancer",
    type: "JOB_ISSUE_REPORTED",
    title: "Job issue reported",
    message: "The customer reported an issue on this job",
    data: { jobId: job._id, status: job.status, issueDetails: job.issueDetails },
  });
  emitLiveNotification({
    recipientId: job.customer_id,
    recipientRole: "customer",
    type: "JOB_ISSUE_REPORTED",
    title: "Issue reported",
    message: "Your issue report was saved",
    data: { jobId: job._id, status: job.status, issueDetails: job.issueDetails },
  });

  return job;
};

export {
  acceptJob,
  sendJobDetails,
  updateFreelancerLocation,
  generateJobOTP,
  verifyJobOTP,
  markJobCompleted,
  confirmJobCompletion,
  reportJobIssue,
};
