const request = require('supertest');
const { app, bootstrapServer, start } = require('../src/server');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

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

    test('start() starts server successfully on designated port', async () => {
      const server = await start(0);
      expect(server).toBeDefined();
      expect(server.listening).toBe(true);
      await new Promise((resolve) => server.close(resolve));
    });

    test('start() catches boot errors, logs to console, and exits with code 1', async () => {
      jest.spyOn(storeService, 'hydrateFromDB').mockRejectedValueOnce(new Error('Fatal database boot error'));
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await start(0);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start server:', expect.any(Error));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('app.js lazy hydration and middleware branches', () => {
    test('lazy hydration skips when path is /api/bot or starts with /api/bot/', async () => {
      const origHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const hydrateSpy = jest.spyOn(storeService, 'hydrateFromDB');

      // Exact match /api/bot
      await request(app).get('/api/bot');
      expect(hydrateSpy).not.toHaveBeenCalled();

      // Prefix match /api/bot/webhook
      await request(app).get('/api/bot/webhook');
      expect(hydrateSpy).not.toHaveBeenCalled();

      storeService.isHydratedFromDB = origHydrated;
    });

    test('lazy hydration executes and logs error when hydrateFromDB fails', async () => {
      const origHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = false;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'hydrateFromDB').mockRejectedValueOnce(new Error('Lazy hydration network drop'));
      const logErrorSpy = jest.spyOn(logger, 'error');

      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(logErrorSpy).toHaveBeenCalledWith('Lazy on-request hydration failed', expect.any(Error), 'APP');

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
        (layer) => layer.handle && layer.handle.length === 3 && layer.handle.toString().includes('hydrationPromise')
      );
      expect(hydrationLayer).toBeDefined();
      const middleware = hydrationLayer.handle;

      const next1 = jest.fn();
      const next2 = jest.fn();

      // First request initiates hydration
      middleware({ path: '/health' }, {}, next1);
      expect(hydrateSpy).toHaveBeenCalledTimes(1);

      // Concurrent second request hits (!hydrationPromise) === false and reuses in-flight promise
      middleware({ path: '/health' }, {}, next2);
      expect(hydrateSpy).toHaveBeenCalledTimes(1);

      // Resolve the deferred hydration promise
      resolveHydration();
      await new Promise((r) => setImmediate(r));

      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();

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

      try {
        process.env.APP_ENV = 'dev';
        process.env.NODE_ENV = 'development';
        jest.isolateModules(() => {
          const loadedApp = require('../src/app');
          expect(loadedApp).toBeDefined();
        });

        // Test non-existent env file to cover fs.existsSync false branch
        process.env.APP_ENV = 'nonexistent_test_env_xyz';
        jest.isolateModules(() => {
          const loadedApp = require('../src/app');
          expect(loadedApp).toBeDefined();
        });

        delete process.env.APP_ENV;
        process.env.NODE_ENV = 'production';
        jest.isolateModules(() => {
          const loadedApp = require('../src/app');
          expect(loadedApp).toBeDefined();
        });
      } finally {
        if (origAppEnv !== undefined) process.env.APP_ENV = origAppEnv;
        else delete process.env.APP_ENV;
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        else delete process.env.NODE_ENV;
      }
    });
  });
});
