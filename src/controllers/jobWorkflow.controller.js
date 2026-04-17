import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import {
  acceptJob,
  sendJobDetails,
  updateFreelancerLocation,
  generateJobOTP,
  verifyJobOTP,
  markJobCompleted,
  confirmJobCompletion,
  reportJobIssue,
} from "../services/jobWorkflow.service.js";

const handlerAcceptJobWorkflow = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");
  const { jobId } = req.body;

  const data = await acceptJob({
    jobId,
    freelancerId: req.user._id,
  });

  return res.status(200).json(new ApiResponse(200, data, "Job accepted and room created"));
});

const handlerSendJobDetails = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");
  const { jobId } = req.body;

  const data = await sendJobDetails({
    jobId,
    freelancerId: req.user._id,
  });

  return res.status(200).json(new ApiResponse(200, data, "Job details sent"));
});

const handlerUpdateFreelancerLocation = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");
  const { jobId, coordinates } = req.body;

  const data = await updateFreelancerLocation({
    jobId,
    freelancerId: req.user._id,
    coordinates,
  });

  return res.status(200).json(new ApiResponse(200, data, "Location updated"));
});

const handlerGenerateJobOtp = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");
  const { jobId } = req.body;

  const data = await generateJobOTP({
    jobId,
    customerId: req.user._id,
  });

  return res.status(200).json(new ApiResponse(200, data, "Job OTP generated"));
});

const handlerVerifyJobOtp = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");
  const { jobId, otp } = req.body;

  const data = await verifyJobOTP({
    jobId,
    freelancerId: req.user._id,
    otp,
  });

  return res.status(200).json(new ApiResponse(200, data, "OTP verified, job started"));
});

const handlerMarkJobCompleted = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");
  const { jobId } = req.body;

  const data = await markJobCompleted({
    jobId,
    freelancerId: req.user._id,
  });

  return res.status(200).json(new ApiResponse(200, data, "Completion sent for customer confirmation"));
});

const handlerConfirmJobCompletion = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");
  const { jobId } = req.body;

  const data = await confirmJobCompletion({
    jobId,
    customerId: req.user._id,
  });

  return res.status(200).json(new ApiResponse(200, data, "Job completion confirmed"));
});

const handlerReportJobIssue = asyncHandler(async (req, res) => {
  ensureRole(req.user, "customer");
  const { jobId, issueDetails } = req.body;

  const data = await reportJobIssue({
    jobId,
    customerId: req.user._id,
    issueDetails,
  });

  return res.status(200).json(new ApiResponse(200, data, "Job issue reported"));
});

export {
  handlerAcceptJobWorkflow,
  handlerSendJobDetails,
  handlerUpdateFreelancerLocation,
  handlerGenerateJobOtp,
  handlerVerifyJobOtp,
  handlerMarkJobCompleted,
  handlerConfirmJobCompletion,
  handlerReportJobIssue,
};
