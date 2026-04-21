# Vikaro Booking Flow Testing Guide (Postman + Socket Updates)

This document gives a complete, practical testing flow for your booking lifecycle using your current backend routes.

## 1. Base Setup

Base URL
- http://localhost:8000

Auth header format
- Authorization: Bearer <ACCESS_TOKEN>

Important route mounts
- Customer auth: /api/v1/customer/auth
- Freelancer auth: /api/v1/freelancer/auth
- Job dispatch: /api/v1/job
- Job workflow: /api/v1/job/status
- Payment: /api/v1/job/workflow
- Subscription: /api/v1/freelancer/subscription
- Rating: /api/v1/freelancer/rating

Important behavior from current code
- Nearby dispatch radius: 1000 meters
- Arrival threshold for phone reveal and OTP generation: 250 meters
- Job completion confirmation requires paymentStatus = paid first
- There is no second OTP endpoint for completion confirmation in current code

## 2. Postman Environment Variables (recommended)

Create these variables in Postman environment:
- baseUrl = http://localhost:8000
- customerToken
- freelancerToken
- customerId
- freelancerId
- jobId
- roomId
- transactionId

## 3. Create/Login Customer

### 3.1 Send OTP (customer)
API
- POST {{baseUrl}}/api/v1/customer/auth/send-otp

Body (raw JSON)
```json
{
  "mobileNumber": "+919999999991",
  "playerId": "customer-player-1"
}
```

### 3.2 Verify OTP (customer)
API
- POST {{baseUrl}}/api/v1/customer/auth/verify-otp

Body (raw JSON)
```json
{
  "mobileNumber": "+919999999991",
  "otp": "123456"
}
```

If response says isNewUser true, register profile.

### 3.3 Register customer profile (if needed)
API
- POST {{baseUrl}}/api/v1/customer/auth/register

Body (raw JSON)
```json
{
  "mobileNumber": "+919999999991",
  "fullname": "Test Customer",
  "address": "Andheri East, Mumbai",
  "coordinates": [72.8777, 19.0760],
  "role": "customer",
  "gender": "male",
  "playerId": "customer-player-1"
}
```

After successful verify/register, save token as customerToken.

## 4. Create/Login Freelancer

### 4.1 Send OTP (freelancer)
API
- POST {{baseUrl}}/api/v1/freelancer/auth/send-otp

Body (raw JSON)
```json
{
  "mobileNumber": "+919999999992",
  "playerId": "freelancer-player-1"
}
```

### 4.2 Verify OTP (freelancer)
API
- POST {{baseUrl}}/api/v1/freelancer/auth/verify-otp

Body (raw JSON)
```json
{
  "mobileNumber": "+919999999992",
  "otp": "123456"
}
```

### 4.3 Register freelancer profile (if needed)
API
- POST {{baseUrl}}/api/v1/freelancer/auth/register

Body type
- form-data

Fields
- mobileNumber: +919999999992
- fullname: Test Freelancer
- vehicleType: Bike
- experience: 1-2
- skill: Electrical
- gender: male
- address: Andheri West, Mumbai
- coordinates: [72.8750, 19.0800]
- role: freelancer
- playerId: freelancer-player-1
- profilePicture: (File, optional)

After successful verify/register, save token as freelancerToken.

## 5. Make Freelancer Eligible to Receive Jobs

### 5.1 Optional: buy PRO subscription (only if free limit reached)
API
- POST {{baseUrl}}/api/v1/freelancer/subscription/buy

Header
- Authorization: Bearer {{freelancerToken}}

### 5.2 Verify PRO subscription payment
API
- POST {{baseUrl}}/api/v1/freelancer/subscription/verify

Header
- Authorization: Bearer {{freelancerToken}}

Body (raw JSON)
```json
{
  "razorpayOrderId": "order_xxx",
  "razorpayPaymentId": "pay_xxx",
  "razorpaySignature": "signature_xxx"
}
```

### 5.3 Toggle freelancer online
API
- PATCH {{baseUrl}}/api/v1/freelancer/status/toggle-status

Header
- Authorization: Bearer {{freelancerToken}}

Expected
- status becomes online

Note
- Dispatch checks freelancer status online, verified, skill match, location near customer, and wallet eligibility.

## 6. Customer Creates Job (Booking Start)

API
- POST {{baseUrl}}/api/v1/job/create-job

Header
- Authorization: Bearer {{customerToken}}

Body (raw JSON)
```json
{
  "categoryId": "{{categoryId}}",
  "serviceId": "{{serviceId}}",
  "subServiceId": "{{subServiceId}}",
  "description": "Ceiling fan not spinning"
}
```

Required fields
- categoryId: MongoDB ObjectId of selected category
- serviceId: MongoDB ObjectId of selected service inside category
- subServiceId: MongoDB ObjectId of selected subservice item
- description: required text (max 500 chars)

Expected
- Returns job object
- Save job._id to jobId
- Returns freelancersNotified and expiresAt

Socket updates expected
- freelancer receives job:incoming (and alias jobRequestSent)

## 7. First Freelancer Accepts Request

Use either endpoint. Prefer first one for dispatch flow.

### 7.1 Accept via dispatch route
API
- POST {{baseUrl}}/api/v1/job/accept-job

Header
- Authorization: Bearer {{freelancerToken}}

Body (raw JSON)
```json
{
  "jobId": "{{jobId}}"
}
```

Expected
- Returns trackingRoomId (save as roomId)
- Job becomes accepted and room is created

Socket updates expected
- customer and freelancer get jobAccepted
- both get job:room:joined

### 7.2 Optional: send job details explicitly
API
- POST {{baseUrl}}/api/v1/job/status/details

Header
- Authorization: Bearer {{freelancerToken}}

Body
```json
{
  "jobId": "{{jobId}}"
}
```

Socket updates expected
- freelancer gets job:details

## 8. Movement and Distance Updates

You can test location updates with HTTP endpoint.

API
- PATCH {{baseUrl}}/api/v1/job/status/location

Header
- Authorization: Bearer {{freelancerToken}}

Body (raw JSON)
```json
{
  "jobId": "{{jobId}}",
  "coordinates": [72.8776, 19.0761]
}
```

Expected
- Returns distance info

Socket updates expected
- room gets job:location:updated
- if distance <= 250 meters, freelancer gets job:customer-phone:revealed

## 9. Customer Generates OTP After Arrival

API
- POST {{baseUrl}}/api/v1/job/status/otp-generate

Header
- Authorization: Bearer {{customerToken}}

Body
```json
{
  "jobId": "{{jobId}}"
}
```

Expected
- Returns otp and expiry
- Works only if freelancer is within 250m

Socket updates expected
- customer room gets job:otp:generated

## 10. Freelancer Verifies OTP and Starts Job

API
- POST {{baseUrl}}/api/v1/job/status/otp-verify

Header
- Authorization: Bearer {{freelancerToken}}

Body
```json
{
  "jobId": "{{jobId}}",
  "otp": "123456"
}
```

Expected
- Job moves to started

Socket updates expected
- room gets job:started

## 11. Freelancer Marks Job Complete

API
- POST {{baseUrl}}/api/v1/job/status/complete-mark

Header
- Authorization: Bearer {{freelancerToken}}

Body
```json
{
  "jobId": "{{jobId}}"
}
```

Expected
- Job moves to completion_pending

Socket updates expected
- customer gets job:completion:requested

## 12. Customer Confirms Completion Before Payment

API
- POST {{baseUrl}}/api/v1/job/status/complete-confirm

Header
- Authorization: Bearer {{customerToken}}

Body
```json
{
  "jobId": "{{jobId}}"
}
```

Expected
- Job moves to completed
- Customer is confirming whether the job was completed or not

Socket updates expected
- room gets job:completed

## 13. Payment Step (after completion confirmation)

Choose one payment path.

### 13.A Online QR path (simple testing)

#### 13.A.1 Generate payment QR
API
- POST {{baseUrl}}/api/v1/job/workflow/payment-qr

Header
- Authorization: Bearer {{freelancerToken}}

Body
```json
{
  "jobId": "{{jobId}}",
  "freelancerUpiId": "freelancer@upi"
}
```

Expected
- Returns transactionId, qrUrl
- Save transactionId
- Works only after the job has been confirmed as completed

Socket updates expected
- room gets job:payment:qr-generated

#### 13.A.2 Confirm payment as online
API
- POST {{baseUrl}}/api/v1/job/workflow/payment-confirm

Header
- Authorization: Bearer {{freelancerToken}}

Body
```json
{
  "jobId": "{{jobId}}",
  "paymentMethod": "online",
  "transactionId": "{{transactionId}}",
  "providerPaymentId": "manual-test-001"
}
```

Expected
- paymentStatus becomes paid

Socket updates expected
- room gets job:payment:confirmed

### 13.B Cash path

API
- POST {{baseUrl}}/api/v1/job/workflow/payment-confirm

Header
- Authorization: Bearer {{freelancerToken}}

Body
```json
{
  "jobId": "{{jobId}}",
  "paymentMethod": "cash"
}
```

Expected
- paymentStatus becomes paid

## 14. Customer Submits Rating

API
- POST {{baseUrl}}/api/v1/freelancer/rating/rating

Header
- Authorization: Bearer {{customerToken}}

Body
```json
{
  "jobId": "{{jobId}}",
  "overallRating": 5,
  "serviceQuality": 5,
  "punctuality": 4,
  "communication": 5,
  "feedback": "Great service"
}
```

Expected
- Rating saved/upserted
- Freelancer average rating and count updated

## 15. Optional Verification APIs

Get freelancer rating stats
- GET {{baseUrl}}/api/v1/freelancer/rating/rating-freelancer/:freelancerId

Check subscription status
- GET {{baseUrl}}/api/v1/freelancer/subscription/subscription-status

## 16. Socket Event Cheat Sheet

Dispatch events
- job:incoming
- job:accept
- jobAccepted
- job:expired
- jobRequestSent
- jobRequestExpired
- jobCancelledByFreelancer
- jobCancelledByCustomer
- jobRedistributed

Workflow events
- job:room:joined
- job:details
- job:location:updated
- job:customer-phone:revealed
- job:otp:generated
- job:started
- job:completion:requested
- job:completed
- job:issue:reported
- job:payment:qr-generated
- job:payment:confirmed

Realtime tracking event
- liveTracking

## 17. How to Test Socket Updates Practically

Option A (recommended)
- Run your frontend/socket client and watch emitted events while calling Postman APIs.

Option B
- Use a Socket.IO client script and connect with token in auth payload.
- Join as customer and freelancer users, then observe events during each API step.

Socket auth requirements
- token required
- role must be customer or freelancer

## 18. Common Failure Cases

- 401 invalid token
- 403 wrong role for endpoint
- 400 invalid jobId/otp/body validation
- 400 freelancer has not arrived yet (otp-generate before <=250m)
- 400 payment must be completed before complete-confirm
- 403 free limit reached or wallet restriction for freelancer accepting jobs

## 19. Exact End-to-End Order

1. Customer login/register
2. Freelancer login/register
3. Freelancer online (and optionally PRO activation)
4. Customer create job
5. Freelancer accept job
6. Freelancer location updates until <=250m
7. Customer generate OTP
8. Freelancer verify OTP (job starts)
9. Freelancer mark complete
10. Customer complete-confirm
11. Payment confirm (online or cash)
12. Customer submit rating
