describe('Domain database migration (Neon PostgreSQL)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('fails loudly and sets a non-zero exit code when DATABASE_URL is unset', async () => {
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn() }));
      freshMigrate = require('../src/db/migrate');
    });
    const originalExitCode = process.exitCode;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await freshMigrate.migrate();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL is not set'));
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  test('applies the schema and seeds all 7 domain collections when configured', async () => {
    const fakeVendors = [{ id: 'v-fixture-1' }, { id: 'v-fixture-2' }];
    const fakeRfqs = [{ id: 'rfq-fixture-1' }];
    const fakeEvaluations = [{ id: 'eval-fixture-1' }];
    const fakeBuyerAccounts = [{ id: 'buyer-fixture-1' }, { id: 'buyer-fixture-2' }];
    const fakeAuditLogs = [{ id: 'log-fixture-1' }, { id: 'log-fixture-2' }];
    const fakeAIFeed = [{ id: 'feed-fixture-1' }, { id: 'feed-fixture-2' }];
    const queryMock = jest.fn().mockResolvedValue({ rows: [] });
    const upsertVendorMock = jest.fn().mockResolvedValue(null);
    const upsertRfqMock = jest.fn().mockResolvedValue(null);
    const upsertEvaluationMock = jest.fn().mockResolvedValue(null);
    const upsertBuyerAccountMock = jest.fn().mockResolvedValue(null);
    const setActiveBuyerAccountMock = jest.fn().mockResolvedValue(undefined);
    const upsertAuditLogMock = jest.fn().mockResolvedValue(null);
    const upsertAIFeedItemMock = jest.fn().mockResolvedValue(null);

    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock }));
      jest.doMock('../src/db/domainQueries', () => ({
        upsertVendorInDB: upsertVendorMock,
        upsertRFQInDB: upsertRfqMock,
        upsertEvaluationInDB: upsertEvaluationMock,
        upsertBuyerAccountInDB: upsertBuyerAccountMock,
        setActiveBuyerAccountInDB: setActiveBuyerAccountMock,
        upsertAuditLogInDB: upsertAuditLogMock,
        upsertAIFeedItemInDB: upsertAIFeedItemMock,
      }));
      jest.doMock('../src/db/seed', () => ({
        SEED_VENDORS: fakeVendors,
        SEED_RFQS: fakeRfqs,
        SEED_EVALUATIONS: fakeEvaluations,
        SEED_BUYER_ACCOUNTS: fakeBuyerAccounts,
        SEED_AUDIT_LOGS: fakeAuditLogs,
        SEED_AI_FEED: fakeAIFeed,
      }));
      freshMigrate = require('../src/db/migrate');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await freshMigrate.migrate();

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS vendors'));
    expect(upsertVendorMock).toHaveBeenCalledTimes(2);
    expect(upsertVendorMock).toHaveBeenCalledWith(fakeVendors[0]);
    expect(upsertVendorMock).toHaveBeenCalledWith(fakeVendors[1]);
    expect(upsertRfqMock).toHaveBeenCalledTimes(1);
    expect(upsertRfqMock).toHaveBeenCalledWith(fakeRfqs[0]);
    expect(upsertEvaluationMock).toHaveBeenCalledTimes(1);
    expect(upsertEvaluationMock).toHaveBeenCalledWith(fakeEvaluations[0]);

    expect(upsertBuyerAccountMock).toHaveBeenCalledTimes(2);
    expect(upsertBuyerAccountMock).toHaveBeenCalledWith(fakeBuyerAccounts[0]);
    expect(upsertBuyerAccountMock).toHaveBeenCalledWith(fakeBuyerAccounts[1]);
    // Matches the in-memory default: activeBuyerAccount starts as accounts[0].
    expect(setActiveBuyerAccountMock).toHaveBeenCalledWith(fakeBuyerAccounts[0].id);

    // Audit logs and AI feed are seeded in reverse array order — index 0 in
    // the seed data is the most recent entry, and inserting it *last* gives
    // it the highest `sequence` value, so it still reads back first.
    expect(upsertAuditLogMock).toHaveBeenNthCalledWith(1, fakeAuditLogs[1]);
    expect(upsertAuditLogMock).toHaveBeenNthCalledWith(2, fakeAuditLogs[0]);
    expect(upsertAIFeedItemMock).toHaveBeenNthCalledWith(1, fakeAIFeed[1]);
    expect(upsertAIFeedItemMock).toHaveBeenNthCalledWith(2, fakeAIFeed[0]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Done'));
  });

  test('skips setActiveBuyerAccountInDB when there are no buyer accounts to seed', async () => {
    const setActiveBuyerAccountMock = jest.fn();
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn().mockResolvedValue({ rows: [] }) }));
      jest.doMock('../src/db/domainQueries', () => ({
        upsertVendorInDB: jest.fn().mockResolvedValue(null),
        upsertRFQInDB: jest.fn().mockResolvedValue(null),
        upsertEvaluationInDB: jest.fn().mockResolvedValue(null),
        upsertBuyerAccountInDB: jest.fn().mockResolvedValue(null),
        setActiveBuyerAccountInDB: setActiveBuyerAccountMock,
        upsertAuditLogInDB: jest.fn().mockResolvedValue(null),
        upsertAIFeedItemInDB: jest.fn().mockResolvedValue(null),
      }));
      jest.doMock('../src/db/seed', () => ({
        SEED_VENDORS: [],
        SEED_RFQS: [],
        SEED_EVALUATIONS: [],
        SEED_BUYER_ACCOUNTS: [],
        SEED_AUDIT_LOGS: [],
        SEED_AI_FEED: [],
      }));
      freshMigrate = require('../src/db/migrate');
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await freshMigrate.migrate();

    expect(setActiveBuyerAccountMock).not.toHaveBeenCalled();
  });

  test('propagates a schema-apply failure to the caller', async () => {
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({
        pool: {},
        query: jest.fn().mockRejectedValue(new Error('syntax error')),
      }));
      jest.doMock('../src/db/domainQueries', () => ({
        upsertVendorInDB: jest.fn(),
        upsertRFQInDB: jest.fn(),
      }));
      freshMigrate = require('../src/db/migrate');
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(freshMigrate.migrate()).rejects.toThrow('syntax error');
  });

  describe('runCli', () => {
    test('exits 0 on success', async () => {
      let freshMigrate;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn().mockResolvedValue({ rows: [] }) }));
        jest.doMock('../src/db/domainQueries', () => ({
          upsertVendorInDB: jest.fn().mockResolvedValue(null),
          upsertRFQInDB: jest.fn().mockResolvedValue(null),
          upsertEvaluationInDB: jest.fn().mockResolvedValue(null),
          upsertBuyerAccountInDB: jest.fn().mockResolvedValue(null),
          setActiveBuyerAccountInDB: jest.fn().mockResolvedValue(undefined),
          upsertAuditLogInDB: jest.fn().mockResolvedValue(null),
          upsertAIFeedItemInDB: jest.fn().mockResolvedValue(null),
        }));
        jest.doMock('../src/db/seed', () => ({
          SEED_VENDORS: [],
          SEED_RFQS: [],
          SEED_EVALUATIONS: [],
          SEED_BUYER_ACCOUNTS: [],
          SEED_AUDIT_LOGS: [],
          SEED_AI_FEED: [],
        }));
        freshMigrate = require('../src/db/migrate');
      });
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      // runCli() reads the ambient process.exitCode, which is a true Node
      // global (not test-isolated) — pin it to a known value so this
      // assertion can't be polluted by whatever another test file in the
      // same worker left behind.
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      await freshMigrate.runCli();

      expect(exitSpy).toHaveBeenCalledWith(0);
      process.exitCode = originalExitCode;
    });

    test('logs the failure and exits 1 when migrate() rejects', async () => {
      let freshMigrate;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({
          pool: {},
          query: jest.fn().mockRejectedValue(new Error('connection refused')),
        }));
        jest.doMock('../src/db/domainQueries', () => ({ upsertVendorInDB: jest.fn(), upsertRFQInDB: jest.fn() }));
        freshMigrate = require('../src/db/migrate');
      });
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await freshMigrate.runCli();

      expect(errorSpy).toHaveBeenCalledWith('[migrate] Failed:', 'connection refused');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
