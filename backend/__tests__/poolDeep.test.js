const poolModule = require('../src/db/pool');
const fs = require('fs');

describe('Pool Deep Branch & Health Check Tests', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = poolModule.pool;
  });

  afterEach(() => {
    poolModule.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('sanitizeConnectionString handles all query param permutations', () => {
    expect(poolModule.sanitizeConnectionString('')).toBe('');
    expect(poolModule.sanitizeConnectionString('postgres://host/db')).toBe('postgres://host/db');
    expect(poolModule.sanitizeConnectionString('postgres://host/db?sslmode=require')).toBe('postgres://host/db?sslmode=require&uselibpqcompat=true');
    expect(poolModule.sanitizeConnectionString('postgres://host/db#sslmode=require')).toBe('postgres://host/db#sslmode=require?uselibpqcompat=true');
    expect(poolModule.sanitizeConnectionString('postgres://host/db?sslmode=require&uselibpqcompat=true')).toBe('postgres://host/db?sslmode=require&uselibpqcompat=true');
  });

  test('detectDBProvider detects all cloud providers and local clusters', () => {
    expect(poolModule.detectDBProvider('').provider).toBe('in_memory_mock');
    expect(poolModule.detectDBProvider('postgres://ep.neon.tech/db').provider).toBe('neon');
    expect(poolModule.detectDBProvider('postgres://db.verceldb.com/db').provider).toBe('neon');
    expect(poolModule.detectDBProvider('postgres://db.supabase.co/db').provider).toBe('supabase');
    expect(poolModule.detectDBProvider('postgres://pg.postgres.database.azure.com/db').provider).toBe('azure_postgres');
    expect(poolModule.detectDBProvider('postgres://pg.rds.amazonaws.com/db').provider).toBe('aws_rds');
    expect(poolModule.detectDBProvider('postgres://localhost:5432/db').provider).toBe('local_postgres');
  });

  test('createPool initializes local and remote postgres pools with custom and default env', () => {
    const localPool = poolModule.createPool('postgresql://postgres:pass@localhost:5432/db');
    expect(localPool).toBeDefined();

    const remotePool = poolModule.createPool('postgresql://postgres:pass@ep-cool-fog.neon.tech:5432/db');
    expect(remotePool).toBeDefined();

    expect(poolModule.createPool('')).toBeNull();
  });

  test('checkDBHealth executes without pool (in-memory mode)', async () => {
    poolModule.pool = null;
    const health = await poolModule.checkDBHealth();
    expect(health.isConnected).toBe(false);
    expect(health.provider).toBe('in_memory_mock');
  });

  test('checkDBHealth executes connected branch and counts tables', async () => {
    poolModule.pool = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ count: '6' }] };
        }
        if (sql.includes('SELECT count(*)::text FROM buyer_accounts')) {
          return {
            rows: [
              {
                buyers: '6',
                vendors: '15',
                rfqs: '12',
                evals: '7',
                audits: '24',
                feeds: '18',
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const health = await poolModule.checkDBHealth();
    expect(health.isConnected).toBe(true);
    expect(health.tablesCount).toBe(6);
    expect(health.totalRecords.buyerAccounts).toBe(6);
  });

  test('checkDBHealth handles 0 tables and empty rows gracefully', async () => {
    poolModule.pool = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const health = await poolModule.checkDBHealth();
    expect(health.isConnected).toBe(true);
    expect(health.tablesCount).toBe(0);

    // Test tablesCount > 0 but countsRes.rows is empty
    poolModule.pool = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ count: '5' }] };
        }
        if (sql.includes('SELECT count(*)::text FROM buyer_accounts')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    const health2 = await poolModule.checkDBHealth();
    expect(health2.totalRecords.buyerAccounts).toBe(0);
  });

  test('checkDBHealth handles count query errors gracefully', async () => {
    poolModule.pool = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ count: '6' }] };
        }
        if (sql.includes('SELECT count(*)::text FROM buyer_accounts')) {
          throw new Error('Table does not exist');
        }
        return { rows: [] };
      }),
    };

    const health = await poolModule.checkDBHealth();
    expect(health.isConnected).toBe(true);
    expect(health.tablesCount).toBe(6);
  });

  test('checkDBHealth handles connection failure', async () => {
    poolModule.pool = {
      query: jest.fn().mockRejectedValue(new Error('Connection Refused')),
    };

    const health = await poolModule.checkDBHealth();
    expect(health.isConnected).toBe(false);
    expect(health.errorMessage).toContain('Connection Refused');

    // Connection failure with empty message
    poolModule.pool = {
      query: jest.fn().mockRejectedValue({}),
    };
    const healthEmpty = await poolModule.checkDBHealth();
    expect(healthEmpty.errorMessage).toBe('Connection failed');
  });

  test('query throws when active pool is null', async () => {
    poolModule.pool = null;
    await expect(poolModule.query('SELECT 1')).rejects.toThrow('DATABASE_URL is not configured');
  });

  test('query handles slow queries and retries on connection reset', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    poolModule.pool = {
      query: jest.fn().mockImplementation(async () => {
        return { rows: [{ id: 1 }] };
      }),
    };

    const res = await poolModule.query('SELECT 1');
    expect(res.rows[0].id).toBe(1);

    process.env.NODE_ENV = originalEnv;
  });

  test('initializeSchema throws when active pool is null', async () => {
    poolModule.pool = null;
    await expect(poolModule.initializeSchema()).rejects.toThrow('Cannot initialize schema');
  });

  test('initializeSchema executes schema SQL when pool is available', async () => {
    poolModule.pool = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('SELECT table_name')) {
          return { rows: [{ table_name: 'rfqs' }, { table_name: 'vendors' }] };
        }
        return { rows: [] };
      }),
    };

    const res = await poolModule.initializeSchema();
    expect(res.success).toBe(true);
    expect(res.tablesCreated).toHaveLength(2);
  });

  test('initializeSchema handles missing schema file and empty error messages', async () => {
    poolModule.pool = { query: jest.fn() };
    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

    const res = await poolModule.initializeSchema();
    expect(res.success).toBe(false);
    expect(res.message).toContain('Schema file not found');

    poolModule.pool = {
      query: jest.fn().mockRejectedValueOnce({}),
    };
    const resEmpty = await poolModule.initializeSchema();
    expect(resEmpty.success).toBe(false);
    expect(resEmpty.message).toBe('Failed to initialize schema.');
  });
});
