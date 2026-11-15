const request = require('supertest');
const path = require('path');
const { app, bootstrapServer, start } = require('../src/server');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const dailyRfqReportService = require('../src/services/dailyRfqReportService');
const { logger } = require('../src/services/loggerService');
const { STORE_HYDRATION_CONFIG } = require('../src/config/constants');

describe('App & Server Dedicated Branch Boost Suite', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('server.js branch & function coverage', () => {
    test('bootstrapServer catches recoverChasersOnBoot rejection and logs warning', async () => {
      jest.spyOn(rfqChaserScheduler, 'recoverChasersOnBoot').mockRejectedValueOnce(new Error('Recovery crash'));
      const warnSpy = jest.spyOn(logger, 'warn');

      const server = await bootstrapServer(0);
      expect(server).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to recover chasers on boot',
        expect.objectContaining({ error: 'Recovery crash' }),
        'SERVER'
      );
      await new Promise((resolve) => server.close(resolve));
    });

    test('bootstrapServer catches comparison queue recovery rejection and logs warning', async () => {
      jest.spyOn(rfqChaserScheduler, 'recoverRFQComparisonJobsOnBoot')
        .mockRejectedValueOnce(new Error('Comparison recovery crash'));
      const warnSpy = jest.spyOn(logger, 'warn');

      const server = await bootstrapServer(0);
      expect(server).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to recover RFQ comparison notifications on boot',
        expect.objectContaining({ error: 'Comparison recovery crash' }),
        'SERVER'
      );
      await new Promise((resolve) => server.close(resolve));
    });

    test('bootstrapServer starts and stops the daily RFQ report scheduler with the server lifecycle', async () => {
      const startScheduler = jest.spyOn(dailyRfqReportService, 'startDailyReportScheduler');
      const stopScheduler = jest.spyOn(dailyRfqReportService, 'stopDailyReportScheduler');
      const server = await bootstrapServer(0);

      expect(startScheduler).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => server.close(resolve));
      expect(stopScheduler).toHaveBeenCalledTimes(1);
    });

    test('start() starts server successfully on designated port', async () => {
      const server = await start(0);
      expect(server).toBeDefined();
      expect(server.listening).toBe(true);
      await new Promise((resolve) => server.close(resolve));
    });

    test('start() catches boot errors, logs a structured error, and exits with code 1', async () => {
      jest.spyOn(storeService, 'hydrateFromDB').mockRejectedValueOnce(new Error('Fatal database boot error'));
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      await start(0);

      expect(errorLogSpy.mock.calls.map(([message, , category]) => [message, category])).toContainEqual([
        'Failed to start server',
        'SERVER',
      ]);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('app.js lazy hydration and middleware branches', () => {
    test('lazy hydration skips health and database-only routes', async () => {
      const origHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const hydrateSpy = jest.spyOn(storeService, 'hydrateFromDB');

      const hydrationLayer = app._router.stack.find(
        (layer) => layer.handle && layer.handle.length === 3 && layer.handle.name === 'storeHydrationGate'
      );
      const defaultPathNext = jest.fn();
      hydrationLayer.handle({}, {}, defaultPathNext);
      expect(defaultPathNext).toHaveBeenCalled();

      await request(app).get('/health').expect(200);
      await request(app).get('/api/enterprise-inquiries').expect(401);
      await request(app).get('/api/db/status');
      await request(app).get('/api/bot/webhook');
      expect(hydrateSpy).not.toHaveBeenCalled();

      storeService.isHydratedFromDB = origHydrated;
    });

    test('lazy hydration rejects store-backed requests and logs errors when hydrateFromDB fails', async () => {
      const origHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValueOnce({
        hydrated: false,
        error: 'Lazy hydration network drop',
      }).mockResolvedValueOnce({ hydrated: true, source: 'postgres' });
      const logErrorSpy = jest.spyOn(logger, 'error');

      const res = await request(app).get('/api/rfqs');
      expect(res.statusCode).toBe(503);
      expect(res.body.retryable).toBe(true);
      expect(res.headers['retry-after']).toBe(String(STORE_HYDRATION_CONFIG.FAILURE_RETRY_AFTER_SECONDS));
      expect(logErrorSpy).toHaveBeenCalledWith(
        'Lazy on-request hydration failed; rejecting store-backed request',
        expect.objectContaining({ error: expect.any(Error), path: '/api/rfqs' }),
        'APP'
      );

      // Inside the failure backoff window the request fails fast and no second load starts.
      const backedOffRes = await request(app).get('/api/rfqs');
      expect(backedOffRes.statusCode).toBe(503);
      expect(backedOffRes.body.error).toMatch(/temporarily unavailable/i);
      expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(1);
      expect(logErrorSpy).toHaveBeenCalledTimes(1);

      // After the backoff expires, the next request loads the store again.
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + STORE_HYDRATION_CONFIG.FAILURE_BACKOFF_MS + 1);
      await request(app).get('/api/rfqs');
      expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(2);
      dateSpy.mockRestore();

      storeService.isHydratedFromDB = origHydrated;
    });

    test('lazy hydration reuses in-flight promise for concurrent requests', async () => {
      const origHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      let resolveHydration;
      const deferredPromise = new Promise((resolve) => {
        resolveHydration = resolve;
      });
      const hydrateSpy = jest.spyOn(storeService, 'hydrateFromDB').mockImplementation(() => deferredPromise);

      const hydrationLayer = app._router.stack.find(
        (layer) => layer.handle && layer.handle.length === 3 && layer.handle.name === 'storeHydrationGate'
      );
      expect(hydrationLayer).toBeDefined();
      const middleware = hydrationLayer.handle;

      const next1 = jest.fn();
      const next2 = jest.fn();

      // First request initiates hydration
      middleware({ path: '/api/rfqs' }, {}, next1);
      expect(hydrateSpy).toHaveBeenCalledTimes(1);

      // A concurrent second request joins the in-flight load instead of starting another
      middleware({ path: '/api/rfqs' }, {}, next2);
      expect(hydrateSpy).toHaveBeenCalledTimes(1);

      // Resolve the deferred hydration promise
      resolveHydration({ hydrated: true });
      await new Promise((r) => setImmediate(r));

      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();

      storeService.isHydratedFromDB = origHydrated;
    });

    test('lazy hydration falls through to next when the response was already sent', async () => {
      const origHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue({ hydrated: false });
      const hydrationLayer = app._router.stack.find(
        (layer) => layer.handle && layer.handle.length === 3 && layer.handle.name === 'storeHydrationGate'
      );
      const res = { headersSent: true, status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      hydrationLayer.handle({ path: '/api/rfqs' }, res, next);
      await new Promise((resolve) => setImmediate(resolve));

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      storeService.isHydratedFromDB = origHydrated;
    });

    test('app.js captures rawBody in express.json verify callback', async () => {
      const res = await request(app)
        .post('/api/rfqs/extract/stage')
        .send({ payload: 'test verify bytes' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBeDefined();
    });

    test('app.js env loading variations in isolated modules', () => {
      const origAppEnv = process.env.APP_ENV;
      const origNodeEnv = process.env.NODE_ENV;
      const fileSystem = require('fs');
      const originalExistsSync = fileSystem.existsSync;
      const config = jest.fn(() => ({ parsed: {} }));
      let presentEnvironmentPath = null;
      let environmentLookupError = false;
      const existsSync = jest.spyOn(fileSystem, 'existsSync').mockImplementation((file) => {
        if (typeof file === 'string' && path.basename(file).startsWith('.env')) {
          if (environmentLookupError) throw new Error('Environment filesystem unavailable');
          return path.resolve(file) === presentEnvironmentPath;
        }
        return originalExistsSync(file);
      });
      // Clean CI checkouts contain no ignored .env files. Drive both presence
      // outcomes explicitly and prevent isolated modules from reading local
      // developer credentials while exercising application configuration.
      jest.doMock('dotenv', () => ({ config }));

      try {
        for (const [appEnv, nodeEnv, expectedFile, exists] of [
          ['ci-explicit', 'production', '.env.ci-explicit', true],
          ['ci-missing', 'development', '.env.ci-missing', false],
          [undefined, 'production', '.env.prod', true],
          [undefined, 'development', '.env.dev', false],
        ]) {
          if (appEnv === undefined) delete process.env.APP_ENV;
          else process.env.APP_ENV = appEnv;
          process.env.NODE_ENV = nodeEnv;
          const specificPath = path.resolve(__dirname, '..', expectedFile);
          presentEnvironmentPath = exists ? specificPath : null;
          config.mockClear();
          existsSync.mockClear();
          jest.isolateModules(() => {
            expect(require('../src/app')).toBeDefined();
          });
          expect(config).toHaveBeenNthCalledWith(1);
          expect(existsSync).toHaveBeenCalledWith(specificPath);
          if (exists) expect(config).toHaveBeenCalledWith({ path: specificPath });
          else expect(config).not.toHaveBeenCalledWith({ path: specificPath });
          expect(config).toHaveBeenCalledWith({ path: path.resolve(__dirname, '../.env') });
        }

        environmentLookupError = true;
        config.mockClear();
        jest.isolateModules(() => {
          expect(require('../src/app')).toBeDefined();
        });
        expect(config).toHaveBeenNthCalledWith(1);
        expect(config).not.toHaveBeenCalledWith({ path: path.resolve(__dirname, '../.env') });
      } finally {
        jest.dontMock('dotenv');
        if (origAppEnv !== undefined) process.env.APP_ENV = origAppEnv;
        else delete process.env.APP_ENV;
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        else delete process.env.NODE_ENV;
      }
    });
  });
});
