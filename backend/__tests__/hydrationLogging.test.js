const app = require('../src/app');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');

describe('store hydration failure logging', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('includes the request correlation ID and method in the structured error', async () => {
    const originalHydratedState = storeService.isHydratedFromDB;
    storeService.isHydratedFromDB = false;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue({
      hydrated: false,
      error: 'Database temporarily unavailable',
    });
    const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const hydrationLayer = app._router.stack.find(
      (layer) => layer.handle && layer.handle.length === 3 && layer.handle.name === 'storeHydrationGate'
    );
    const response = {
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    hydrationLayer.handle({
      method: 'GET',
      path: '/api/rfqs',
      requestId: 'req-hydration-42',
    }, response, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorLogSpy).toHaveBeenCalledWith(
      'Lazy on-request hydration failed; rejecting store-backed request',
      expect.objectContaining({
        requestId: 'req-hydration-42',
        method: 'GET',
        path: '/api/rfqs',
      }),
      'APP'
    );
    expect(response.status).toHaveBeenCalledWith(503);
    storeService.isHydratedFromDB = originalHydratedState;
  });
});
