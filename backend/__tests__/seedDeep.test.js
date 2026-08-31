const poolModule = require('../src/db/pool');
const seed = require('../src/db/seed');

describe('Seed Database Deep Execution Tests', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = poolModule.pool;
  });

  afterEach(() => {
    poolModule.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('seedInitialDataToPostgres inserts all seed data when pool is active', async () => {
    poolModule.pool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const res = await seed.seedInitialDataToPostgres();
    expect(res.success).toBe(true);
    expect(res.counts.buyerAccounts).toBeGreaterThan(0);
    expect(res.counts.vendors).toBeGreaterThan(0);
    expect(res.counts.rfqs).toBeGreaterThan(0);
    expect(res.counts.evaluations).toBeGreaterThan(0);
    expect(res.counts.auditLogs).toBeGreaterThan(0);
  });

  test('seed catch blocks are executed when queries throw', async () => {
    poolModule.pool = {
      query: jest.fn().mockRejectedValue(new Error('Generic Query Error')),
    };

    const res = await seed.seedInitialDataToPostgres();
    expect(res.success).toBe(true);
    expect(res.counts.buyerAccounts).toBe(0);
  });

  test('runSeedCLI execution and error exit', async () => {
    poolModule.pool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const res = await seed.runSeedCLI();
    expect(res.success).toBe(true);

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit: ${code}`);
    });
    jest.spyOn(poolModule, 'initializeSchema').mockRejectedValueOnce(new Error('Fatal Seed Failure'));

    await expect(seed.runSeedCLI()).rejects.toThrow();
    exitSpy.mockRestore();
  });
});
