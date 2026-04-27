import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { ensureRole } from "../utils/role.js";
import { redisClientConfig } from "../config/redis.config.js";

import { Transaction } from "../models/transaction.model.js";
import { Withdrawal } from "../models/withdrawal.model.js";
import { Wallet } from "../models/wallet.model.js";
import { WalletRecharge } from "../models/walletRecharge.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { applyWalletEntry } from "../services/wallet.service.js";
import {
  createRazorpayOrderService,
  verifyRazorpayPaymentSignatureService,
} from "../services/razorpay.service.js";
import { razorpayConfig } from "../config/razorpay.config.js";
import {
  WALLET_LEDGER_SOURCES,
  WITHDRAW_REQUEST_MIN_AMOUNT,
} from "../constants/wallet.constant.js";

const WALLET_CACHE_PREFIX = "cache:wallet:";
const WALLET_CACHE_TTL_SECONDS = 2 * 60;

const redisGetJson = async (key) => {
  if (!redisClientConfig.isOpen) return null;

  try {
    const rawValue = await redisClientConfig.get(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
};

const redisSetJson = async (key, value, ttlSeconds) => {
  if (!redisClientConfig.isOpen) return;

  try {
    await redisClientConfig.set(key, JSON.stringify(value), {
      EX: ttlSeconds,
    });
  } catch {
    // Non-blocking cache write.
  }
};

const buildWalletSummaryCacheKey = (freelancerId) =>
  `${WALLET_CACHE_PREFIX}summary:${freelancerId}`;
const buildWalletDailyCacheKey = (freelancerId, isoDate) =>
  `${WALLET_CACHE_PREFIX}daily:${freelancerId}:${isoDate}`;
const buildWalletWeeklyCacheKey = (freelancerId, weekStartIso) =>
  `${WALLET_CACHE_PREFIX}weekly:${freelancerId}:${weekStartIso}`;

const invalidateWalletCache = async (freelancerId) => {
  if (!freelancerId || !redisClientConfig.isOpen) return;

  const match = `${WALLET_CACHE_PREFIX}*${freelancerId}*`;
  const keysToDelete = [];

  try {
    for await (const key of redisClientConfig.scanIterator({ MATCH: match })) {
      keysToDelete.push(key);
    }

    if (keysToDelete.length > 0) {
      await redisClientConfig.del([...new Set(keysToDelete)]);
    }
  } catch {
    // Non-blocking cache invalidation.
  }
};

const buildWalletRechargeReceipt = (freelancerId) =>
  `wrec_${String(freelancerId).slice(-8)}_${Date.now().toString(36)}`;

const getPendingWithdrawalAmount = async (freelancerId) => {
  const result = await Withdrawal.aggregate([
    {
      $match: {
        freelancerId,
        status: { $in: ["requested", "processing"] },
      },
    },
    {
      $group: {
        _id: null,
        totalLocked: { $sum: "$amount" },
      },
    },
  ]);

  return result[0]?.totalLocked || 0;
};

const getWalletSummaryData = async (freelancerId) => {
  const wallet = await Wallet.findOne({ freelancerId }).select(
    "balance lifetimeEarnings"
  );
  const balance = wallet?.balance ?? 0;
  const lifetimeEarnings = wallet?.lifetimeEarnings ?? 0;
  const lockedBalance = await getPendingWithdrawalAmount(freelancerId);
  const withdrawableBalance = Math.max(
    0,
    Number((balance - lockedBalance).toFixed(2))
  );

  return {
    balance,
    lockedBalance,
    withdrawableBalance,
    lifetimeEarnings,
    minWithdrawalAmount: WITHDRAW_REQUEST_MIN_AMOUNT,
  };
};

const parseOptionalDate = (value, fieldName = "date") => {
  if (!value) return new Date();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${fieldName} must be a valid date`);
  }

  return date;
};

/* ---------------- DAILY EARNINGS ---------------- */

const handlerGetDailyEarnings = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const date = parseOptionalDate(req.query.date);

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const freelancerId = req.user?._id?.toString?.();
  const isoDate = start.toISOString().slice(0, 10);
  const cacheKey = buildWalletDailyCacheKey(freelancerId, isoDate);

  const cached = await redisGetJson(cacheKey);
  if (cached) {
    return res
      .status(200)
      .json(new ApiResponse(200, cached, "Daily earnings fetched"));
  }

  const result = await Transaction.aggregate([
    {
      $match: {
        freelancerId: req.user._id,
        status: "paid",
        paidAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const data = {
    date: start,
    totalEarnings: result[0]?.total || 0,
    jobsPaid: result[0]?.count || 0,
  };

  await redisSetJson(cacheKey, data, WALLET_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Daily earnings fetched"));
});

/* ---------------- WEEKLY EARNINGS ---------------- */

const handlerGetWeeklyEarnings = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const date = parseOptionalDate(req.query.date);

  const day = new Date(date);
  const diffToMonday = (day.getDay() + 6) % 7;

  const start = new Date(day);
  start.setDate(day.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const freelancerId = req.user?._id?.toString?.();
  const weekStartIso = start.toISOString().slice(0, 10);
  const cacheKey = buildWalletWeeklyCacheKey(freelancerId, weekStartIso);

  const cached = await redisGetJson(cacheKey);
  if (cached) {
    return res
      .status(200)
      .json(new ApiResponse(200, cached, "Weekly earnings fetched"));
  }

  const result = await Transaction.aggregate([
    {
      $match: {
        freelancerId: req.user._id,
        status: "paid",
        paidAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const data = {
    weekStart: start,
    weekEnd: end,
    totalEarnings: result[0]?.total || 0,
    jobsPaid: result[0]?.count || 0,
  };

  await redisSetJson(cacheKey, data, WALLET_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Weekly earnings fetched"));
});

const handlerGetWalletSummary = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancerId = req.user?._id?.toString?.();
  const cacheKey = buildWalletSummaryCacheKey(freelancerId);

  const cached = await redisGetJson(cacheKey);
  if (cached) {
    return res
      .status(200)
      .json(new ApiResponse(200, cached, "Wallet summary fetched"));
  }

  const data = await getWalletSummaryData(req.user._id);

  await redisSetJson(cacheKey, data, WALLET_CACHE_TTL_SECONDS);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Wallet summary fetched"));
});

/* ---------------- WITHDRAW WALLET ---------------- */

const handlerWithdrawWalletBalance = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const freelancer = await ProfileFreelancer.findById(req.user._id).select(
    "upiId isUpiVerified"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (!freelancer.upiId) {
    throw new ApiError(
      400,
      "UPI not found. Please add your UPI before withdrawal"
    );
  }

  if (!freelancer.isUpiVerified) {
    throw new ApiError(400, "UPI must be verified before withdrawal");
  }

  const { amount, bankAccountNumber, ifscCode, accountHolderName } = req.body;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, "Amount must be greater than 0");
  }

  if (numericAmount < WITHDRAW_REQUEST_MIN_AMOUNT) {
    throw new ApiError(
      400,
      `Minimum withdrawal amount is ${WITHDRAW_REQUEST_MIN_AMOUNT}`
    );
  }

  const summary = await getWalletSummaryData(req.user._id);
  if (summary.withdrawableBalance < numericAmount) {
    throw new ApiError(400, "Insufficient withdrawable balance");
  }

  const withdrawal = await Withdrawal.create({
    freelancerId: req.user._id,
    amount: numericAmount,
    bankAccountNumber,
    ifscCode,
    accountHolderName,
    status: "requested",
    walletDebitApplied: false,
  });

  // Invalidate cached wallet summaries/earnings for this freelancer
  await invalidateWalletCache(
    req.user._id?.toString?.() || String(req.user._id)
  );

  return res
    .status(200)
    .json(
      new ApiResponse(200, withdrawal, "Withdrawal requested and amount locked")
    );
});

/* ---------------- PROCESS WITHDRAWAL (ADMIN) ---------------- */

const handlerProcessWithdrawal = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { withdrawalId, approve, remarks } = req.body;

  const withdrawal = await Withdrawal.findById(withdrawalId);

  if (!withdrawal) {
    throw new ApiError(404, "Withdrawal request not found");
  }

  if (withdrawal.status !== "requested" && withdrawal.status !== "processing") {
    throw new ApiError(400, "Withdrawal is already finalized");
  }

  if (withdrawal.freelancerId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only process your own withdrawals");
  }

  if (approve) {
    if (!withdrawal.walletDebitApplied) {
      await applyWalletEntry({
        freelancerId: withdrawal.freelancerId,
        amount: withdrawal.amount,
        type: "debit",
        source: WALLET_LEDGER_SOURCES.WITHDRAWAL,
        referenceId: withdrawal._id,
        note: "Withdrawal completed",
      });
      withdrawal.walletDebitApplied = true;
    }

    withdrawal.status = "completed";
    withdrawal.processedAt = new Date();
  } else {
    withdrawal.status = "rejected";
    withdrawal.remarks = remarks || "Rejected by admin";

    if (withdrawal.walletDebitApplied) {
      await applyWalletEntry({
        freelancerId: withdrawal.freelancerId,
        amount: withdrawal.amount,
        type: "credit",
        source: WALLET_LEDGER_SOURCES.REVERSAL,
        referenceId: withdrawal._id,
        note: "Withdrawal reversal",
      });
      withdrawal.walletDebitApplied = false;
    }
  }

  await withdrawal.save();
  await invalidateWalletCache(
    withdrawal.freelancerId?.toString?.() || String(withdrawal.freelancerId)
  );

  return res
    .status(200)
    .json(new ApiResponse(200, withdrawal, "Withdrawal processed"));
});

const handlerRechargeWallet = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { amount, referenceId } = req.body;

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, "Amount must be greater than 0");
  }

  const order = await createRazorpayOrderService({
    amountInRupees: numericAmount,
    receipt: buildWalletRechargeReceipt(req.user._id),
    notes: {
      freelancerId: String(req.user._id),
      type: "wallet_recharge",
      referenceId: referenceId || "",
    },
  });

  const recharge = await WalletRecharge.create({
    freelancerId: req.user._id,
    amount: numericAmount,
    currency: order.currency || "INR",
    provider: "razorpay",
    providerOrderId: order.id,
    status: "pending",
    notes: {
      referenceId: referenceId || null,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        keyId: razorpayConfig.keyId,
        amount: recharge.amount,
        currency: recharge.currency,
        orderId: recharge.providerOrderId,
        rechargeId: recharge._id,
      },
      "Wallet recharge order created"
    )
  );
});

const handlerVerifyWalletRecharge = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const isValidSignature = verifyRazorpayPaymentSignatureService({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!isValidSignature) {
    throw new ApiError(400, "Invalid Razorpay payment signature");
  }

  const recharge = await WalletRecharge.findOne({
    freelancerId: req.user._id,
    provider: "razorpay",
    providerOrderId: razorpayOrderId,
  });

  if (!recharge) {
    throw new ApiError(404, "Recharge request not found for this order");
  }

  if (recharge.status === "paid" && recharge.walletCreditApplied) {
    const summary = await getWalletSummaryData(req.user._id);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          recharge,
          walletSummary: summary,
          verified: true,
          existing: true,
        },
        "Wallet recharge already verified"
      )
    );
  }

  if (recharge.status !== "pending") {
    throw new ApiError(400, "Only pending recharge requests can be verified");
  }

  if (!recharge.walletCreditApplied) {
    await applyWalletEntry({
      freelancerId: req.user._id,
      amount: recharge.amount,
      type: "credit",
      source: WALLET_LEDGER_SOURCES.RECHARGE,
      referenceId: recharge._id,
      note: "Wallet recharge via Razorpay",
    });

    recharge.walletCreditApplied = true;
  }

  recharge.providerPaymentId = razorpayPaymentId;
  recharge.providerSignature = razorpaySignature;
  recharge.status = "paid";
  recharge.paidAt = new Date();
  await recharge.save();
  const summary = await getWalletSummaryData(req.user._id);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        recharge,
        walletSummary: summary,
        verified: true,
        existing: false,
      },
      "Wallet recharge verified and balance updated"
    )
  );
});

export {
  handlerGetWalletSummary,
  handlerGetDailyEarnings,
  handlerGetWeeklyEarnings,
  handlerWithdrawWalletBalance,
  handlerProcessWithdrawal,
  handlerRechargeWallet,
  handlerVerifyWalletRecharge,
};
