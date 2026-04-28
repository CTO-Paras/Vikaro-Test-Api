import mongoose from "mongoose";
import { Job } from "../models/job.model.js";
import { Category } from "../models/category.model.js";
import { ProfileCustomer } from "../models/profileCustomer.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { sendNotificationToApp } from "./notification.service.js";
import { ApiError } from "../utils/APIError.js";
import { JOB_DISPATCH_SOCKET_EVENTS as SOCKET_EVENTS } from "../constants/jobDispatchEvents.constant.js";
import { getFreelancerWalletBalance } from "./wallet.service.js";
import { calculateDistance, calculateETA } from "./maps.service.js";
import { MIN_ALLOWED_BALANCE } from "../constants/wallet.constant.js";

const JOB_DISPATCH_RADIUS_METERS = Math.max(
  1000,
  Number.parseInt(process.env.JOB_DISPATCH_RADIUS_METERS || "10000", 10) ||
    10000
);
const JOB_RESPONSE_TIMEOUT_MS = 30000;
const JOB_DISPATCH_BATCH_SIZE = 4;
const CANCEL_WINDOW_DAYS = 30;
const CANCEL_RESTRICTION_DAYS = 30;
const MAX_CANCELS_WITHIN_WINDOW = 3;
const CUSTOMER_CANCEL_BLOCK_DISTANCE_METERS = Math.max(
  0,
  Number.parseInt(
    process.env.CUSTOMER_CANCEL_BLOCK_DISTANCE_METERS || "80",
    10
  ) || 80
);
const CUSTOMER_CANCEL_FINE_FLAT_AMOUNT = Math.max(
  0,
  Number.parseFloat(process.env.CUSTOMER_CANCEL_FINE_FLAT_AMOUNT || "99") || 99
);
const isJobFlowDebugEnabled = process.env.JOB_FLOW_DEBUG === "true";

const dispatchTimers = new Map();
const jobArrivalTimers = new Map();

const JOB_ARRIVAL_TIMEOUT_MS = Math.max(
  60 * 1000,
  Number.parseInt(process.env.JOB_ARRIVAL_TIMEOUT_MS || "", 10) ||
    60 * 60 * 1000
); // default 60 minutes

const jobFlowLog = (...args) => {
  if (!isJobFlowDebugEnabled) return;
  console.log("[job-flow]", ...args);
};

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
      const job = await Job.findById(jobId).select(
        "status acceptedBy customer_id roomId"
      );
      if (!job) return;

      if (job.status === "accepted") {
        await autoCancelAcceptedJobForArrivalTimeout({
          jobId,
          acceptedFreelancerId: job.acceptedBy,
          customerId: job.customer_id,
          emitToRoom,
        });
      }
    } catch (error) {
      console.error(
        "Failed to auto-cancel accepted job on arrival timeout:",
        error.message || error
      );
    }
  }, JOB_ARRIVAL_TIMEOUT_MS);

  jobArrivalTimers.set(key, timer);
};

const buildRoom = (role, userId) => `${role}_${userId}`;

const emitJobEvent = (
  emitToRoom,
  role,
  userId,
  event,
  payload,
  aliases = []
) => {
  emitToRoom(buildRoom(role, userId), event, payload);
  aliases.forEach((aliasEvent) => {
    emitToRoom(buildRoom(role, userId), aliasEvent, payload);
  });
};

const toIdString = (value) => value?.toString();

const getAcceptFailureReason = ({ job, freelancerId, now }) => {
  if (!job) {
    return "Job not found";
  }

  if (job.status !== "pending") {
    return `Job is not pending (current status: ${job.status})`;
  }

  if (!job.expiresAt || job.expiresAt <= now) {
    return "Offer expired for this job";
  }

  const activeFreelancers = job.activeFreelancers || [];
  const isActiveForFreelancer = activeFreelancers.some(
    (activeFreelancerId) =>
      toIdString(activeFreelancerId) === toIdString(freelancerId)
  );

  if (!isActiveForFreelancer) {
    return "Job offer is not currently active for this freelancer";
  }

  const rejectedBy = job.rejectedBy || [];
  const isRejectedByFreelancer = rejectedBy.some(
    (rejectedFreelancerId) =>
      toIdString(rejectedFreelancerId) === toIdString(freelancerId)
  );

  if (isRejectedByFreelancer) {
    return "Job already rejected by this freelancer";
  }

  const expiredBy = job.expiredBy || [];
  const isExpiredByFreelancer = expiredBy.some(
    (expiredFreelancerId) =>
      toIdString(expiredFreelancerId) === toIdString(freelancerId)
  );

  if (isExpiredByFreelancer) {
    return "Job offer already expired for this freelancer";
  }

  return "Job already accepted, expired, rejected, or not available for this freelancer";
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

const buildSkillCandidatesFromCategory = (category) => {
  const normalizedCategory = String(category || "")
    .trim()
    .toLowerCase();

  const aliasMap = {
    plumbing: ["Plumbing"],
    electrical: ["Electrical"],
    electroical: ["Electrical"],
    carpenter: ["Carpenter"],
    painter: ["Painter"],
    "ac repair": ["AC Repair"],
    acrepair: ["AC Repair"],
    mechanic: ["Mechanic"],
  };

  const candidates = aliasMap[normalizedCategory] || [];
  if (candidates.length > 0) {
    return candidates;
  }

  // Fallback to incoming category value to avoid blocking unknown future categories.
  return category ? [category] : [];
};

const computeCustomerCancellationFineAmount = (jobAmount) => {
  const proportionalAmount =
    Math.ceil((Number(jobAmount || 0) * 0.1) / 10) * 10;
  return Math.max(CUSTOMER_CANCEL_FINE_FLAT_AMOUNT, proportionalAmount, 0);
};

const clearDispatchTimer = (jobId) => {
  const key = jobId.toString();
  const existing = dispatchTimers.get(key);
  if (!existing) return;
  clearTimeout(existing);
  dispatchTimers.delete(key);
};

const buildArrivalTimeoutAt = () =>
  new Date(Date.now() + JOB_ARRIVAL_TIMEOUT_MS);

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

const recordFreelancerCancellation = async ({
  freelancerId,
  jobId,
  reason,
}) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId);
  if (!freelancer) {
    throw new ApiError(404, "Freelancer profile not found");
  }

  const now = new Date();
  const windowStart = new Date(
    now.getTime() - CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

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
    restrictionUntil = new Date(
      now.getTime() + CANCEL_RESTRICTION_DAYS * 24 * 60 * 60 * 1000
    );
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
      console.error(
        "Failed to auto-expire freelancer batch response:",
        error.message
      );
    }
  }, JOB_RESPONSE_TIMEOUT_MS);

  dispatchTimers.set(key, timer);
};

const getNearbyFreelancers = async ({ category, customerCoordinates }) => {
  await restoreExpiredRestrictions();

  const skillCandidates = buildSkillCandidatesFromCategory(category);
  if (skillCandidates.length === 0) {
    return [];
  }

  return ProfileFreelancer.find({
    skill: { $in: skillCandidates },
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
  }).select("_id location playerId");
};

const getQueuedFreelancers = (job) => {
  const rejected = new Set((job.rejectedBy || []).map(toIdString));
  const expired = new Set((job.expiredBy || []).map(toIdString));

  return (job.notifiedFreelancers || []).filter((freelancerId) => {
    const id = toIdString(freelancerId);
    return !rejected.has(id) && !expired.has(id);
  });
};

const computePricingSummary = (job) => {
  const customerBill = roundMoney(job?.amount);
  const baseAmount = roundMoney(job?.baseAmount || customerBill);
  const itemTotal = roundMoney(job?.itemTotal || baseAmount);
  const visitingFee = roundMoney(job?.visitingFee);
  const taxAmount = roundMoney(job?.taxAmount);
  const tipAmount = roundMoney(job?.tipAmount);
  const unitAmount = roundMoney(job?.unitAmount || baseAmount);
  const quantity = Number(job?.quantity || 1);
  const platformCommission = roundMoney(baseAmount * 0.2);
  const freelancerBaseEarning = roundMoney(baseAmount * 0.8);
  const freelancerVisitingFeeEarning = visitingFee;
  const freelancerEarning = roundMoney(
    freelancerBaseEarning + freelancerVisitingFeeEarning + tipAmount
  );

  return {
    unitAmount,
    quantity,
    baseAmount,
    itemTotal,
    visitingFee,
    taxAmount,
    tipAmount,
    customerBill,
    freelancerBaseEarning,
    freelancerVisitingFeeEarning,
    freelancerTipEarning: tipAmount,
    freelancerEarning,
    platformCommission,
  };
};

const buildFreelancerJobSummary = ({
  job,
  customer,
  freelancer,
  requestTimeoutAt,
  responseTimeoutMs,
}) => {
  const customerCoordinates = customer?.location?.coordinates;
  const freelancerCoordinates = freelancer?.location?.coordinates;
  const canComputeDistance =
    isValidCoordinates(customerCoordinates) &&
    isValidCoordinates(freelancerCoordinates);
  const distance = canComputeDistance
    ? calculateDistance(freelancerCoordinates, customerCoordinates)
    : null;
  const eta = distance ? calculateETA(distance.distanceMeters) : null;
  const pricingSummary = computePricingSummary(job);

  return {
    jobId: job._id,
    customerId: job.customer_id,
    category: job.category,
    service: job.service,
    description: job.description || null,
    amount: pricingSummary.customerBill,
    totalAmount: pricingSummary.customerBill,
    unitAmount: pricingSummary.unitAmount,
    quantity: pricingSummary.quantity,
    baseAmount: pricingSummary.baseAmount,
    itemTotal: pricingSummary.itemTotal,
    visitingFee: pricingSummary.visitingFee,
    taxAmount: pricingSummary.taxAmount,
    tip: pricingSummary.tipAmount,
    tipAmount: pricingSummary.tipAmount,
    freelancerEarning: pricingSummary.freelancerEarning,
    platformCommission: pricingSummary.platformCommission,
    customerName: customer?.fullname || null,
    customerAddress: customer?.address || null,
    customerLocation: customer?.location || null,
    freelancerLocation: freelancer?.location || null,
    customerPhone: customer?.mobileNumber || null,
    freelancerPhone: freelancer?.mobileNumber || null,
    distance: distance
      ? {
          text: `${distance.distanceKm} km`,
          meters: distance.distanceMeters,
        }
      : null,
    eta: eta
      ? {
          text: eta.etaText,
          minutes: eta.etaMinutes,
          seconds: eta.etaMinutes * 60,
        }
      : null,
    pricing: {
      unitAmount: pricingSummary.unitAmount,
      quantity: pricingSummary.quantity,
      baseAmount: pricingSummary.baseAmount,
      itemTotal: pricingSummary.itemTotal,
      visitingFee: pricingSummary.visitingFee,
      taxAmount: pricingSummary.taxAmount,
      tip: pricingSummary.tipAmount,
      tipAmount: pricingSummary.tipAmount,
      customerBill: pricingSummary.customerBill,
      freelancerBaseEarning: pricingSummary.freelancerBaseEarning,
      freelancerVisitingFeeEarning: pricingSummary.freelancerVisitingFeeEarning,
      freelancerTipEarning: pricingSummary.freelancerTipEarning,
      freelancerEarning: pricingSummary.freelancerEarning,
      platformCommission: pricingSummary.platformCommission,
    },
    requestTimeoutAt,
    expiresAt: requestTimeoutAt,
    responseTimeoutMs,
  };
};

const settleJobWhenQueueEmpty = async ({
  job,
  emitToRoom,
  finalStatus = "rejected_timeout",
}) => {
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
    { returnDocument: "after" }
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
  jobFlowLog("dispatchToNextFreelancer:start", {
    jobId: jobId?.toString?.() || String(jobId),
    status: pendingJob?.status || null,
    activeFreelancersCount: pendingJob?.activeFreelancers?.length || 0,
    notifiedFreelancersCount: pendingJob?.notifiedFreelancers?.length || 0,
    redistributionReason,
  });

  if (!pendingJob || pendingJob.status !== "pending") return pendingJob;

  const hasActiveBatch =
    Array.isArray(pendingJob.activeFreelancers) &&
    pendingJob.activeFreelancers.length > 0;
  if (hasActiveBatch) {
    return pendingJob;
  }

  const queuedFreelancers = getQueuedFreelancers(pendingJob);
  const nextBatch = queuedFreelancers.slice(0, JOB_DISPATCH_BATCH_SIZE);

  jobFlowLog("dispatchToNextFreelancer:batchPrepared", {
    jobId: pendingJob._id?.toString?.() || String(pendingJob._id),
    queuedCount: queuedFreelancers.length,
    batchSize: nextBatch.length,
    nextBatchFreelancerIds: nextBatch.map(
      (id) => id?.toString?.() || String(id)
    ),
  });

  if (nextBatch.length === 0) {
    jobFlowLog("dispatchToNextFreelancer:noFreelancersLeft", {
      jobId: pendingJob._id?.toString?.() || String(pendingJob._id),
      finalStatusWhenEmpty,
    });
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
    { returnDocument: "after" }
  );

  if (!assignedJob) {
    jobFlowLog("dispatchToNextFreelancer:assignmentRace", {
      jobId: pendingJob._id?.toString?.() || String(pendingJob._id),
    });
    return Job.findById(jobId);
  }

  jobFlowLog("dispatchToNextFreelancer:batchDispatched", {
    jobId: assignedJob._id?.toString?.() || String(assignedJob._id),
    expiresAt: assignedJob.expiresAt,
    activeFreelancersCount: assignedJob.activeFreelancers?.length || 0,
  });

  const [customerProfile, freelancerProfiles] = await Promise.all([
    // include mobileNumber so we can embed phones into socket payloads
    ProfileCustomer.findById(assignedJob.customer_id)
      .select("fullname address location mobileNumber")
      .lean(),
    ProfileFreelancer.find({ _id: { $in: nextBatch } })
      .select("playerId location mobileNumber")
      .lean(),
  ]);

  const freelancerProfileById = new Map(
    freelancerProfiles.map((freelancer) => [String(freelancer._id), freelancer])
  );

  for (const freelancerId of nextBatch) {
    const freelancerProfile = freelancerProfileById.get(String(freelancerId));
    const jobSummary = buildFreelancerJobSummary({
      job: assignedJob,
      customer: customerProfile,
      freelancer: freelancerProfile,
      requestTimeoutAt,
      responseTimeoutMs: JOB_RESPONSE_TIMEOUT_MS,
    });

    // Make a plain object copy of the job and attach phone numbers so
    // the socket payload includes both customer and freelancer mobiles.
    const jobObj = assignedJob?.toObject
      ? assignedJob.toObject()
      : JSON.parse(JSON.stringify(assignedJob));
    jobObj.customerPhone = customerProfile?.mobileNumber || null;
    jobObj.freelancerPhone = freelancerProfile?.mobileNumber || null;
    jobObj.pricing = jobSummary.pricing;
    jobObj.totalAmount = jobSummary.totalAmount;
    jobObj.itemTotal = jobSummary.itemTotal;
    jobObj.visitingFee = jobSummary.visitingFee;
    jobObj.taxAmount = jobSummary.taxAmount;
    jobObj.tip = jobSummary.tipAmount;
    jobObj.freelancerEarning = jobSummary.freelancerEarning;
    jobObj.platformCommission = jobSummary.platformCommission;

    const payload = {
      jobId: assignedJob._id,
      job: jobObj,
      jobSummary,
      amount: jobSummary.amount,
      totalAmount: jobSummary.totalAmount,
      itemTotal: jobSummary.itemTotal,
      visitingFee: jobSummary.visitingFee,
      taxAmount: jobSummary.taxAmount,
      tip: jobSummary.tipAmount,
      tipAmount: jobSummary.tipAmount,
      freelancerEarning: jobSummary.freelancerEarning,
      platformCommission: jobSummary.platformCommission,
      requestTimeoutAt,
      expiresAt: requestTimeoutAt,
      responseTimeoutMs: JOB_RESPONSE_TIMEOUT_MS,
    };

    emitJobEvent(
      emitToRoom,
      "freelancer",
      freelancerId,
      SOCKET_EVENTS.JOB_INCOMING,
      payload,
      [SOCKET_EVENTS.JOB_REQUEST_SENT]
    );

    if (freelancerProfile?.playerId) {
      await sendNotificationToApp({
        recipientId: freelancerId,
        recipientRole: "freelancer",
        playerIds: [freelancerProfile.playerId],
        type: "JOB_REQUEST",
        title: "New Job Request",
        message: `New ${assignedJob.service} job near you`,
        data: {
          jobId: assignedJob._id,
          amount: jobSummary.amount,
          totalAmount: jobSummary.totalAmount,
          itemTotal: jobSummary.itemTotal,
          visitingFee: jobSummary.visitingFee,
          taxAmount: jobSummary.taxAmount,
          tip: jobSummary.tipAmount,
          tipAmount: jobSummary.tipAmount,
          freelancerEarning: jobSummary.freelancerEarning,
          platformCommission: jobSummary.platformCommission,
          jobSummary,
          requestTimeoutAt,
        },
      });
    }
  }

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

  scheduleDispatchTimer(assignedJob._id, nextBatch, emitToRoom);

  return assignedJob;
};

const autoCancelAcceptedJobForArrivalTimeout = async ({
  jobId,
  acceptedFreelancerId,
  customerId,
  emitToRoom,
}) => {
  if (!acceptedFreelancerId) return null;

  const autoCancelled = await Job.findOneAndUpdate(
    {
      _id: jobId,
      status: "accepted",
      acceptedBy: acceptedFreelancerId,
    },
    {
      status: "pending",
      acceptedBy: null,
      currentFreelancer: null,
      activeFreelancers: [],
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
      arrivalTimeoutAt: null,
      $addToSet: { rejectedBy: acceptedFreelancerId },
    },
    { returnDocument: "after" }
  );

  if (!autoCancelled) return null;

  clearDispatchTimer(autoCancelled._id);
  clearArrivalTimer(autoCancelled._id);

  await ProfileFreelancer.findByIdAndUpdate(acceptedFreelancerId, {
    status: "online",
  });

  const notifyPayload = {
    jobId: autoCancelled._id,
    status: "rejected_timeout",
    message: "Freelancer did not arrive in time",
    timestamp: new Date().toISOString(),
  };

  emitJobEvent(
    emitToRoom,
    "freelancer",
    acceptedFreelancerId,
    SOCKET_EVENTS.JOB_REJECT,
    notifyPayload,
    [SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER]
  );
  emitJobEvent(
    emitToRoom,
    "customer",
    customerId || autoCancelled.customer_id,
    SOCKET_EVENTS.JOB_REJECT,
    notifyPayload,
    [SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER]
  );

  await dispatchToNextFreelancer({
    jobId: autoCancelled._id,
    emitToRoom,
    finalStatusWhenEmpty: "rejected_timeout",
    redistributedBy: null,
    redistributionReason: "auto_cancelled_timeout",
  });

  return autoCancelled;
};

const resolveSubServiceForJob = async ({
  categoryId,
  serviceId,
  subServiceId,
}) => {
  ensureValidObjectId(categoryId, "categoryId");
  ensureValidObjectId(serviceId, "serviceId");
  ensureValidObjectId(subServiceId, "subServiceId");

  const categoryDoc =
    await Category.findById(categoryId).select("title services");

  if (!categoryDoc) {
    throw new ApiError(404, "Category not found");
  }

  const serviceDoc = categoryDoc.services.id(serviceId);
  if (!serviceDoc) {
    throw new ApiError(404, "Service not found in selected category");
  }

  const subServiceDoc = serviceDoc.subServices.id(subServiceId);
  if (!subServiceDoc) {
    throw new ApiError(404, "Subservice not found in selected service");
  }

  return {
    categoryName: categoryDoc.title,
    serviceName: subServiceDoc.name,
    amount: Number(subServiceDoc.price) || 0,
    categoryObjectId: categoryDoc._id,
    serviceObjectId: serviceDoc._id,
    subServiceObjectId: subServiceDoc._id,
  };
};

const roundMoney = (value) => Number((Number(value) || 0).toFixed(2));

const resolveJobAmountBreakdown = ({
  unitAmount,
  quantity,
  itemTotal,
  visitingFee,
  taxAmount,
  tipAmount,
  finalAmount,
}) => {
  const resolvedQuantity = quantity === undefined ? 1 : Number(quantity);
  const resolvedItemTotal = itemTotal === undefined ? null : Number(itemTotal);
  const resolvedVisitingFee = visitingFee === undefined ? 0 : Number(visitingFee);
  const resolvedTaxAmount = taxAmount === undefined ? 0 : Number(taxAmount);
  const resolvedTipAmount = tipAmount === undefined ? 0 : Number(tipAmount);
  const resolvedUnitAmount = roundMoney(unitAmount);

  if (!Number.isInteger(resolvedQuantity) || resolvedQuantity < 1 || resolvedQuantity > 100) {
    throw new ApiError(400, "quantity must be an integer between 1 and 100");
  }

  if (resolvedItemTotal !== null && (!Number.isFinite(resolvedItemTotal) || resolvedItemTotal < 0)) {
    throw new ApiError(400, "itemTotal must be greater than or equal to 0");
  }

  if (!Number.isFinite(resolvedVisitingFee) || resolvedVisitingFee < 0) {
    throw new ApiError(400, "visitingFee must be greater than or equal to 0");
  }

  if (!Number.isFinite(resolvedTaxAmount) || resolvedTaxAmount < 0) {
    throw new ApiError(400, "taxAmount must be greater than or equal to 0");
  }

  if (!Number.isFinite(resolvedTipAmount) || resolvedTipAmount < 0) {
    throw new ApiError(400, "tipAmount must be greater than or equal to 0");
  }

  const baseAmount = roundMoney(resolvedUnitAmount * resolvedQuantity);
  const normalizedItemTotal = roundMoney(resolvedItemTotal ?? baseAmount);
  const normalizedVisitingFee = roundMoney(resolvedVisitingFee);
  const normalizedTaxAmount = roundMoney(resolvedTaxAmount);
  const normalizedTipAmount = roundMoney(resolvedTipAmount);

  if (normalizedItemTotal !== baseAmount) {
    throw new ApiError(
      400,
      `Item total mismatch. Expected ${baseAmount} from selected service and quantity`
    );
  }

  const amount = roundMoney(
    normalizedItemTotal + normalizedVisitingFee + normalizedTaxAmount + normalizedTipAmount
  );

  if (finalAmount !== undefined) {
    const requestedFinalAmount = roundMoney(finalAmount);
    if (requestedFinalAmount !== amount) {
      throw new ApiError(
        400,
        `Final amount mismatch. Expected ${amount} from item total, visiting fee, tax, and tip`
      );
    }
  }

  return {
    unitAmount: resolvedUnitAmount,
    quantity: resolvedQuantity,
    baseAmount,
    itemTotal: normalizedItemTotal,
    visitingFee: normalizedVisitingFee,
    taxAmount: normalizedTaxAmount,
    tipAmount: normalizedTipAmount,
    amount,
  };
};

const createJobAndDispatch = async ({
  customer,
  categoryId,
  serviceId,
  subServiceId,
  description,
  quantity,
  itemTotal,
  visitingFee,
  taxAmount,
  tipAmount,
  finalAmount,
  emitToRoom,
}) => {
  const customerCoordinates = customer?.location?.coordinates;

  jobFlowLog("createJobAndDispatch:request", {
    customerId: customer?._id?.toString?.() || String(customer?._id || ""),
    categoryId,
    serviceId,
    subServiceId,
    hasCoordinates: isValidCoordinates(customerCoordinates),
  });

  if (!isValidCoordinates(customerCoordinates)) {
    throw new ApiError(400, "Customer address location not set");
  }

  const selectedSubService = await resolveSubServiceForJob({
    categoryId,
    serviceId,
    subServiceId,
  });

  const amountBreakdown = resolveJobAmountBreakdown({
    unitAmount: selectedSubService.amount,
    quantity,
    itemTotal,
    visitingFee,
    taxAmount,
    tipAmount,
    finalAmount,
  });

  const nearbyFreelancers = await getNearbyFreelancers({
    category: selectedSubService.categoryName,
    customerCoordinates,
  });

  const candidateFreelancerIds = nearbyFreelancers.map(
    (freelancer) => freelancer._id
  );
  jobFlowLog("createJobAndDispatch:nearbyFreelancers", {
    customerId: customer?._id?.toString?.() || String(customer?._id || ""),
    count: candidateFreelancerIds.length,
    freelancerIds: candidateFreelancerIds.map(
      (id) => id?.toString?.() || String(id)
    ),
  });
  const job = await Job.create({
    customer_id: customer._id,
    category: selectedSubService.categoryName,
    service: selectedSubService.serviceName,
    unitAmount: amountBreakdown.unitAmount,
    quantity: amountBreakdown.quantity,
    baseAmount: amountBreakdown.baseAmount,
    itemTotal: amountBreakdown.itemTotal,
    visitingFee: amountBreakdown.visitingFee,
    taxAmount: amountBreakdown.taxAmount,
    tipAmount: amountBreakdown.tipAmount,
    amount: amountBreakdown.amount,
    description,
    categoryId: selectedSubService.categoryObjectId,
    serviceId: selectedSubService.serviceObjectId,
    subServiceId: selectedSubService.subServiceObjectId,
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
    jobFlowLog("createJobAndDispatch:noFreelancerAvailable", {
      jobId: job._id?.toString?.() || String(job._id),
      customerId: customer?._id?.toString?.() || String(customer?._id || ""),
    });

    await Job.findByIdAndUpdate(job._id, {
      status: "expired",
      cancelReason: "No available freelancers matched dispatch criteria",
      cancelledBy: "system",
      requestTimeoutAt: new Date(),
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
        await sendNotificationToApp({
          recipientId: customer._id,
          recipientRole: "customer",
          playerIds: [customer.playerId],
          type: "NO_FREELANCERS_AVAILABLE",
          title: "No Freelancers Available",
          message:
            "No freelancers available right now. Please try again later.",
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

  const freelancerProfile =
    await ProfileFreelancer.findById(freelancerId).select("status isVerified");

  if (!freelancerProfile) {
    throw new ApiError(404, "Freelancer profile not found");
  }

  if (!freelancerProfile.isVerified) {
    throw new ApiError(403, "Account not verified");
  }

  if (freelancerProfile.status !== "online") {
    throw new ApiError(403, "Freelancer must be online to accept jobs");
  }

  const now = new Date();

  const liveOfferJob = await Job.findOne({
    _id: jobId,
    status: "pending",
    activeFreelancers: freelancerId,
    rejectedBy: { $nin: [freelancerId] },
    expiredBy: { $nin: [freelancerId] },
    expiresAt: { $gt: now },
  }).select("activeFreelancers");

  if (!liveOfferJob) {
    const jobSnapshot = await Job.findById(jobId).select(
      "status expiresAt activeFreelancers rejectedBy expiredBy"
    );
    const reason = getAcceptFailureReason({
      job: jobSnapshot,
      freelancerId,
      now,
    });

    throw new ApiError(400, reason);
  }

  const activeBatch = liveOfferJob.activeFreelancers || [];

  const job = await Job.findOneAndUpdate(
    {
      _id: jobId,
      status: "pending",
      activeFreelancers: freelancerId,
      rejectedBy: { $nin: [freelancerId] },
      expiredBy: { $nin: [freelancerId] },
      expiresAt: { $gt: now },
    },
    {
      status: "accepted",
      acceptedBy: freelancerId,
      currentFreelancer: null,
      activeFreelancers: [],
      arrivalTimeoutAt: buildArrivalTimeoutAt(),
      $pull: { notifiedFreelancers: { $in: activeBatch } },
    },
    { returnDocument: "after" }
  );

  if (!job) {
    const latestJobSnapshot = await Job.findById(jobId).select(
      "status expiresAt activeFreelancers rejectedBy expiredBy"
    );
    const reason = getAcceptFailureReason({
      job: latestJobSnapshot,
      freelancerId,
      now,
    });

    throw new ApiError(400, reason);
  }

  clearDispatchTimer(job._id);
  await ProfileFreelancer.findByIdAndUpdate(freelancerId, { status: "busy" });

  // Fetch a small freelancer summary and last-known location to include in the accept payloads
  const freelancerProfileDoc = await ProfileFreelancer.findById(freelancerId)
    .select(
      "_id fullname ratingAverage completedJobsCount location address mobileNumber playerId"
    )
    .lean();

  const freelancerSummary = {
    id: freelancerProfileDoc?._id,
    fullname: freelancerProfileDoc?.fullname || null,
    ratingAverage: freelancerProfileDoc?.ratingAverage || null,
    completedJobsCount: freelancerProfileDoc?.completedJobsCount || 0,
  };

  const freelancerLocation = {
    coordinates: freelancerProfileDoc?.location?.coordinates || null,
    address: freelancerProfileDoc?.address || null,
    fullname: freelancerProfileDoc?.fullname || null,
    mobileNumber: freelancerProfileDoc?.mobileNumber || null,
  };

  const trackingRoomId = `job_${job._id}`;
  joinRoom(`customer_${job.customer_id}`, trackingRoomId);
  joinRoom(`freelancer_${freelancerId}`, trackingRoomId);

  // Include customer's location and basic info in the accept payload so
  // the client receives coordinates/address immediately on accept.
  const customerProfile = await ProfileCustomer.findById(job.customer_id)
    .select("location address fullname mobileNumber playerId")
    .lean();

  const customerLocation = {
    coordinates:
      customerProfile?.location?.coordinates ||
      job?.jobLocation?.coordinates ||
      null,
    address: customerProfile?.address || null,
    fullname: customerProfile?.fullname || null,
    mobileNumber: customerProfile?.mobileNumber || null,
  };

  // Attach phone numbers to the job object so both apps receive them on accept
  const jobObj = job?.toObject
    ? job.toObject()
    : JSON.parse(JSON.stringify(job));
  jobObj.customerPhone = customerProfile?.mobileNumber || null;
  jobObj.freelancerPhone = freelancerProfileDoc?.mobileNumber || null;

  const payload = {
    job: jobObj,
    trackingRoomId,
    freelancer: freelancerSummary,
    customerLocation,
    freelancerLocation,
  };
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
    (activeFreelancerId) =>
      toIdString(activeFreelancerId) !== toIdString(freelancerId)
  );

  otherOfferedFreelancers.forEach((otherFreelancerId) => {
    emitJobEvent(
      emitToRoom,
      "freelancer",
      otherFreelancerId,
      SOCKET_EVENTS.JOB_EXPIRED,
      {
        jobId: job._id,
        status: "taken_by_other_freelancer",
      }
    );
  });

  // Start arrival timer: if freelancer doesn't start job within timeout, auto-cancel
  try {
    scheduleArrivalTimer(job._id, freelancerId, emitToRoom);
  } catch (err) {
    console.error("Failed to schedule arrival timer:", err?.message || err);
  }
  return { job, trackingRoomId, freelancer: freelancerSummary };
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
    const jobSnapshot = await Job.findById(jobId).select(
      "jobLocation acceptedBy status"
    );
    const freelancerSnapshot =
      await ProfileFreelancer.findById(freelancerId).select("location");

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
      status: {
        $in: [
          "accepted",
          "arrived",
          "started",
          "in_progress",
          "completion_pending",
        ],
      },
    },
    {
      status: "cancelled_by_freelancer",
      cancelReason: reason || "Freelancer cancelled after acceptance",
      cancelledBy: "freelancer",
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
      arrivalTimeoutAt: null,
      $addToSet: { rejectedBy: freelancerId },
    },
    { returnDocument: "after" }
  );

  if (!cancelledJob) {
    throw new ApiError(
      400,
      "Only assigned freelancer can reject an active accepted job"
    );
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

  emitJobEvent(
    emitToRoom,
    "freelancer",
    freelancerId,
    SOCKET_EVENTS.JOB_REJECT,
    notifyPayload,
    [SOCKET_EVENTS.JOB_CANCELLED_BY_FREELANCER]
  );
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
      cancelReason: null,
      cancelledBy: null,
      requestTimeoutAt: new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS),
      expiresAt: new Date(Date.now() + JOB_RESPONSE_TIMEOUT_MS),
      arrivalTimeoutAt: null,
      $pull: {
        activeFreelancers: freelancerId,
        notifiedFreelancers: freelancerId,
      },
    },
    { returnDocument: "after" }
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

const cancelJobByCustomer = async ({
  jobId,
  customerId,
  reason,
  acceptFine,
  emitToRoom,
}) => {
  ensureValidObjectId(jobId, "jobId");

  jobFlowLog("cancelJobByCustomer:request", {
    jobId: jobId?.toString?.() || String(jobId),
    customerId: customerId?.toString?.() || String(customerId),
    acceptFine: Boolean(acceptFine),
    hasReason: Boolean(reason),
  });

  const nowIso = new Date().toISOString();

  const pendingSnapshot = await Job.findOne({
    _id: jobId,
    customer_id: customerId,
    status: "pending",
  }).select("activeFreelancers notifiedFreelancers");

  const offeredFreelancers = pendingSnapshot
    ? [
        ...(pendingSnapshot.activeFreelancers || []),
        ...(pendingSnapshot.notifiedFreelancers || []),
      ]
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
      customerCancellationFineApplied: false,
      customerCancellationFineAmount: 0,
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
      arrivalTimeoutAt: null,
      activeFreelancers: [],
    },
    { returnDocument: "after" }
  );

  if (pendingCancelled) {
    jobFlowLog("cancelJobByCustomer:cancelledPending", {
      jobId: pendingCancelled._id?.toString?.() || String(pendingCancelled._id),
      offeredFreelancersCount: offeredFreelancers.length,
    });

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

  const acceptedSnapshot = await Job.findOne({
    _id: jobId,
    customer_id: customerId,
    status: {
      $in: [
        "accepted",
        "arrived",
        "started",
        "in_progress",
        "completion_pending",
      ],
    },
  }).select("acceptedBy jobLocation status amount");

  let fineRequiredByDistance = false;

  if (
    acceptedSnapshot?.acceptedBy &&
    isValidCoordinates(acceptedSnapshot.jobLocation?.coordinates)
  ) {
    const freelancerSnapshot = await ProfileFreelancer.findById(
      acceptedSnapshot.acceptedBy
    )
      .select("location")
      .lean();

    const freelancerCoordinates = freelancerSnapshot?.location?.coordinates;

    if (isValidCoordinates(freelancerCoordinates)) {
      const { distanceMeters } = calculateDistance(
        freelancerCoordinates,
        acceptedSnapshot.jobLocation.coordinates
      );

      jobFlowLog("cancelJobByCustomer:distanceCheck", {
        jobId: acceptedSnapshot._id?.toString?.() || String(jobId),
        acceptedBy:
          acceptedSnapshot.acceptedBy?.toString?.() ||
          String(acceptedSnapshot.acceptedBy),
        distanceMeters,
        thresholdMeters: CUSTOMER_CANCEL_BLOCK_DISTANCE_METERS,
        acceptFine: Boolean(acceptFine),
      });

      fineRequiredByDistance =
        distanceMeters <= CUSTOMER_CANCEL_BLOCK_DISTANCE_METERS;

      if (fineRequiredByDistance && !acceptFine) {
        const fineAmount = computeCustomerCancellationFineAmount(
          acceptedSnapshot.amount
        );
        jobFlowLog("cancelJobByCustomer:fineRequired", {
          jobId: acceptedSnapshot._id?.toString?.() || String(jobId),
          fineAmount,
          distanceMeters,
        });
        throw new ApiError(
          402,
          "Freelancer is nearby. Cancellation requires fine confirmation.",
          [
            {
              code: "CUSTOMER_CANCEL_FINE_REQUIRED",
              fineAmount,
              currency: "INR",
              distanceMeters,
              thresholdMeters: CUSTOMER_CANCEL_BLOCK_DISTANCE_METERS,
            },
          ]
        );
      }
    }
  }

  const cancellationFineAmount = acceptedSnapshot
    ? computeCustomerCancellationFineAmount(acceptedSnapshot.amount)
    : 0;
  const isFineApplied = Boolean(
    acceptedSnapshot && acceptFine && fineRequiredByDistance
  );

  const acceptedCancelled = await Job.findOneAndUpdate(
    {
      _id: jobId,
      customer_id: customerId,
      status: {
        $in: [
          "accepted",
          "arrived",
          "started",
          "in_progress",
          "completion_pending",
        ],
      },
    },
    {
      status: "cancelled_by_customer",
      cancelReason: reason || "Cancelled by customer",
      cancelledBy: "customer",
      customerCancellationFineApplied: isFineApplied,
      customerCancellationFineAmount: isFineApplied
        ? cancellationFineAmount
        : 0,
      requestTimeoutAt: new Date(),
      expiresAt: new Date(),
      arrivalTimeoutAt: null,
    },
    { returnDocument: "after" }
  );

  if (!acceptedCancelled) {
    jobFlowLog("cancelJobByCustomer:failedInvalidState", {
      jobId: jobId?.toString?.() || String(jobId),
      customerId: customerId?.toString?.() || String(customerId),
    });
    throw new ApiError(400, "Job cannot be cancelled in current state");
  }

  jobFlowLog("cancelJobByCustomer:cancelledAcceptedOrOngoing", {
    jobId: acceptedCancelled._id?.toString?.() || String(acceptedCancelled._id),
    status: acceptedCancelled.status,
    fineApplied: isFineApplied,
    fineAmount: isFineApplied ? cancellationFineAmount : 0,
  });

  clearDispatchTimer(acceptedCancelled._id);

  if (acceptedCancelled.acceptedBy) {
    await ProfileFreelancer.findByIdAndUpdate(acceptedCancelled.acceptedBy, {
      status: "online",
    });

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

const expireFreelancerBatch = async ({ jobId, freelancerIds, emitToRoom }) => {
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
    { returnDocument: "after" }
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

const recoverStaleJobTimers = async ({ emitToRoom, batchLimit = 50 } = {}) => {
  if (typeof emitToRoom !== "function") {
    throw new ApiError(500, "emitToRoom is required for job timer recovery");
  }

  const now = new Date();
  const acceptedFallbackCutoff = new Date(
    now.getTime() - JOB_ARRIVAL_TIMEOUT_MS
  );
  const limit = Math.min(Math.max(Number(batchLimit) || 50, 1), 200);
  const summary = {
    pendingChecked: 0,
    acceptedChecked: 0,
    recovered: 0,
    errors: 0,
  };

  const stalePendingJobs = await Job.find({
    status: "pending",
    expiresAt: { $lte: now },
  })
    .select("_id activeFreelancers notifiedFreelancers")
    .sort({ expiresAt: 1 })
    .limit(limit);

  for (const job of stalePendingJobs) {
    summary.pendingChecked += 1;

    try {
      const activeFreelancers = job.activeFreelancers || [];

      if (activeFreelancers.length > 0) {
        const recoveredJob = await expireFreelancerBatch({
          jobId: job._id,
          freelancerIds: activeFreelancers,
          emitToRoom,
        });

        if (recoveredJob) summary.recovered += 1;
      } else {
        const recoveredJob = await dispatchToNextFreelancer({
          jobId: job._id,
          emitToRoom,
          finalStatusWhenEmpty: "rejected_timeout",
          redistributionReason: "timer_recovery",
        });

        if (recoveredJob) summary.recovered += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        "Job pending timer recovery failed:",
        error.message || error
      );
    }
  }

  const remainingLimit = Math.max(limit - stalePendingJobs.length, 1);
  const staleAcceptedJobs = await Job.find({
    status: "accepted",
    acceptedBy: { $ne: null },
    $or: [
      { arrivalTimeoutAt: { $lte: now } },
      { arrivalTimeoutAt: null, updatedAt: { $lte: acceptedFallbackCutoff } },
      {
        arrivalTimeoutAt: { $exists: false },
        updatedAt: { $lte: acceptedFallbackCutoff },
      },
    ],
  })
    .select("_id acceptedBy customer_id")
    .sort({ arrivalTimeoutAt: 1, updatedAt: 1 })
    .limit(remainingLimit);

  for (const job of staleAcceptedJobs) {
    summary.acceptedChecked += 1;

    try {
      const recoveredJob = await autoCancelAcceptedJobForArrivalTimeout({
        jobId: job._id,
        acceptedFreelancerId: job.acceptedBy,
        customerId: job.customer_id,
        emitToRoom,
      });

      if (recoveredJob) summary.recovered += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(
        "Job accepted timer recovery failed:",
        error.message || error
      );
    }
  }

  return summary;
};

export {
  SOCKET_EVENTS,
  createJobAndDispatch,
  acceptJobForFreelancer,
  rejectAcceptedJobForFreelancer,
  cancelJobByCustomer,
  clearArrivalTimer,
  recoverStaleJobTimers,
};
