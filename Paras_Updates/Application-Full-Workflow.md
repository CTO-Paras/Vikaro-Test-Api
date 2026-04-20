# Vikaro Backend: Full Integration and Folder Guide

This is the single end-to-end backend document for frontend and backend integration.
It covers:
- Complete folder purpose
- Model, controller, and service function responsibilities
- Exact API payloads frontend must send
- Flow checkpoints from auth to payment and wallet

## 1) Base Setup and Response Format

Base URL prefix for APIs:
- `/api/v1`

Common response envelope (`ApiResponse`):
- `statusCode`: number
- `data`: object or null
- `message`: string
- `success`: boolean

Auth:
- Protected routes require token through auth middleware.
- Role checks are enforced in controllers/services.

## 2) Folder-by-Folder Purpose

### Root
- `app.js`: Express app setup, middleware setup, route mounting, webhook raw-body setup.
- `index.js`: server bootstrap, DB/socket startup.
- `jest.config.js`: test configuration.

### src/config
- Environment-backed configs for CORS, helmet, Razorpay, Redis, Google maps, OneSignal, and API options.

### src/constants
- Static constants for events, wallet rules, categories/services, socket event names.

### src/controllers
- Request-layer handlers.
- Validates role/access and calls service/model operations.
- Returns API responses.

### src/db
- MongoDB connection bootstrap.

### src/middlewares
- Auth verification, input validation, upload middleware, and route-specific rate limiting.

### src/models
- Mongoose schemas for all persisted entities.

### src/routes
- Route definitions with validation rules and middleware pipeline.

### src/services
- Business logic for dispatch/workflow/payment/wallet/maps/notifications/socket integration.

### src/sockets
- Socket.IO instance setup and socket namespace wiring.

### src/utils
- Utility helpers: error/response wrappers, async handler, JWT token helper, role helper, phone normalization.

### Paras_Updates
- Human-readable workflow docs by module.

### test
- Automated tests grouped by domain.

## 3) Model Responsibilities (What Each Model Stores)

### `ProfileCustomer`
- Customer identity and location.
- Key fields: `mobileNumber`, `fullname`, `address`, `location`, `playerId`, `role`.

### `ProfileFreelancer`
- Freelancer identity, skill/profile, status, subscription counters, rating counters, wallet mirror fields.
- Key fields: `mobileNumber`, `fullname`, `status`, `isVerified`, `skill`, `location`, `freeJobsUsed`, `isProActive`, `walletBalance`, `accountStatus`.

### `Job`
- Core job lifecycle and assignment state.
- Key fields: `customer_id`, `acceptedBy`, `category`, `service`, `amount`, `status`, `jobLocation`, OTP fields, completion timestamps, `paymentStatus`, `paymentQrUrl`.

### `Transaction`
- Payment transaction per job/provider.
- Key fields: `jobId`, `customerId`, `freelancerId`, `amount`, `provider`, `providerOrderId`, `providerPaymentId`, `paymentMethod`, `status`, `paidAt`.

### `Wallet`
- Freelancer wallet balance and ledger entries.
- Key fields: `freelancerId`, `balance`, `lifetimeEarnings`, `ledger[]`.

### `Withdrawal`
- Withdrawal request and processing lifecycle.
- Key fields: `freelancerId`, `amount`, bank fields, `status`, `walletDebitApplied`, `processedAt`, `remarks`.

### `FreelancerRating`
- Customer feedback per completed job.
- Key fields: `jobId` (unique), `freelancerId`, `customerId`, rating dimensions, `feedback`.

### `PaymentWebhookEvent`
- Razorpay webhook idempotency tracking.
- Key fields: `eventId` (unique), `eventType`, `status`, `providerOrderId`, `providerPaymentId`, `reason`.

## 4) Controller Functions (File and Purpose)

### `authCustomer.controller.js`
- `handlerSendOtp`: send OTP to customer number.
- `handlerVerifyOtp`: verify OTP and return login/new-user state.
- `handlerRegisterCustomerProfile`: create customer profile.
- `handlerCurrentLoggedInCustomer`: fetch logged-in customer.

### `authFreelancer.controller.js`
- `handlerSendOtp`: send OTP to freelancer number.
- `handlerVerifyOtp`: verify OTP and return login/new-user state.
- `handlerRegisterFreelancerProfile`: create freelancer profile (with optional profile image).
- `handlerCurrentLoggedInFreelancer`: fetch logged-in freelancer.

### `freelancerStatus.controller.js`
- `handlerToggleFreelancerStatus`: switch freelancer online/offline after verification/free-limit checks.

### `job.controller.js`
- `handlerCreateJob`: customer creates and dispatches a job.
- `handlerAcceptJob`: freelancer accepts job.
- `handlerRejectJob`: freelancer reject-after-accept flow.
- `handlerCancelJob`: customer cancels own job.

### `jobWorkflow.controller.js`
- `handlerAcceptJobWorkflow`: workflow accept and room setup.
- `handlerSendJobDetails`: fetch and push route/distance details.
- `handlerUpdateFreelancerLocation`: update live freelancer location.
- `handlerGenerateJobOtp`: customer generates OTP.
- `handlerVerifyJobOtp`: freelancer verifies OTP to start service.
- `handlerMarkJobCompleted`: freelancer requests completion confirmation.
- `handlerConfirmJobCompletion`: customer confirms completion.
- `handlerReportJobIssue`: customer reports completion issue.

### `payment.controller.js`
- `handlerCreateRazorpayOrder`: freelancer creates Razorpay order for a completed job.
- `handlerVerifyRazorpayPayment`: freelancer verifies Razorpay payment signature.
- `handlerRazorpayWebhook`: webhook endpoint for Razorpay events.
- `handlerGeneratePaymentQr`: freelancer generates external UPI QR.
- `handlerConfirmPayment`: freelancer confirms payment (`online` or `cash`).

### `wallet.controller.js`
- `handlerGetWalletSummary`: wallet balance + locked + withdrawable summary.
- `handlerGetDailyEarnings`: paid transaction total for date.
- `handlerGetWeeklyEarnings`: paid transaction total for week.
- `handlerWithdrawWalletBalance`: create withdrawal request and lock amount.
- `handlerProcessWithdrawal`: approve/reject withdrawal (currently self-process flow).
- `handlerRechargeWallet`: recharge wallet via ledger credit.

### `subscription.controller.js`
- `handlerCheckSubscriptionStatus`: free jobs and pro requirement summary.
- `handlerActivateProSubscription`: set pro active.

### `rating.controller.js`
- `handlerSubmitFreelancerRating`: customer submits/updates rating by job.
- `handlerGetFreelancerRatingStats`: fetch freelancer profile rating stats + recent feedback.

## 5) Service Functions (File and Purpose)

### `otp.service.js`
- `sendOTPService`: generate/store/send OTP.
- `verifyOTPService`: validate OTP and consume OTP state.

### `jobDispatch.service.js`
- `createJobAndDispatch`: create job and notify eligible freelancers.
- `acceptJobForFreelancer`: atomic acceptance and lock assignment.
- `rejectAcceptedJobForFreelancer`: release accepted job and redispatch.
- `cancelJobByCustomer`: cancel job with role checks and emits.

### `jobWorkflow.service.js`
- `acceptJob`, `sendJobDetails`, `updateFreelancerLocation`, `generateJobOTP`, `verifyJobOTP`, `markJobCompleted`, `confirmJobCompletion`, `reportJobIssue`.
- Manages live job-state transitions and room events.

### `payment.service.js`
- `createRazorpayOrder`: create/reuse pending Razorpay order transaction.
- `verifyRazorpayPayment`: verify signature and settle payment.
- `handleRazorpayWebhook`: verify webhook signature, idempotency, settle/fail updates.
- `generatePaymentQR`: create UPI QR payload for external payment.
- `confirmPayment`: freelancer-side final confirmation for `online`/`cash`.

### `wallet.service.js`
- `applyWalletEntry`: central wallet ledger mutation and business limits enforcement.
- `getFreelancerWalletBalance`: quick balance fetch.

### `razorpay.service.js`
- `createRazorpayOrderService`: Razorpay order create.
- `verifyRazorpayPaymentSignatureService`: frontend payment signature check.
- `verifyRazorpayWebhookSignatureService`: webhook signature check.

### `maps.service.js`
- `calculateDistance`, `calculateETA`, `getDistanceMatrix`, `getRouteData`.

### `notification.service.js`
- `sendPushNotificationService`, `enqueuePushNotificationJob`, `startPushNotificationWorker`, `stopPushNotificationWorker`.

### `socket.service.js`
- `authenticateFreelancerSocketService`, `registerFreelancerSocketEventsService`.

### `cloudinary.service.js`
- `uploadOnCloudinaryService`.

## 6) Frontend API Contract (What Frontend Must Send)

Use JSON for all request bodies unless noted.

### Customer Auth (`/api/v1/customer/auth`)

1. `POST /send-otp`
- Body: `{ mobileNumber, playerId }`

2. `POST /verify-otp`
- Body: `{ mobileNumber, otp }`

3. `POST /register`
- Body: `{ mobileNumber, fullname, address, coordinates: [lng, lat], role: "customer", playerId }`

4. `GET /current-logged-in-customer`
- Headers: token required.

### Freelancer Auth (`/api/v1/freelancer/auth`)

1. `POST /send-otp`
- Body: `{ mobileNumber, playerId }`

2. `POST /verify-otp`
- Body: `{ mobileNumber, otp }`

3. `POST /register`
- Content type: multipart/form-data
- Fields: `mobileNumber`, `fullname`, `vehicleType`, `experience`, `skill`, `coordinates`, `address`, `role: "freelancer"`, `playerId`, optional file `profilePicture`

4. `GET /current-logged-in-freelancer`
- Headers: token required.

### Freelancer Status (`/api/v1/freelancer/status`)

1. `PATCH /toggle-status`
- Headers: token (freelancer).

### Job (`/api/v1/job`)

1. `POST /create-job`
- Headers: token (customer)
- Body: `{ category, service, description? }`
- `service` must belong to selected `category`.

2. `POST /accept-job`
- Headers: token (freelancer)
- Body: `{ jobId }`

3. `POST /reject-job`
- Headers: token (freelancer)
- Body: `{ jobId, afterAccept: true, reason? }`

4. `POST /cancel-job`
- Headers: token (customer)
- Body: `{ jobId, reason? }`

### Job Workflow (`/api/v1/job/status`)

1. `POST /accept`
- Token: freelancer
- Body: `{ jobId }`

2. `POST /details`
- Token: freelancer
- Body: `{ jobId }`

3. `PATCH /location`
- Token: freelancer
- Body: `{ jobId, coordinates: [lng, lat] }`

4. `POST /otp-generate`
- Token: customer
- Body: `{ jobId }`

5. `POST /otp-verify`
- Token: freelancer
- Body: `{ jobId, otp }`

6. `POST /complete-mark`
- Token: freelancer
- Body: `{ jobId }`

7. `POST /complete-confirm`
- Token: customer
- Body: `{ jobId }`

8. `POST /complete-report-issue`
- Token: customer
- Body: `{ jobId, issueDetails? }`

### Payment (`/api/v1/job/workflow`)

Important checkpoint:
- Payment is allowed only when job status is `completed`.
- Only assigned freelancer can perform payment actions.

1. `POST /payment-order`
- Token: freelancer
- Body: `{ jobId }`
- Returns Razorpay order data (`keyId`, `orderId`, amount, etc.).

2. `POST /payment-verify`
- Token: freelancer
- Body: `{ jobId, razorpayOrderId, razorpayPaymentId, razorpaySignature }`

3. `POST /payment-qr`
- Token: freelancer
- Body: `{ jobId, freelancerUpiId? }`
- Returns `transactionId`, `qrUrl`, `qrPayload`.

4. `POST /payment-confirm`
- Token: freelancer
- Body for online: `{ jobId, paymentMethod: "online", transactionId, providerPaymentId? }`
- Body for cash: `{ jobId, paymentMethod: "cash", providerPaymentId? }`

5. `POST /payment-webhook`
- No user token.
- Called by Razorpay.
- Required headers from Razorpay:
	- `x-razorpay-signature`
	- `x-razorpay-event-id`
- Raw JSON body required for signature verification.

### Wallet (`/api/v1/freelancer/wallet`)

1. `GET /wallet-summary`
- Token: freelancer

2. `GET /wallet-daily`
- Token: freelancer
- Query optional: `date`

3. `GET /wallet-weekly`
- Token: freelancer
- Query optional: `date`

4. `POST /wallet-withdraw`
- Token: freelancer
- Body: `{ amount, bankAccountNumber, ifscCode, accountHolderName }`

5. `POST /wallet-withdraw-process`
- Token: freelancer
- Body: `{ withdrawalId, approve, remarks? }`

6. `POST /wallet-recharge`
- Token: freelancer
- Body: `{ amount, referenceId? }`

### Subscription (`/api/v1/freelancer/subscription`)

1. `GET /subscription-status`
- Token: freelancer

2. `POST /subscription-activate`
- Token: freelancer

### Rating (`/api/v1/freelancer/rating`)

1. `POST /rating`
- Token: customer
- Body: `{ jobId, overallRating, serviceQuality, punctuality, communication, feedback? }`

2. `GET /rating-freelancer/:freelancerId`
- Token required.

## 7) End-to-End Frontend Checkpoints

### [A] Login/Register Checkpoint
- Call send OTP.
- Call verify OTP.
- If `isNewUser: true`, open registration form and submit register API.
- Save access token for protected requests.

### [B] Job Lifecycle Checkpoint
- Customer creates job.
- Freelancer accepts job.
- Freelancer updates live location.
- Customer generates OTP.
- Freelancer verifies OTP to start.
- Freelancer marks completion.
- Customer confirms completion.

### [C] Payment Checkpoint (Completed Job Only)
- Option 1: Razorpay
	- Freelancer calls `payment-order` and returns order to frontend checkout.
	- Frontend passes Razorpay result to `payment-verify`.
- Option 2: QR/manual online
	- Freelancer calls `payment-qr`.
	- After customer pays externally, freelancer calls `payment-confirm` with `online` and `transactionId`.
- Option 3: Cash
	- Freelancer calls `payment-confirm` with `cash`.

### [D] Wallet/Withdrawal Checkpoint
- Use `wallet-summary` for UI balances.
- Withdraw flow is lock-first:
	- request creates locked amount
	- final debit happens when withdrawal is approved/completed.

## 8) Money Rules and Business Constraints

- Platform commission rate: `20%`.
- Online payout credit to freelancer wallet: `80%` of job amount.
- Cash settlement: commission debited from freelancer wallet.
- Wallet lower bound: `MIN_ALLOWED_BALANCE = -20`.
- Minimum withdrawal request amount: `WITHDRAW_REQUEST_MIN_AMOUNT = 100`.
- Payment blocked until job reaches `completed`.
- Duplicate payment protection exists on job and transaction state.

## 9) Webhook and Security Notes

- `app.js` mounts raw parser on `/api/v1/job/workflow/payment-webhook` before JSON parser.
- Razorpay webhook signature is verified before any state change.
- Webhook dedupe uses `PaymentWebhookEvent.eventId`.
- Validation middleware and rate limiters guard all critical APIs.

## 10) Socket/Realtime Behavior

Realtime job lifecycle emits events for:
- job room join
- job details
- location updates
- OTP generation
- job started
- completion request
- job completed
- issue reported
- payment confirmed

Frontend should subscribe to room/user channels according to auth role and active job context.

## 11) Suggested Reading Order

1. `Paras_Updates/Auth-Workflow.md`
2. `Paras_Updates/Job-Workflow.md`
3. `Paras_Updates/Job-Payment-Workflow.md`
4. `Paras_Updates/Wallet-Workflow.md`
5. This file for complete integration.
