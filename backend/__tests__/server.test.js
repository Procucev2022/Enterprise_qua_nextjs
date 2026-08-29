const request = require('supertest');
const app = require('../src/app');

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
});
