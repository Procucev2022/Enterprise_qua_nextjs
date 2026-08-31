const poolModule = require('../src/db/pool');
const { detectDBProvider, sanitizeConnectionString, query, checkDBHealth, initializeSchema } = poolModule;
const seed = require('../src/db/seed');

describe('Database Configuration & Connection Helpers', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = poolModule.pool;
  });

  afterEach(() => {
    poolModule.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('detectDBProvider identifies all major providers', () => {
    expect(detectDBProvider('postgres://user:pass@ep-cool-fog-12345.us-east-2.aws.neon.tech/neondb').provider).toBe('neon');
    expect(detectDBProvider('postgresql://postgres:pass@db.xyz.supabase.co:5432/postgres').provider).toBe('supabase');
    expect(detectDBProvider('postgresql://admin:pass@psql-procucev.postgres.database.azure.com:5432/procucev_db').provider).toBe('azure_postgres');
    expect(detectDBProvider('postgresql://admin:pass@rds-instance.123456789.us-east-1.rds.amazonaws.com:5432/mydb').provider).toBe('aws_rds');
    expect(detectDBProvider('postgresql://postgres:pass@localhost:5432/db').provider).toBe('local_postgres');
    expect(detectDBProvider('').provider).toBe('in_memory_mock');
  });

  test('sanitizeConnectionString handles sslmode and empty strings', () => {
    expect(sanitizeConnectionString('')).toBe('');
    expect(sanitizeConnectionString('postgresql://user:pass@host/db?sslmode=require')).toContain('uselibpqcompat=true');
    expect(sanitizeConnectionString('postgresql://user:pass@host/db?sslmode=require&uselibpqcompat=true')).toBe('postgresql://user:pass@host/db?sslmode=require&uselibpqcompat=true');
    expect(sanitizeConnectionString('postgresql://user:pass@host/db')).toBe('postgresql://user:pass@host/db');
  });

  test('query throws when pool is null', async () => {
    poolModule.pool = null;
    await expect(query('SELECT 1')).rejects.toThrow('DATABASE_URL is not configured');
  });

  test('checkDBHealth returns status for disconnected/fallback mode', async () => {
    poolModule.pool = null;
    const health = await checkDBHealth();
    expect(health.provider).toBe('in_memory_mock');
    expect(health.isConnected).toBe(false);
  });

  test('initializeSchema throws when pool is null', async () => {
    poolModule.pool = null;
    await expect(initializeSchema()).rejects.toThrow('Cannot initialize schema');
  });

  test('seed database definitions are loaded', () => {
    expect(seed.SEED_BUYER_ACCOUNTS).toBeDefined();
    expect(seed.SEED_VENDORS).toBeDefined();
    expect(seed.SEED_RFQS).toBeDefined();
  });
});
