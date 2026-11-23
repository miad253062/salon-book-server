# SalonBook — Salon Appointment Booking Platform (Server)

This is the RESTful backend API server for **SalonBook**, built with Node.js, Express.js, and MongoDB. It handles salon services, appointment bookings, user block statuses, payment records, and server-side session and role verification.

## Live Website & Repository Links

- **Live Website:** [https://salon-book-client-pjan.vercel.app/](https://salon-book-client-pjan.vercel.app/)
- **Server GitHub Repository:** [https://github.com/miad253062/salon-book-server](https://github.com/miad253062/salon-book-server)
- **Client GitHub Repository:** [https://github.com/miad253062/salon-book-client](https://github.com/miad253062/salon-book-client)

## Important Features

- **Server-Side Session Verification (`verifyToken`):** Validates `Authorization: Bearer <token>` headers against Better Auth's `session` and `user` collections in MongoDB, checks session expiration, and blocks access for suspended (`isBlocked: true`) users.
- **Role-Based Authorization (`verifyAdmin` & `verifyCustomer`):** Enforces strict server-side role verification so only administrators can manage services, users, and appointment confirmations, while only customers can book appointments and manage their own bookings.
- **Service Management APIs:** Provides public endpoints for active services and admin-protected endpoints for creating, updating, toggling status, and deleting services with positive price and duration validation.
- **Appointment & Conflict Prevention APIs:** Ensures only active services can be booked, prevents double-booking on the same date and time slot, and enforces role-based cancellation rules.
- **Payment & Transaction APIs:** Updates payment status for confirmed appointments and prevents duplicate transaction records using `sessionId`.
- **CORS Protection:** Configured with an explicit allowed-origin list and credential support for secure communication with the Next.js client.

## Technology Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB (Native Node.js Driver)
- **Configuration & Security:** `dotenv`, `cors`

## Installation Instructions

1. Clone the server repository:
   ```bash
   git clone https://github.com/miad253062/salon-book-server.git
   cd salon-book-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory and configure the required environment variables listed below.

## Required Environment Variables

Create a `.env` file in the root directory containing only the variable names below (never push `.env` files to GitHub):

```env
PORT=
DB_USERNAME=
DB_PASSWORD=
```

## How to Run the Project Locally

1. Start the Express server:
   ```bash
   node index.js
   ```
2. Verify that the server is running by opening `http://localhost:8000` (or your configured `PORT`), which responds with `Server is running`.