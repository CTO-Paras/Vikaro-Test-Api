Here is the structured **Roadmap and Feature Enhancement** document in Markdown format. This summarizes the missing pieces and provides the technical blueprint for implementing them in your application.

---

# 🚀 Feature Enhancement Roadmap: Vikaro Marketplace

This document outlines the missing functionalities identified in the current backend architecture and the proposed technical solutions to bridge the gap between the current "Core Workflow" and a "Full-Scale Marketplace."

---

## 1. Advanced Customer Profiles
**Current Status:** Minimal data (Mobile, Name, Location).
**Goal:** Personalization for marketing and user experience.

### Proposed Schema Changes (`profileCustomer.model.js`)
Add the following fields to the `profileCustomerSchema`:
* **Gender:** `enum: ["Male", "Female", "Other"]`
* **DOB:** `Date` (For age-restricted services or birthday offers)
* **Anniversary:** `Date` (For special discount triggers)

```javascript
// New Fields
gender: { type: String, enum: ["Male", "Female", "Other"] },
dob: { type: Date },
anniversary: { type: Date }
```

---

## 2. Service Intelligence (Most Used & Statistics)
**Current Status:** Services are stored in a static constant file (`categoryServices.js`).
**Goal:** Dynamic service management with prices, ratings, and popularity tracking.

### Proposed `Service` Model
Move services from constants to a dedicated MongoDB collection:
* **Charge:** Base price for the service.
* **Booking Count:** Increment this every time a `Job` is completed.
* **Rating:** Calculated average from `FreelancerRating`.

```javascript
const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true }, // e.g., "Plumbing"
  baseCharge: { type: Number, default: 0 },
  visitationFee: { type: Number, default: 50 },
  bookingCount: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 }
});
```

---

## 3. Marketplace Discovery (Trending Search)
**Current Status:** No search tracking.
**Goal:** Show "What people are searching for" in the frontend search bar.

### Implementation Strategy
1. **Log Searches:** Create a `SearchLog` model to record what users type.
2. **Aggregation:** Create an endpoint that runs a MongoDB `$group` query to find the top 10 most frequent search terms in the last 7 days.

---

## 4. Financials: Service Cart & Tipping
**Current Status:** `Job` amount is a single flat number.
**Goal:** Transparent pricing (Itemized bill) and Freelancer incentives.

### The "Cart" Object
When a customer places an order, the backend should calculate a breakdown:
| Component | Source |
| :--- | :--- |
| **Item Total** | Sum of selected service base charges |
| **Visitation Fee** | Fixed platform fee |
| **Taxes** | Calculated percentage (e.g., 18% GST) |
| **Tip** | Optional input from customer |
| **Total Amount** | sum(Item + Fees + Taxes + Tip) |

### Tipping Logic
* Add `tipAmount` to the `Job` model.
* Update `payment.service.js` to ensure the **100% of the tip** goes to the freelancer, while the platform commission is only calculated on the `Item Total`.

---

## 5. Customer Booking History
**Current Status:** Jobs are stored, but no dedicated "History" API exists.
**Goal:** Let customers see their past and upcoming jobs.

### New API Endpoint: `GET /api/v1/customers/history`
This controller will query the `Job` collection filtering by `customer_id` and include:
* Service Name/Category.
* Freelancer Details (via `.populate()`).
* Final Status (Completed/Cancelled).
* Total Amount Paid.

---

## 6. Admin Service Management
**Current Status:** Manual code updates required to add services.
**Goal:** A backend-to-frontend pipeline to "Add a Service."

### Proposed Action
Implement a `handlerAddService` controller (Admin only) that allows adding new service names and prices to the database without redeploying the code.

---

## Summary of Technical Debt
| Feature | Complexity | Priority |
| :--- | :--- | :--- |
| Customer History API | Low | High |
| Database Service Model | Medium | High |
| Tipping & Fee Breakdown | Medium | Medium |
| Trending Search Logic | High | Low |

---
*Generated for the Vikaro Development Team*