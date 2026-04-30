import { Job } from "../models/job.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { FreelancerRating } from "../models/freelancerRating.model.js";
import { generateJobOTP } from "./jobWorkflow.service.js";
import { getCachedJobOtp } from "./jobOtpCache.service.js";

const ACTIVE_JOB_STATUSES = [
  "accepted",
  "arrived",
  "started",
  "completion_pending",
  "issue_reported",
];

const RESTORABLE_JOB_STATUSES = [...ACTIVE_JOB_STATUSES, "completed"];

const STATUS_SCREEN_MAP = {
  accepted: "tracking",
  arrived: "otp",
  started: "ongoing_service",
  completion_pending: "completion_confirmation",
  issue_reported: "issue_review",
  completed: "payment_or_rating",
};

const STATUS_ORDER = {
  pending: 0,
  accepted: 1,
  arrived: 2,
  started: 3,
  completion_pending: 4,
  issue_reported: 5,
  completed: 6,
};

const toIdString = (value) => value?.toString?.() || String(value || "");

const toIsoString = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const ensureJobRoomId = async (job) => {
  const roomId = job.roomId || `job_${job._id}`;
  if (!job.roomId) {
    await Job.updateOne({ _id: job._id, roomId: null }, { $set: { roomId } });
  }
  return roomId;
};

const shouldRestoreJob = ({ job, role, ratingSubmitted }) => {
  if (!job) return false;
  if (ACTIVE_JOB_STATUSES.includes(job.status)) return true;

  if (job.status === "completed") {
    if (job.paymentStatus !== "paid") return true;
    if (role === "customer" && !ratingSubmitted) return true;
  }

  return false;
};

const buildPublicCustomer = ({ customer, job, role }) => {
  if (!customer) return null;

  const canExposePhone =
    role === "customer" || Boolean(job.customerPhoneVisibleToFreelancer);

  return {
    id: toIdString(customer._id),
    fullname: customer.fullname || null,
    mobileNumber: canExposePhone ? customer.mobileNumber || null : null,
    address: customer.address || null,
    location: customer.location || null,
  };
};

const buildPublicFreelancer = (freelancer) => {
  if (!freelancer) return null;

  return {
    id: toIdString(freelancer._id),
    fullname: freelancer.fullname || null,
    mobileNumber: freelancer.mobileNumber || null,
    profilePicture: freelancer.profilePicture || null,
    status: freelancer.status || null,
    ratingAverage: Number(freelancer.ratingAverage) || 0,
    completedJobsCount: Number(freelancer.completedJobsCount) || 0,
    location: freelancer.location || null,
  };
};

const buildLastFreelancerLocation = (freelancer) => {
  const coordinates = freelancer?.location?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;

  return {
    coordinates,
    updatedAt: toIsoString(freelancer.updatedAt),
  };
};

const buildActiveJobSnapshot = async ({
  job,
  role,
  ratingSubmitted = false,
  restoredOtp = null,
  otpRestoreError = null,
}) => {
  const roomId = await ensureJobRoomId(job);
  const [customer, freelancer] = await Promise.all([
    ProfileCustomer.findById(job.customer_id)
      .select("fullname mobileNumber address location")
      .lean(),
    job.acceptedBy
      ? ProfileFreelancer.findById(job.acceptedBy)
          .select(
            "fullname mobileNumber profilePicture status ratingAverage completedJobsCount location updatedAt"
          )
          .lean()
      : Promise.resolve(null),
  ]);

  const otpGenerated = Boolean(job.serviceOtpExpiresAt);
  const status = job.status;

  return {
    hasActiveJob: true,
    jobId: toIdString(job._id),
    status,
    statusOrder: STATUS_ORDER[status] ?? -1,
    nextScreen: STATUS_SCREEN_MAP[status] || "job",
    roomId,
    trackingRoomId: roomId,
    customerId: toIdString(job.customer_id),
    freelancerId: toIdString(job.acceptedBy),
    categoryId: toIdString(job.categoryId),
    serviceId: toIdString(job.serviceId),
    subServiceId: toIdString(job.subServiceId),
    category: job.category || null,
    service: job.service || null,
    description: job.description || null,
    amount: Number(job.amount) || 0,
    unitAmount: Number(job.unitAmount) || 0,
    quantity: Number(job.quantity) || 1,
    baseAmount: Number(job.baseAmount) || 0,
    itemTotal: Number(job.itemTotal) || 0,
    visitingFee: Number(job.visitingFee) || 0,
    taxAmount: Number(job.taxAmount) || 0,
    tipAmount: Number(job.tipAmount) || 0,
    paymentStatus: job.paymentStatus || "unpaid",
    customerPhoneVisibleToFreelancer: Boolean(
      job.customerPhoneVisibleToFreelancer
    ),
    otpGenerated,
    otp: restoredOtp?.otp || undefined,
    otpExpiresAt: restoredOtp?.expiresAt
      ? toIsoString(restoredOtp.expiresAt)
      : toIsoString(job.serviceOtpExpiresAt),
    otpGeneratedAt: restoredOtp?.generatedAt || null,
    otpRestoreError,
    canGenerateOtp: ["accepted", "arrived"].includes(status),
    serviceStartedAt: toIsoString(job.serviceStartedAt),
    completionMarkedAt: toIsoString(job.completionMarkedAt),
    completionConfirmedAt: toIsoString(job.completionConfirmedAt),
    issueDetails: job.issueDetails || null,
    ratingSubmitted: Boolean(ratingSubmitted),
    jobLocation: job.jobLocation || null,
    customer: buildPublicCustomer({ customer, job, role }),
    freelancer: buildPublicFreelancer(freelancer),
    lastFreelancerLocation: buildLastFreelancerLocation(freelancer),
    createdAt: toIsoString(job.createdAt),
    updatedAt: toIsoString(job.updatedAt),
  };
};

const findRestorableJobForUser = async ({ userId, role }) => {
  const filter = {
    status: { $in: RESTORABLE_JOB_STATUSES },
  };

  if (role === "customer") {
    filter.customer_id = userId;
  } else if (role === "freelancer") {
    filter.acceptedBy = userId;
  } else {
    return null;
  }

  return Job.findOne(filter).sort({ updatedAt: -1 }).select("+serviceOtpHash");
};

const regenerateOtpForCustomerRestore = async ({ job, userId, role }) => {
  if (role !== "customer" || job.status !== "arrived") return null;

  const cachedOtp = await getCachedJobOtp(job._id);
  if (cachedOtp) return cachedOtp;

  return generateJobOTP({
    jobId: job._id,
    customerId: userId,
  });
};

const getActiveJobForUser = async ({
  userId,
  role,
  regenerateOtpOnRestore = false,
}) => {
  let job = await findRestorableJobForUser({ userId, role });
  if (!job) {
    return {
      hasActiveJob: false,
      job: null,
    };
  }

  const ratingSubmitted =
    job.status === "completed"
      ? Boolean(await FreelancerRating.exists({ jobId: job._id }))
      : false;

  if (!shouldRestoreJob({ job, role, ratingSubmitted })) {
    return {
      hasActiveJob: false,
      job: null,
    };
  }

  let restoredOtp = null;
  let otpRestoreError = null;

  if (regenerateOtpOnRestore) {
    try {
      restoredOtp = await regenerateOtpForCustomerRestore({ job, userId, role });
      if (restoredOtp) {
        job = await Job.findById(job._id).select("+serviceOtpHash");
      }
    } catch (error) {
      otpRestoreError = error?.message || "Failed to regenerate OTP";
    }
  }

  return buildActiveJobSnapshot({
    job,
    role,
    ratingSubmitted,
    restoredOtp,
    otpRestoreError,
  });
};

const hasActiveJobInProgressForFreelancer = async (freelancerId) => {
  if (!freelancerId) return false;

  return Boolean(
    await Job.exists({
      acceptedBy: freelancerId,
      status: { $in: ACTIVE_JOB_STATUSES },
    })
  );
};

export {
  ACTIVE_JOB_STATUSES,
  RESTORABLE_JOB_STATUSES,
  getActiveJobForUser,
  hasActiveJobInProgressForFreelancer,
};
