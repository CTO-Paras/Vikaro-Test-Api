# Auth Workflow

This document explains customer and freelancer login flow in simple words.

## 1) Auth Route Groups

Customer auth base:
- /api/v1/customer/auth

Freelancer auth base:
- /api/v1/freelancer/auth

## 2) Common Auth Steps

Both customer and freelancer follow OTP based login.

1. Send OTP
2. Verify OTP
3. If profile exists, login and return token
4. If profile does not exist, register profile

## 3) Customer Auth Endpoints

- POST /api/v1/customer/auth/send-otp
- POST /api/v1/customer/auth/verify-otp
- POST /api/v1/customer/auth/register
- GET /api/v1/customer/auth/current-logged-in-customer

## 4) Freelancer Auth Endpoints

- POST /api/v1/freelancer/auth/send-otp
- POST /api/v1/freelancer/auth/verify-otp
- POST /api/v1/freelancer/auth/register
- GET /api/v1/freelancer/auth/current-logged-in-freelancer

## 5) Send OTP Flow

1. Mobile number is validated.
2. Number is normalized to a standard format.
3. OTP is generated and stored with expiry.
4. OTP is sent through notification/SMS logic.

## 6) Verify OTP Flow

1. User sends mobile number and OTP.
2. Backend verifies OTP from cache/store.
3. If user profile already exists:
   - Access token is generated.
   - User gets login response.
4. If profile does not exist:
   - Response says isNewUser true.
   - Client should call register endpoint.

## 7) Register Flow

Customer register requires:
- mobileNumber
- fullname
- address
- coordinates
- role as customer
- playerId

Freelancer register requires:
- mobileNumber
- fullname
- vehicleType
- experience
- skill
- address
- coordinates
- role as freelancer
- playerId
- optional profile picture file

After successful registration:
- Profile is created.
- Access token is generated.

## 8) Current Logged In User API

Protected by token middleware.

- Customer endpoint returns current customer profile.
- Freelancer endpoint returns current freelancer profile.

## 9) Security and Validation

- Request validation is done by express-validator.
- Rate limiting is applied for send OTP, verify OTP, and register routes.
- Token middleware supports Authorization header and cookie token.
- Role checks are enforced in protected controllers.

## 10) Quick End-to-End Example

1. User enters phone.
2. App calls send-otp.
3. User enters OTP.
4. App calls verify-otp.
5. If isNewUser is true, app shows profile form and calls register.
6. App stores access token and uses it for protected APIs.
