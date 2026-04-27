import { ApiError } from "../utils/APIError.js";
import { Wallet } from "../models/wallet.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import {
  MIN_ALLOWED_BALANCE,
  WITHDRAW_MIN_BALANCE,
  WALLET_LEDGER_SOURCES,
} from "../constants/wallet.constant.js";
import { redisClientConfig } from "../config/redis.config.js";

const WALLET_CACHE_PREFIX = "cache:wallet:";

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

const DEBIT_SOURCES_ALLOW_NEGATIVE_BAND = new Set([
  WALLET_LEDGER_SOURCES.PLATFORM_COMMISSION,
  WALLET_LEDGER_SOURCES.PENALTY,
  WALLET_LEDGER_SOURCES.CORRECTION,
]);

const WALLET_LEDGER_SOURCE_VALUES = new Set(Object.values(WALLET_LEDGER_SOURCES));

const ensureWalletExists = async (freelancerId) => {
  return Wallet.findOneAndUpdate(
    { freelancerId },
    {
      $setOnInsert: {
        freelancerId,
        balance: 0,
        lifetimeEarnings: 0,
        ledger: [],
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    }
  );
};

const resolveMinimumBalanceForEntry = ({ type, source }) => {
  if (type !== "debit") return MIN_ALLOWED_BALANCE;
  if (source === WALLET_LEDGER_SOURCES.WITHDRAWAL) return WITHDRAW_MIN_BALANCE;
  if (DEBIT_SOURCES_ALLOW_NEGATIVE_BAND.has(source)) return MIN_ALLOWED_BALANCE;
  return WITHDRAW_MIN_BALANCE;
};

const applyWalletEntry = async ({
  freelancerId,
  type,
  amount,
  source,
  referenceId = null,
  note = null,
}) => {
  if (!freelancerId) {
    throw new ApiError(400, "freelancerId is required");
  }

  if (!["credit", "debit"].includes(type)) {
    throw new ApiError(400, "type must be credit or debit");
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, "amount must be greater than 0");
  }

  if (!WALLET_LEDGER_SOURCE_VALUES.has(source)) {
    throw new ApiError(400, "Invalid wallet source");
  }

  await ensureWalletExists(freelancerId);

  const minimumAllowedBalance = resolveMinimumBalanceForEntry({ type, source });
  const debitThreshold = numericAmount + minimumAllowedBalance;

  const query = { freelancerId };
  if (type === "debit") {
    query.balance = { $gte: debitThreshold };
  }

  const nextBalanceExpr =
    type === "credit"
      ? { $add: ["$balance", numericAmount] }
      : { $subtract: ["$balance", numericAmount] };

  const updatePipeline = [
    {
      $set: {
        _nextBalance: nextBalanceExpr,
      },
    },
    {
      $set: {
        lifetimeEarnings:
          type === "credit"
            ? { $add: ["$lifetimeEarnings", numericAmount] }
            : "$lifetimeEarnings",
        ledger: {
          $concatArrays: [
            "$ledger",
            [
              {
                type,
                amount: numericAmount,
                source,
                referenceId,
                jobId: referenceId,
                note,
                balanceBefore: "$balance",
                balanceAfter: "$_nextBalance",
                createdAt: "$$NOW",
              },
            ],
          ],
        },
        balance: "$_nextBalance",
      },
    },
    {
      $unset: "_nextBalance",
    },
  ];

  const updatedWallet = await Wallet.findOneAndUpdate(query, updatePipeline, {
    returnDocument: "after",
  });

  if (!updatedWallet) {
    if (type === "debit") {
      throw new ApiError(400, `Insufficient wallet balance. Minimum allowed balance is ${minimumAllowedBalance}`);
    }

    throw new ApiError(500, "Failed to update wallet");
  }

  await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
    walletBalance: updatedWallet.balance,
    lifetimeEarnings: updatedWallet.lifetimeEarnings,
  });

  if (updatedWallet.balance <= MIN_ALLOWED_BALANCE) {
    await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
      accountStatus: "wallet_due",
      status: "offline",
    });
  }

  if (updatedWallet.balance > MIN_ALLOWED_BALANCE) {
    await ProfileFreelancer.findOneAndUpdate(
      { _id: freelancerId, accountStatus: "wallet_due" },
      { accountStatus: "active" }
    );
  }

  // Invalidate wallet-related caches for this freelancer (non-blocking)
  try {
    await invalidateWalletCache(freelancerId?.toString?.() || String(freelancerId));
  } catch {
    // ignore cache errors
  }

  return {
    wallet: updatedWallet,
    balance: updatedWallet.balance,
    lifetimeEarnings: updatedWallet.lifetimeEarnings,
  };
};

const getFreelancerWalletBalance = async (freelancerId) => {
  const wallet = await Wallet.findOne({ freelancerId }).select("balance");
  return wallet?.balance ?? 0;
};

export {
  applyWalletEntry,
  getFreelancerWalletBalance,
};
