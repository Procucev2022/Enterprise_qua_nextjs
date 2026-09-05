const request = require('supertest');
const http = require('http');
const EventEmitter = require('events');

describe('Domain database viewer (Neon PostgreSQL)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('resolves default port from DB_VIEW_PORT and PORT environment variables', () => {
    const oldDbViewPort = process.env.DB_VIEW_PORT;
    const oldPort = process.env.PORT;

    try {
      process.env.DB_VIEW_PORT = '5010';
      jest.isolateModules(() => {
        require('../src/db/view');
      });

      delete process.env.DB_VIEW_PORT;
      process.env.PORT = '5020';
      jest.isolateModules(() => {
        require('../src/db/view');
      });
    } finally {
      if (oldDbViewPort !== undefined) process.env.DB_VIEW_PORT = oldDbViewPort;
      else delete process.env.DB_VIEW_PORT;
      if (oldPort !== undefined) process.env.PORT = oldPort;
      else delete process.env.PORT;
    }
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

  describe('fetchPostgresTable and getAllPostgresData', () => {
    test('returns empty results when pool is not configured', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      const res = await freshView.fetchPostgresTable('vendors');
      expect(res).toEqual({ rows: [], columns: [], count: 0, pkColumn: 'id' });

      const all = await freshView.getAllPostgresData();
      expect(all).toEqual({});
    });

    test('fetches table rows and schema dynamically', async () => {
      const mockQuery = jest.fn((sql) => {
        if (sql.includes('information_schema.tables')) {
          return Promise.resolve({ rows: [{ table_name: 'custom_table' }] });
        }
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ total: '2' }] });
        }
        return Promise.resolve({ rows: [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }] });
      });

      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const tableData = await freshView.fetchPostgresTable('vendors');
      expect(tableData.count).toBe(2);
      expect(tableData.columns).toEqual(['id', 'name']);
      expect(tableData.rows.length).toBe(2);

      const allData = await freshView.getAllPostgresData();
      expect(allData.custom_table).toBeDefined();
      expect(allData.vendors).toBeDefined();
    });

    test('handles empty count result and fallback to 0 count', async () => {
      const mockQuery = jest.fn((sql) => {
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const tableData = await freshView.fetchPostgresTable('vendors');
      expect(tableData).toEqual({ rows: [], columns: [], count: 0, pkColumn: 'id' });
    });

    test('handles schema query failure gracefully and keeps known tables', async () => {
      const mockQuery = jest.fn((sql) => {
        if (sql.includes('information_schema.tables')) {
          return Promise.reject(new Error('no schema'));
        }
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const allData = await freshView.getAllPostgresData();
      expect(allData.vendors).toEqual({ rows: [], columns: [], count: 0, pkColumn: 'id' });
    });

    test('handles fetch errors gracefully and falls back to empty array', async () => {
      const mockQuery = jest.fn().mockRejectedValue(new Error('table does not exist'));

      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const tableData = await freshView.fetchPostgresTable('unknown_table');
      expect(tableData).toEqual({ rows: [], columns: [], count: 0, pkColumn: 'id' });
    });
  });

  describe('createViewerApp Express API Routes', () => {
    let freshView;
    let app;

    beforeEach(() => {
      jest.isolateModules(() => {
        const mockQuery = jest.fn((sql) => {
          if (sql.includes('count(*)')) {
            return Promise.resolve({ rows: [{ total: '1' }] });
          }
          if (sql.includes('information_schema.tables')) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [{ id: 'v-1', name: 'Apex' }] });
        });
        const mockHealth = jest.fn().mockResolvedValue({ poolStatus: 'ACTIVE', providerLabel: 'Neon' });

        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery, checkDomainDBHealth: mockHealth }));
        freshView = require('../src/db/view');
      });
      app = freshView.createViewerApp();
    });

    test('GET / returns HTML viewer interface', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Neon PostgreSQL Database Viewer');
    });

    test('GET /api/overview returns domain health and counts', async () => {
      const res = await request(app).get('/api/overview');
      expect(res.status).toBe(200);
      expect(res.body.domainHealth).toBeDefined();
      expect(res.body.tableCounts).toBeDefined();
    });

    test('GET /api/overview handles when pool is null', async () => {
      let unconfiguredView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: null }));
        unconfiguredView = require('../src/db/view');
      });
      const unconfiguredApp = unconfiguredView.createViewerApp();
      const res = await request(unconfiguredApp).get('/api/overview');
      expect(res.status).toBe(200);
      expect(res.body.domainHealth.poolStatus).toBe('NOT_CONFIGURED');
    });

    test('GET /api/tables returns table summaries', async () => {
      const res = await request(app).get('/api/tables');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tables)).toBe(true);
    });

    test('GET /api/table/:tableName returns specific table records', async () => {
      const res = await request(app).get('/api/table/vendors');
      expect(res.status).toBe(200);
      expect(res.body.table).toBe('vendors');
      expect(res.body.count).toBe(1);
    });

    test('GET /api/all-data returns comprehensive snapshot', async () => {
      const res = await request(app).get('/api/all-data');
      expect(res.status).toBe(200);
      expect(res.body.database).toBe('Neon PostgreSQL');
      expect(res.body.tables).toBeDefined();
    });

    test('PUT /api/table/:tableName/:recordId updates a record successfully', async () => {
      jest.spyOn(freshView, 'updateTableRecord').mockResolvedValueOnce({ id: 'v-1', status: 'VERIFIED' });
      const res = await request(app)
        .put('/api/table/vendors/v-1')
        .send({ status: 'VERIFIED' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.status).toBe('VERIFIED');
    });

    test('POST /api/table/:tableName creates a new record successfully', async () => {
      jest.spyOn(freshView, 'insertTableRecord').mockResolvedValueOnce({ id: 'v-2', status: 'ACTIVE' });
      const res = await request(app)
        .post('/api/table/vendors')
        .send({ id: 'v-2', status: 'ACTIVE' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.record.id).toBe('v-2');
    });

    test('DELETE /api/table/:tableName/:recordId deletes a record successfully', async () => {
      jest.spyOn(freshView, 'deleteTableRecord').mockResolvedValueOnce({ id: 'v-1' });
      const res = await request(app).delete('/api/table/vendors/v-1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deletedRecord.id).toBe('v-1');
    });

    test('handles API errors gracefully', async () => {
      jest.spyOn(freshView, 'getAllPostgresData').mockRejectedValueOnce(new Error('DB failure'));
      const res = await request(app).get('/api/overview');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('DB failure');

      jest.spyOn(freshView, 'getAllPostgresData').mockRejectedValueOnce(new Error('DB failure'));
      const resTables = await request(app).get('/api/tables');
      expect(resTables.status).toBe(500);

      jest.spyOn(freshView, 'fetchPostgresTable').mockRejectedValueOnce(new Error('Table failure'));
      const resTable = await request(app).get('/api/table/vendors');
      expect(resTable.status).toBe(500);

      jest.spyOn(freshView, 'updateTableRecord').mockRejectedValueOnce(new Error('Update failure'));
      const resPut = await request(app).put('/api/table/vendors/v-1').send({ status: 'ERR' });
      expect(resPut.status).toBe(500);

      jest.spyOn(freshView, 'insertTableRecord').mockRejectedValueOnce(new Error('Insert failure'));
      const resPost = await request(app).post('/api/table/vendors').send({});
      expect(resPost.status).toBe(500);

      jest.spyOn(freshView, 'deleteTableRecord').mockRejectedValueOnce(new Error('Delete failure'));
      const resDel = await request(app).delete('/api/table/vendors/v-1');
      expect(resDel.status).toBe(500);

      jest.spyOn(freshView, 'getAllPostgresData').mockRejectedValueOnce(new Error('DB failure'));
      const resAll = await request(app).get('/api/all-data');
      expect(resAll.status).toBe(500);
    });
  });

  describe('updateTableRecord, insertTableRecord, deleteTableRecord helpers', () => {
    test('updateTableRecord throws on invalid inputs or unconfigured pool', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.updateTableRecord('vendors', 'v-1', { status: 'ACTIVE' })).rejects.toThrow('pool is not configured');

      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.updateTableRecord('invalid;name', 'v-1', { a: 1 })).rejects.toThrow('Invalid table name');
      await expect(freshView.updateTableRecord('vendors', null, { a: 1 })).rejects.toThrow('Record ID is required');
      await expect(freshView.updateTableRecord('vendors', 'v-1', {})).rejects.toThrow('No fields provided');
      await expect(freshView.updateTableRecord('vendors', 'v-1', { id: 'v-1' })).rejects.toThrow('No editable column fields');
    });

    test('updateTableRecord executes parameterized SQL update with JSON stringification', async () => {
      const mockQuery = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'UPDATED', raw: { name: 'New' } }] });
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const res = await freshView.updateTableRecord('vendors', 'v-1', { status: 'UPDATED', raw: { name: 'New' } });
      expect(res.id).toBe('v-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "vendors" SET "status" = $1, "raw" = $2 WHERE "id" = $3'),
        ['UPDATED', JSON.stringify({ name: 'New' }), 'v-1']
      );
    });

    test('updateTableRecord throws when record not found', async () => {
      const mockQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.updateTableRecord('vendors', 'v-999', { status: 'X' })).rejects.toThrow('not found');
    });

    test('insertTableRecord executes insert with values', async () => {
      const mockQuery = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'v-2', status: 'NEW' }] });
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const res = await freshView.insertTableRecord('vendors', { id: 'v-2', status: 'NEW', raw: { a: 1 } });
      expect(res.id).toBe('v-2');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "vendors"'),
        ['v-2', 'NEW', JSON.stringify({ a: 1 })]
      );
    });

    test('insertTableRecord handles validation errors', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.insertTableRecord('vendors', { id: '1' })).rejects.toThrow('pool is not configured');

      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.insertTableRecord('bad;table', { a: 1 })).rejects.toThrow('Invalid table name');
      await expect(freshView.insertTableRecord('vendors', {})).rejects.toThrow('No record data');
    });

    test('deleteTableRecord executes delete and throws if not found', async () => {
      const mockQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })
        .mockResolvedValueOnce({ rows: [] });
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: mockQuery }));
        freshView = require('../src/db/view');
      });

      const res = await freshView.deleteTableRecord('vendors', 'v-1');
      expect(res.id).toBe('v-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "vendors" WHERE "id" = $1'),
        ['v-1']
      );

      await expect(freshView.deleteTableRecord('vendors', 'v-999')).rejects.toThrow('not found');
    });

    test('deleteTableRecord validates pool and inputs', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: null, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.deleteTableRecord('vendors', '1')).rejects.toThrow('pool is not configured');

      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn() }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.deleteTableRecord('bad;table', '1')).rejects.toThrow('Invalid table name');
      await expect(freshView.deleteTableRecord('vendors', null)).rejects.toThrow('Record ID is required');
    });
  });

  describe('startViewerServer', () => {
    test('starts server with default port parameter and can be closed cleanly', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn(), checkDomainDBHealth: jest.fn() }));
        freshView = require('../src/db/view');
      });

      const fakeServer = new EventEmitter();
      fakeServer.address = () => ({ port: 5005 });
      fakeServer.close = (cb) => cb && cb();
      fakeServer.listen = jest.fn((port, cb) => {
        process.nextTick(() => cb && cb());
      });
      jest.spyOn(http, 'createServer').mockReturnValue(fakeServer);

      const serverHandle = await freshView.startViewerServer();
      expect(serverHandle.url).toBe('http://localhost:5005');
      await serverHandle.close();
    });

    test('handles EADDRINUSE by falling back to port 0', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn(), checkDomainDBHealth: jest.fn() }));
        freshView = require('../src/db/view');
      });

      const fakeServer = new EventEmitter();
      fakeServer.address = () => ({ port: 61234 });
      fakeServer.close = (cb) => cb && cb();

      let listenCallCount = 0;
      fakeServer.listen = jest.fn((port, cb) => {
        listenCallCount += 1;
        if (listenCallCount === 1) {
          const err = new Error('Port in use');
          err.code = 'EADDRINUSE';
          process.nextTick(() => fakeServer.emit('error', err));
        } else {
          process.nextTick(() => cb && cb());
        }
      });

      jest.spyOn(http, 'createServer').mockReturnValue(fakeServer);

      const serverHandle = await freshView.startViewerServer(5005);
      expect(serverHandle.url).toBe('http://localhost:61234');
      await serverHandle.close();
    });

    test('rejects on unexpected server errors', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: jest.fn(), checkDomainDBHealth: jest.fn() }));
        freshView = require('../src/db/view');
      });

      const fakeServer = new EventEmitter();
      fakeServer.listen = jest.fn(() => {
        const err = new Error('Permission denied');
        err.code = 'EACCES';
        process.nextTick(() => fakeServer.emit('error', err));
      });

      jest.spyOn(http, 'createServer').mockReturnValue(fakeServer);

      await expect(freshView.startViewerServer(80)).rejects.toThrow('Permission denied');
    });
  });

  describe('runCli', () => {
    test('exits 0 on test/cli mode with default options argument', async () => {
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
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      await freshView.runCli();

      expect(exitSpy).toHaveBeenCalledWith(0);
      process.exitCode = originalExitCode;
    });

    test('starts viewer server and logs banner when runCli is invoked in interactive mode', async () => {
      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({
          pool: {},
          query: jest.fn().mockResolvedValue({ rows: [] }),
          checkDomainDBHealth: jest.fn().mockResolvedValue({ providerLabel: 'Neon PostgreSQL', poolStatus: 'ACTIVE' }),
        }));
        freshView = require('../src/db/view');
      });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const mockServer = { url: 'http://localhost:5005', close: jest.fn() };
      jest.spyOn(freshView, 'startViewerServer').mockResolvedValue(mockServer);

      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        await freshView.runCli({ once: false });
        expect(freshView.startViewerServer).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Neon PostgreSQL Database Viewer'));
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
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

      await freshView.runCli({ once: true });

      expect(errorSpy).toHaveBeenCalledWith('[db:view] Failed:', 'ECONNREFUSED');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('exercises getPrimaryKeyColumn branch variations', () => {
      let freshView;
      jest.isolateModules(() => {
        freshView = require('../src/db/view');
      });

      expect(freshView.getPrimaryKeyColumn('role')).toBe('uuid');
      expect(freshView.getPrimaryKeyColumn('auth_otp_codes')).toBe('otp_key');
      expect(freshView.getPrimaryKeyColumn('auth_revoked_tokens')).toBe('signature');
      expect(freshView.getPrimaryKeyColumn('custom_table')).toBe('id');

      expect(freshView.getPrimaryKeyColumn('custom_table', { id: 1 })).toBe('id');
      expect(freshView.getPrimaryKeyColumn('custom_table', { uuid: 'u1' })).toBe('uuid');
      expect(freshView.getPrimaryKeyColumn('custom_table', { otp_key: 'k1' })).toBe('otp_key');
      expect(freshView.getPrimaryKeyColumn('custom_table', { signature: 's1' })).toBe('signature');
      expect(freshView.getPrimaryKeyColumn('custom_table', { other_col: 'val' })).toBe('id');
    });

    test('exercises insertTableRecord edge cases with invalid column keys and object serialization', async () => {
      let freshView;
      const queryMock = jest.fn().mockResolvedValue({ rows: [{ id: 1, payload: { a: 1 } }] });
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, query: queryMock }));
        freshView = require('../src/db/view');
      });

      await expect(freshView.insertTableRecord('vendors', { 'invalid-col-name!': 'test' })).rejects.toThrow(
        'No valid columns provided'
      );

      const res = await freshView.insertTableRecord('vendors', { name: 'Acme', payload: { a: 1 }, extra_null: null });
      expect(res).toEqual({ id: 1, payload: { a: 1 } });
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "vendors"'),
        ['Acme', '{"a":1}', null]
      );
    });

    test('exercises view() fallback branches when checkDatabaseHealth is available or health fields are null', async () => {
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const checkDatabaseHealthMock = jest.fn().mockResolvedValue({ providerLabel: null, poolStatus: null });

      let freshView;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({
          pool: {},
          query: queryMock,
          checkDatabaseHealth: checkDatabaseHealthMock,
        }));
        freshView = require('../src/db/view');
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await freshView.view();

      expect(checkDatabaseHealthMock).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Connected to Database (ACTIVE)'));
    });
  });
});
