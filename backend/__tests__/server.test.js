const request = require('supertest');
const { app, bootstrapServer } = require('../src/server');
const pool = require('../src/db/pool');

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
});
