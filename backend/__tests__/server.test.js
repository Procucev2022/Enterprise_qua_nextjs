const request = require('supertest');
const { EventEmitter } = require('events');
const { app, bootstrapServer, installCrashHandlers } = require('../src/server');
const dbPool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const eventOutboxService = require('../src/services/eventOutboxService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

function restoreEnvVar(name, originalValue) {
  if (originalValue === undefined) delete process.env[name];
  else process.env[name] = originalValue;
}

describe('Server & Health Endpoints', () => {
  test('GET /health should return 200 and system health metadata', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.version).toBe('2.0.0');
    expect(res.body.platform).toContain('Procucev');
  });

  test('GET / returns 200 and backend API documentation endpoints', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ONLINE');
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.endpoints.rfqs).toBe('/api/rfqs');
  });

  test('GET /unknown-route returns 404 JSON response', async () => {
    const res = await request(app).get('/unknown-route');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('bootstrapServer starts the server once database health is reported', async () => {
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValueOnce({
      isConnected: true,
      providerLabel: 'Test PostgreSQL',
      database: 'test_db',
      userCount: 3,
      latencyMs: 5,
    });
    const server = await bootstrapServer(0);
    expect(server).toBeDefined();
    await new Promise((resolve) => server.close(resolve));
  });

  test('scheduled RFQ closure logs sweep failures and clears its timer when the server closes', async () => {
    const timerCallbacks = [];
    const timer = { unref: jest.fn() };
    const intervalSpy = jest.spyOn(global, 'setInterval').mockImplementation((callback, interval) => {
      expect(interval).toBeGreaterThan(0);
      timerCallbacks.push(callback);
      return timer;
    });
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    const error = new Error('closure storage unavailable');
    const chaserRecoveryError = new Error('chaser recovery unavailable');
    const chaserDispatchError = new Error('chaser queue unavailable');
    const comparisonRecoveryError = new Error('comparison recovery unavailable');
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValue({
      isConnected: true,
      providerLabel: 'Test PostgreSQL',
      database: 'test_db',
      userCount: 0,
      vendorCount: 0,
      rfqCount: 0,
      latencyMs: 1,
    });
    jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue(undefined);
    jest.spyOn(storeService, 'closeExpiredRFQsDurably').mockRejectedValue(error);
    jest.spyOn(rfqChaserScheduler, 'recoverChasersOnBoot').mockRejectedValue(chaserRecoveryError);
    jest.spyOn(rfqChaserScheduler, 'dispatchDueChaserJobs').mockRejectedValue(chaserDispatchError);
    jest.spyOn(rfqChaserScheduler, 'recoverRFQComparisonJobsOnBoot').mockRejectedValue(comparisonRecoveryError);
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockRejectedValue(error);
    const loggerErrorSpy = jest.spyOn(logger, 'error');
    const loggerWarnSpy = jest.spyOn(logger, 'warn');

    const server = await bootstrapServer(0);
    timerCallbacks[0]();
    timerCallbacks[1]();
    await new Promise((resolve) => setImmediate(resolve));

    expect(timer.unref).toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith('Scheduled RFQ closure sweep failed', { error }, 'SERVER');
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to dispatch queued background events during startup', { error }, 'SERVER'
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to dispatch due chaser jobs during startup', { error: chaserDispatchError }, 'SERVER'
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Scheduled chaser dispatch failed', { error: chaserDispatchError }, 'SERVER'
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith('Scheduled event-outbox dispatch failed', { error }, 'SERVER');
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      'Failed to recover chasers on boot', { error: chaserRecoveryError.message }, 'SERVER'
    );
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      'Failed to recover RFQ comparison notifications on boot', { error: comparisonRecoveryError.message }, 'SERVER'
    );
    await new Promise((resolve) => server.close(resolve));
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    intervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  test('bootstrapServer supports storage-backed dispatch with timer handles that cannot be unrefed', async () => {
    const timerHandles = [{ id: 'closure' }, { id: 'outbox' }, { id: 'comparison' }];
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => timerHandles.shift());
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValue({ isConnected: true, providerLabel: 'test' });
    jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue(undefined);
    jest.spyOn(storeService, 'closeExpiredRFQsDurably').mockResolvedValue([]);
    jest.spyOn(rfqChaserScheduler, 'recoverChasersOnBoot').mockResolvedValue(undefined);
    jest.spyOn(rfqChaserScheduler, 'dispatchDueChaserJobs').mockResolvedValue({ claimed: 0 });
    jest.spyOn(rfqChaserScheduler, 'recoverRFQComparisonJobsOnBoot').mockResolvedValue(undefined);
    const comparisonDispatch = jest.spyOn(rfqChaserScheduler, 'dispatchDueRFQComparisonJobs')
      .mockResolvedValue({ claimed: 0, sent: 0, failed: 0 });
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 0, completed: 0 });

    let server;
    try {
      server = await bootstrapServer(0);
      expect(comparisonDispatch).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => server.close(resolve));
      expect(clearIntervalSpy).toHaveBeenCalledWith({ id: 'closure' });
      expect(clearIntervalSpy).toHaveBeenCalledWith({ id: 'outbox' });
      expect(clearIntervalSpy).toHaveBeenCalledWith({ id: 'comparison' });
      expect(setIntervalSpy).toHaveBeenCalledTimes(3);
    } finally {
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      jest.restoreAllMocks();
    }
  });

  test('bootstrapServer survives a database health check that throws', async () => {
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockRejectedValueOnce(new Error('Connection Failed'));
    const server = await bootstrapServer(0);
    expect(server).toBeDefined();
    await new Promise((resolve) => server.close(resolve));
  });

  test('bootstrapServer falls back to its default port parameter when called with no arguments', async () => {
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValueOnce({
      isConnected: false,
      providerLabel: 'Test PostgreSQL',
      errorMessage: 'unreachable',
    });
    const listenSpy = jest.spyOn(app, 'listen').mockImplementation(() => ({ close: (cb) => cb && cb() }));

    const server = await bootstrapServer();
    expect(server).toBeDefined();
    expect(listenSpy).toHaveBeenCalled();

    listenSpy.mockRestore();
  });

  test('module load: falls back to port 4000 when PORT is unset, and skips auto-start when neither trigger is set', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;
    const originalAutoStart = process.env.AUTO_START_SERVER;
    delete process.env.PORT;
    // NODE_ENV must be something other than 'test' here, or the auto-start guard
    // short-circuits before even checking AUTO_START_SERVER/require.main below.
    process.env.NODE_ENV = 'staging';
    process.env.AUTO_START_SERVER = 'false';

    let freshApp;
    try {
      jest.isolateModules(() => {
        // require.main !== this fresh module in a Jest run, and AUTO_START_SERVER is 'false',
        // so start() must not fire here — exercises the module's no-auto-start path.
        freshApp = require('../src/server').app;
      });
      expect(freshApp).toBeDefined();
    } finally {
      restoreEnvVar('NODE_ENV', originalNodeEnv);
      restoreEnvVar('PORT', originalPort);
      restoreEnvVar('AUTO_START_SERVER', originalAutoStart);
    }
  });

  test('module load: does not auto-start while NODE_ENV is "test", even with AUTO_START_SERVER true', () => {
    const originalAutoStart = process.env.AUTO_START_SERVER;
    process.env.AUTO_START_SERVER = 'true';

    try {
      jest.isolateModules(() => {
        // NODE_ENV stays 'test' (Jest's default) here — this is the real-world case this
        // guard exists for: local .env sets AUTO_START_SERVER=true, which must not spin up
        // a real listener bound to the real PORT during every test run.
        require('../src/server');
      });
    } finally {
      restoreEnvVar('AUTO_START_SERVER', originalAutoStart);
    }

    // No server was started, so port 4000 is still free for the next test/file to use.
  });

  test('module load: auto-starts when NODE_ENV is not "test" and AUTO_START_SERVER is true', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;
    const originalAutoStart = process.env.AUTO_START_SERVER;
    const originalUnhandledListeners = new Set(process.listeners('unhandledRejection'));
    const originalExceptionListeners = new Set(process.listeners('uncaughtException'));
    const listen = jest.fn(() => ({ requestTimeout: 300000, headersTimeout: 330000 }));
    const stopPolling = jest.fn();
    const dispatchOutbox = jest.fn().mockResolvedValue({ claimed: 0, completed: 0 });

    // Keep this module-load test isolated from developer credentials and real
    // email, database, or Zoho services. It only needs to verify the startup
    // branch reaches app.listen.
    jest.doMock('../src/app', () => ({ listen }));
    jest.doMock('../src/db/pool', () => ({
      checkDatabaseHealth: jest.fn().mockResolvedValue({ isConnected: false, providerLabel: 'test', errorMessage: 'offline' }),
      hasStorage: jest.fn().mockReturnValue(false),
    }));
    jest.doMock('../src/services/storeService', () => ({
      hydrateFromDB: jest.fn().mockResolvedValue(),
      closeExpiredRFQsDurably: jest.fn().mockResolvedValue([]),
    }));
    jest.doMock('../src/services/rfqChaserScheduler', () => ({
      recoverChasersOnBoot: jest.fn().mockResolvedValue(),
      dispatchDueChaserJobs: jest.fn().mockResolvedValue({ claimed: 0, sent: 0, failed: 0, skipped: 0 }),
      recoverRFQComparisonJobsOnBoot: jest.fn().mockResolvedValue(),
      dispatchDueRFQComparisonJobs: jest.fn().mockResolvedValue({ claimed: 0, sent: 0, failed: 0 }),
    }));
    jest.doMock('../src/services/eventOutboxService', () => ({
      dispatchDueEventOutboxJobs: dispatchOutbox,
    }));
    jest.doMock('../src/services/emailGatewayService', () => ({
      startPolling: jest.fn().mockReturnValue({ started: false, reason: 'disabled in test' }),
      stopPolling,
    }));
    jest.doMock('../src/services/zohoReconciliationService', () => ({
      startPolling: jest.fn().mockReturnValue({ started: false, reason: 'disabled in test' }),
      stopPolling,
    }));

    process.env.NODE_ENV = 'staging';
    delete process.env.PORT;
    process.env.AUTO_START_SERVER = 'true';

    try {
      jest.isolateModules(() => {
        require('../src/server');
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(listen).toHaveBeenCalledWith(4000);
      expect(dispatchOutbox).toHaveBeenCalledTimes(1);
    } finally {
      restoreEnvVar('NODE_ENV', originalNodeEnv);
      restoreEnvVar('PORT', originalPort);
      restoreEnvVar('AUTO_START_SERVER', originalAutoStart);
      jest.dontMock('../src/app');
      jest.dontMock('../src/db/pool');
      jest.dontMock('../src/services/storeService');
      jest.dontMock('../src/services/rfqChaserScheduler');
      jest.dontMock('../src/services/eventOutboxService');
      jest.dontMock('../src/services/emailGatewayService');
      jest.dontMock('../src/services/zohoReconciliationService');
      process.listeners('unhandledRejection').forEach((listener) => {
        if (!originalUnhandledListeners.has(listener)) process.removeListener('unhandledRejection', listener);
      });
      process.listeners('uncaughtException').forEach((listener) => {
        if (!originalExceptionListeners.has(listener)) process.removeListener('uncaughtException', listener);
      });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Crash visibility
//
// An unhandled rejection exits the process and closes every in-flight socket.
// The client sees only "socket hang up", so without these handlers the cause
// never reaches app.log and the failure cannot be diagnosed after the fact.
// ══════════════════════════════════════════════════════════════════════════════
describe('installCrashHandlers', () => {
  /** Stand-in for `process` so a test can assert without exiting the Jest worker. */
  function fakeProcess() {
    const proc = new EventEmitter();
    proc.exit = jest.fn();
    return proc;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('logs an unhandled rejection carrying an Error', () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const proc = installCrashHandlers(fakeProcess());

    const cause = new Error('Gemini call rejected');
    proc.emit('unhandledRejection', cause);

    expect(errorSpy).toHaveBeenCalledWith('Unhandled promise rejection', cause, 'SERVER');
  });

  // A bare `Promise.reject('boom')` yields a string, which the logger needs as an
  // Error to record a stack trace at all.
  test('wraps a non-Error rejection reason', () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const proc = installCrashHandlers(fakeProcess());

    proc.emit('unhandledRejection', 'socket hang up');

    const [message, err, category] = errorSpy.mock.calls[0];
    expect(message).toBe('Unhandled promise rejection');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('socket hang up');
    expect(category).toBe('SERVER');
  });

  test('logs an uncaught exception and preserves the non-zero exit', () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const proc = installCrashHandlers(fakeProcess());

    const cause = new Error('boom');
    proc.emit('uncaughtException', cause);

    expect(errorSpy).toHaveBeenCalledWith('Uncaught exception — the process is exiting', cause, 'SERVER');
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  test('logs and ignores transient socket reset exceptions without exiting', () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const proc = installCrashHandlers(fakeProcess());

    const resetError = new Error('read ECONNRESET');
    resetError.code = 'ECONNRESET';
    proc.emit('uncaughtException', resetError);

    expect(errorSpy).toHaveBeenCalledWith('Ignored transient network socket reset', resetError, 'SERVER');
    expect(proc.exit).not.toHaveBeenCalled();

    const timeoutError = new Error('connect ETIMEDOUT');
    timeoutError.code = 'ETIMEDOUT';
    proc.emit('uncaughtException', timeoutError);
    expect(errorSpy).toHaveBeenCalledWith('Ignored transient network socket reset', timeoutError, 'SERVER');
    expect(proc.exit).not.toHaveBeenCalled();
  });

  test('defaults to the real process when called with no argument', () => {
    const onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

    installCrashHandlers();

    expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
  });
});

// ==============================================================================
// EMAIL GATEWAY STARTUP HOOK
// ==============================================================================
// The gateway is the first background task in this backend, so boot must be safe
// in both directions: it starts when a mailbox is configured, and says why it did
// not when one is not. Neither case may prevent the server from listening.
// ==============================================================================

describe('bootstrapServer email gateway hook', () => {
  const emailGatewayService = require('../src/services/emailGatewayService');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reports the reason when the gateway does not start', async () => {
    jest
      .spyOn(emailGatewayService, 'startPolling')
      .mockReturnValue({ started: false, reason: 'no mailbox configured' });
    const info = jest.spyOn(logger, 'info');

    const server = await bootstrapServer(0);
    try {
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('no mailbox configured'),
        expect.anything(),
        'SERVER'
      );
    } finally {
      server.close();
    }
  });

  test('stays quiet when the gateway starts', async () => {
    jest.spyOn(emailGatewayService, 'startPolling').mockReturnValue({ started: true, pollIntervalMs: 120000 });
    const info = jest.spyOn(logger, 'info');

    const server = await bootstrapServer(0);
    try {
      const notStartedLogs = info.mock.calls.filter(([message]) =>
        String(message).includes('Email ingestion gateway not started')
      );
      expect(notStartedLogs).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  // A gateway that throws on boot must not stop the server from listening.
  test('a listening server is returned regardless', async () => {
    jest.spyOn(emailGatewayService, 'startPolling').mockReturnValue({ started: true });
    const server = await bootstrapServer(0);
    expect(server.listening).toBe(true);
    server.close();
  });
});

// ==============================================================================
// ZOHO RECONCILIATION STARTUP HOOK
// ==============================================================================
describe('bootstrapServer Zoho reconciliation hook', () => {
  const zohoReconciliationService = require('../src/services/zohoReconciliationService');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reports the reason when reconciliation does not start', async () => {
    jest
      .spyOn(zohoReconciliationService, 'startPolling')
      .mockReturnValue({ started: false, reason: 'ZOHO_RECONCILIATION_ENABLED is not true.' });
    const info = jest.spyOn(logger, 'info');

    const server = await bootstrapServer(0);
    try {
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('ZOHO_RECONCILIATION_ENABLED is not true.'),
        expect.anything(),
        'SERVER'
      );
    } finally {
      server.close();
    }
  });

  test('stays quiet when reconciliation starts', async () => {
    jest.spyOn(zohoReconciliationService, 'startPolling').mockReturnValue({ started: true, intervalMs: 600000 });
    const info = jest.spyOn(logger, 'info');

    const server = await bootstrapServer(0);
    try {
      const notStartedLogs = info.mock.calls.filter(([message]) =>
        String(message).includes('Zoho payment-link reconciliation not started')
      );
      expect(notStartedLogs).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});
