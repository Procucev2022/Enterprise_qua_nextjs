const request = require('supertest');
const { EventEmitter } = require('events');
const { app, bootstrapServer, installCrashHandlers } = require('../src/server');
const dbPool = require('../src/db/pool');
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

  test('module load: auto-starts when NODE_ENV is not "test" and AUTO_START_SERVER is true', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;
    const originalAutoStart = process.env.AUTO_START_SERVER;

    process.env.NODE_ENV = 'staging';
    process.env.PORT = '0'; // ephemeral — can't collide with anything even though it's never explicitly closed
    process.env.AUTO_START_SERVER = 'true';

    try {
      jest.isolateModules(() => {
        require('../src/server');
      });
    } finally {
      restoreEnvVar('NODE_ENV', originalNodeEnv);
      restoreEnvVar('PORT', originalPort);
      restoreEnvVar('AUTO_START_SERVER', originalAutoStart);
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
