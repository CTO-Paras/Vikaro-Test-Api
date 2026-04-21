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

const DISTANCE_THRESHOLD_METERS = 250;

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
    ProfileFreelancer.findById(freelancerId).select("location").lean(),
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

const revealCustomerPhone = async ({ jobId, freelancerId, job: preloadedJob = null }) => {
  const job = preloadedJob || await ensureJobForFreelancer(jobId, freelancerId);
  if (!job.customerPhoneVisibleToFreelancer) {
    job.customerPhoneVisibleToFreelancer = true;
    await job.save();
  }

  const customer = await ProfileCustomer.findById(job.customer_id).select("mobileNumber");
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

const updateFreelancerLocation = async ({ jobId, freelancerId, coordinates }) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    throw new ApiError(400, "coordinates must be [lng, lat]");
  }

  const job = await ensureJobForFreelancer(jobId, freelancerId);
  const [customer] = await Promise.all([
    ProfileCustomer.findById(job.customer_id).select("location").lean(),
    ProfileFreelancer.updateOne(
      { _id: freelancerId },
      { $set: { location: { type: "Point", coordinates } } }
    ),
  ]);

  const { distanceMeters, distanceKm } = calculateDistance(
    coordinates,
    customer.location.coordinates
  );

  const payload = {
    jobId,
    freelancerCoordinates: coordinates,
    distanceMeters,
    distanceKm,
  };

  getIOInstance().to(job.roomId || `job_${job._id}`).emit(JOB_WORKFLOW_EVENTS.LOCATION_UPDATED, payload);

  if (checkDistanceThreshold(distanceMeters)) {
    await revealCustomerPhone({ jobId, freelancerId, job });
  }

  return payload;
};

const generateJobOTP = async ({ jobId, customerId }) => {
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
  const freelancer = await ProfileFreelancer.findById(job.acceptedBy).select("location").lean();
  const customer = await ProfileCustomer.findById(job.customer_id).select("location").lean();

  const freelancerCoords = freelancer?.location?.coordinates;
  const customerCoords = customer?.location?.coordinates;

  if (!Array.isArray(freelancerCoords) || freelancerCoords.length !== 2 ||
      !Array.isArray(customerCoords) || customerCoords.length !== 2) {
    throw new ApiError(400, "Could not determine locations to validate arrival");
  }

  const { distanceMeters } = calculateDistance(freelancerCoords, customerCoords);
  if (Number(distanceMeters) > DISTANCE_THRESHOLD_METERS) {
    throw new ApiError(400, "Freelancer has not arrived yet");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await job.setServiceOtp(otp);
  job.status = "arrived";
  await job.save();

  getIOInstance().to(`customer_${customerId}`).emit(JOB_WORKFLOW_EVENTS.JOB_OTP_GENERATED, {
    jobId,
    otp,
  });
  emitLiveNotification({
    recipientId: customerId,
    recipientRole: "customer",
    type: "JOB_OTP_GENERATED",
    title: "OTP generated",
    message: "Share this OTP with the freelancer to start the job",
    data: { jobId, otp },
  });

  return { jobId, otp, expiresAt: job.serviceOtpExpiresAt };
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
