const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const vendorPresenceService = require('../src/services/vendorPresenceService');

function vendorAuthHeader(email = 'testvendor@example.com') {
  const token = authService.generateSessionToken({
    id: 'usr-vendor-123',
    email,
    name: 'Test Vendor',
    role: 'vendor',
    orgId: 'org-vendor-123',
    orgName: 'Test Vendor Corp',
  });
  return { Authorization: `Bearer ${token}` };
}

function buyerAuthHeader() {
  const token = authService.generateSessionToken({
    id: 'usr-buyer-123',
    email: 'buyer@example.com',
    name: 'Test Buyer',
    role: 'buyer',
    orgId: 'org-buyer-123',
  });
  return { Authorization: `Bearer ${token}` };
}

describe('Vendor Presence & Heartbeat API Routes', () => {
  beforeEach(() => {
    vendorPresenceService.resetAll();
  });

  afterEach(() => {
    vendorPresenceService.resetAll();
  });

  describe('POST /api/vendors/heartbeat', () => {
    it('records heartbeat with authenticated user email if identifier is omitted', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .set(vendorAuthHeader('auto@vendor.com'))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.identifier).toBe('auto@vendor.com');
      expect(res.body.isOnline).toBe(true);
    });

    it('uses the authenticated vendor identity and accepts the requested status', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .set(vendorAuthHeader('session@vendor.com'))
        .send({ identifier: 'manual@vendor.com', role: 'admin', status: 'offline' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.identifier).toBe('session@vendor.com');
      expect(res.body.isOnline).toBe(false);
    });

    it('rejects invalid heartbeat payload', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .set(vendorAuthHeader())
        .send({ status: 'invalid-status' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects heartbeat when no identifier and unauthenticated', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .send({});

      expect(res.status).toBe(401);
    });

    it('rejects heartbeat from non-vendor sessions', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .set(buyerAuthHeader())
        .send({ identifier: 'spoofed@vendor.com' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/vendors/presence', () => {
    it('requires an authenticated buyer or staff session', async () => {
      const anonymous = await request(app).get('/api/vendors/presence');
      expect(anonymous.status).toBe(401);

      const vendor = await request(app).get('/api/vendors/presence').set(vendorAuthHeader());
      expect(vendor.status).toBe(403);
    });

    it('returns empty list when no vendors are online', async () => {
      const res = await request(app).get('/api/vendors/presence').set(buyerAuthHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineVendors).toEqual([]);
    });

    it('returns online vendors and details', async () => {
      vendorPresenceService.recordHeartbeat({ identifier: 'v1@vendor.com' });
      vendorPresenceService.recordHeartbeat({ identifier: 'v2@vendor.com', status: 'offline' });

      const res = await request(app).get('/api/vendors/presence').set(buyerAuthHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineVendors).toContain('v1@vendor.com');
      expect(res.body.onlineVendors).not.toContain('v2@vendor.com');
      expect(res.body.details['v1@vendor.com'].isOnline).toBe(true);
    });

    it('filters presence by requested identifiers query parameter', async () => {
      vendorPresenceService.recordHeartbeat({ identifier: 'v1@vendor.com' });

      const res = await request(app)
        .get('/api/vendors/presence?identifiers=v1@vendor.com,unknown@vendor.com')
        .set(buyerAuthHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineVendors).toEqual(['v1@vendor.com']);
      expect(res.body.details['v1@vendor.com'].isOnline).toBe(true);
      expect(res.body.details['unknown@vendor.com'].isOnline).toBe(false);
    });
  });
});
