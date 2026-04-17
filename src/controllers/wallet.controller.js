import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { ensureRole } from "../utils/role.js";

import { Transaction } from "../models/transaction.model.js";
import { Withdrawal } from "../models/withdrawal.model.js";
import { Wallet } from "../models/wallet.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { applyWalletEntry } from "../services/wallet.service.js";
import {
  WALLET_LEDGER_SOURCES,
  WITHDRAW_REQUEST_MIN_AMOUNT,
} from "../constants/wallet.constant.js";

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
  const wallet = await Wallet.findOne({ freelancerId }).select("balance lifetimeEarnings");
  const balance = wallet?.balance ?? 0;
  const lifetimeEarnings = wallet?.lifetimeEarnings ?? 0;
  const lockedBalance = await getPendingWithdrawalAmount(freelancerId);
  const withdrawableBalance = Math.max(0, Number((balance - lockedBalance).toFixed(2)));

  return {
    balance,
    lockedBalance,
    withdrawableBalance,
    lifetimeEarnings,
    minWithdrawalAmount: WITHDRAW_REQUEST_MIN_AMOUNT,
  };
};


/* ---------------- DAILY EARNINGS ---------------- */

const handlerGetDailyEarnings = asyncHandler(async (req, res) => {

  ensureRole(req.user, "freelancer");

  const date = req.query.date ? new Date(req.query.date) : new Date();

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

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

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Daily earnings fetched"));
});



/* ---------------- WEEKLY EARNINGS ---------------- */

const handlerGetWeeklyEarnings = asyncHandler(async (req, res) => {

  ensureRole(req.user, "freelancer");

  const date = req.query.date ? new Date(req.query.date) : new Date();

  const day = new Date(date);
  const diffToMonday = (day.getDay() + 6) % 7;

  const start = new Date(day);
  start.setDate(day.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

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

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Weekly earnings fetched"));
});

const handlerGetWalletSummary = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const data = await getWalletSummaryData(req.user._id);

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
    throw new ApiError(400, "UPI not found. Please add your UPI before withdrawal");
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

  return res
    .status(200)
    .json(new ApiResponse(200, withdrawal, "Withdrawal requested and amount locked"));
});



/* ---------------- PROCESS WITHDRAWAL (ADMIN) ---------------- */

const handlerProcessWithdrawal = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { withdrawalId, approve, remarks } = req.body;

  const withdrawal = await Withdrawal.findById(withdrawalId);

  if (!withdrawal) {
    throw new ApiError(404, "Withdrawal request not found");
  }

  if (
    withdrawal.status !== "requested" &&
    withdrawal.status !== "processing"
  ) {
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

  return res
    .status(200)
    .json(new ApiResponse(200, withdrawal, "Withdrawal processed"));
});

const handlerRechargeWallet = asyncHandler(async (req, res) => {
  ensureRole(req.user, "freelancer");

  const { amount, referenceId } = req.body;

  const result = await applyWalletEntry({
    freelancerId: req.user._id,
    amount,
    type: "credit",
    source: WALLET_LEDGER_SOURCES.RECHARGE,
    referenceId: referenceId || null,
    note: "Wallet recharge",
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result.wallet, "Wallet recharged successfully"));
});



export {
  handlerGetWalletSummary,
  handlerGetDailyEarnings,
  handlerGetWeeklyEarnings,
  handlerWithdrawWalletBalance,
  handlerProcessWithdrawal,
  handlerRechargeWallet,
};