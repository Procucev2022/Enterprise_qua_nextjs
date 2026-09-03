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

  test('applies the schema and seeds vendors + RFQs when configured', async () => {
    const fakeVendors = [{ id: 'v-fixture-1' }, { id: 'v-fixture-2' }];
    const fakeRfqs = [{ id: 'rfq-fixture-1' }];
    const queryMock = jest.fn().mockResolvedValue({ rows: [] });
    const upsertVendorMock = jest.fn().mockResolvedValue(null);
    const upsertRfqMock = jest.fn().mockResolvedValue(null);

    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock }));
      jest.doMock('../src/db/domainQueries', () => ({
        upsertVendorInDB: upsertVendorMock,
        upsertRFQInDB: upsertRfqMock,
      }));
      jest.doMock('../src/db/seed', () => ({ SEED_VENDORS: fakeVendors, SEED_RFQS: fakeRfqs }));
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
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Done'));
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
        }));
        jest.doMock('../src/db/seed', () => ({ SEED_VENDORS: [], SEED_RFQS: [] }));
        freshMigrate = require('../src/db/migrate');
      });
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await freshMigrate.runCli();

      expect(exitSpy).toHaveBeenCalledWith(0);
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
