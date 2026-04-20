# Job Workflow

This document explains the full job lifecycle in simple words.

## 1) Main Job APIs

Base routes:
- /api/v1/job
- /api/v1/job/status

Important endpoints:
- POST /api/v1/job/create-job
- POST /api/v1/job/accept-job
- POST /api/v1/job/reject-job
- POST /api/v1/job/cancel-job
- POST /api/v1/job/status/details
- PATCH /api/v1/job/status/location
- POST /api/v1/job/status/otp-generate
- POST /api/v1/job/status/otp-verify
- POST /api/v1/job/status/complete-mark
- POST /api/v1/job/status/complete-confirm
- POST /api/v1/job/status/complete-report-issue

## 2) Job Creation Flow

1. Customer creates job with category, service, and optional description.
2. Backend validates category and service mapping.
3. Backend finds nearby online and verified freelancers.
4. Backend dispatches job in batches.
5. Socket notifications are sent to available freelancers.

If no freelancer is available, job is marked expired.

## 3) Job Acceptance Flow

1. Freelancer accepts job.
2. Backend checks job is still pending and offer is active.
3. Backend checks freelancer account restrictions and wallet acceptance rules.
4. Job status changes to accepted.
5. Customer and freelancer are joined to tracking room.

## 4) Job Rejection and Cancellation

Freelancer side:
- Pending manual reject is disabled.
- Assigned freelancer can cancel accepted job with reason.
- Job can be redistributed to next freelancer batch.

Customer side:
- Customer can cancel pending or accepted job depending on state.
- Relevant socket updates are emitted.

## 5) In-Progress Workflow

After accept, these operations happen:

1. Freelancer fetches job details.
2. Freelancer sends live location updates.
3. System checks distance threshold.
4. Customer phone can be revealed to freelancer when close.
5. Customer generates OTP.
6. Freelancer verifies OTP to start job.

## 6) Completion Flow

1. Freelancer marks job complete.
2. Job moves to completion_pending.
3. Customer either:
   - confirms completion, or
   - reports issue.

If customer confirms:
- Job status becomes completed.
- Payment flow can start.

If customer reports issue:
- Job status becomes issue_reported.
- Payment should be blocked until issue handling policy allows it.

## 7) Job Status Values Used

Common statuses:
- pending
- accepted
- arrived
- started
- completion_pending
- completed
- issue_reported
- cancelled
- cancelled_by_customer
- cancelled_by_freelancer
- expired

## 8) Safety Checks

- Role checks on every protected action.
- Request body validation with express-validator.
- Rate limiting middleware for job actions.
- Job ownership and assignment checks.
- Wallet acceptance guard for freelancers.

## 9) Events Used in Job Flow

Common real-time events include:
- job:details
- job:location:updated
- job:otp:generated
- job:started
- job:completion:requested
- job:completed
- job:issue:reported
