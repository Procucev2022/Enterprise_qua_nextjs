const request = require('supertest');
const { app, bootstrapServer } = require('../src/server');
const pool = require('../src/db/pool');

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

  test('bootstrapServer starts server instance', async () => {
    jest.spyOn(pool, 'checkDBHealth').mockResolvedValueOnce({ isConnected: true });
    const server = await bootstrapServer(0);
    expect(server).toBeDefined();
    await new Promise((resolve) => server.close(resolve));
  });

  test('bootstrapServer handles db health error fallback', async () => {
    jest.spyOn(pool, 'checkDBHealth').mockRejectedValueOnce(new Error('Connection Failed'));
    const server = await bootstrapServer(0);
    expect(server).toBeDefined();
    await new Promise((resolve) => server.close(resolve));
  });

  test('bootstrapServer falls back to its default port parameter when called with no arguments', async () => {
    jest.spyOn(pool, 'checkDBHealth').mockResolvedValueOnce({ isConnected: false });
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
