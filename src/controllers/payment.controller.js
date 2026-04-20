import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ensureRole } from "../utils/role.js";
import {
	createRazorpayOrder,
	verifyRazorpayPayment,
	handleRazorpayWebhook,
	generatePaymentQR,
	confirmPayment,
} from "../services/payment.service.js";

const handlerCreateRazorpayOrder = asyncHandler(async (req, res) => {
	ensureRole(req.user, "freelancer");
	const { jobId } = req.body;

	const data = await createRazorpayOrder({
		jobId,
		freelancerId: req.user._id,
	});

	return res.status(200).json(new ApiResponse(200, data, "Razorpay order created"));
});

const handlerVerifyRazorpayPayment = asyncHandler(async (req, res) => {
	ensureRole(req.user, "freelancer");

	const {
		jobId,
		razorpayOrderId,
		razorpayPaymentId,
		razorpaySignature,
	} = req.body;

	const data = await verifyRazorpayPayment({
		jobId,
		freelancerId: req.user._id,
		razorpayOrderId,
		razorpayPaymentId,
		razorpaySignature,
	});

	return res.status(200).json(new ApiResponse(200, data, "Razorpay payment verified"));
});

const handlerRazorpayWebhook = asyncHandler(async (req, res) => {
	const signature = req.headers["x-razorpay-signature"];
	const eventId = req.headers["x-razorpay-event-id"];

	const result = await handleRazorpayWebhook({
		rawBody: req.body,
		signature,
		eventId,
	});

	return res.status(200).json(new ApiResponse(200, result, "Webhook processed"));
});

const handlerGeneratePaymentQr = asyncHandler(async (req, res) => {
	ensureRole(req.user, "freelancer");
	const { jobId, freelancerUpiId } = req.body;

	const data = await generatePaymentQR({
		jobId,
		freelancerId: req.user._id,
		freelancerUpiId,
	});

	return res.status(200).json(new ApiResponse(200, data, "Payment QR generated"));
});

const handlerConfirmPayment = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

	const { jobId, transactionId, providerPaymentId, paymentMethod } = req.body;

	const data = await confirmPayment({
		jobId,
		transactionId,
		providerPaymentId,
		paymentMethod,
		actorRole: req.user.role,
		actorId: req.user._id,
	});

	return res.status(200).json(new ApiResponse(200, data, "Payment confirmed"));
});

export {
	handlerCreateRazorpayOrder,
	handlerVerifyRazorpayPayment,
	handlerRazorpayWebhook,
	handlerGeneratePaymentQr,
	handlerConfirmPayment,
};
