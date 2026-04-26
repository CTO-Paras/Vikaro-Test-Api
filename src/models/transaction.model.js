import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileCustomer",
      required: true,
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileFreelancer",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    provider: {
      type: String,
      enum: ["razorpay", "manual"],
      default: "razorpay",
    },
    providerPaymentId: {
      type: String,
    },
    providerOrderId: {
      type: String,
    },
    providerSignature: {
      type: String,
      default: null,
    },
    providerWebhookEventId: {
      type: String,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["online", "cash",null],
      default: null,
    },
    status: {
      type: String,
      enum: ["pending","processing", "paid", "failed", "refunded"],
      default: "pending",
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

transactionSchema.index({ freelancerId: 1, createdAt: -1 });
transactionSchema.index(
  { providerOrderId: 1 },
  { unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } } }
);
transactionSchema.index(
  { providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } } }
);

export const Transaction = mongoose.model("Transaction", transactionSchema);

export const ensureTransactionIndexes = async () => {
  const existingIndexes = await Transaction.collection.indexes();
  const staleUniqueProviderIndexes = existingIndexes.filter((indexDef) => {
    const isProviderOrderIndex = indexDef?.key?.providerOrderId === 1;
    const isProviderPaymentIndex = indexDef?.key?.providerPaymentId === 1;
    const hasPartialFilter = Boolean(indexDef?.partialFilterExpression);

    return indexDef?.unique === true && !hasPartialFilter && (isProviderOrderIndex || isProviderPaymentIndex);
  });

  for (const staleIndex of staleUniqueProviderIndexes) {
    if (staleIndex?.name && staleIndex.name !== "_id_") {
      await Transaction.collection.dropIndex(staleIndex.name);
    }
  }

  await Transaction.collection.createIndex({ freelancerId: 1, createdAt: -1 });
  await Transaction.collection.createIndex(
    { providerOrderId: 1 },
    {
      unique: true,
      partialFilterExpression: { providerOrderId: { $type: "string" } },
    }
  );
  await Transaction.collection.createIndex(
    { providerPaymentId: 1 },
    {
      unique: true,
      partialFilterExpression: { providerPaymentId: { $type: "string" } },
    }
  );
};
