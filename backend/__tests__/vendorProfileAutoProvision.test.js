const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const identityQueries = require('../src/db/identityQueries');
const domainQueries = require('../src/db/domainQueries');
const vendorController = require('../src/controllers/vendorController');
const authService = require('../src/services/authService');
const { authHeader, TEST_USERS } = require('./testHelpers');

// Vendors migrated straight into the identity `user` table (e.g. mumbai@japl.org)
// had no `vendors` row, so every vendor-scoped lookup resolved to null and their
// RFQ list came back empty. The profile is now created on first use.
describe('storeService.ensureVendorProfileForUser', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    storeService.vendors = storeService.vendors.filter((v) => !String(v.email || '').endsWith('@migrated.test'));
  });

  test('returns null for missing user, non-vendor role, or missing email', async () => {
    await expect(storeService.ensureVendorProfileForUser(null)).resolves.toBeNull();
    await expect(storeService.ensureVendorProfileForUser({ role: 'buyer', email: 'b@migrated.test' })).resolves.toBeNull();
    await expect(storeService.ensureVendorProfileForUser({ role: 'vendor' })).resolves.toBeNull();
  });

  test('returns an existing in-memory profile without creating one', async () => {
    storeService.vendors.unshift({ id: 'v-existing-mig', email: 'Existing@migrated.test', name: 'Existing' });
    const addSpy = jest.spyOn(storeService, 'addVendor');
    const vendor = await storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'Existing@migrated.test' });
    expect(vendor.id).toBe('v-existing-mig');
    expect(addSpy).not.toHaveBeenCalled();
  });

  test('returns a profile found only through the DB fallback', async () => {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({ id: 'v-db', email: 'db@migrated.test' });
    const addSpy = jest.spyOn(storeService, 'addVendor');
    const vendor = await storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'db@migrated.test' });
    expect(vendor.id).toBe('v-db');
    expect(addSpy).not.toHaveBeenCalled();
  });

  test('creates a category-less profile from the identity record', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({
      name: 'Mumbai Contact',
      orgName: 'JAPL Mumbai',
      mobile: '+919082848703',
    });
    const vendor = await storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'Mumbai@Migrated.test' });
    expect(vendor).toMatchObject({
      email: 'mumbai@migrated.test',
      name: 'JAPL Mumbai',
      contactPerson: 'Mumbai Contact',
      phone: '+919082848703',
      majorCategory: '',
      source: 'migrated_identity',
      subscriptionPlan: 'premium',
      freeQuotationCredits: 0,
      isCategoryAligned: false,
      onboardingEmailStatus: 'account_exists',
    });
    expect(storeService.getVendorById('mumbai@migrated.test', 'all').id).toBe(vendor.id);
  });

  test('falls back to token fields when the identity lookup fails', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValueOnce(new Error('db down'));
    const vendor = await storeService.ensureVendorProfileForUser({
      role: 'vendor',
      email: 'token@migrated.test',
      name: 'Token Name',
      orgName: 'Token Org',
    });
    expect(vendor).toMatchObject({ name: 'Token Org', contactPerson: 'Token Name', phone: '' });
  });

  test('uses the contact name, then the email, when no organisation name exists', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    const named = await storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'named@migrated.test', name: 'Only Name' });
    expect(named.name).toBe('Only Name');
    const bare = await storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'bare@migrated.test' });
    expect(bare).toMatchObject({ name: 'bare@migrated.test', contactPerson: '' });
  });

  test('concurrent calls share a single creation', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    const addSpy = jest.spyOn(storeService, 'addVendor');
    const user = { role: 'vendor', email: 'race@migrated.test' };
    const [a, b] = await Promise.all([
      storeService.ensureVendorProfileForUser(user),
      storeService.ensureVendorProfileForUser(user),
    ]);
    expect(a).toBe(b);
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(storeService._pendingVendorProfiles.size).toBe(0);
  });

  test('returns the winning row when another isolate created it first (409)', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    jest.spyOn(storeService, 'confirmVendorPersisted').mockRejectedValueOnce(Object.assign(new Error('dup'), { statusCode: 409 }));
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue({ id: 'v-winner', email: 'conflict@migrated.test' });
    const vendor = await storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'conflict@migrated.test' });
    expect(vendor.id).toBe('v-winner');
  });

  test('returns null when the 409 winner cannot be re-read', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    jest.spyOn(storeService, 'confirmVendorPersisted').mockRejectedValueOnce(Object.assign(new Error('dup'), { statusCode: 409 }));
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);
    await expect(
      storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'gone@migrated.test' })
    ).resolves.toBeNull();
  });

  test('returns null when persisting fails for any other reason', async () => {
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
    jest.spyOn(storeService, 'confirmVendorPersisted').mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    await expect(
      storeService.ensureVendorProfileForUser({ role: 'vendor', email: 'fail@migrated.test' })
    ).resolves.toBeNull();
  });
});

describe('Vendor without a profile', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    storeService.vendors = storeService.vendors.filter((v) => !String(v.email || '').endsWith('@migrated.test'));
  });

  function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  test('GET /api/rfqs sees V0/V2/V3 RFQs instead of an empty list', async () => {
    const rfq = { id: 'rfq-mig-v2', rfqNumber: 'RFQ-MIG-V2', title: 'Pumps', category: 'Pumps', sourcingMode: 'mode_2', status: 'Open', quotes: [] };
    storeService.rfqs.unshift(rfq);
    try {
      const res = await request(app)
        .get('/api/rfqs')
        .set({ Authorization: `Bearer ${authService.generateSessionToken({ ...TEST_USERS.vendor, email: 'list@migrated.test' })}` });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.map((r) => r.rfqNumber)).toContain('RFQ-MIG-V2');
      expect(storeService.getVendorById('list@migrated.test', 'all')).toBeTruthy();
    } finally {
      storeService.rfqs = storeService.rfqs.filter((r) => r.id !== rfq.id);
    }
  });

  test('rfq-credits returns the auto-created profile credits for a vendor', async () => {
    const res = mockRes();
    await vendorController.getVendorRfqCredits(
      { params: {}, user: { role: 'vendor', email: 'credits@migrated.test' } },
      res,
      jest.fn()
    );
    const created = storeService.getVendorById('credits@migrated.test', 'all');
    expect(created).toBeTruthy();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: storeService.getVendorRfqCredits(created.id) });
  });

  test('rfq-credits does not auto-create a profile for non-vendor roles', async () => {
    const ensureSpy = jest.spyOn(storeService, 'ensureVendorProfileForUser');
    const res = mockRes();
    await vendorController.getVendorRfqCredits(
      { params: {}, user: { role: 'admin', email: 'admin@migrated.test' } },
      res,
      jest.fn()
    );
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.vendorId).toBe('admin@migrated.test');
  });
});

describe('RFQ extend/delete role guards', () => {
  test.each([
    ['post', '/api/rfqs/any-rfq/extend'],
    ['delete', '/api/rfqs/any-rfq'],
  ])('%s %s rejects vendors with 403', async (method, path) => {
    const res = await request(app)[method](path)
      .set(authHeader('vendor'))
      .send({ hours: 24 });
    expect(res.statusCode).toBe(403);
  });
});

// A migrated vendor who signed in before being added has an auto-created,
// unowned profile; the next add (single or bulk) takes it over instead of 409ing.
describe('claiming an auto-created migrated profile', () => {
  const pool = require('../src/db/pool');

  function seedMigrated(email, extra = {}) {
    const vendor = {
      id: `v-mig-${email}`,
      email,
      name: email,
      source: 'migrated_identity',
      majorCategory: '',
      buyerId: null,
      buyerAccountId: null,
      freeQuotationCredits: 3,
      quotedRfqIds: ['rfq-a'],
      unlockedRfqIds: ['rfq-b'],
      rfqDownloadsUsed: 2,
      subscriptionPlan: 'select',
      onboardingEmailStatus: 'account_exists',
      ...extra,
    };
    storeService.vendors.unshift(vendor);
    return vendor;
  }

  function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  beforeEach(() => {
    jest.spyOn(storeService, 'confirmVendorPersisted').mockResolvedValue({ persisted: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    storeService.vendors = storeService.vendors.filter((v) => !String(v.email || '').endsWith('@migrated.test'));
  });

  test('returns null without an email or a matching profile', async () => {
    await expect(storeService.claimMigratedVendorProfile('', {})).resolves.toBeNull();
    await expect(storeService.claimMigratedVendorProfile('nobody@migrated.test', {})).resolves.toBeNull();
  });

  test('returns null for profiles that are not unowned migrated ones', async () => {
    seedMigrated('regular@migrated.test', { source: 'self_registration' });
    seedMigrated('owned@migrated.test', { buyerId: 'buyer-x' });
    seedMigrated('owned2@migrated.test', { buyerAccountId: 'buyer-y' });
    for (const email of ['regular@migrated.test', 'owned@migrated.test', 'owned2@migrated.test']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(storeService.claimMigratedVendorProfile(email, { name: 'X' }, 'buyer-1')).resolves.toBeNull();
    }
  });

  test('returns null when the lookup matched a different email (corporateEmail)', async () => {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
      id: 'v-corp', email: 'other@migrated.test', source: 'migrated_identity',
    });
    await expect(storeService.claimMigratedVendorProfile('corp@migrated.test', {})).resolves.toBeNull();
  });

  test('links the profile to the buyer and keeps the vendor usage', async () => {
    seedMigrated('claim@migrated.test');
    const claimed = await storeService.claimMigratedVendorProfile(
      'Claim@Migrated.test',
      {
        id: 'ignored', email: 'ignored@x.test', name: 'Claimed Co', majorCategory: 'Pumps',
        freeQuotationCredits: 99, quotedRfqIds: [], unlockedRfqIds: [], rfqDownloadsUsed: 0,
        subscriptionPlan: 'premium', onboardingEmailStatus: 'pending', createdAt: 'x', created_at: 'x',
      },
      'buyer-1',
      'buyer@procucev.com'
    );
    expect(claimed).toMatchObject({
      id: 'v-mig-claim@migrated.test',
      email: 'claim@migrated.test',
      name: 'Claimed Co',
      majorCategory: 'Pumps',
      buyerId: 'buyer-1',
      buyerAccountId: 'buyer-1',
      source: 'buyer_manual',
      isCategoryAligned: true,
      onboardingEmailStatus: 'account_exists',
      freeQuotationCredits: 3,
      quotedRfqIds: ['rfq-a'],
      unlockedRfqIds: ['rfq-b'],
      rfqDownloadsUsed: 2,
      subscriptionPlan: 'select',
    });
    expect(storeService.confirmVendorPersisted).toHaveBeenCalledWith(claimed);
  });

  test('derives the source when none is given and keeps an explicit one', async () => {
    seedMigrated('network@migrated.test');
    seedMigrated('company@migrated.test');
    seedMigrated('explicit@migrated.test');
    seedMigrated('nodetails@migrated.test');
    const network = await storeService.claimMigratedVendorProfile('network@migrated.test', { isCategoryAligned: false });
    expect(network).toMatchObject({ source: 'procucev_network', buyerId: null, isCategoryAligned: false });
    const company = await storeService.claimMigratedVendorProfile('company@migrated.test', { addedByBuyerCompany: 'Acme' });
    expect(company.source).toBe('buyer_manual');
    const explicit = await storeService.claimMigratedVendorProfile('explicit@migrated.test', { source: 'excel' });
    expect(explicit.source).toBe('excel');
    const noDetails = await storeService.claimMigratedVendorProfile('nodetails@migrated.test');
    expect(noDetails.source).toBe('procucev_network');
  });

  test('createVendor takes over the migrated profile with 201', async () => {
    seedMigrated('add@migrated.test');
    const provisionSpy = jest.spyOn(storeService, 'provisionVendorOnboarding');
    const res = mockRes();
    await vendorController.createVendor(
      {
        body: { name: 'Added Co', email: 'add@migrated.test', majorCategory: 'Pumps' },
        query: { buyerId: 'buyer-2' },
        user: { role: 'admin', email: 'admin@procucev.com' },
      },
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ id: 'v-mig-add@migrated.test', buyerId: 'buyer-2', name: 'Added Co' });
    expect(provisionSpy).not.toHaveBeenCalled();
  });

  test('createVendor still returns 409 for a non-migrated duplicate', async () => {
    seedMigrated('dup@migrated.test', { source: 'self_registration' });
    const res = mockRes();
    await vendorController.createVendor(
      { body: { name: 'Dup', email: 'dup@migrated.test', majorCategory: 'Pumps' }, query: {}, user: { role: 'admin', email: 'admin@procucev.com' } },
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('bulk import claims migrated duplicates from memory and from the DB', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockResolvedValue([]);
    jest.spyOn(identityQueries, 'findExistingUsernames').mockResolvedValue(new Set());
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    seedMigrated('mem@migrated.test');
    seedMigrated('boom@migrated.test');
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockImplementation(async (email) =>
      (email === 'dbonly@migrated.test'
        ? { id: 'v-dbonly', email: 'dbonly@migrated.test', name: 'Db Only', source: 'migrated_identity' }
        : null)
    );
    const realClaim = storeService.claimMigratedVendorProfile.bind(storeService);
    jest.spyOn(storeService, 'claimMigratedVendorProfile').mockImplementation(async (email, ...rest) => {
      if (email === 'boom@migrated.test') throw new Error('claim failed');
      return realClaim(email, ...rest);
    });

    const row = (rowNumber, email) => ({
      rowNumber, email, name: `Row ${rowNumber}`, phone: '9000000000', majorCategory: 'Pumps', buyerId: 'buyer-3',
    });
    const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
      row(2, 'mem@migrated.test'),
      row(3, 'dbonly@migrated.test'),
      row(4, 'boom@migrated.test'),
      row(5, 'fresh@migrated.test'),
    ]);

    const byRow = Object.fromEntries(results.map((r) => [r.rowNumber, r]));
    expect(byRow[2]).toMatchObject({ status: 'imported', onboardingEmailStatus: 'account_exists' });
    expect(byRow[2].vendor).toMatchObject({ id: 'v-mig-mem@migrated.test', buyerId: 'buyer-3', name: 'Row 2' });
    expect(byRow[2].reason).toBeUndefined();
    expect(byRow[3]).toMatchObject({ status: 'imported' });
    expect(byRow[3].vendor).toMatchObject({ id: 'v-dbonly', buyerId: 'buyer-3' });
    expect(byRow[4]).toMatchObject({ status: 'duplicate', reason: 'A vendor with this email already exists.' });
    expect(byRow[5]).toMatchObject({ status: 'duplicate' });
    expect(importedCount).toBe(2);
    expect(duplicateCount).toBe(2);
  });
});
