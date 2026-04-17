import { Job } from "../models/job.model.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ensureRole } from "../utils/role.js";
import { ApiError } from "../utils/APIError.js";
import { getIOInstance } from "../sockets/io.instance.js";
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
  const { category, service, description } = req.body;
  const customer = req.user;
  ensureRole(customer, "customer");

  const dispatchResult = await createJobAndDispatch({
    customer,
    category,
    service,
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



export const handlerGetCustomerBookingHistory = asyncHandler(async (req, res) => {
    // 1. Logged-in customer ki ID nikalna (middleware se aayegi)
    const customerId = req.user._id;

    // 2. Database se saari bookings nikalna
    // .populate() se freelancer ka naam aur rating bhi mil jayegi
    // .sort({ createdAt: -1 }) se sabse naya order sabse upar dikhega
    const history = await Job.find({ customer_id: customerId })
        .populate("acceptedBy", "fullname mobileNumber ratingAverage")
        .sort({ createdAt: -1 });

    // 3. Simple response bhejna
    return res.status(200).json(
        new ApiResponse(
            200, 
            {
                count: history.length,
                bookings: history
            }, 
            "Booking history retrieved successfully"
        )
    );
});

export { handlerCreateJob, handlerAcceptJob, handlerRejectJob, handlerCancelJob };