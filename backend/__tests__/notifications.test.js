const request = require('supertest');

const app = require('../src/app');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const { authHeader, TEST_USERS } = require('./testHelpers');

// The controller resolves the caller to a recipient by their session email, so
// the store needs a vendor row and a buyer account whose emails match the test
// users. The store is a shared singleton across the worker; these are additive
// and scoped by unique category/email so they don't collide with other suites.
let vendorRecord;
let buyerAccount;

let prevHydrated;

beforeAll(() => {
  prevHydrated = storeService.isHydratedFromDB;
  storeService.isHydratedFromDB = true;
  vendorRecord = storeService.addVendor({
    name: 'Notification Test Vendor',
    email: TEST_USERS.vendor.email,
    majorCategory: 'Notification-Test-Category',
    minorCategories: [],
  });
  buyerAccount = storeService.addBuyerAccount({
    organizationName: 'Notification Test Buyer',
    corporateEmail: TEST_USERS.buyer.email,
  });
});

afterAll(() => {
  storeService.isHydratedFromDB = prevHydrated;
});

describe('GET /api/notifications', () => {
  test('requires a session', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.statusCode).toBe(401);
  });

  test('returns a category manager an empty inbox rather than an error', async () => {
    const res = await request(app).get('/api/notifications').set(authHeader('category_manager'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], unreadCount: 0 });
  });

  test('a vendor sees the notification raised when a CM invites them to a new RFQ', async () => {
    const rfq = storeService.createRFQ({ title: 'Notif RFQ One', category: 'Notification-Test-Category' });
    await storeService.inviteVendorsToRFQ(rfq.id, [vendorRecord.id], TEST_USERS.category_manager.email);

    const res = await request(app).get('/api/notifications').set(authHeader('vendor'));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const mine = res.body.data.filter((n) => n.recipientId === vendorRecord.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]).toMatchObject({ kind: 'rfq_category_match', read: false });
    expect(res.body.unreadCount).toBeGreaterThan(0);
  });

  test('a buyer sees the quote-received notification for their own RFQ', async () => {
    const rfq = storeService.createRFQ({ title: 'Notif RFQ Two', category: 'Whatever' }, buyerAccount);
    storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-bidder', vendorName: 'Bidder Inc', unitPrice: 5, totalPrice: 50 });

    const res = await request(app).get('/api/notifications').set(authHeader('buyer'));

    const mine = res.body.data.filter((n) => n.kind === 'quote_received' && n.rfqNumber === rfq.rfqNumber);
    expect(mine).toHaveLength(1);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  test('marks the caller’s own notification read', async () => {
    const rfq = storeService.createRFQ({ id: 'rfq-notif-three', title: 'Notif RFQ Three', category: 'Notification-Test-Category' });
    await storeService.inviteVendorsToRFQ(rfq.id, [vendorRecord.id], TEST_USERS.category_manager.email);
    const [notification] = storeService.getNotificationsFor('vendor', vendorRecord.id).filter((n) => !n.read);

    const res = await request(app)
      .patch(`/api/notifications/${notification.id}/read`)
      .set(authHeader('vendor'));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.read).toBe(true);
  });

  test('reports another recipient’s notification as not found', async () => {
    const rfq = storeService.createRFQ({ id: 'rfq-notif-four', title: 'Notif RFQ Four', category: 'Notification-Test-Category' });
    await storeService.inviteVendorsToRFQ(rfq.id, [vendorRecord.id], TEST_USERS.category_manager.email);
    const [notification] = storeService.getNotificationsFor('vendor', vendorRecord.id);

    // The category manager has no inbox, so this id is "not theirs".
    const res = await request(app)
      .patch(`/api/notifications/${notification.id}/read`)
      .set(authHeader('category_manager'));

    expect(res.statusCode).toBe(404);
  });

  test('reports an unknown id as not found', async () => {
    const res = await request(app)
      .patch('/api/notifications/ntf-does-not-exist/read')
      .set(authHeader('vendor'));
    expect(res.statusCode).toBe(404);
  });

  test('requires a session', async () => {
    const res = await request(app).patch('/api/notifications/ntf-1/read');
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/notifications/read-all', () => {
  test('clears every unread notification for the caller', async () => {
    const rfqFive = storeService.createRFQ({ id: 'rfq-notif-five', title: 'Notif RFQ Five', category: 'Notification-Test-Category' });
    const rfqSix = storeService.createRFQ({ id: 'rfq-notif-six', title: 'Notif RFQ Six', category: 'Notification-Test-Category' });
    await storeService.inviteVendorsToRFQ(rfqFive.id, [vendorRecord.id], TEST_USERS.category_manager.email);
    await storeService.inviteVendorsToRFQ(rfqSix.id, [vendorRecord.id], TEST_USERS.category_manager.email);
    expect(storeService.getUnreadNotificationCountFor('vendor', vendorRecord.id)).toBeGreaterThan(0);

    const res = await request(app).post('/api/notifications/read-all').set(authHeader('vendor'));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBeGreaterThan(0);
    expect(storeService.getUnreadNotificationCountFor('vendor', vendorRecord.id)).toBe(0);
  });

  test('returns updated: 0 for a role with no inbox', async () => {
    const res = await request(app).post('/api/notifications/read-all').set(authHeader('admin'));
    expect(res.body).toEqual({ success: true, updated: 0 });
  });

  test('requires a session', async () => {
    const res = await request(app).post('/api/notifications/read-all');
    expect(res.statusCode).toBe(401);
  });
});

describe('notificationController.resolveRecipient', () => {
  const { resolveRecipient } = require('../src/controllers/notificationController');

  test('returns null when there is no user', async () => {
    expect(await resolveRecipient({})).toBeNull();
  });

  test('returns null for a vendor with no vendor record', async () => {
    expect(await resolveRecipient({ user: { role: 'vendor', email: 'ghost-vendor@nowhere.test' } })).toBeNull();
  });

  test('returns null for a buyer with no buyer account', async () => {
    expect(await resolveRecipient({ user: { role: 'buyer', email: 'ghost-buyer@nowhere.test' } })).toBeNull();
  });
});

describe('notification endpoints surface an unexpected failure', () => {
  const storeSvc = require('../src/services/storeService');

  afterEach(() => jest.restoreAllMocks());

  test('GET propagates a thrown error to the handler', async () => {
    jest.spyOn(storeSvc, 'getVendorById').mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).get('/api/notifications').set(authHeader('vendor'));
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  test('read-all propagates a thrown error to the handler', async () => {
    jest.spyOn(storeSvc, 'markAllNotificationsRead').mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).post('/api/notifications/read-all').set(authHeader('vendor'));
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  test('PATCH propagates a thrown error to the handler', async () => {
    jest.spyOn(storeSvc, 'markNotificationRead').mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await request(app).patch('/api/notifications/ntf-1/read').set(authHeader('vendor'));
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  test('resolves recipient for buyer user with buyerId only', async () => {
    const token = authService.generateSessionToken({
      sub: 'buyer-user-1',
      email: 'buyer1@test.com',
      role: 'buyer',
      buyerId: 'buyer-id-999',
    });
    const res = await request(app).get('/api/notifications').set({ Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('resolves recipient for buyer user with neither id when email lookup fails', async () => {
    jest.spyOn(storeSvc, 'getBuyerAccountByEmail').mockResolvedValue(null);
    const token = authService.generateSessionToken({
      sub: 'buyer-user-2',
      email: 'unregistered-buyer@test.com',
      role: 'buyer',
    });
    const res = await request(app).get('/api/notifications').set({ Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('resolves recipient for vendor user when getVendorById returns null', async () => {
    jest.spyOn(storeSvc, 'getVendorById').mockReturnValue(null);
    const token = authService.generateSessionToken({
      sub: 'vendor-user-1',
      email: 'unknown-vendor@test.com',
      role: 'vendor',
    });
    const res = await request(app).get('/api/notifications').set({ Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('notificationController unit coverage for branches', () => {
  const { resolveRecipient, listNotifications, markRead, markAllRead } = require('../src/controllers/notificationController');

  test('covers all resolveRecipient combinations', async () => {
    expect(await resolveRecipient(null)).toBeNull();
    expect(await resolveRecipient({})).toBeNull();
    expect(await resolveRecipient({ user: { role: 'other' } })).toBeNull();
    expect(await resolveRecipient({ user: { role: 'vendor', vendorId: 'v1' } })).toEqual({ type: 'vendor', id: 'v1' });
    expect(await resolveRecipient({ user: { role: 'buyer', buyerAccountId: 'ba1' } })).toEqual({ type: 'buyer', id: 'ba1' });
    expect(await resolveRecipient({ user: { role: 'buyer', buyerId: 'b1' } })).toEqual({ type: 'buyer', id: 'b1' });
  });

  test('covers listNotifications limit branches', async () => {
    const fakeRes = () => {
      const res = {};
      res.json = jest.fn((val) => val);
      res.status = jest.fn(() => res);
      return res;
    };
    const next = jest.fn();

    // query.limit integer > 0
    let res = fakeRes();
    await listNotifications({ user: { role: 'buyer', buyerAccountId: 'b1' }, query: { limit: '10' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    // query.limit > 200 (caps at 200)
    res = fakeRes();
    await listNotifications({ user: { role: 'buyer', buyerAccountId: 'b1' }, query: { limit: '500' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    // query.limit <= 0 or not an integer
    res = fakeRes();
    await listNotifications({ user: { role: 'buyer', buyerAccountId: 'b1' }, query: { limit: '-5' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    // no query object
    res = fakeRes();
    await listNotifications({ user: { role: 'buyer', buyerAccountId: 'b1' } }, res, next);
    expect(res.json).toHaveBeenCalled();
  });

  test('covers markRead and markAllRead when recipient is null', async () => {
    const fakeRes = () => {
      const res = {};
      res.json = jest.fn((val) => val);
      res.status = jest.fn(() => res);
      return res;
    };
    const next = jest.fn();

    let res = fakeRes();
    await markRead({ user: { role: 'admin' }, params: { id: 'ntf-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    res = fakeRes();
    await markAllRead({ user: { role: 'admin' } }, res, next);
    expect(res.json).toHaveBeenCalledWith({ success: true, updated: 0 });
  });
});
