const request = require('supertest');
const app = require('../src/app');
const { authHeader } = require('./testHelpers');

describe('Historical Purchase Data Ingestion API', () => {
  test('POST /api/buyer-accounts/historical-data processes vendor records', async () => {
    const res = await request(app)
      .post('/api/buyer-accounts/historical-data')
      .set(authHeader('buyer'))
      .send({
        period: '2_years',
        vendorRecords: [
          {
            companyName: 'Larsen Valves Pvt Ltd',
            email: 'sales@larsenvalves.in',
            minorCategories: ['Valves & Actuators'],
          },
        ],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.importedCount).toBeGreaterThanOrEqual(1);
    expect(res.body.period).toBe('2_years');
  });

  test('POST /api/buyer-accounts/historical-data returns 400 when period missing', async () => {
    const res = await request(app).post('/api/buyer-accounts/historical-data').set(authHeader('buyer')).send({});
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/buyer-accounts/historical-data requires authentication', async () => {
    const res = await request(app).post('/api/buyer-accounts/historical-data').send({ period: '2_years' });
    expect(res.statusCode).toBe(401);
  });
});
