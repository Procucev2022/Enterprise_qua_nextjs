const buyerProfileService = require('../src/services/buyerProfileService');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const dbPool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const { BUYER_PROFILE_MESSAGES, AUTH_MESSAGES, BUYER_PROFILE_CONFIG } = require('../src/config/constants');

const SESSION = { sub: 'user-1', email: 'buyer@procucev.com', role: 'buyer', orgId: 'org-1' };

const STORED_PROFILE = {
  organizationId: 'org-1',
  userId: 'user-1',
  companyName: 'Larsen & Toubro Limited',
  brandName: 'L&T Heavy Engineering',
  organizationType: 'Public Limited',
  panNumber: 'AAACL1234F',
  gstNumber: '27AAACL1234F1Z5',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://www.larsentoubro.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  street: 'L&T House',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  contactName: 'Rajesh Sharma',
  contactDesignation: 'Chief Procurement Officer (CPO)',
  contactEmail: 'buyer@procucev.com',
  contactPhone: '+919820144820',
  categories: [{ major: 'IT', minor: 'Laptop' }],
};

describe('Buyer profile service', () => {
  const originalPool = dbPool.pool;

  beforeEach(() => {
    // The service refuses to touch an unconfigured identity database, so tests
    // that exercise real behaviour need a pool present.
    dbPool.pool = originalPool || {};
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => undefined);
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  // ── Identity resolution ───────────────────────────────────────────────────
  describe('resolveBuyerIdentity', () => {
    test('takes the user id from the session subject claim', () => {
      expect(buyerProfileService.resolveBuyerIdentity(SESSION)).toEqual({
        userId: 'user-1',
        email: 'buyer@procucev.com',
      });
    });

    test('tolerates a session with no email', () => {
      expect(buyerProfileService.resolveBuyerIdentity({ sub: 'user-1' })).toEqual({
        userId: 'user-1',
        email: '',
      });
    });

    test('rejects a session that identifies no user', () => {
      expect(() => buyerProfileService.resolveBuyerIdentity(null)).toThrow(
        BUYER_PROFILE_MESSAGES.SESSION_MISSING_USER
      );
      expect(() => buyerProfileService.resolveBuyerIdentity({})).toThrow(
        BUYER_PROFILE_MESSAGES.SESSION_MISSING_USER
      );
    });
  });

  describe('assertIdentityConfigured', () => {
    test('throws a 503 when the identity database is absent', () => {
      dbPool.pool = null;
      try {
        buyerProfileService.assertIdentityConfigured();
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.status).toBe(503);
        expect(err.message).toBe(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
      }
    });
  });

  describe('raiseLookupFailure', () => {
    test.each([
      ['USER_NOT_FOUND', 404, BUYER_PROFILE_MESSAGES.USER_NOT_FOUND],
      ['ORG_NOT_LINKED', 409, BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_LINKED],
      ['NO_USER_ID', 401, BUYER_PROFILE_MESSAGES.SESSION_MISSING_USER],
    ])('maps %s onto %i', (reason, status, message) => {
      try {
        buyerProfileService.raiseLookupFailure(reason);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.status).toBe(status);
        expect(err.message).toBe(message);
      }
    });
  });

  // ── Category normalisation ────────────────────────────────────────────────
  describe('normalizeCategories', () => {
    test('passes undefined through so an omitted selection is left alone', () => {
      expect(buyerProfileService.normalizeCategories(undefined)).toBeUndefined();
      expect(buyerProfileService.normalizeCategories(null)).toBeUndefined();
    });

    test('trims and keeps distinct pairs', () => {
      expect(
        buyerProfileService.normalizeCategories([
          { major: ' IT ', minor: ' Laptop ' },
          { major: 'IT', minor: 'Servers' },
        ])
      ).toEqual([
        { major: 'IT', minor: 'Laptop' },
        { major: 'IT', minor: 'Servers' },
      ]);
    });

    test('collapses a repeated pair rather than rejecting it', () => {
      expect(
        buyerProfileService.normalizeCategories([
          { major: 'IT', minor: 'Laptop' },
          { major: 'it', minor: 'laptop' },
        ])
      ).toEqual([{ major: 'IT', minor: 'Laptop' }]);
    });

    test('accepts an empty array, which clears the selection', () => {
      expect(buyerProfileService.normalizeCategories([])).toEqual([]);
    });

    test('rejects a pair missing either half', () => {
      expect(() => buyerProfileService.normalizeCategories([{ major: '', minor: 'Laptop' }])).toThrow(
        BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID
      );
      expect(() => buyerProfileService.normalizeCategories([{ major: 'IT' }])).toThrow(
        BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID
      );
      expect(() => buyerProfileService.normalizeCategories([null])).toThrow(
        BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID
      );
    });

    test('rejects a non-array selection', () => {
      expect(() => buyerProfileService.normalizeCategories('IT')).toThrow(
        BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID
      );
    });

    test('enforces the major category cap', () => {
      const tooMany = ['A', 'B', 'C', 'D', 'E', 'F'].map((major) => ({ major, minor: 'x' }));
      try {
        buyerProfileService.normalizeCategories(tooMany);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.status).toBe(400);
        expect(err.message).toContain(String(BUYER_PROFILE_CONFIG.MAX_MAJOR_CATEGORIES));
        expect(err.details).toHaveProperty('categories');
      }
    });

    test('enforces the minor category cap', () => {
      const tooMany = Array.from({ length: BUYER_PROFILE_CONFIG.MAX_MINOR_CATEGORIES + 1 }, (_, i) => ({
        major: 'IT',
        minor: `minor-${i}`,
      }));
      try {
        buyerProfileService.normalizeCategories(tooMany);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.status).toBe(400);
        expect(err.message).toContain(String(BUYER_PROFILE_CONFIG.MAX_MINOR_CATEGORIES));
      }
    });

    test('accepts a selection exactly at both caps', () => {
      const atCap = Array.from({ length: BUYER_PROFILE_CONFIG.MAX_MINOR_CATEGORIES }, (_, i) => ({
        major: `major-${i % BUYER_PROFILE_CONFIG.MAX_MAJOR_CATEGORIES}`,
        minor: `minor-${i}`,
      }));
      expect(buyerProfileService.normalizeCategories(atCap)).toHaveLength(
        BUYER_PROFILE_CONFIG.MAX_MINOR_CATEGORIES
      );
    });
  });

  // ── Field picking ─────────────────────────────────────────────────────────
  describe('pickPatchableFields', () => {
    test('keeps only supplied profile fields', () => {
      expect(
        buyerProfileService.pickPatchableFields({ companyName: 'ACME', city: 'Pune', state: null })
      ).toEqual({ companyName: 'ACME', city: 'Pune' });
    });

    // These are the account's own login identity, owned by the `user` row.
    test('drops contact email, phone and anything else not on the allow list', () => {
      expect(
        buyerProfileService.pickPatchableFields({
          companyName: 'ACME',
          contactEmail: 'attacker@evil.com',
          contactPhone: '+910000000000',
          organizationId: 'other-org',
          rfqCredits: 9999,
        })
      ).toEqual({ companyName: 'ACME' });
    });
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  describe('getProfile', () => {
    test('returns the stored profile for the signed-in buyer', async () => {
      const spy = jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValue({ found: true, profile: STORED_PROFILE });

      await expect(buyerProfileService.getProfile(SESSION)).resolves.toEqual(STORED_PROFILE);
      // Resolved from the session subject, never from a request body.
      expect(spy).toHaveBeenCalledWith('user-1');
    });

    test('reports a 409 when the account has no organisation', async () => {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValue({ found: false, reason: 'ORG_NOT_LINKED' });

      await expect(buyerProfileService.getProfile(SESSION)).rejects.toMatchObject({
        status: 409,
        message: BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_LINKED,
      });
    });

    test('reports a 503 when the database read fails', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(buyerProfileService.getProfile(SESSION)).rejects.toMatchObject({
        status: 503,
        message: BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED,
      });
    });

    test('refuses when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(buyerProfileService.getProfile(SESSION)).rejects.toMatchObject({ status: 503 });
    });
  });

  // ── Write ─────────────────────────────────────────────────────────────────
  describe('saveProfile', () => {
    function mockHappyPath() {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValue({ found: true, profile: STORED_PROFILE });
      return jest
        .spyOn(buyerProfileQueries, 'updateProfile')
        .mockResolvedValue({ updated: true, fieldsUpdated: 2, categoryCount: 1 });
    }

    test('persists the patch and returns the re-read record', async () => {
      const update = mockHappyPath();

      const result = await buyerProfileService.saveProfile(
        SESSION,
        { companyName: 'ACME Ltd', categories: [{ major: 'IT', minor: 'Laptop' }] },
        '10.0.0.1'
      );

      expect(result.profile).toEqual(STORED_PROFILE);
      expect(result.categoryCount).toBe(1);
      expect(update).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { companyName: 'ACME Ltd' },
        categories: [{ major: 'IT', minor: 'Laptop' }],
        actor: 'buyer@procucev.com',
      });
      expect(storeService.addAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ userEmail: 'buyer@procucev.com' })
      );
    });

    test('ignores an organisation id supplied in the body', async () => {
      const update = mockHappyPath();

      await buyerProfileService.saveProfile(SESSION, {
        companyName: 'ACME Ltd',
        organizationId: 'someone-elses-org',
        userId: 'someone-elses-user',
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' })
      );
    });

    test('leaves the selection alone when categories are omitted', async () => {
      const update = mockHappyPath();
      await buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' });
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ categories: undefined }));
    });

    test('rejects a payload with no legal entity name', async () => {
      mockHappyPath();
      await expect(buyerProfileService.saveProfile(SESSION, {})).rejects.toMatchObject({
        status: 400,
        details: expect.objectContaining({ companyName: expect.any(String) }),
      });
    });

    test.each([
      ['panNumber', 'NOTAPAN'],
      ['gstNumber', '27AAACL1234F1Z'],
      ['cinNumber', 'L28920MH1946PLC00476'],
      ['website', 'larsentoubro.com'],
      ['pincode', '040001'],
      ['organizationType', 'Cooperative Society'],
    ])('rejects a malformed %s', async (field, value) => {
      mockHappyPath();
      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd', [field]: value })
      ).rejects.toMatchObject({ status: 400, details: expect.objectContaining({ [field]: expect.any(String) }) });
    });

    test('accepts every optional field when correctly formatted', async () => {
      const update = mockHappyPath();
      await buyerProfileService.saveProfile(SESSION, {
        companyName: 'ACME Ltd',
        brandName: 'ACME Heavy',
        organizationType: 'LLP',
        panNumber: 'AAACL1234F',
        gstNumber: '27AAACL1234F1Z5',
        cinNumber: 'L28920MH1946PLC004768',
        website: 'https://acme.example.com',
        annualTurnover: '₹ 180 Cr',
        street: 'Plot 1',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        country: 'India',
        contactName: 'Someone',
        contactDesignation: 'CPO',
      });
      expect(update).toHaveBeenCalled();
    });

    test('reports a 409 when the account has no organisation', async () => {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValue({ found: false, reason: 'ORG_NOT_LINKED' });

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).rejects.toMatchObject({ status: 409 });
    });

    test('reports a 503 when the pre-save lookup fails', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).rejects.toMatchObject({ status: 503, message: BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED });
    });

    test('reports a 503 when the write fails', async () => {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValue({ found: true, profile: STORED_PROFILE });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockRejectedValue(new Error('deadlock'));

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).rejects.toMatchObject({ status: 503, message: BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED });
    });

    test('reports a 404 when the organisation vanished between lookup and write', async () => {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValue({ found: true, profile: STORED_PROFILE });
      jest
        .spyOn(buyerProfileQueries, 'updateProfile')
        .mockResolvedValue({ updated: false, reason: 'ORG_NOT_FOUND' });

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).rejects.toMatchObject({ status: 404, message: BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_FOUND });
    });

    test('reports a 503 when the post-save re-read fails', async () => {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValueOnce({ found: true, profile: STORED_PROFILE })
        .mockRejectedValueOnce(new Error('ETIMEDOUT'));
      jest
        .spyOn(buyerProfileQueries, 'updateProfile')
        .mockResolvedValue({ updated: true, fieldsUpdated: 1, categoryCount: 0 });

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).rejects.toMatchObject({ status: 503, message: BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED });
    });

    test('returns a null profile when the re-read finds nothing', async () => {
      jest
        .spyOn(buyerProfileQueries, 'findProfileByUserId')
        .mockResolvedValueOnce({ found: true, profile: STORED_PROFILE })
        .mockResolvedValueOnce({ found: false, reason: 'USER_NOT_FOUND' });
      jest
        .spyOn(buyerProfileQueries, 'updateProfile')
        .mockResolvedValue({ updated: true, fieldsUpdated: 1, categoryCount: 0 });

      const result = await buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' });
      expect(result.profile).toBeNull();
    });

    test('falls back to the user id as the audit actor when the session has no email', async () => {
      const update = mockHappyPath();
      await buyerProfileService.saveProfile({ sub: 'user-1' }, { companyName: 'ACME Ltd' });
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ actor: 'user-1' }));
    });

    test('rejects an unauthenticated save before touching the database', async () => {
      const update = jest.spyOn(buyerProfileQueries, 'updateProfile');
      await expect(buyerProfileService.saveProfile({}, { companyName: 'ACME' })).rejects.toMatchObject({
        status: 401,
      });
      expect(update).not.toHaveBeenCalled();
    });

    test('refuses when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).rejects.toMatchObject({ status: 503 });
    });
  });

  // ── Taxonomy ──────────────────────────────────────────────────────────────
  describe('getCategoryTaxonomy', () => {
    test('returns the master taxonomy', async () => {
      const taxonomy = [{ majorCategory: 'IT', minorCategories: ['Laptop'] }];
      jest.spyOn(buyerProfileQueries, 'findCategoryTaxonomy').mockResolvedValue(taxonomy);
      await expect(buyerProfileService.getCategoryTaxonomy()).resolves.toEqual(taxonomy);
    });

    test('reports a 503 when the master cannot be read', async () => {
      jest.spyOn(buyerProfileQueries, 'findCategoryTaxonomy').mockRejectedValue(new Error('down'));
      await expect(buyerProfileService.getCategoryTaxonomy()).rejects.toMatchObject({
        status: 503,
        message: BUYER_PROFILE_MESSAGES.TAXONOMY_LOAD_FAILED,
      });
    });

    test('refuses when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(buyerProfileService.getCategoryTaxonomy()).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('BuyerProfileError', () => {
    test('defaults to a 400 with no details', () => {
      const err = new buyerProfileService.BuyerProfileError('bad input');
      expect(err.name).toBe('BuyerProfileError');
      expect(err.status).toBe(400);
      expect(err.details).toBeNull();
    });
  });
});
