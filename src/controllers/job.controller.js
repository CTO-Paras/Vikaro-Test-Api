import { Job } from "../models/job.model.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ensureRole } from "../utils/role.js";
import { ApiError } from "../utils/APIError.js";
import { getIOInstance } from "../sockets/io.instance.js";
import { buildPaginationMeta, resolvePagination } from "../utils/pagination.js";
import {
  createJobAndDispatch,
  cancelJobByCustomer,
  rejectAcceptedJobForFreelancer,
} from "../services/jobDispatch.service.js";
import { acceptJob } from "../services/jobWorkflow.service.js";

const emitToRoom = (room, event, payload) => {
  getIOInstance().to(room).emit(event, payload);
};

const handlerCreateJob = asyncHandler(async (req, res) => {
  const { categoryId, serviceId, subServiceId, description } = req.body;
  const customer = req.user;
  ensureRole(customer, "customer");

  const dispatchResult = await createJobAndDispatch({
    customer,
    categoryId,
    serviceId,
    subServiceId,
    description,
    emitToRoom,
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        job: dispatchResult.job,
        freelancersNotified: dispatchResult.freelancersNotified,
        expiresAt: dispatchResult.expiresAt,
      },
      "Job created successfully"
    )
  );
});

const handlerAcceptJob = asyncHandler(async (req, res) => {
  const { jobId } = req.body;
  const freelancer = req.user;

  ensureRole(freelancer, "freelancer");
  
  const { job, roomId } = await acceptJob({
    jobId,
    freelancerId: freelancer._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, { job, trackingRoomId: roomId }, "Job accepted successfully"));
});

const handlerRejectJob = asyncHandler(async (req, res) => {
  const { jobId, afterAccept, reason } = req.body;
  const freelancer = req.user;

  ensureRole(freelancer, "freelancer");

  if (!afterAccept) {
    throw new ApiError(403, "Manual reject for pending job requests is disabled");
  }

  const result = await rejectAcceptedJobForFreelancer({
    jobId,
    freelancerId: freelancer._id,
    reason,
    emitToRoom,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Job cancelled by freelancer and reassigned"));
});

const handlerCancelJob = asyncHandler(async (req, res) => {
  const { jobId, reason } = req.body;
  const customer = req.user;
  ensureRole(customer, "customer");

  const job = await cancelJobByCustomer({
    jobId,
    customerId: customer._id,
    reason,
    emitToRoom,
  });

  return res.status(200).json(new ApiResponse(200, { job }, "Job cancelled successfully"));
});



 const handlerGetCustomerBookingHistory = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");

  const { status = "all" } = req.query; 
  const { page, limit, skip } = resolvePagination(req.query, {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 50,
  });

  const filter = {
    customer_id: req.user._id,
  };

  if (status !== "all") {
    filter.status = status;
  }

  const [total, bookings] = await Promise.all([
    Job.countDocuments(filter),
    Job.find(filter)
      .populate("acceptedBy", "fullname mobileNumber ratingAverage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        bookings,
        count: bookings.length,
        pagination,
      },
      "Booking history retrieved successfully"
    )
  );
});

export { handlerCreateJob, handlerAcceptJob, handlerRejectJob, handlerCancelJob, handlerGetCustomerBookingHistory };