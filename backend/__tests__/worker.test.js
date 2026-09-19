const {
  fetch,
  scheduled,
  email,
  workerApp,
  createWorkerApp,
  dispatchToExpress,
} = require('../src/worker');

const pool = require('../src/db/pool');
const r2Client = require('../src/services/r2Client');
const { handleScheduled } = require('../src/workers/scheduledWorker');
const { handleEmail } = require('../src/workers/emailWorker');
const { graphql } = require('graphql');

jest.mock('../src/db/pool', () => ({
  initFromEnv: jest.fn(),
}));

jest.mock('../src/services/r2Client', () => ({
  setNativeBucket: jest.fn(),
}));

jest.mock('../src/workers/scheduledWorker', () => ({
  handleScheduled: jest.fn(),
}));

jest.mock('../src/workers/emailWorker', () => ({
  handleEmail: jest.fn(),
}));

jest.mock('graphql', () => {
  const actual = jest.requireActual('graphql');
  return {
    ...actual,
    graphql: jest.fn(),
  };
});

describe('Cloudflare Workers Native Edge Entry Point (src/worker.js)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Root and Health Endpoints', () => {
    test('GET /health returns 200 with edge platform metadata', async () => {
      const req = new Request('http://localhost/health');
      const res = await workerApp.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        status: 'UP',
        version: '2.1.0',
        platform: expect.stringContaining('Cloudflare Workers Edge Platform'),
        edge: true,
      });
      expect(data.timestamp).toBeDefined();
    });

    test('GET / returns 200 with API discovery directory', async () => {
      const req = new Request('http://localhost/');
      const res = await workerApp.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        name: 'Procucev Enterprise Procurement Edge API',
        version: '2.1.0',
        platform: 'Cloudflare Workers',
        status: 'ONLINE',
      });
      expect(data.endpoints.health).toBe('/health');
      expect(data.endpoints.graphql).toBe('/graphql');
    });
  });

  describe('Edge Middleware & Binding Initializations', () => {
    test('initializes Hyperdrive and R2 bindings when provided in env', async () => {
      const req = new Request('http://localhost/health');
      const env = {
        HYPERDRIVE: { connectionString: 'postgres://edge:5432/db' },
        R2_BUCKET: { put: jest.fn(), get: jest.fn() },
      };

      const res = await workerApp.request(req, undefined, env);
      expect(res.status).toBe(200);
      expect(pool.initFromEnv).toHaveBeenCalledWith(env);
      expect(r2Client.setNativeBucket).toHaveBeenCalledWith(env.R2_BUCKET);
    });

    test('initializes database pool when DATABASE_URL is in env', async () => {
      const req = new Request('http://localhost/health');
      const env = { DATABASE_URL: 'postgres://neon/prod' };

      const res = await workerApp.request(req, undefined, env);
      expect(res.status).toBe(200);
      expect(pool.initFromEnv).toHaveBeenCalledWith(env);
    });
  });

  describe('Edge GraphQL Endpoint', () => {
    test('executes POST /graphql with query and variables', async () => {
      graphql.mockResolvedValue({
        data: {
          systemConfig: { status: 'OPTIMAL' },
        },
      });

      const req = new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'query GetStatus { systemConfig { status } }',
          variables: { limit: 10 },
          operationName: 'GetStatus',
        }),
      });

      const res = await workerApp.request(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.systemConfig.status).toBe('OPTIMAL');
      expect(graphql).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'query GetStatus { systemConfig { status } }',
          operationName: 'GetStatus',
          variableValues: { limit: 10 },
        })
      );
    });

    test('executes GET /graphql with query string and serialized variables', async () => {
      graphql.mockResolvedValue({
        data: {
          rfqs: [],
        },
      });

      const url =
        'http://localhost/graphql?query=query+GetRFQs+%7B+rfqs+%7B+id+%7D+%7D&variables=%7B%22status%22%3A%22open%22%7D&operationName=GetRFQs';
      const req = new Request(url);

      const res = await workerApp.request(req);
      expect(res.status).toBe(200);
      expect(graphql).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'query GetRFQs { rfqs { id } }',
          operationName: 'GetRFQs',
          variableValues: { status: 'open' },
        })
      );
    });

    test('handles invalid JSON string in GET /graphql variables gracefully', async () => {
      graphql.mockResolvedValue({ data: { test: true } });
      const url = 'http://localhost/graphql?query=query+Test+%7B+test+%7D&variables=invalid-json';
      const req = new Request(url);

      const res = await workerApp.request(req);
      expect(res.status).toBe(200);
      expect(graphql).toHaveBeenCalledWith(
        expect.objectContaining({
          variableValues: {},
        })
      );
    });

    test('returns 400 when query string is missing in GraphQL request', async () => {
      const req = new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await workerApp.request(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.errors[0].message).toContain('Must provide query string');
    });

    test('returns 500 when graphql execution throws an unexpected error', async () => {
      graphql.mockRejectedValue(new Error('Syntax error'));

      const req = new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'broken query' }),
      });

      const res = await workerApp.request(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.errors[0].message).toBe('Syntax error');
    });

    test('returns fallback error message when error has no message', async () => {
      graphql.mockRejectedValue({});

      const req = new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'broken query' }),
      });

      const res = await workerApp.request(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.errors[0].message).toBe('Internal GraphQL error');
    });
  });

  describe('dispatchToExpress Gateway & API Routing', () => {
    test('routes GET requests to Express app and receives response', async () => {
      const mockExpressApp = {
        handle: jest.fn((req, res) => {
          res.setHeader('x-custom-header', 'test-val');
          res.setHeader('set-cookie', ['cookie1=val1', 'cookie2=val2']);
          res.write('part1');
          res.write(Buffer.from('part2'));
          res.end(Buffer.from('part3'));
        }),
      };

      const testApp = createWorkerApp({ appOverride: mockExpressApp });
      const req = new Request('http://localhost/api/custom');
      const res = await testApp.request(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-custom-header')).toBe('test-val');
      const bodyText = await res.text();
      expect(bodyText).toBe('part1part2part3');
    });

    test('routes POST requests with JSON payload to Express', async () => {
      const mockExpressApp = {
        handle: jest.fn((req, res) => {
          res.statusCode = 201;
          res.end(JSON.stringify({ created: true }));
        }),
      };

      const testApp = createWorkerApp({ appOverride: mockExpressApp });
      const req = new Request('http://localhost/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'sample' }),
      });

      const res = await testApp.request(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.created).toBe(true);
    });

    test('handles empty body for POST request', async () => {
      const mockExpressApp = {
        handle: jest.fn((req, res) => {
          res.statusCode = 204;
          res.end();
        }),
      };

      const testApp = createWorkerApp({ appOverride: mockExpressApp });
      const req = new Request('http://localhost/api/empty', {
        method: 'POST',
      });

      const res = await testApp.request(req);
      expect(res.status).toBe(204);
    });

    test('handles request when arrayBuffer() throws an error', async () => {
      const mockExpressApp = {
        handle: jest.fn((req, res) => {
          res.statusCode = 200;
          res.end('ok');
        }),
      };

      const badRequest = {
        url: 'http://localhost/api/bad-buffer',
        method: 'POST',
        headers: new Headers(),
        arrayBuffer: () => Promise.reject(new Error('arrayBuffer fail')),
      };

      const res = await dispatchToExpress(mockExpressApp, badRequest);
      expect(res.status).toBe(200);
    });

    test('handles write and end with callback functions', async () => {
      const mockExpressApp = {
        handle: jest.fn((req, res) => {
          let cb1Called = false;
          let cb2Called = false;
          res.write('chunk', 'utf8', () => {
            cb1Called = true;
          });
          res.end('last', 'utf8', () => {
            cb2Called = true;
          });
          expect(cb1Called).toBe(true);
          expect(cb2Called).toBe(true);
        }),
      };

      const testApp = createWorkerApp({ appOverride: mockExpressApp });
      const req = new Request('http://localhost/api/cb-test');
      const res = await testApp.request(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('chunklast');
    });

    test('returns 500 when dispatchToExpress throws an error', async () => {
      const badExpressApp = {
        handle: jest.fn(() => {
          throw new Error('Express internal crash');
        }),
      };

      const testApp = createWorkerApp({ appOverride: badExpressApp });
      const req = new Request('http://localhost/api/crash');
      const res = await testApp.request(req);

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Express internal crash');
    });

    test('returns 500 with fallback error message if exception has no message', async () => {
      const badExpressApp = {
        handle: jest.fn(() => {
          throw {};
        }),
      };

      const testApp = createWorkerApp({ appOverride: badExpressApp });
      const req = new Request('http://localhost/api/crash2');
      const res = await testApp.request(req);

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Gateway dispatch failed');
    });
  });

  describe('Cloudflare Workers Exported Handlers', () => {
    test('fetch export calls workerApp.fetch', async () => {
      const req = new Request('http://localhost/health');
      const env = {};
      const ctx = {};

      const res = await fetch(req, env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('UP');
    });

    test('scheduled export calls handleScheduled', async () => {
      handleScheduled.mockResolvedValue({ success: true, cron: '*/5 * * * *' });

      const event = { cron: '*/5 * * * *' };
      const env = { HYPERDRIVE: {} };
      const ctx = { waitUntil: jest.fn() };

      const result = await scheduled(event, env, ctx);
      expect(handleScheduled).toHaveBeenCalledWith(event, env, ctx);
      expect(result.success).toBe(true);
    });

    test('email export calls handleEmail', async () => {
      handleEmail.mockResolvedValue({ outcome: 'RFQ_CREATED', rfqId: 'RFQ-01' });

      const message = { from: 'buyer@procucev.com' };
      const env = {};
      const ctx = {};

      const result = await email(message, env, ctx);
      expect(handleEmail).toHaveBeenCalledWith(message, env, ctx);
      expect(result.outcome).toBe('RFQ_CREATED');
    });
  });
});
