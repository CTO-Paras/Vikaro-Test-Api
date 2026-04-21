# Dummy Seed API (Development Only)

This document describes the development-only dummy seeding endpoint used to quickly populate test data for **freelancer history** and **job history** features.

> **Important**: This API is **disabled in production** and should only be used in development/testing environments.

---

## 1. Endpoint Overview

- **Method**: `POST`
- **URL**: `/api/v1/dummy/seed`
- **Mounted at**: `app.js` (only when `NODE_ENV !== 'production'`)
- **Auth**: None (public, dev-only)

When `NODE_ENV === 'production'`, the endpoint returns `403` and does **not** modify data.

---

## 2. Purpose

The endpoint seeds realistic sample data for a single freelancer and customer pair so you can test:

- Freelancer wallet history (ledger)
- Freelancer job history (completed and cancelled jobs)

It uses **fixed ObjectIds** so you can reliably query the same freelancer and customer.

---

## 3. Fixed IDs Used

- `freelancerId = ObjectId("69dd77055639b0f822e24dae")`
- `customerId  = ObjectId("64f222222222222222222222")`

These are created via `mongoose.Types.ObjectId` inside the controller.

---

## 4. Behavior Summary

Each call to `POST /api/v1/dummy/seed` (in non-production):

1. **Deletes existing data** for this freelancer:
   - `Wallet.deleteOne({ freelancerId })`
   - `Job.deleteMany({ acceptedBy: freelancerId })`
2. **Inserts one Wallet document** for the freelancer (with ledger entries).
3. **Inserts three Job documents** for the freelancer:
   - 1 completed job
   - 2 cancelled jobs (by customer and by freelancer)

You can safely call this endpoint repeatedly; it always resets and recreates data for this test freelancer.

---

## 5. How to Call the API

Example (assuming the server runs on port `3000`):

```bash
curl -X POST "http://localhost:3000/api/v1/dummy/seed" \
  -H "Content-Type: application/json"
```

- **Request body**: none (empty JSON body is fine).
- **Headers**: `Content-Type: application/json`.

### Expected Responses

**Success (development):**

```json
{
  "success": true,
  "message": "Dummy data inserted successfully"
}
```

**Forbidden (production):**

```json
{
  "success": false,
  "message": "Dummy seed endpoint is disabled in production"
}
```

---

## 6. Wallet Data Inserted

Model: `Wallet`  
Collection: `wallets`

A **single** wallet is created for `freelancerId = ObjectId("69dd77055639b0f822e24dae")` with:

- `balance: 1500`
- `lifetimeEarnings: 2000`
- `ledger`: 4 entries (credits/debits) with running balances

Structure of the inserted wallet document (conceptual):

```json
{
  "freelancerId": "69dd77055639b0f822e24dae",
  "balance": 1500,
  "lifetimeEarnings": 2000,
  "ledger": [
    {
      "type": "credit",
      "amount": 1000,
      "source": "payment_settlement",
      "note": "Payment settlement for completed job",
      "createdAt": "<Date object>",
      "balanceBefore": 1180,
      "balanceAfter": 2180
    },
    {
      "type": "debit",
      "amount": 140,
      "source": "platform_commission",
      "note": "Platform commission deducted",
      "createdAt": "<Date object>",
      "balanceBefore": 2180,
      "balanceAfter": 2040
    },
    {
      "type": "debit",
      "amount": 560,
      "source": "withdrawal",
      "note": "Withdrawal to bank account",
      "createdAt": "<Date object>",
      "balanceBefore": 2040,
      "balanceAfter": 1480
    },
    {
      "type": "credit",
      "amount": 20,
      "source": "reversal",
      "note": "Reversal adjustment",
      "createdAt": "<Date object>",
      "balanceBefore": 1480,
      "balanceAfter": 1500
    }
  ],
  "createdAt": "<auto by Mongoose>",
  "updatedAt": "<auto by Mongoose>",
  "_id": "<auto by MongoDB>"
}
```

> Note: `createdAt` inside ledger entries and on the wallet itself are `Date` objects created via `new Date(...)`. MongoDB will display them as ISODate in the shell/Compass.

Ledger events are inserted in this exact order:

1. `credit` → `payment_settlement` → 1000
2. `debit`  → `platform_commission` → 140
3. `debit`  → `withdrawal` → 560
4. `credit` → `reversal` → 20

---

## 7. Job Data Inserted

Model: `Job`  
Collection: `jobs`

Three jobs are created for the same freelancer and customer:

Common fields for all:

- `customer_id: ObjectId("64f222222222222222222222")`
- `acceptedBy: ObjectId("64f111111111111111111111")`
- `category: "Electrical"`
- `jobLocation: { type: "Point", coordinates: [77.41, 23.25] }`
- `createdAt`, `updatedAt` are `Date` objects spaced out in the past to simulate history.

### 7.1 Completed job – Fan Repair (₹1000)

```json
{
  "customer_id": "64f222222222222222222222",
  "acceptedBy": "64f111111111111111111111",
  "category": "Electrical",
  "service": "Fan Repair",
  "amount": 1000,
  "description": "Ceiling fan not working",
  "jobLocation": {
    "type": "Point",
    "coordinates": [77.41, 23.25]
  },
  "status": "completed",
  "paymentStatus": "paid",
  "createdAt": "<now - 1 hour>",
  "updatedAt": "<now - 30 minutes>",
  "cancelledBy": null,
  "cancelReason": null,
  "_id": "<auto>"
}
```

### 7.2 Cancelled by customer – AC Installation (₹600)

```json
{
  "customer_id": "64f222222222222222222222",
  "acceptedBy": "64f111111111111111111111",
  "category": "Electrical",
  "service": "AC Installation",
  "amount": 600,
  "description": "Split AC installation",
  "jobLocation": {
    "type": "Point",
    "coordinates": [77.41, 23.25]
  },
  "status": "cancelled_by_customer",
  "cancelledBy": "customer",
  "cancelReason": "Change of plan",
  "paymentStatus": "unpaid",
  "createdAt": "<now - 2 hours>",
  "updatedAt": "<now - 1.5 hours>",
  "_id": "<auto>"
}
```

### 7.3 Cancelled by freelancer – Geyser Installation (₹850)

```json
{
  "customer_id": "64f222222222222222222222",
  "acceptedBy": "64f111111111111111111111",
  "category": "Electrical",
  "service": "Geyser Installation",
  "amount": 850,
  "description": "New geyser fitting",
  "jobLocation": {
    "type": "Point",
    "coordinates": [77.41, 23.25]
  },
  "status": "cancelled_by_freelancer",
  "cancelledBy": "freelancer",
  "cancelReason": "Not available at requested time",
  "paymentStatus": "unpaid",
  "createdAt": "<now - 3 hours>",
  "updatedAt": "<now - 2.5 hours>",
  "_id": "<auto>"
}
```

Other optional fields on the `Job` schema use their defaults.

---

## 8. Verifying the Seed in MongoDB

You can verify the inserted data in `mongosh` (adjust DB name as needed):

```js
// Wallet for the seeded freelancer
db.wallets.find({ freelancerId: ObjectId("69dd77055639b0f822e24dae") }).pretty()

// Jobs for the seeded freelancer
db.jobs.find({ acceptedBy: ObjectId("69dd77055639b0f822e24dae") }).pretty()
```

You should see:

- Exactly **1 wallet** with `balance: 1500` and 4 ledger entries.
- Exactly **3 jobs** with statuses `completed`, `cancelled_by_customer`, `cancelled_by_freelancer`.

---

## 9. Using This Seed With History APIs

To use this seeded data with existing history endpoints:

1. Ensure your auth system can issue a token where:
  - `req.user._id = ObjectId("69dd77055639b0f822e24dae")`
   - `req.user.role` (or equivalent) is `"freelancer"`.
2. Call your existing endpoints, for example:
   - `GET /api/v1/freelancer/history`
   - `GET /api/v1/freelancer/jobs-history?status=all`

The wallet and job entries created by this seed should now appear in those responses for the test freelancer.
