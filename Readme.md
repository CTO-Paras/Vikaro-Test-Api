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

## 6) Android Frontend Socket Flow For Job OTP

Use this section for the Android/frontend app.

### Important Rules

- OTP is emitted only to the customer socket.
- Freelancer does not receive the OTP value directly.
- Coordinates must always be sent as `[longitude, latitude]`.
- OTP auto-generates when the freelancer is within `1000 meters` of the customer/job location.
- Freelancer must emit `freelancerOnline` before sending job location updates.

Correct coordinate format:

```json
[77.41, 23.25]
```

Wrong coordinate format:

```json
[23.25, 77.41]
```

### Full Frontend Flow

1. Customer logs in and connects socket using customer token.
2. Freelancer logs in and connects socket using freelancer token.
3. Freelancer emits `freelancerOnline` with current coordinates.
4. Customer creates job from REST API.
5. Freelancer receives job request.
6. Freelancer accepts job from REST API or socket.
7. Freelancer starts sending `updateLocation` with `jobId`.
8. Backend calculates distance from freelancer to customer/job location.
9. If distance is `<= 1000 meters`, backend auto-generates OTP.
10. Customer socket receives `job:otp:generated`.
11. Customer shows OTP on screen.
12. Freelancer enters OTP and verifies it.

### Customer Socket Setup

Connect customer socket using the customer access token.

```kotlin
val options = IO.Options().apply {
    transports = arrayOf("websocket")
    auth = mapOf("token" to customerToken)
}

val customerSocket = IO.socket(BASE_URL, options)

customerSocket.on(Socket.EVENT_CONNECT) {
    Log.d("Socket", "Customer socket connected")
}

customerSocket.on("job:otp:generated") { args ->
    val data = args[0] as JSONObject

    Log.d("Socket", "OTP generated: $data")

    val otp = data.getString("otp")
    val jobId = data.getString("jobId")
    val expiresAt = data.optString("expiresAt")

    // Show otp on customer screen
}

customerSocket.connect()
```

Expected `job:otp:generated` payload:

```json
{
  "jobId": "JOB_ID",
  "otp": "1234",
  "expiresAt": "2026-04-26T10:30:00.000Z",
  "status": "arrived",
  "distanceMeters": 452.3,
  "distanceThresholdMeters": 1000
}
```

### Freelancer Socket Setup

Connect freelancer socket using the freelancer access token.

```kotlin
val options = IO.Options().apply {
    transports = arrayOf("websocket")
    auth = mapOf("token" to freelancerToken)
}

val freelancerSocket = IO.socket(BASE_URL, options)

freelancerSocket.on(Socket.EVENT_CONNECT) {
    Log.d("Socket", "Freelancer socket connected")

    val onlinePayload = JSONObject().apply {
        put("coordinates", JSONArray(listOf(longitude, latitude)))
    }

    freelancerSocket.emit("freelancerOnline", onlinePayload, Ack { ackArgs ->
        Log.d("Socket", "freelancerOnline ack: ${ackArgs.contentToString()}")
    })
}

freelancerSocket.connect()
```

### Freelancer Location Update

After job accept, send location updates with `jobId`.

```kotlin
val locationPayload = JSONObject().apply {
    put("jobId", jobId)
    put("coordinates", JSONArray(listOf(longitude, latitude)))
}

freelancerSocket.emit("updateLocation", locationPayload, Ack { ackArgs ->
    Log.d("Socket", "updateLocation ack: ${ackArgs.contentToString()}")
})
```

Expected `updateLocation` ACK when freelancer is within `1000 meters`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {
    "jobId": "JOB_ID",
    "customerId": "CUSTOMER_ID",
    "freelancerId": "FREELANCER_ID",
    "roomId": "job_JOB_ID",
    "freelancerCoordinates": [77.41, 23.25],
    "distanceMeters": 452.3,
    "distanceKm": 0.45,
    "distanceThresholdMeters": 1000,
    "withinDistanceThreshold": true,
    "otpGenerated": true,
    "otpExpiresAt": "2026-04-26T10:30:00.000Z"
  }
}
```

If the update is sent too fast, backend may return:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Location update throttled",
  "data": {
    "throttled": true
  }
}
```

### Freelancer Phone Reveal Event

Freelancer can listen to this event when close enough:

```kotlin
freelancerSocket.on("job:customer-phone:revealed") { args ->
    val data = args[0] as JSONObject

    Log.d("Socket", "Customer phone revealed: $data")

    val customerPhone = data.optString("customerPhone")
    val canCallCustomer = data.optBoolean("canCallCustomer")
}
```

Expected payload:

```json
{
  "jobId": "JOB_ID",
  "customerPhone": "9876543210",
  "canCallCustomer": true
}
```

### Live Tracking Event For Customer

Customer can also listen to live tracking updates:

```kotlin
customerSocket.on("liveTracking") { args ->
    val data = args[0] as JSONObject
    Log.d("Socket", "Live tracking: $data")
}
```

Expected payload:

```json
{
  "freelancerId": "FREELANCER_ID",
  "jobId": "JOB_ID",
  "coordinates": [77.41, 23.25],
  "distanceMeters": 452.3,
  "distanceKm": 0.45,
  "etaMinutes": 2,
  "etaText": "2 min"
}
```

### OTP Verify From Freelancer

After customer shares OTP, freelancer verifies OTP:

```kotlin
val otpPayload = JSONObject().apply {
    put("jobId", jobId)
    put("otp", otp)
}

freelancerSocket.emit("job:verify-otp", otpPayload, Ack { ackArgs ->
    Log.d("Socket", "OTP verify ack: ${ackArgs.contentToString()}")
})
```

Success starts the job and both sides can listen for:

```kotlin
socket.on("job:started") { args ->
    Log.d("Socket", "Job started: ${args[0]}")
}
```

### REST APIs Used In This Flow

Create job:

```txt
POST /api/v1/job/create-job
Authorization: Bearer CUSTOMER_TOKEN
```

Accept job:

```txt
POST /api/v1/job/accept-job
Authorization: Bearer FREELANCER_TOKEN
```

Verify OTP by REST alternative:

```txt
POST /api/v1/job/status/otp-verify
Authorization: Bearer FREELANCER_TOKEN
```

Body:

```json
{
  "jobId": "JOB_ID",
  "otp": "1234"
}
```

### Common Mistakes To Avoid

Do not listen for OTP on freelancer socket:

```kotlin
freelancerSocket.on("job:otp:generated") {
    // wrong socket for OTP
}
```

Listen for OTP on customer socket:

```kotlin
customerSocket.on("job:otp:generated") {
    // correct socket for OTP
}
```

Do not send `[latitude, longitude]`.

Do not send `updateLocation` before `freelancerOnline` succeeds.

Do not expect OTP to generate if job status is already `started`, `completed`, or cancelled.

## 7) Detailed Docs

- [Paras_Updates/Auth-Workflow.md](Paras_Updates/Auth-Workflow.md)
- [Paras_Updates/Job-Workflow.md](Paras_Updates/Job-Workflow.md)
- [Paras_Updates/Job-Payment-Workflow.md](Paras_Updates/Job-Payment-Workflow.md)
- [Paras_Updates/Wallet-Workflow.md](Paras_Updates/Wallet-Workflow.md)
- [Paras_Updates/Application-Full-Workflow.md](Paras_Updates/Application-Full-Workflow.md)
