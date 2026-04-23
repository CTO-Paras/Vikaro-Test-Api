# Frontend Freelancer Job Notification Guide

This document explains what the frontend team must do so the freelancer app receives a new job when the customer creates one.

## 1) Goal

When a customer creates a job:
- the backend finds nearby online verified freelancers,
- the backend sends a live socket event to the freelancer app,
- the backend sends a push notification if the freelancer has a valid `playerId`,
- the freelancer frontend shows the job,
- the freelancer taps Accept,
- the frontend calls the accept API.

## 2) Important Backend Parts

Job creation route:
- `POST /api/v1/job/create-job`

Job accept route:
- `POST /api/v1/job/accept-job`

Freelancer socket event for going online:
- `freelancerOnline`

Freelancer socket event for receiving a new job:
- `job:incoming`

Compatibility alias already used in the backend:
- `jobRequestSent`

Live in-app notification event:
- `notification:new`

## 3) What the Freelancer Frontend Must Send

### A. Access token
The frontend must connect the socket with the freelancer access token.

Use either:
- `handshake.auth.token`
- or `Authorization: Bearer <token>`

### B. Player ID
The frontend must collect and send the OneSignal `playerId` during auth/register so push notifications work.

The backend already expects `playerId` in the freelancer auth flow.

### C. Coordinates when going online
After the freelancer goes online, the frontend should emit:

```json
{
  "coordinates": [72.875, 19.08]
}
```

This is sent with the socket event:
- `freelancerOnline`

## 4) What the Freelancer Frontend Must Listen To

The app should listen for these socket events:

- `job:incoming` -> new job request arrived
- `jobRequestSent` -> compatibility event
- `notification:new` -> live notification UI
- `jobAccepted` -> useful if you want to refresh customer/freelancer state
- `job:expired` -> job offer timed out
- `job:reject` -> job was rejected or cancelled

## 5) Recommended Frontend Flow

### Step 1: Login
- Freelancer logs in.
- Frontend receives access token.
- Frontend stores token securely.

### Step 2: Register device for push
- Ask for notification permission.
- Get OneSignal `playerId`.
- Send `playerId` to the backend in the freelancer auth flow.

### Step 3: Connect socket
- Open the socket using the freelancer token.
- Keep the socket connection alive.
- Join the freelancer room automatically through the backend.

### Step 4: Go online
- When the freelancer taps Go Online, emit `freelancerOnline` with current coordinates.
- Backend updates freelancer status and location.

### Step 5: Receive job
- When the backend dispatches a job, the freelancer app receives `job:incoming`.
- Show a visible job card, modal, or full-screen alert.
- If app is backgrounded or closed, OneSignal should show the push notification.

### Step 6: Accept job
When the freelancer taps Accept, call:

`POST /api/v1/job/accept-job`

Body:

```json
{
  "jobId": "<jobId>"
}
```

Headers:
- `Authorization: Bearer <token>`

### Step 7: Navigate after accept
- If accept succeeds, open the active job screen.
- Start job tracking from the accepted job response.

## 6) Important Rule

Do not make the push notification itself perform the accept action.

Push notification should only:
- alert the freelancer,
- open the app,
- show job details,
- let the user tap Accept.

The real accept action must be done by the API or socket event.

## 7) Example Socket Pseudocode

```js
const socket = io(BACKEND_URL, {
  auth: {
    token: accessToken,
  },
});

socket.on("connect", () => {
  socket.emit("freelancerOnline", {
    coordinates: [longitude, latitude],
  });
});

socket.on("job:incoming", (payload) => {
  console.log("New job request", payload);
  // show UI here
});

socket.on("notification:new", (notification) => {
  console.log("Live notification", notification);
});
```

## 8) Example Accept API Call

```js
await fetch(`${BACKEND_URL}/api/v1/job/accept-job`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ jobId }),
});
```

## 9) Different Machine Setup

If frontend and backend are on different machines:
- do not use `localhost` in the frontend,
- use the backend machine LAN IP or a deployed URL,
- use the same reachable host for REST APIs and sockets.

## 10) Short Summary

The frontend does not create the job message.
The backend creates the job and sends the notification.
The frontend only needs to:
- connect with token,
- send `playerId`,
- go online with coordinates,
- listen for `job:incoming`,
- let the freelancer tap Accept,
- call the accept API.
