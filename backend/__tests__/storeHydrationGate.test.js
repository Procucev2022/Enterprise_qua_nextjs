const { createStoreHydrationGate, isLogIngestionRequest } = require('../src/middleware/storeHydrationGate');
const { D1_OVERLOAD_CONFIG, STORE_HYDRATION_CONFIG } = require('../src/config/constants');

function makeResponse() {
  const res = {
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeRequest(overrides = {}) {
  return { method: 'GET', path: '/api/rfqs', requestId: 'req-1', ...overrides };
}

function makeStore({ hydrated = false, load } = {}) {
  return {
    isHydratedFromDB: hydrated,
    hydrateFromDB: jest.fn(load || (() => Promise.resolve({ hydrated: true, source: 'postgres' }))),
  };
}

function buildGate(overrides = {}) {
  const deps = {
    storeService: makeStore(),
    hasStorage: () => true,
    isOverloaded: () => false,
    shouldSkipPath: () => false,
    logger: { error: jest.fn() },
    now: () => 1000,
    ...overrides,
  };
  return { gate: createStoreHydrationGate(deps), deps };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('isLogIngestionRequest', () => {
  test('matches POST to the authenticated and anonymous log ingestion routes', () => {
    expect(isLogIngestionRequest({ method: 'POST', path: '/api/logs' })).toBe(true);
    expect(isLogIngestionRequest({ method: 'POST', path: '/api/logs/client-error' })).toBe(true);
    expect(isLogIngestionRequest({ method: 'POST', path: '/api/logs/' })).toBe(true);
  });

  test('does not match reads or admin remediation routes that may use the store', () => {
    expect(isLogIngestionRequest({ method: 'GET', path: '/api/logs' })).toBe(false);
    expect(isLogIngestionRequest({ method: 'POST', path: '/api/logs/auto-resolve' })).toBe(false);
    expect(isLogIngestionRequest({ method: 'POST', path: '/api/logs/performance/optimize' })).toBe(false);
    expect(isLogIngestionRequest({ method: 'POST', path: '/api/rfqs' })).toBe(false);
  });

  test('treats a request without a path as a non-ingestion route', () => {
    expect(isLogIngestionRequest({ method: 'POST' })).toBe(false);
  });
});

describe('createStoreHydrationGate', () => {
  test('passes requests straight through when the store is already hydrated', () => {
    const { gate, deps } = buildGate({ storeService: makeStore({ hydrated: true }) });
    const next = jest.fn();
    gate(makeRequest(), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(deps.storeService.hydrateFromDB).not.toHaveBeenCalled();
  });

  test('passes requests through when no database is configured', () => {
    const { gate, deps } = buildGate({ hasStorage: () => false });
    const next = jest.fn();
    gate(makeRequest(), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(deps.storeService.hydrateFromDB).not.toHaveBeenCalled();
  });

  test('passes requests through for paths that never need the store', () => {
    const { gate, deps } = buildGate({ shouldSkipPath: () => true });
    const next = jest.fn();
    gate(makeRequest({ path: '/api/db/status' }), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(deps.storeService.hydrateFromDB).not.toHaveBeenCalled();
  });

  test('never makes frontend log ingestion wait for the store', () => {
    const { gate, deps } = buildGate();
    const next = jest.fn();
    gate(makeRequest({ method: 'POST', path: '/api/logs' }), makeResponse(), next);
    gate(makeRequest({ method: 'POST', path: '/api/logs/client-error' }), makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(deps.storeService.hydrateFromDB).not.toHaveBeenCalled();
  });

  test('still loads the store for other log routes', async () => {
    const { gate, deps } = buildGate();
    const next = jest.fn();
    gate(makeRequest({ method: 'GET', path: '/api/logs' }), makeResponse(), next);
    await flushPromises();
    expect(deps.storeService.hydrateFromDB).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('shares one load between concurrent requests', async () => {
    const { gate, deps } = buildGate();
    const first = jest.fn();
    const second = jest.fn();
    gate(makeRequest(), makeResponse(), first);
    gate(makeRequest({ path: '/api/bootstrap' }), makeResponse(), second);
    await flushPromises();
    expect(deps.storeService.hydrateFromDB).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('uses Date.now for backoff timing when no clock is injected', async () => {
    const storeService = makeStore({
      load: () => Promise.reject(new Error('timeout')),
    });
    const gate = createStoreHydrationGate({
      storeService,
      hasStorage: () => true,
      isOverloaded: () => false,
      shouldSkipPath: () => false,
      logger: { error: jest.fn() },
    });
    const res = makeResponse();
    gate(makeRequest(), res, jest.fn());
    await flushPromises();
    gate(makeRequest(), makeResponse(), jest.fn());
    expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(1);
  });

  test('rejects with a retryable 503 and Retry-After while D1 is overloaded', () => {
    const { gate, deps } = buildGate({ isOverloaded: () => true });
    const res = makeResponse();
    const next = jest.fn();
    gate(makeRequest(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(deps.storeService.hydrateFromDB).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', String(D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS));
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      retryable: true,
      error: D1_OVERLOAD_CONFIG.MESSAGE,
    });
  });

  test('joins a load that is already in flight even while D1 reports overload', async () => {
    let finish;
    const storeService = makeStore({
      load: () => new Promise((resolve) => { finish = resolve; }),
    });
    let overloaded = false;
    const { gate } = buildGate({ storeService, isOverloaded: () => overloaded });
    const first = jest.fn();
    const second = jest.fn();
    gate(makeRequest(), makeResponse(), first);
    overloaded = true;
    gate(makeRequest({ path: '/api/bootstrap' }), makeResponse(), second);
    finish({ hydrated: true, source: 'postgres' });
    await flushPromises();
    expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('turns a failed load into a 503 and backs off before loading again', async () => {
    let clock = 1000;
    const storeService = makeStore({
      load: () => Promise.reject(new Error('D1 read timed out')),
    });
    const logger = { error: jest.fn() };
    const { gate } = buildGate({ storeService, logger, now: () => clock });

    const failedRes = makeResponse();
    gate(makeRequest({ id: 'fallback-id', requestId: undefined }), failedRes, jest.fn());
    await flushPromises();
    expect(failedRes.setHeader).toHaveBeenCalledWith('Retry-After', String(STORE_HYDRATION_CONFIG.FAILURE_RETRY_AFTER_SECONDS));
    expect(failedRes.status).toHaveBeenCalledWith(503);
    expect(failedRes.json).toHaveBeenCalledWith({
      success: false,
      retryable: true,
      error: STORE_HYDRATION_CONFIG.UNAVAILABLE_MESSAGE,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Lazy on-request hydration failed; rejecting store-backed request',
      expect.objectContaining({ requestId: 'fallback-id', method: 'GET', path: '/api/rfqs' }),
      'APP'
    );

    const backedOffRes = makeResponse();
    const backedOffNext = jest.fn();
    gate(makeRequest(), backedOffRes, backedOffNext);
    expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(1);
    expect(backedOffNext).not.toHaveBeenCalled();
    expect(backedOffRes.status).toHaveBeenCalledWith(503);

    clock += STORE_HYDRATION_CONFIG.FAILURE_BACKOFF_MS + 1;
    gate(makeRequest(), makeResponse(), jest.fn());
    expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(2);
  });

  test('records a null request id when the failing request carries none', async () => {
    const logger = { error: jest.fn() };
    const storeService = makeStore({ load: () => Promise.reject(new Error('boom')) });
    const { gate } = buildGate({ storeService, logger });
    gate(makeRequest({ requestId: undefined, id: undefined }), makeResponse(), jest.fn());
    await flushPromises();
    expect(logger.error.mock.calls[0][1]).toEqual(expect.objectContaining({ requestId: null }));
  });

  test('treats a load that reports it did not hydrate as a failure', async () => {
    const logger = { error: jest.fn() };
    const storeService = makeStore({
      load: () => Promise.resolve({ hydrated: false, source: 'unavailable', error: 'pool offline' }),
    });
    const { gate } = buildGate({ storeService, logger });
    const res = makeResponse();
    gate(makeRequest(), res, jest.fn());
    await flushPromises();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(logger.error.mock.calls[0][1].error.message).toBe('pool offline');
  });

  test('uses the generic unavailable message when a non-hydrated load gives no reason', async () => {
    const logger = { error: jest.fn() };
    const storeService = makeStore({ load: () => Promise.resolve({ hydrated: false }) });
    const { gate } = buildGate({ storeService, logger });
    gate(makeRequest(), makeResponse(), jest.fn());
    await flushPromises();
    expect(logger.error.mock.calls[0][1].error.message).toBe(STORE_HYDRATION_CONFIG.UNAVAILABLE_MESSAGE);
  });

  test('a successful load clears an earlier failure backoff', async () => {
    let clock = 1000;
    let failing = true;
    const storeService = makeStore({
      load: () => (failing ? Promise.reject(new Error('timeout')) : Promise.resolve({ hydrated: true })),
    });
    const { gate } = buildGate({ storeService, now: () => clock });

    gate(makeRequest(), makeResponse(), jest.fn());
    await flushPromises();

    failing = false;
    clock += STORE_HYDRATION_CONFIG.FAILURE_BACKOFF_MS + 1;
    const recovered = jest.fn();
    gate(makeRequest(), makeResponse(), recovered);
    await flushPromises();
    expect(recovered).toHaveBeenCalledTimes(1);

    // Even a clock that reads before the old backoff end must not block the healthy store.
    clock = 1000;
    const afterRecovery = jest.fn();
    gate(makeRequest(), makeResponse(), afterRecovery);
    await flushPromises();
    expect(afterRecovery).toHaveBeenCalledTimes(1);
    expect(storeService.hydrateFromDB).toHaveBeenCalledTimes(3);
  });

  test('lets the request continue when a failed load finds the response already started', async () => {
    const storeService = makeStore({ load: () => Promise.reject(new Error('boom')) });
    const { gate } = buildGate({ storeService });
    const res = makeResponse();
    res.headersSent = true;
    const next = jest.fn();
    gate(makeRequest(), res, next);
    await flushPromises();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
