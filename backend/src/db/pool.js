const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function sanitizeConnectionString(raw) {
  if (!raw) return '';
  if (raw.includes('sslmode=require') && !raw.includes('uselibpqcompat=')) {
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}uselibpqcompat=true`;
  }
  return raw;
}

const connectionString = sanitizeConnectionString(
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  ''
);

function detectDBProvider(connStr) {
  if (!connStr) {
    return { provider: 'in_memory_mock', label: 'In-Memory Enterprise Store (Offline / Fallback Mode)' };
  }
  const lower = connStr.toLowerCase();
  if (lower.includes('neon.tech') || lower.includes('verceldb')) {
    return { provider: 'neon', label: 'Neon / Vercel Serverless Postgres' };
  }
  if (lower.includes('supabase.co')) {
    return { provider: 'supabase', label: 'Supabase Managed PostgreSQL' };
  }
  if (lower.includes('postgres.database.azure.com')) {
    return { provider: 'azure_postgres', label: 'Azure Database for PostgreSQL Flexible Server' };
  }
  if (lower.includes('rds.amazonaws.com')) {
    return { provider: 'aws_rds', label: 'AWS RDS PostgreSQL' };
  }
  return { provider: 'local_postgres', label: 'Dedicated / Local PostgreSQL Cluster' };
}

function createPool(connStr = connectionString) {
  if (!connStr) return null;
  const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1');
  return new Pool({
    connectionString: connStr,
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 20,
    idleTimeoutMillis: process.env.DB_POOL_IDLE_TIMEOUT_MS ? parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10) : 30000,
    connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT_MS ? parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) : 10000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}

const initialPool = createPool();

const poolModule = {
  pool: initialPool,
};

async function query(text, params, retries = 2) {
  const activePool = poolModule.pool;
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured. Running in memory fallback mode.');
  }

  const start = Date.now();
  try {
    const res = await activePool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 500) {
      console.warn(`[Slow Query ${duration}ms]: ${text.slice(0, 100)}...`);
    }
    return res;
  } catch (error) {
    if (retries > 0 && (error.message?.includes('timeout') || error.message?.includes('Connection terminated') || error.message?.includes('ECONNRESET'))) {
      console.warn(`[PostgreSQL Retrying Query after ${error.message}]: ${text.slice(0, 80)}...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return query(text, params, retries - 1);
    }
    console.error('[PostgreSQL Query Error]:', error.message, '\nQuery:', text);
    throw error;
  }
}

async function checkDBHealth() {
  const activePool = poolModule.pool;
  const currentConn = connectionString || (activePool ? 'postgresql://mock:mock@localhost:5432/mock' : '');
  const { provider, label } = detectDBProvider(currentConn);
  const now = new Date().toISOString();

  if (!activePool) {
    return {
      isConfigured: false,
      isConnected: false,
      provider: 'in_memory_mock',
      providerLabel: label,
      latencyMs: 0,
      tablesCount: 0,
      totalRecords: {
        buyerAccounts: 6,
        vendors: 15,
        rfqs: 12,
        evaluations: 7,
        auditLogs: 24,
        aiFeed: 18,
      },
      errorMessage: 'DATABASE_URL environment variable is not defined.',
      timestamp: now,
    };
  }

  const startTime = Date.now();
  try {
    await activePool.query('SELECT 1 AS ping');
    const latency = Date.now() - startTime;

    const tableRes = await activePool.query(
      `SELECT count(*)::text as count FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tablesCount = parseInt(tableRes.rows[0]?.count || '0', 10);

    let counts = {
      buyerAccounts: 0,
      vendors: 0,
      rfqs: 0,
      evaluations: 0,
      auditLogs: 0,
      aiFeed: 0,
    };

    if (tablesCount > 0) {
      try {
        const countsRes = await activePool.query(`
          SELECT
            (SELECT count(*)::text FROM buyer_accounts) as buyers,
            (SELECT count(*)::text FROM vendors) as vendors,
            (SELECT count(*)::text FROM rfqs) as rfqs,
            (SELECT count(*)::text FROM vendor_evaluations) as evals,
            (SELECT count(*)::text FROM audit_logs) as audits,
            (SELECT count(*)::text FROM ai_bot_feed) as feeds
        `);
        if (countsRes.rows[0]) {
          counts = {
            buyerAccounts: parseInt(countsRes.rows[0].buyers || '0', 10),
            vendors: parseInt(countsRes.rows[0].vendors || '0', 10),
            rfqs: parseInt(countsRes.rows[0].rfqs || '0', 10),
            evaluations: parseInt(countsRes.rows[0].evals || '0', 10),
            auditLogs: parseInt(countsRes.rows[0].audits || '0', 10),
            aiFeed: parseInt(countsRes.rows[0].feeds || '0', 10),
          };
        }
      } catch {
        // Tables might not be initialized yet
      }
    }

    return {
      isConfigured: true,
      isConnected: true,
      provider,
      providerLabel: label,
      latencyMs: latency,
      tablesCount,
      totalRecords: counts,
      timestamp: now,
    };
  } catch (err) {
    return {
      isConfigured: true,
      isConnected: false,
      provider,
      providerLabel: label,
      latencyMs: Date.now() - startTime,
      tablesCount: 0,
      totalRecords: { buyerAccounts: 0, vendors: 0, rfqs: 0, evaluations: 0, auditLogs: 0, aiFeed: 0 },
      errorMessage: err.message || 'Connection failed',
      timestamp: now,
    };
  }
}

async function initializeSchema() {
  const activePool = poolModule.pool;
  if (!activePool) {
    throw new Error('Cannot initialize schema: DATABASE_URL is not set.');
  }

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at ${schemaPath}`);
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await activePool.query(sql);

    const tablesRes = await activePool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = tablesRes.rows.map((r) => r.table_name);

    return {
      success: true,
      message: `Database schema successfully initialized. ${tableNames.length} tables active.`,
      tablesCreated: tableNames,
    };
  } catch (err) {
    console.error('Failed to initialize PostgreSQL schema:', err);
    return {
      success: false,
      message: err.message || 'Failed to initialize schema.',
    };
  }
}

poolModule.createPool = createPool;
poolModule.query = query;
poolModule.detectDBProvider = detectDBProvider;
poolModule.checkDBHealth = checkDBHealth;
poolModule.initializeSchema = initializeSchema;
poolModule.sanitizeConnectionString = sanitizeConnectionString;

module.exports = poolModule;
