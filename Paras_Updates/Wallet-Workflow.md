# Wallet Workflow and Balance Rules

This file explains wallet logic in simple words using current backend behavior.

## 1) Wallet Constants

- MIN_ALLOWED_BALANCE = -20
- WITHDRAW_MIN_BALANCE = 0
- WITHDRAW_REQUEST_MIN_AMOUNT = 100

Meaning:
- Wallet can go negative only up to -20.
- Withdrawal cannot use negative balance.

## 2) Central Wallet Service

All wallet updates now go through a single service function:

applyWalletEntry({
   freelancerId,
   type,        // credit | debit
   amount,
   source,      // payment_settlement | platform_commission | withdrawal | reversal | penalty | correction | recharge
   referenceId,
   note
})

Responsibilities:
- Creates wallet if not present.
- Validates source and amount.
- Updates wallet balance safely with atomic rule checks.
- Enforces min balance based on debit source.
- Writes full ledger record including balance before and after.
- Syncs freelancer profile walletBalance and lifetimeEarnings.

## 3) Platform Commission and Settlement Rules

Platform commission is 20% for every job.
Freelancer gets 80% for online payment settlement.

Example for jobAmount = 1000:
- platformCommission = 200
- freelancerSettlement = 800

### Online payment settlement

When paymentMethod is online:
1. Assigned freelancer generates QR for completed assigned job.
2. Customer pays externally using QR.
3. Assigned freelancer confirms online payment.
3. Transaction is marked paid.
4. Wallet is credited with 80% of job amount.

Ledger entry:
- type: credit
- source: payment_settlement
- amount: 800
- referenceId: jobId

### Cash payment settlement

When paymentMethod is cash:
1. Freelancer confirms cash payment.
2. Transaction is marked paid.
3. Platform commission is deducted from wallet.

Ledger entry:
- type: debit
- source: platform_commission
- amount: charged commission amount
- referenceId: jobId

## 4) Cash Commission Charging Cases

### Case 1: Sufficient balance

If walletBalance >= commission:
- full commission is debited.

Example:
- wallet = 500, commission = 200 -> new wallet = 300

### Case 2: Partial balance

If wallet is not enough for full commission but can stay above -20 after debit:
- full commission is debited.

Example:
- wallet = 50, commission = 60
- new wallet = -10

### Case 3: Already at/under limit

If wallet would go below -20 after debit:
- commission debit is blocked by wallet service.
- freelancer must recharge before taking new jobs.

## 5) Job Acceptance Guard

Before a freelancer accepts a job, wallet balance is checked.

If walletBalance is less than or equal to -20:
- accept is blocked
- error message: Recharge wallet to continue accepting jobs.

## 6) Payment Ownership and State Validation

Validation rules:
- Payment allowed only when job.status is completed.
- Only assigned freelancer can generate payment QR for a completed assigned job.
- Only assigned freelancer can confirm payment (online or cash).
- Online confirmation requires pending transactionId from payment-qr response.
- Duplicate paid protection:
   - if paymentStatus is paid, payment operations are rejected.

## 7) Withdrawal Rules

Withdrawal flow:
1. Freelancer requests withdrawal.
2. Amount is locked by creating a withdrawal in requested state.
3. Wallet is debited with source withdrawal only when withdrawal is approved/completed.
4. If withdrawal is rejected before debit, no reversal entry is needed.
5. If rejection happens after debit, reversal credit is applied with source reversal.

Wallet summary endpoint:
- GET /api/v1/freelancer/wallet/wallet-summary

Summary fields:
- balance
- lockedBalance
- withdrawableBalance
- lifetimeEarnings
- minWithdrawalAmount

## 8) Recharge

Freelancer recharge endpoint:
- POST /api/v1/freelancer/wallet/wallet-recharge

Behavior:
- Wallet is credited with source recharge.
- If account is wallet_due and balance becomes above -20, accountStatus is set to active.

## 9) Ledger Structure

Every wallet update writes:

{
   type: "credit" | "debit",
   amount,
   source,
   referenceId,
   note,
   balanceBefore,
   balanceAfter,
   createdAt
}

## 10) Payment Event Emission

After successful payment settlement, socket emits:
- job:payment:confirmed

Payload includes:
- jobId
- amount
- freelancerId
- paymentStatus
