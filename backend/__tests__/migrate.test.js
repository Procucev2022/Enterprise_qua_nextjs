describe('Database migration (Neon PostgreSQL)', () => {
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

  test('skips loudly and preserves exit code when DATABASE_URL is unset and skipIfUnset is true', async () => {
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn() }));
      freshMigrate = require('../src/db/migrate');
    });
    const originalExitCode = process.exitCode;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await freshMigrate.migrate({ skipIfUnset: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('verified schema.sql integrity offline'));
    expect(process.exitCode).toBe(originalExitCode);
  });

  test('applies the schema and writes no seed data', async () => {
    // The whole point of this migration is that it creates structure and nothing
    // else. It used to seed six collections from SEED_* constants and was broken
    // because four of those exports had already been deleted.
    const queryMock = jest.fn().mockResolvedValue({ rows: [{ total: '0' }] });

    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock }));
      freshMigrate = require('../src/db/migrate');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await freshMigrate.migrate();

    const statements = queryMock.mock.calls.map((call) => call[0]);
    // Identity, taxonomy, session and domain structures all come from schema.sql.
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS vendors');
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS "user"');
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS category_division');
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS auth_otp_codes');
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS auth_revoked_tokens');

    // Nothing after the schema but the read-only row-count report. Asserted by
    // shape rather than by scanning for insert/update/delete keywords, because
    // schema.sql's own comments contain those words.
    expect(statements.slice(1).every((sql) => /^select count\(\*\)/i.test(sql.trim()))).toBe(true);

    // The schema itself only ever creates; it must never drop or alter an
    // existing table, because it is applied against a live database.
    const schema = statements[0];
    expect(schema).not.toMatch(/^\s*DROP\s/im);
    expect(schema).not.toMatch(/^\s*ALTER\s/im);
    expect(schema).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Done'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No seed data is written'));
  });

  test('reports a row count for every table the schema defines', async () => {
    const queryMock = jest.fn().mockResolvedValue({ rows: [{ total: '4' }] });
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock }));
      freshMigrate = require('../src/db/migrate');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await freshMigrate.reportRowCounts();

    freshMigrate.REPORTED_TABLES.forEach((table) => {
      expect(queryMock).toHaveBeenCalledWith(`select count(*) as total from "${table}"`);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(table));
    });
  });

  test('reports a table as unavailable rather than aborting the whole report', async () => {
    // A table that does not exist yet must not stop the remaining counts: the
    // operator needs the full picture, and one missing table is information too.
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({
        pool: {},
        query: jest.fn().mockRejectedValue(new Error('relation does not exist')),
      }));
      freshMigrate = require('../src/db/migrate');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(freshMigrate.reportRowCounts()).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('unavailable (relation does not exist)'));
  });

  test('propagates a schema-apply failure to the caller', async () => {
    let freshMigrate;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({
        pool: {},
        query: jest.fn().mockRejectedValue(new Error('syntax error')),
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
        jest.doMock('../src/db/pool', () => ({
          pool: {},
          query: jest.fn().mockResolvedValue({ rows: [{ total: '0' }] }),
        }));
        freshMigrate = require('../src/db/migrate');
      });
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      // runCli() reads the ambient process.exitCode, which is a true Node global
      // (not test-isolated) — pin it to a known value so this assertion cannot be
      // polluted by whatever another test file in the same worker left behind.
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
