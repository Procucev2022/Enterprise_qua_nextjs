import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

let bindings;
let app;
let emailGateway;
let reconciliation;
let chasers;
let eventOutbox;
let dailyReport;
let store;
let loggerService;
let originalFetch;
let waitUntil;
let createHandler;
const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  bindings = { WORKER_TEST_SETTING: 'bound', WORKER_TEST_NUMBER: 42, WORKER_TEST_OBJECT: {} };
  app = { listen: jest.fn() };
  emailGateway = { pollBothInboxesOnce: jest.fn().mockResolvedValue({}) };
  reconciliation = { reconcileOnce: jest.fn().mockResolvedValue({}) };
  chasers = {
    dispatchDueChaserJobs: jest.fn().mockResolvedValue([]),
    dispatchDueRFQComparisonJobs: jest.fn().mockResolvedValue([]),
  };
  eventOutbox = {
    dispatchDueEventOutboxJobs: jest.fn().mockResolvedValue([]),
    dispatchScheduledEventOutboxJobs: jest.fn().mockResolvedValue([]),
    purgeExpiredEventOutboxRows: jest.fn().mockResolvedValue([]),
  };
  dailyReport = { runScheduledDailyRfqReport: jest.fn().mockResolvedValue({ triggered: true }) };
  store = {
    isHydratedFromDB: false,
    hydrateFromDB: jest.fn().mockResolvedValue(undefined),
    closeExpiredRFQsDurably: jest.fn().mockResolvedValue([]),
  };
  loggerService = { error: jest.fn() };
  originalFetch = jest.fn().mockResolvedValue('response');
  waitUntil = jest.fn();
  createHandler = jest.fn(() => ({ fetch: originalFetch }));
  jest.unstable_mockModule('cloudflare:node', () => ({ httpServerHandler: createHandler }), { virtual: true });
  jest.unstable_mockModule('cloudflare:workers', () => ({ env: bindings, waitUntil }), { virtual: true });
  jest.unstable_mockModule('../src/app.js', () => ({ default: app }));
  jest.unstable_mockModule('../src/services/emailGatewayService.js', () => ({ default: emailGateway }));
  jest.unstable_mockModule('../src/services/zohoReconciliationService.js', () => ({ default: reconciliation }));
  jest.unstable_mockModule('../src/services/rfqChaserScheduler.js', () => ({ default: chasers }));
  jest.unstable_mockModule('../src/services/eventOutboxService.js', () => ({ default: eventOutbox }));
  jest.unstable_mockModule('../src/services/dailyRfqReportService.js', () => ({ default: dailyReport }));
  jest.unstable_mockModule('../src/services/storeService.js', () => ({ default: store }));
  jest.unstable_mockModule('../src/services/loggerService.js', () => ({ logger: loggerService }));
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  delete globalThis.__CF_ENV__;
  delete globalThis.__CF_WAIT_UNTIL__;
  jest.restoreAllMocks();
});

const loadWorker = async () => (await import('../src/worker.mjs')).default;

describe('Worker runtime bindings and fetch bridge', () => {
  test('sets bindings before loading the app and preserves existing configuration', async () => {
    process.env.WORKER_TEST_SETTING = 'existing';
    process.env.WORKER_TEST_NUMBER = '';
    const worker = await loadWorker();
    expect(globalThis.__CF_ENV__).toBe(bindings);
    expect(globalThis.__CF_WAIT_UNTIL__).toBe(waitUntil);
    expect(process.env.WORKER_TEST_SETTING).toBe('existing');
    expect(process.env.WORKER_TEST_NUMBER).toBe('42');
    expect(process.env.WORKER_TEST_OBJECT).toBeUndefined();
    expect(app.listen).toHaveBeenCalledWith(4000);
    expect(createHandler).toHaveBeenCalledWith({ port: 4000 });
    const request = { url: 'https://example.test' };
    const context = {};
    const nextBindings = { WORKER_TEST_SETTING: 'next', WORKER_TEST_NUMBER: 9 };
    expect(await worker.fetch(request, nextBindings, context)).toBe('response');
    expect(originalFetch).toHaveBeenCalledWith(request, nextBindings, context);
    expect(originalFetch.mock.contexts[0]).toBe(worker);
    expect(process.env.WORKER_TEST_SETTING).toBe('next');
    expect(process.env.WORKER_TEST_NUMBER).toBe('42');
    expect(globalThis.__CF_ENV__).toBe(nextBindings);
  });

  test.each([null, 'not-an-object'])('accepts missing bindings %p', async (value) => {
    bindings = value;
    const worker = await loadWorker();
    await worker.fetch({}, value, {});
    expect(originalFetch).toHaveBeenCalled();
  });

  test('logs module and fetch binding-enumeration failures while continuing to serve requests', async () => {
    const bindingError = new Error('unavailable');
    bindings = new Proxy({}, { ownKeys() { throw bindingError; } });
    const worker = await loadWorker();
    expect(await worker.fetch({}, bindings, {})).toBe('response');
    expect(loggerService.error).toHaveBeenNthCalledWith(
      1,
      'Failed to synchronize Cloudflare Worker bindings into process.env',
      { operation: 'worker_module_initialization', error: bindingError },
      'WORKER_ENV'
    );
    expect(loggerService.error).toHaveBeenNthCalledWith(
      2,
      'Failed to synchronize Cloudflare Worker bindings into process.env',
      { operation: 'worker_fetch', error: bindingError },
      'WORKER_ENV'
    );
  });

  test('records non-Error binding failures without exposing the rejected value', async () => {
    bindings = new Proxy({}, { ownKeys() { throw 'binding rejected'; } });
    await loadWorker();
    expect(loggerService.error).toHaveBeenCalledWith(
      'Failed to synchronize Cloudflare Worker bindings into process.env',
      expect.objectContaining({
        operation: 'worker_module_initialization',
        error: expect.any(Error),
        errorType: 'string',
      }),
      'WORKER_ENV'
    );
  });

  test('writes a safe structured fallback when the centralized logger fails', async () => {
    const bindingError = new Error('binding unavailable');
    bindings = new Proxy({}, { ownKeys() { throw bindingError; } });
    loggerService.error.mockImplementation(() => { throw new Error('logger unavailable'); });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await loadWorker();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleError.mock.calls[0][0])).toMatchObject({
      level: 'ERROR',
      category: 'WORKER_ENV',
      operation: 'worker_module_initialization',
      errorName: 'Error',
      loggerErrorName: 'Error',
    });
  });

  test('uses stdout fallbacks when the centralized logger is unavailable', async () => {
    bindings = new Proxy({}, { ownKeys() { throw 'binding unavailable'; } });
    loggerService = undefined;
    store.hydrateFromDB.mockRejectedValue(new Error('hydration unavailable'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const worker = await loadWorker();
    await worker.scheduled({ cron: '* * * * *' }, {}, {});

    expect(JSON.parse(consoleError.mock.calls[0][0])).toMatchObject({
      level: 'ERROR',
      category: 'WORKER_ENV',
      operation: 'worker_module_initialization',
      errorName: 'string',
    });
    expect(consoleError).toHaveBeenCalledWith('[CRON] hydration failed', expect.any(Error));
  });

  test('uses safe fallback metadata when both the binding and logger reject with non-Error values', async () => {
    bindings = new Proxy({}, { ownKeys() { throw 'binding unavailable'; } });
    loggerService.error.mockImplementation(() => { throw 'logger unavailable'; });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await loadWorker();

    expect(JSON.parse(consoleError.mock.calls[0][0])).toMatchObject({
      level: 'ERROR',
      category: 'WORKER_ENV',
      operation: 'worker_module_initialization',
      errorName: 'string',
      loggerErrorName: 'string',
    });
  });

  test('supports namespace exports for CommonJS interop', async () => {
    jest.unstable_mockModule('../src/app.js', () => app);
    jest.unstable_mockModule('../src/services/emailGatewayService.js', () => emailGateway);
    jest.unstable_mockModule('../src/services/zohoReconciliationService.js', () => reconciliation);
    jest.unstable_mockModule('../src/services/rfqChaserScheduler.js', () => chasers);
    jest.unstable_mockModule('../src/services/eventOutboxService.js', () => eventOutbox);
    jest.unstable_mockModule('../src/services/dailyRfqReportService.js', () => dailyReport);
    const worker = await loadWorker();
    await worker.scheduled({ cron: '* * * * *' }, {}, {});
    expect(app.listen).toHaveBeenCalled();
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalled();
  });
});

describe('Worker cron jobs', () => {
  test('hydrates once before polling mailboxes and dispatching due chasers', async () => {
    const worker = await loadWorker();
    const runtimeBindings = { WORKER_TEST_SETTING: 'cron', WORKER_TEST_NUMBER: 9 };
    await worker.scheduled({ cron: '* * * * *' }, runtimeBindings, {});
    expect(store.hydrateFromDB).toHaveBeenCalledTimes(1);
    expect(store.hydrateFromDB.mock.invocationCallOrder[0]).toBeLessThan(emailGateway.pollBothInboxesOnce.mock.invocationCallOrder[0]);
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalledTimes(1);
    expect(chasers.dispatchDueChaserJobs).toHaveBeenCalledTimes(1);
    expect(chasers.dispatchDueRFQComparisonJobs).toHaveBeenCalledTimes(1);
    expect(store.closeExpiredRFQsDurably).toHaveBeenCalledTimes(1);
    expect(reconciliation.reconcileOnce).not.toHaveBeenCalled();
    expect(process.env.WORKER_TEST_SETTING).toBe('cron');
    expect(globalThis.__CF_ENV__).toBe(runtimeBindings);
  });

  test('runs only payment reconciliation for the reconciliation trigger', async () => {
    store.isHydratedFromDB = true;
    const worker = await loadWorker();
    await worker.scheduled({ cron: '*/10 * * * *' }, null, {});
    expect(store.hydrateFromDB).not.toHaveBeenCalled();
    expect(reconciliation.reconcileOnce).toHaveBeenCalledTimes(1);
    expect(emailGateway.pollBothInboxesOnce).not.toHaveBeenCalled();
    expect(store.closeExpiredRFQsDurably).not.toHaveBeenCalled();
  });

  test('runs only the daily report for the daily report trigger', async () => {
    store.isHydratedFromDB = true;
    const worker = await loadWorker();
    const scheduledTime = new Date('2026-11-04T00:30:00.000Z');
    await worker.scheduled({ cron: '30 0 * * *', scheduledTime: scheduledTime.getTime() }, {}, {});
    expect(dailyReport.runScheduledDailyRfqReport).toHaveBeenCalledWith(scheduledTime);
    expect(dailyReport.runScheduledDailyRfqReport).toHaveBeenCalledTimes(1);
    expect(emailGateway.pollBothInboxesOnce).not.toHaveBeenCalled();
    expect(reconciliation.reconcileOnce).not.toHaveBeenCalled();
  });

  test('runs all jobs for an unrecognized trigger and reports rejected jobs', async () => {
    const worker = await loadWorker();
    await worker.scheduled({ cron: 'custom' }, {}, {});
    expect(reconciliation.reconcileOnce).toHaveBeenCalledTimes(1);
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalledTimes(1);
    expect(chasers.dispatchDueChaserJobs).toHaveBeenCalledTimes(1);
    expect(chasers.dispatchDueRFQComparisonJobs).toHaveBeenCalledTimes(1);
    reconciliation.reconcileOnce.mockRejectedValue(new Error('payment failure'));
    await expect(worker.scheduled({ cron: 'custom' }, {}, {})).rejects.toThrow('payment failure');
  });

  test('runs the cron jobs one at a time, so their database queries never overlap', async () => {
    const worker = await loadWorker();
    let active = 0;
    let maxActive = 0;
    const job = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return [];
    };
    eventOutbox.dispatchScheduledEventOutboxJobs.mockImplementation(job);
    chasers.dispatchDueChaserJobs.mockImplementation(job);
    chasers.dispatchDueRFQComparisonJobs.mockImplementation(job);
    store.closeExpiredRFQsDurably.mockImplementation(job);
    emailGateway.pollBothInboxesOnce.mockImplementation(job);

    await worker.scheduled({ cron: '* * * * *' }, {}, {});

    expect(maxActive).toBe(1);
    expect(eventOutbox.dispatchScheduledEventOutboxJobs).toHaveBeenCalledTimes(1);
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalledTimes(1);
  });

  test('a failed job does not stop the others, and the first failure in order is reported', async () => {
    const worker = await loadWorker();
    chasers.dispatchDueChaserJobs.mockRejectedValue(new Error('chaser failure'));
    emailGateway.pollBothInboxesOnce.mockRejectedValue(new Error('mail failure'));

    await expect(worker.scheduled({ cron: '* * * * *' }, {}, {})).rejects.toThrow('chaser failure');
    expect(chasers.dispatchDueRFQComparisonJobs).toHaveBeenCalledTimes(1);
    expect(store.closeExpiredRFQsDurably).toHaveBeenCalledTimes(1);
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalledTimes(1);
  });

  test('the reconciliation trigger does not hydrate the store, even when the store has not been hydrated', async () => {
    const worker = await loadWorker();
    await worker.scheduled({ cron: '*/10 * * * *' }, {}, {});
    expect(store.hydrateFromDB).not.toHaveBeenCalled();
    expect(reconciliation.reconcileOnce).toHaveBeenCalledTimes(1);
    expect(eventOutbox.purgeExpiredEventOutboxRows).toHaveBeenCalledTimes(1);
  });

  test('the daily report hydrates the store before it runs', async () => {
    const worker = await loadWorker();
    await worker.scheduled({ cron: '30 0 * * *', scheduledTime: Date.UTC(2026, 10, 4, 0, 30) }, {}, {});
    expect(store.hydrateFromDB).toHaveBeenCalledTimes(1);
    expect(store.hydrateFromDB.mock.invocationCallOrder[0]).toBeLessThan(
      dailyReport.runScheduledDailyRfqReport.mock.invocationCallOrder[0]
    );
  });

  test('waits for both mail jobs before propagating an error', async () => {
    const worker = await loadWorker();
    emailGateway.pollBothInboxesOnce.mockRejectedValue(new Error('mail failure'));
    await expect(worker.scheduled({ cron: '* * * * *' }, {}, {})).rejects.toThrow('mail failure');
    expect(chasers.dispatchDueChaserJobs).toHaveBeenCalled();
    expect(chasers.dispatchDueRFQComparisonJobs).toHaveBeenCalled();
  });

  test('logs hydration errors through the structured logger and tolerates nonenumerable cron bindings', async () => {
    const worker = await loadWorker();
    const error = new Error('hydration failure');
    store.hydrateFromDB.mockRejectedValue(error);
    const badBindings = new Proxy({}, { ownKeys() { throw new Error('binding failure'); } });
    await worker.scheduled({ cron: '* * * * *' }, badBindings, {});
    expect(loggerService.error).toHaveBeenCalledWith(
      'Failed to synchronize Cloudflare Worker bindings into process.env',
      expect.objectContaining({ operation: 'worker_scheduled', error: expect.any(Error) }),
      'WORKER_ENV'
    );
    expect(loggerService.error).toHaveBeenCalledWith(
      'Scheduled Worker state hydration failed',
      error,
      'WORKER_CRON'
    );
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalled();
  });
});
