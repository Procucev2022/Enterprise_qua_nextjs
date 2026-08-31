# Procucev Enterprise (QUA AI 2.0) - Node.js Platform

An autonomous procurement intelligence, supplier orchestration, and RFQ management platform built on **Node.js & Express**.

---

## Features

- **Autonomous Sourcing Operations**:
  - **Mode 1 (Client Approved Roster)**: Private empanelled suppliers.
  - **Mode 2 (Hybrid Sourced Pool)**: Empanelled list expanded with AI-recommended market partners.
  - **Mode 3 (360° Vendor Qualification)**: 6-pillar supplier audit (Commercial, Technical, Quality, Delivery, Financial, Governance).
- **Multi-Channel AI Chaser Engine**: Automated outreach across Voice Calls (with transcripts), WhatsApp Interactive links, SMS DLT alerts, and 24h Escalation Emails.
- **Cryptographic Audit Ledger**: Immutable transaction records stamped and verified with SHA-256 signatures.
- **Dual-Database Support**: Out-of-the-box support for PostgreSQL (Azure Flexible Postgres, Neon, Supabase, AWS RDS, Local) with automatic high-speed In-Memory fallback.
- **Parametric Quote Evaluation Matrix**: Automated price benchmarking, lead-time scoring, and 1-click PO awarding.

---

## Directory Structure

```
node_version/
├── package.json
├── jest.config.js
├── .env.example
├── README.md
├── src/
│   ├── app.js               # Express application setup
│   ├── server.js            # Server entry point & startup
│   ├── config/              # Constants & Category taxonomy
│   ├── db/                  # PostgreSQL Pool, schema & queries
│   ├── middleware/          # Logger & global error handler
│   ├── controllers/         # REST API business controllers
│   ├── routes/              # Express API routers
│   ├── services/            # Store, Audit, AI Chaser, Evaluation services
│   └── public/              # Rich interactive single-page dashboard
└── __tests__/               # Automated unit & integration tests
```

---

## Getting Started

### 1. Install Dependencies
```bash
cd node_version
npm install
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(If `DATABASE_URL` is omitted, the application runs automatically in High-Performance In-Memory Mode).*

### 3. Start the Application
```bash
# Production Start
npm start

# Development with Live Reload
npm run dev
```

The web dashboard is accessible at:
- **Web App UI**: `http://localhost:4000`
- **REST APIs**: `http://localhost:4000/api`
- **Health Check**: `http://localhost:4000/health`

### 4. Run Automated Tests
```bash
npm test
npm run test:coverage
```
