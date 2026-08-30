const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const apiRoutes = require('./routes');
const graphqlRoutes = require('./routes/graphql');
const requestLogger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Security & Parsing Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);

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
