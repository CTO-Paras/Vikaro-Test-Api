import { Job } from "../models/job.model.js";
import { Category } from "../models/category.model.js";
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
import { getActiveJobForUser } from "../services/activeJob.service.js";

const emitToRoom = (room, event, payload) => {
  getIOInstance().to(room).emit(event, payload);
};

const handlerCreateJob = asyncHandler(async (req, res) => {
  const {
    categoryId,
    serviceId,
    subServiceId,
    description,
    quantity,
    itemTotal,
    itemsTotal,
    subtotal,
    serviceTotal,
    baseAmount,
    visitingFee,
    visitFee,
    visitingCharge,
    visitingCharges,
    taxAmount,
    tax,
    gstAmount,
    gst,
    tipAmount,
    tip,
    finalAmount,
    totalAmount,
    payableAmount,
    grandTotal,
    orderTotal,
    amount,
  } = req.body;
  const customer = req.user;
  ensureRole(customer, "customer");

  const dispatchResult = await createJobAndDispatch({
    customer,
    categoryId,
    serviceId,
    subServiceId,
    description,
    quantity,
    itemTotal: itemTotal ?? itemsTotal ?? subtotal ?? serviceTotal ?? baseAmount,
    visitingFee: visitingFee ?? visitFee ?? visitingCharge ?? visitingCharges,
    taxAmount: taxAmount ?? tax ?? gstAmount ?? gst,
    tipAmount: tipAmount ?? tip,
    finalAmount: finalAmount ?? totalAmount ?? payableAmount ?? grandTotal ?? orderTotal ?? amount,

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

  const {
    job,
    roomId,
    freelancer: acceptedFreelancer,
  } = await acceptJob({
    jobId,
    freelancerId: freelancer._id,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { job, trackingRoomId: roomId, freelancer: acceptedFreelancer },
        "Job accepted successfully"
      )
    );
});

const handlerRejectJob = asyncHandler(async (req, res) => {
  const { jobId, afterAccept, reason } = req.body;
  const freelancer = req.user;

  ensureRole(freelancer, "freelancer");

  if (!afterAccept) {
    throw new ApiError(
      403,
      "Manual reject for pending job requests is disabled"
    );
  }

  const result = await rejectAcceptedJobForFreelancer({
    jobId,
    freelancerId: freelancer._id,
    reason,
    emitToRoom,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, result, "Job cancelled by freelancer and reassigned")
    );
});

const handlerCancelJob = asyncHandler(async (req, res) => {
  const { jobId, reason, acceptFine } = req.body;
  const customer = req.user;
  ensureRole(customer, "customer");

  const job = await cancelJobByCustomer({
    jobId,
    customerId: customer._id,
    reason,
    acceptFine,
    emitToRoom,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, { job }, "Job cancelled successfully"));
});

const handlerGetActiveJob = asyncHandler(async (req, res) => {
  const role = req.userRole || req.user?.role;
  const data = await getActiveJobForUser({
    userId: req.user._id,
    role,
    regenerateOtpOnRestore: role === "customer",
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Active job fetched successfully"));
});

const handlerGetCustomerBookingHistory = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");

  const { page, limit, skip } = resolvePagination(req.query, {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 50,
  });

  const filter = {
    customer_id: req.user._id,
    status: "completed",
  };

  const [total, bookings] = await Promise.all([
    Job.countDocuments(filter),
    Job.find(filter)
      .populate("acceptedBy", "freelancerUniqueId fullname mobileNumber ratingAverage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const categoryIds = [
    ...new Set(
      bookings
        .map((booking) => booking.categoryId?.toString?.())
        .filter(Boolean)
    ),
  ];
  const categories = categoryIds.length
    ? await Category.find({ _id: { $in: categoryIds } })
        .select("services")
        .lean()
    : [];

  const subServiceMediaByKey = new Map();
  categories.forEach((category) => {
    (category.services || []).forEach((service) => {
      (service.subServices || []).forEach((subService) => {
        subServiceMediaByKey.set(
          `${category._id}:${service._id}:${subService._id}`,
          {
            subServiceName: subService.name || null,
            subServiceImage: subService.image || null,
            serviceLogoImage: service.logoImage || null,
            serviceBannerImage: service.bannerImage || null,
          }
        );
      });
    });
  });

  const bookingsWithImages = bookings.map((booking) => {
    const mediaKey = `${booking.categoryId}:${booking.serviceId}:${booking.subServiceId}`;
    const media = subServiceMediaByKey.get(mediaKey) || {};

    return {
      ...booking,
      subServiceName: media.subServiceName || booking.service || null,
      subServiceImage: media.subServiceImage || null,
      image: media.subServiceImage || null,
      serviceLogoImage: media.serviceLogoImage || null,
      serviceBannerImage: media.serviceBannerImage || null,
    };
  });

  const pagination = buildPaginationMeta({ total, page, limit });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        bookings: bookingsWithImages,
        count: bookingsWithImages.length,
        pagination,
      },
      "Booking history retrieved successfully"
    )
  );
});

export {
  handlerCreateJob,
  handlerAcceptJob,
  handlerRejectJob,
  handlerCancelJob,
  handlerGetActiveJob,
  handlerGetCustomerBookingHistory,
};
