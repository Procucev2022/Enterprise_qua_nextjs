const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables (from working directory and backend directory)
dotenv.config();
try {
  const fs = require('fs');
  const targetEnv = process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');
  const envSpecificPath = path.resolve(__dirname, `../.env.${targetEnv}`);
  if (fs.existsSync(envSpecificPath)) {
    dotenv.config({ path: envSpecificPath });
  }
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch {
  // Environment files are optional; Worker bindings and process configuration remain authoritative.
}

const apiRoutes = require('./routes');
const graphqlRoutes = require('./routes/graphql');
const requestLogger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const storeService = require('./services/storeService');
const pool = require('./db/pool');
const d1Bridge = require('./db/d1Bridge');
const { createStoreHydrationGate } = require('./middleware/storeHydrationGate');
const { logger } = require('./services/loggerService');
const { GRAPHQL_CONFIG, STORE_HYDRATION_CONFIG } = require('./config/constants');

const app = express();

// Security, request logging, and CORS preflight run before any hydration work.
app.use(cors());
app.options('*', cors());
app.use(requestLogger);
// GraphQL accepts only bounded JSON bodies even though selected file-ingestion
// APIs need the larger workspace upload limit below.
app.use('/graphql', express.json({ limit: GRAPHQL_CONFIG.MAX_REQUEST_BODY_BYTES }));
app.use('/api/graphql', express.json({ limit: GRAPHQL_CONFIG.MAX_REQUEST_BODY_BYTES }));
app.use('/graphql', express.urlencoded({ extended: true, limit: GRAPHQL_CONFIG.MAX_REQUEST_BODY_BYTES }));
app.use('/api/graphql', express.urlencoded({ extended: true, limit: GRAPHQL_CONFIG.MAX_REQUEST_BODY_BYTES }));
// `verify` captures the exact request bytes onto req.rawBody alongside the
// parsed body express.json() already produces — needed only by the Zoho
// webhook route, whose signature covers the raw wire bytes, not a
// re-serialization of the parsed object (which can reorder keys/whitespace and
// silently break verification).
app.use(
  express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function pathMatchesPrefix(requestPath, prefix) {
  return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

function shouldSkipStoreHydration(requestPath = '/') {
  return STORE_HYDRATION_CONFIG.SKIP_PATHS.some((prefix) => pathMatchesPrefix(requestPath, prefix));
}

// Worker isolates may need storeService's legacy in-memory projection for a
// subset of domain routes. Do not pay the multi-table hydration cost for
// database-only APIs, health checks, or external integrations. Failed hydration
// is a retryable outage for legacy routes; never continue with stale seed state.
// The gate also stops a failing load from repeating on every request, and it
// keeps frontend log ingestion off the store path (see middleware/storeHydrationGate.js).
app.use(createStoreHydrationGate({
  storeService,
  hasStorage: () => pool.hasStorage(),
  isOverloaded: d1Bridge.isD1Overloaded,
  shouldSkipPath: shouldSkipStoreHydration,
  logger,
}));

// API Health & Root Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    version: '2.0.0',
    platform: 'Procucev Enterprise (QUA AI 2.0) Node.js Backend API',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Procucev Enterprise Procurement Backend API',
    version: '2.0.0',
    status: 'ONLINE',
    endpoints: {
      health: '/health',
      apiBase: '/api',
      graphql: '/graphql',
      rfqs: '/api/rfqs',
      vendors: '/api/vendors',
      evaluations: '/api/evaluations',
      buyerAccounts: '/api/buyer-accounts',
      auditLogs: '/api/audit',
      systemConfig: '/api/system-config',
      catalogue: '/api/catalogue',
      supportChat: '/api/support-chat',
      logs: '/api/logs',
      internalTasks: '/api/internal-tasks',
      tickets: '/api/tickets',
      approvals: '/api/approvals',
      scorecard: '/api/scorecard',
    },
  });
});

// Mount GraphQL root route
app.use('/graphql', graphqlRoutes);

// Mount Main API Routes
app.use('/api', apiRoutes);

// 404 Handler for Unknown Routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
  });
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
