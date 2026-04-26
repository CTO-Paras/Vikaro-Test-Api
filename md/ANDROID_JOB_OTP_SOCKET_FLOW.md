# Android Job OTP Socket Flow

This file explains only the job OTP socket flow and the frontend changes needed for Android.

## What Was Fixed In Backend

- `updateLocation` now checks job distance and OTP generation correctly.
- OTP generation uses fresh socket coordinates from the freelancer.
- Customer room now gets the correct `customerId`.
- Customer receives `job:otp:generated` when freelancer is within `1000 meters`.
- Backend emits both `job:otp:generated` and `JOB_OTP_GENERATED` for frontend compatibility.
- OTP payload now includes `generatedAt`.
- Freelancer receives phone reveal event, but not the OTP value.

## Important Rule

OTP is emitted only to the customer socket.

Freelancer should not listen for the OTP value. Freelancer enters the OTP after the customer shares it.

## Coordinate Format

Always send coordinates as:

```txt
[longitude, latitude]
```

Correct:

```json
[77.41, 23.25]
```

Wrong:

```json
[23.25, 77.41]
```

## Full Job OTP Flow

1. Customer logs in and connects socket using customer token.
2. Freelancer logs in and connects socket using freelancer token.
3. Freelancer emits `freelancerOnline`.
4. Customer creates job.
5. Freelancer accepts job.
6. Freelancer emits `updateLocation` with `jobId`.
7. Backend calculates freelancer distance from customer/job location.
8. If distance is `<= 1000 meters`, backend auto-generates OTP.
9. Customer socket receives `job:otp:generated`.
10. Customer app shows OTP on screen.
11. Customer shares OTP with freelancer.
12. Freelancer verifies OTP using socket or REST API.

## Customer Socket

Connect socket with customer token:

```kotlin
val options = IO.Options().apply {
    transports = arrayOf("websocket")
    auth = mapOf("token" to customerToken)
}

val customerSocket = IO.socket(BASE_URL, options)

customerSocket.on(Socket.EVENT_CONNECT) {
    Log.d("Socket", "Customer socket connected")
}

customerSocket.connect()
```

Listen for OTP:

```kotlin
customerSocket.on("job:otp:generated") { args ->
    val data = args[0] as JSONObject

    Log.d("Socket", "OTP generated: $data")

    val jobId = data.getString("jobId")
    val otp = data.getString("otp")
    val expiresAt = data.optString("expiresAt")
    val distanceMeters = data.optDouble("distanceMeters")

    // Show otp on customer screen
}
```

Compatibility listener:

```kotlin
customerSocket.on("JOB_OTP_GENERATED") { args ->
    val data = args[0] as JSONObject
    Log.d("Socket", "OTP generated alias: $data")
}
```

Expected payload:

```json
{
  "jobId": "JOB_ID",
  "otp": "1234",
  "expiresAt": "2026-04-26T10:30:00.000Z",
  "status": "arrived",
  "distanceMeters": 452.3,
  "distanceThresholdMeters": 1000,
  "generatedAt": "2026-04-26T10:00:00.000Z"
}
```

## Freelancer Socket

Connect socket with freelancer token:

```kotlin
val options = IO.Options().apply {
    transports = arrayOf("websocket")
    auth = mapOf("token" to freelancerToken)
}

val freelancerSocket = IO.socket(BASE_URL, options)

freelancerSocket.on(Socket.EVENT_CONNECT) {
    Log.d("Socket", "Freelancer socket connected")
}

freelancerSocket.connect()
```

Emit freelancer online first:

```kotlin
val onlinePayload = JSONObject().apply {
    put("coordinates", JSONArray(listOf(longitude, latitude)))
}

freelancerSocket.emit("freelancerOnline", onlinePayload, Ack { ackArgs ->
    Log.d("Socket", "freelancerOnline ack: ${ackArgs.contentToString()}")
})
```

After accepting job, emit location:

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

If location is sent too fast, backend can return:

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

## Freelancer Phone Reveal Event

Freelancer can listen for customer phone reveal:

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

## Customer Live Tracking Event

Customer can listen for freelancer live tracking:

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

## Freelancer Verify OTP By Socket

After customer shares OTP with freelancer:

```kotlin
val otpPayload = JSONObject().apply {
    put("jobId", jobId)
    put("otp", otp)
}

freelancerSocket.emit("job:verify-otp", otpPayload, Ack { ackArgs ->
    Log.d("Socket", "OTP verify ack: ${ackArgs.contentToString()}")
})
```

Success starts the job.

Both customer and freelancer can listen:

```kotlin
socket.on("job:started") { args ->
    Log.d("Socket", "Job started: ${args[0]}")
}
```

## REST APIs Used

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

Verify OTP REST alternative:

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

## Common Mistakes

Do not listen for OTP on freelancer socket:

```kotlin
freelancerSocket.on("job:otp:generated") {
    // wrong
}
```

Listen for OTP on customer socket:

```kotlin
customerSocket.on("job:otp:generated") {
    // correct
}
```

Do not send location before `freelancerOnline`.

Do not send coordinates as `[latitude, longitude]`.

Do not expect OTP to generate after job is already `started`, `completed`, or cancelled.
