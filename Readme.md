# Vikaro Backend Workflow Guide

This readme explains the complete backend flow in simple words.

## 1) What This Backend Does

This is a marketplace backend where:
- Customers create service jobs.
- Freelancers accept and complete jobs.
- Payment is handled as online or cash.
- Wallet is managed with commission rules.

## 2) Main Route Groups

- Customer auth: /api/v1/customer/auth
- Freelancer auth: /api/v1/freelancer/auth
- Job creation and actions: /api/v1/job
- Job progress workflow: /api/v1/job/status
- Payment workflow: /api/v1/job/workflow
- Freelancer wallet: /api/v1/freelancer/wallet
- Freelancer subscription: /api/v1/freelancer/subscription
- Freelancer rating: /api/v1/freelancer/rating

## 3) Full Application Workflow

### Step A: Login and registration

1. User sends OTP.
2. User verifies OTP.
3. If profile exists, user logs in and gets token.
4. If profile does not exist, user registers profile.

### Step B: Customer creates job

1. Customer creates job with category and service.
2. Backend finds nearby available freelancers.
3. Job is dispatched in batches.

### Step C: Freelancer accepts and does work

1. Freelancer accepts job.
2. Freelancer receives job details and sends location updates.
3. Customer generates OTP.
4. Freelancer verifies OTP to start service.

### Step D: Job completion decision

1. Freelancer marks completion.
2. Customer gets completion request.
3. Customer either confirms completion or reports issue.

### Step E: Payment

When job is completed, payment can be settled:

- Online payment:
	- Assigned freelancer can create Razorpay order for frontend checkout.
	- Frontend verifies payment with backend signature verification.
	- Assigned freelancer generates payment QR.
	- Customer pays externally using QR.
	- Assigned freelancer confirms payment.
	- Freelancer wallet gets 80% settlement.

- Cash payment:
	- Customer pays freelancer directly.
	- Assigned freelancer confirms payment.
	- Platform deducts 20% commission from freelancer wallet.

### Step F: Wallet and withdrawal

1. Wallet entries are created for all credits and debits.
2. Wallet can go negative only up to -20.
3. If wallet is at limit, freelancer cannot accept new jobs.
4. Freelancer can recharge wallet.
5. Freelancer withdrawal request locks amount first.
6. Wallet is debited only when withdrawal is completed.

## 4) Business Rules Summary

- Platform commission: 20% per job.
- Online settlement to freelancer: 80%.
- Wallet minimum allowed balance: -20.
- Withdraw minimum balance rule: cannot go below 0.
- Payment allowed only for completed jobs.

## 5) Real-Time Events

Socket events are used for:
- Job updates
- Location updates
- OTP and completion updates
- Payment confirmation

## 6) Detailed Docs

- [Paras_Updates/Auth-Workflow.md](Paras_Updates/Auth-Workflow.md)
- [Paras_Updates/Job-Workflow.md](Paras_Updates/Job-Workflow.md)
- [Paras_Updates/Job-Payment-Workflow.md](Paras_Updates/Job-Payment-Workflow.md)
- [Paras_Updates/Wallet-Workflow.md](Paras_Updates/Wallet-Workflow.md)
- [Paras_Updates/Application-Full-Workflow.md](Paras_Updates/Application-Full-Workflow.md)