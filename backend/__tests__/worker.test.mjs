import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

let bindings;
let app;
let emailGateway;
let reconciliation;
let chasers;
let store;
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
  chasers = { dispatchDueChaserJobs: jest.fn().mockResolvedValue([]) };
  store = { isHydratedFromDB: false, hydrateFromDB: jest.fn().mockResolvedValue(undefined) };
  originalFetch = jest.fn().mockResolvedValue('response');
  waitUntil = jest.fn();
  createHandler = jest.fn(() => ({ fetch: originalFetch }));
  jest.unstable_mockModule('cloudflare:node', () => ({ httpServerHandler: createHandler }), { virtual: true });
  jest.unstable_mockModule('cloudflare:workers', () => ({ env: bindings, waitUntil }), { virtual: true });
  jest.unstable_mockModule('../src/app.js', () => ({ default: app }));
  jest.unstable_mockModule('../src/services/emailGatewayService.js', () => ({ default: emailGateway }));
  jest.unstable_mockModule('../src/services/zohoReconciliationService.js', () => ({ default: reconciliation }));
  jest.unstable_mockModule('../src/services/rfqChaserScheduler.js', () => ({ default: chasers }));
  jest.unstable_mockModule('../src/services/storeService.js', () => ({ default: store }));
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

  test('continues serving requests when bindings enumeration throws', async () => {
    bindings = new Proxy({}, { ownKeys() { throw new Error('unavailable'); } });
    const worker = await loadWorker();
    expect(await worker.fetch({}, bindings, {})).toBe('response');
  });

  test('supports namespace exports for CommonJS interop', async () => {
    jest.unstable_mockModule('../src/app.js', () => app);
    jest.unstable_mockModule('../src/services/emailGatewayService.js', () => emailGateway);
    jest.unstable_mockModule('../src/services/zohoReconciliationService.js', () => reconciliation);
    jest.unstable_mockModule('../src/services/rfqChaserScheduler.js', () => chasers);
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
  });

  test('runs all jobs for an unrecognized trigger and reports rejected jobs', async () => {
    const worker = await loadWorker();
    await worker.scheduled({ cron: 'custom' }, {}, {});
    expect(reconciliation.reconcileOnce).toHaveBeenCalledTimes(1);
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalledTimes(1);
    expect(chasers.dispatchDueChaserJobs).toHaveBeenCalledTimes(1);
    reconciliation.reconcileOnce.mockRejectedValue(new Error('payment failure'));
    await expect(worker.scheduled({ cron: 'custom' }, {}, {})).rejects.toThrow('payment failure');
  });

  test('waits for both mail jobs before propagating an error', async () => {
    const worker = await loadWorker();
    emailGateway.pollBothInboxesOnce.mockRejectedValue(new Error('mail failure'));
    await expect(worker.scheduled({ cron: '* * * * *' }, {}, {})).rejects.toThrow('mail failure');
    expect(chasers.dispatchDueChaserJobs).toHaveBeenCalled();
  });

  test('logs hydration errors and tolerates nonenumerable cron bindings', async () => {
    const worker = await loadWorker();
    const error = new Error('hydration failure');
    store.hydrateFromDB.mockRejectedValue(error);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const badBindings = new Proxy({}, { ownKeys() { throw new Error('binding failure'); } });
    await worker.scheduled({ cron: '* * * * *' }, badBindings, {});
    expect(console.error).toHaveBeenCalledWith('[CRON] hydration failed', error);
    expect(emailGateway.pollBothInboxesOnce).toHaveBeenCalled();
  });
});
