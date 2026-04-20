# Job Payment Workflow

This file explains the freelancer-led payment flow with Razorpay and QR support.

## 1) Main Idea

- Platform commission is 20% per job.
- Freelancer settlement for online payment is 80%.
- Payment starts only after job status becomes completed.
- Customer payment goes to Vikaro account, then freelancer wallet is settled virtually.

## 2) Payment APIs

Base route:
- /api/v1/job/workflow

Endpoints:
- POST /payment-order
- POST /payment-verify
- POST /payment-webhook
- POST /payment-qr
- POST /payment-confirm

## 3) Before Payment Starts

1. Freelancer marks job complete.
2. Customer either confirms completion or reports issue.
3. Only if customer confirms, job becomes completed.
4. Then assigned freelancer can start payment.

If job is not completed, payment is blocked.

## 4) Online Payment Flow (Razorpay)

1. Assigned freelancer calls `/payment-order` for completed job.
2. Backend validates ownership, creates Razorpay order, and returns `keyId`, `orderId`, `transactionId`.
3. Frontend opens Razorpay checkout.
4. Frontend sends `razorpayOrderId`, `razorpayPaymentId`, `razorpaySignature` to `/payment-verify`.
5. Backend verifies signature and settles payment.
6. Transaction status becomes `paid` and job paymentStatus becomes `paid`.
7. Freelancer wallet is credited with 80% via `applyWalletEntry`.
8. Socket event `job:payment:confirmed` is emitted.

Webhook fallback:
- Razorpay posts to `/payment-webhook`.
- Backend validates webhook signature and settles pending online transaction idempotently.

## 5) Online Payment Flow (UPI QR)

1. Assigned freelancer calls `/payment-qr` for completed job.
2. Backend validates freelancer ownership and unpaid status.
3. Backend generates UPI payload + QR URL.
4. Backend creates (or reuses) a pending transaction for that job.
5. Customer scans and pays externally.
6. Assigned freelancer calls `/payment-confirm` with `paymentMethod = online` and `transactionId`.
7. Backend validates transaction exists and is pending, then settles payment.

## 6) Cash Payment Flow

1. Customer pays freelancer in cash directly.
2. Assigned freelancer confirms payment using `/payment-confirm` with `paymentMethod = cash`.
3. Transaction status becomes paid.
4. Job paymentStatus becomes paid.
5. Platform commission (20%) is debited from freelancer wallet via `applyWalletEntry`.
6. Wallet rules (minimum balance and wallet_due status) are handled inside wallet service.

## 7) Role and Ownership Rules

- Only assigned freelancer can create order/QR and confirm payment.
- Duplicate payment is blocked when job paymentStatus is already paid.
- Job must be completed before payment operations.
- Transaction must be pending before it can be marked paid.

## 8) Wallet Impact Summary

- Online paid job: wallet credit 80% (payment_settlement)
- Cash paid job: wallet debit 20% (platform_commission)
- Wallet is a virtual ledger for freelancer earnings and withdrawals.

## 9) Important Event

After successful settlement, backend emits:
- job:payment:confirmed

Payload includes:
- jobId
- amount
- freelancerId
- paymentStatus
