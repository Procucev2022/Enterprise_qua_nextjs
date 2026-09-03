describe('Domain database viewer (Neon PostgreSQL)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('fails loudly and sets a non-zero exit code when DATABASE_URL is unset', async () => {
    let freshView;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn(), checkDomainDBHealth: jest.fn() }));
      freshView = require('../src/db/view');
    });
    const originalExitCode = process.exitCode;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await freshView.view();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL is not set'));
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  test('prints a summary table and the raw records for vendors and RFQs when configured', async () => {
    const vendorRow = {
      id: 'v-1',
      email: 'v@x.com',
      major_category: 'Mechanical',
      status: 'ACTIVE',
      source: 'buyer_manual',
      created_at: '2026-01-01T00:00:00.000Z',
      raw: { id: 'v-1', name: 'Apex' },
    };
    const rfqRow = {
      id: 'rfq-1',
      rfq_number: 'RFQ-2026-0001',
      category: 'Mechanical',
      status: 'open',
      sourcing_mode: 'mode_1',
      budget: 1000,
      created_at: '2026-01-01T00:00:00.000Z',
      raw: { id: 'rfq-1', title: 'Test RFQ' },
    };
    const queryMock = jest
      .fn()
      .mockResolvedValueOnce({ rows: [vendorRow] })
      .mockResolvedValueOnce({ rows: [rfqRow] });
    const healthMock = jest.fn().mockResolvedValue({ providerLabel: 'Neon PostgreSQL', poolStatus: 'ACTIVE (max 10 connections)' });

    let freshView;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock, checkDomainDBHealth: healthMock }));
      freshView = require('../src/db/view');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'table').mockImplementation(() => {});

    await freshView.view();

    expect(healthMock).toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('FROM vendors'));
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('FROM rfqs'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Vendors (1)'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('RFQs (1)'));
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([vendorRow.raw], null, 2));
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([rfqRow.raw], null, 2));
  });

  test('prints "(none)" for an empty table instead of an empty console.table', async () => {
    const queryMock = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const healthMock = jest.fn().mockResolvedValue({ providerLabel: 'Neon PostgreSQL', poolStatus: 'ACTIVE' });

    let freshView;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock, checkDomainDBHealth: healthMock }));
      freshView = require('../src/db/view');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const tableSpy = jest.spyOn(console, 'table').mockImplementation(() => {});

    await freshView.view();

    expect(logSpy).toHaveBeenCalledWith('  (none)');
    expect(tableSpy).not.toHaveBeenCalled();
  });

  test('propagates a query failure to the caller', async () => {
    let freshView;
    jest.isolateModules(() => {
      jest.doMock('../src/db/pool', () => ({
        pool: {},
        query: jest.fn().mockRejectedValue(new Error('connection refused')),
        checkDomainDBHealth: jest.fn().mockResolvedValue({ providerLabel: 'Neon PostgreSQL', poolStatus: 'ACTIVE' }),
      }));
      freshView = require('../src/db/view');
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(freshView.view()).rejects.toThrow('connection refused');
  });

  describe('runCli', () => {
    test('exits 0 on success', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({
          pool: {},
          query: jest.fn().mockResolvedValue({ rows: [] }),
          checkDomainDBHealth: jest.fn().mockResolvedValue({ providerLabel: 'Neon PostgreSQL', poolStatus: 'ACTIVE' }),
        }));
        freshView = require('../src/db/view');
      });
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await freshView.runCli();

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('logs the failure and exits 1 when view() rejects', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({
          pool: {},
          query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          checkDomainDBHealth: jest.fn().mockResolvedValue({ providerLabel: 'Neon PostgreSQL', poolStatus: 'ACTIVE' }),
        }));
        freshView = require('../src/db/view');
      });
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await freshView.runCli();

      expect(errorSpy).toHaveBeenCalledWith('[db:view] Failed:', 'ECONNREFUSED');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
