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

    test('auto-heals missing address and tax details from storeService buyer account', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: null,
        city: null,
        state: null,
        pincode: null,
        gstNumber: null,
        panNumber: null,
        country: '',
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        address1: 'B-10 Sector 5',
        city: 'Noida',
        state: 'UP',
        pincode: '201301',
        gstin: '07AAACL1234F1Z5',
        pan: 'AAACL1234F',
        country: 'India',
      });
      const updateSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ found: true });

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.street).toBe('B-10 Sector 5');
      expect(profile.city).toBe('Noida');
      expect(profile.state).toBe('UP');
      expect(profile.pincode).toBe('201301');
      expect(profile.gstNumber).toBe('07AAACL1234F1Z5');
      expect(profile.panNumber).toBe('AAACL1234F');
      expect(profile.country).toBe('India');
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          patch: expect.objectContaining({
            street: 'B-10 Sector 5',
            city: 'Noida',
            state: 'UP',
            pincode: '201301',
            gstNumber: '07AAACL1234F1Z5',
            panNumber: 'AAACL1234F',
          }),
        })
      );
    });

    test('auto-heals with city and state fallback when address is missing', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: null,
        city: null,
        state: null,
        pincode: null,
        gstNumber: null,
        panNumber: null,
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        city: 'Bengaluru',
        state: 'Karnataka',
        zipCode: '560001',
        gstNumber: '29AAACL1234F1Z5',
      });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockRejectedValue(new Error('DB write failed'));

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.street).toBe('Bengaluru, Karnataka');
      expect(profile.pincode).toBe('560001');
      expect(profile.gstNumber).toBe('29AAACL1234F1Z5');
      expect(profile.panNumber).toBeNull();
    });

    test('does not auto-heal dummy PAN from GSTIN when buyer account not found in storeService', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: 'Main Road',
        gstNumber: '27AAACL1234F1Z5',
        panNumber: null,
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      const updateSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ found: true });

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.panNumber).toBeNull();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test('handles storeService and updateProfile errors gracefully in auto-healing', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        gstNumber: '27AAACL1234F1Z5',
        panNumber: null,
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockRejectedValue(new Error('store offline'));

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.companyName).toBe('Test Corp');
    });

    test('auto-heals with city only and pan directly when state is not available', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: null,
        city: null,
        state: null,
        pincode: null,
        country: '',
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        city: 'Jaipur',
        pan: 'ABCDE1234F',
      });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ found: true });

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.street).toBe('Jaipur');
      expect(profile.panNumber).toBe('ABCDE1234F');
      expect(profile.country).toBe('India');
    });

    test('auto-heals with direct street from buyer account', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: null,
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        street: '123 MG Road',
      });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ found: true });

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.street).toBe('123 MG Road');
    });
  });

  describe('resolveOrganizationId lookup failure in getDispatchTemplates', () => {
    test('reports 503 when organization lookup throws in resolveOrganizationId', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValue(new Error('DB failure'));
      await expect(buyerProfileService.getDispatchTemplates(SESSION)).rejects.toMatchObject({
        status: 503,
        message: BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED,
      });
    });
  });

  // ── Vendor onboarding dispatch templates (Template A / Template B) ─────────
  describe('getDispatchTemplates', () => {
    test('resolves the organisation from the session and reads its templates', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      const readSpy = jest
        .spyOn(buyerProfileQueries, 'getDispatchTemplates')
        .mockResolvedValue({ category_mapped: { subject: 'Hi', message: 'Welcome' } });

      await expect(buyerProfileService.getDispatchTemplates(SESSION)).resolves.toEqual({
        category_mapped: { subject: 'Hi', message: 'Welcome' },
      });
      expect(readSpy).toHaveBeenCalledWith('org-1');
    });

    test('reports a 409 when the account has no organisation', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: false, reason: 'ORG_NOT_LINKED' });
      await expect(buyerProfileService.getDispatchTemplates(SESSION)).rejects.toMatchObject({ status: 409 });
    });

    test('reports a 503 when the read fails', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      jest.spyOn(buyerProfileQueries, 'getDispatchTemplates').mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(buyerProfileService.getDispatchTemplates(SESSION)).rejects.toMatchObject({
        status: 503,
        message: BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED,
      });
    });
  });

  describe('saveDispatchTemplate', () => {
    test('saves the custom subject/message for the signed-in buyer\'s organisation', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      const writeSpy = jest
        .spyOn(buyerProfileQueries, 'upsertDispatchTemplate')
        .mockResolvedValue({ subject: 'Hi', message: 'Welcome' });

      const result = await buyerProfileService.saveDispatchTemplate(SESSION, 'category_mapped', {
        subject: 'Hi',
        message: 'Welcome',
      });

      expect(result).toEqual({ subject: 'Hi', message: 'Welcome' });
      expect(writeSpy).toHaveBeenCalledWith('org-1', 'category_mapped', { subject: 'Hi', message: 'Welcome' }, SESSION.email);
    });

    test('rejects an unknown template type before touching the database', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      const writeSpy = jest.spyOn(buyerProfileQueries, 'upsertDispatchTemplate');

      await expect(
        buyerProfileService.saveDispatchTemplate(SESSION, 'not_a_real_type', { subject: 'x', message: 'y' })
      ).rejects.toMatchObject({ status: 400 });
      expect(writeSpy).not.toHaveBeenCalled();
    });

    test('reports a 503 when the write fails', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      jest.spyOn(buyerProfileQueries, 'upsertDispatchTemplate').mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(
        buyerProfileService.saveDispatchTemplate(SESSION, 'self_map_required', { subject: 'x', message: 'y' })
      ).rejects.toMatchObject({ status: 503, message: BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED });
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

    test('durably syncs account profile fields without accepting a login-phone override', async () => {
      mockHappyPath();
      const updateAccSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue({ id: 'buyer-1' });
      const dispatchSpy = jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue({});

      await buyerProfileService.saveProfile(SESSION, {
        companyName: 'ACME Real Ltd',
        contactName: 'Alice',
        contactPhone: '9876543210',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        gstNumber: '27AAAAA0000A1Z5',
        panNumber: 'AAAAA0000A',
      });

      expect(updateAccSpy).toHaveBeenCalledWith(SESSION.email, expect.objectContaining({
        organizationName: 'ACME Real Ltd',
        status: 'ACTIVE_VERIFIED',
      }));
      expect(updateAccSpy.mock.calls[0][1]).not.toEqual(expect.objectContaining({
        phone: expect.anything(),
        mobileNumber: expect.anything(),
        phoneVerified: expect.anything(),
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(SESSION.email);
    });

    test('does not sync an unverified placeholder phone from an extra request field', async () => {
      mockHappyPath();
      const updateAccSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue({ id: 'buyer-1' });
      const dispatchSpy = jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue({});

      await buyerProfileService.saveProfile(SESSION, {
        companyName: 'ACME Placeholder Ltd',
        contactPhone: '9999999999',
      });

      expect(updateAccSpy.mock.calls[0][1]).not.toEqual(expect.objectContaining({
        phone: expect.anything(),
        mobileNumber: expect.anything(),
        phoneVerified: expect.anything(),
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(SESSION.email);
    });

    test('syncs storeService successfully with valid profile data', async () => {
      mockHappyPath();
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue({ id: 'buyer-1' });
      jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue({});

      const result = await buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Valid', city: 'Pune' });
      expect(result).toBeDefined();
    });

    test('dispatches pending notifications even if durable account synchronization fails', async () => {
      mockHappyPath();
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockRejectedValue(new Error('Store sync failed'));
      const dispatchSpy = jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue({});

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd', contactPhone: '9876543210' })
      ).resolves.toBeDefined();
      expect(dispatchSpy).toHaveBeenCalledWith(SESSION.email);
    });

    test('keeps a notification dispatch error from changing the saved profile result', async () => {
      mockHappyPath();
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue({ id: 'buyer-1' });
      jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockRejectedValue(new Error('notification queue unavailable'));

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).resolves.toBeDefined();
    });

    test('logs a missing buyer-account mirror without failing the canonical profile save', async () => {
      mockHappyPath();
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue(null);
      jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue({});

      await expect(
        buyerProfileService.saveProfile(SESSION, { companyName: 'ACME Ltd' })
      ).resolves.toBeDefined();
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

  describe('BuyerProfileError and branch coverage edge cases', () => {
    test('defaults to a 400 with no details', () => {
      const err = new buyerProfileService.BuyerProfileError('bad input');
      expect(err.name).toBe('BuyerProfileError');
      expect(err.status).toBe(400);
      expect(err.details).toBeNull();
    });

    test('auto-heals with address, zip_code, gst, and pan properties on buyer account', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: null,
        city: null,
        state: null,
        pincode: null,
        gstNumber: null,
        panNumber: null,
        country: '',
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        address: 'Plot 44',
        city: 'Ahmedabad',
        zip_code: '380001',
        gst: '24AAACL1234F1Z5',
        pan: 'AAACL1234F',
      });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ found: true });

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.street).toBe('Plot 44');
      expect(profile.city).toBe('Ahmedabad');
      expect(profile.pincode).toBe('380001');
      expect(profile.gstNumber).toBe('24AAACL1234F1Z5');
      expect(profile.panNumber).toBe('AAACL1234F');
      expect(profile.country).toBe('India');
    });

    test('auto-heals street with city only when state is absent', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: null,
        city: null,
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        city: 'Delhi',
      });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ found: true });

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.street).toBe('Delhi');
    });

    test('catches updateProfile error during buyer account auto-healing in getProfile', async () => {
      const partialProfile = {
        organizationId: 'org-1',
        userId: 'user-1',
        companyName: 'Test Corp',
        street: 'Existing Street',
        gstNumber: '27AAACL1234F1Z5',
        panNumber: null,
      };
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { ...partialProfile } });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ pan: 'AAACL1234F' });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockRejectedValue(new Error('PAN update failed'));

      const profile = await buyerProfileService.getProfile(SESSION);
      expect(profile.panNumber).toBe('AAACL1234F');
    });

    test('saveDispatchTemplate falls back to null actor when session email is omitted', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      const upsertSpy = jest.spyOn(buyerProfileQueries, 'upsertDispatchTemplate').mockResolvedValue({ success: true });

      await buyerProfileService.saveDispatchTemplate({ sub: 'user-1' }, 'category_mapped', { subject: 'Test', message: 'Body' });
      expect(upsertSpy).toHaveBeenCalledWith('org-1', 'category_mapped', { subject: 'Test', message: 'Body' }, null);
    });

    test('saveProfile audits updated profile successfully', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ updated: true });

      const res = await buyerProfileService.saveProfile(SESSION, { companyName: 'Brand Corp', brandName: 'BrandOnly' });
      expect(res.profile).toEqual(STORED_PROFILE);
    });
  });

  describe('D1 overload fallbacks', () => {
    const d1Bridge = require('../src/db/d1Bridge');
    const { DEFAULT_CATEGORY_TAXONOMY } = require('../src/config/constants');

    afterEach(() => {
      d1Bridge.resetD1OverloadState();
    });

    test('getProfile falls back to storeService buyer account when D1 is overloaded', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValueOnce(new Error('D1 DB is overloaded'));
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        organizationId: 'org-fallback-1',
        organizationName: 'Fallback Industries Pvt Ltd',
        contactPerson: 'Ananya Rao',
        phone: '9820011223',
        street: '14 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
        gstin: '29aaacl1234f1z5',
        pan: 'aaacl1234f',
      });

      const profile = await buyerProfileService.getProfile(SESSION);

      expect(profile).toEqual({
        userId: 'user-1',
        email: 'buyer@procucev.com',
        organizationId: 'org-fallback-1',
        companyName: 'Fallback Industries Pvt Ltd',
        contactName: 'Ananya Rao',
        contactEmail: 'buyer@procucev.com',
        contactPhone: '9820011223',
        phone: '9820011223',
        street: '14 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
        gstNumber: '29AAACL1234F1Z5',
        panNumber: 'AAACL1234F',
        categories: [],
      });
    });

    test('getProfile maps alternate buyer-account fields and defaults in D1 overload fallback', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValueOnce(new Error('D1 DB is overloaded'));
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        companyName: 'Alt Co',
        name: 'Vikram Seth',
        mobile: '9811122233',
        address: 'Plot 9',
        zipCode: '110001',
        gstNumber: '07aaacl1234f1z9',
        panNumber: 'aaacl1234f',
      });

      const profile = await buyerProfileService.getProfile(SESSION);

      expect(profile.organizationId).toBe('user-1');
      expect(profile.companyName).toBe('Alt Co');
      expect(profile.contactName).toBe('Vikram Seth');
      expect(profile.contactPhone).toBe('9811122233');
      expect(profile.street).toBe('Plot 9');
      expect(profile.pincode).toBe('110001');
      expect(profile.country).toBe('India');
      expect(profile.gstNumber).toBe('07AAACL1234F1Z9');
      expect(profile.panNumber).toBe('AAACL1234F');
    });

    test('getProfile throws 503 when D1 is overloaded and buyer-account lookup rejects', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValueOnce(new Error('D1 DB is overloaded'));
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockRejectedValueOnce(new Error('store lookup failed'));

      await expect(buyerProfileService.getProfile(SESSION)).rejects.toMatchObject({
        status: 503,
        message: BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED,
      });
    });

    test('getCategoryTaxonomy returns cloned DEFAULT_CATEGORY_TAXONOMY when D1 is overloaded', async () => {
      jest.spyOn(buyerProfileQueries, 'findCategoryTaxonomy').mockRejectedValueOnce(new Error('D1 DB is overloaded'));

      const taxonomy = await buyerProfileService.getCategoryTaxonomy();

      expect(taxonomy).toEqual(DEFAULT_CATEGORY_TAXONOMY);
      expect(taxonomy).not.toBe(DEFAULT_CATEGORY_TAXONOMY);
    });

    test('getProfile auto-heals missing GSTIN, PAN, street, pincode, and country from buyer account mirror', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
        found: true,
        profile: {
          ...STORED_PROFILE,
          street: '',
          city: '',
          state: '',
          pincode: '',
          country: '',
          gstNumber: '',
          panNumber: '',
        },
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        corporateEmail: SESSION.email,
        address: '42 Industrial Estate',
        city: 'Bengaluru',
        state: 'Karnataka',
        zipCode: '560099',
        country: 'India',
        gst: '29abcde1234f1z5',
        panNumber: 'abcde1234f',
      });
      const updateSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ updated: true });

      const hydrated = await buyerProfileService.getProfile(SESSION);

      expect(hydrated.street).toBe('42 Industrial Estate');
      expect(hydrated.gstNumber).toBe('29ABCDE1234F1Z5');
      expect(hydrated.panNumber).toBe('ABCDE1234F');
      expect(hydrated.pincode).toBe('560099');
      expect(hydrated.country).toBe('India');
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        patch: expect.objectContaining({
          street: '42 Industrial Estate',
          gstNumber: '29ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          pincode: '560099',
          country: 'India',
        }),
      }));
    });

    test('getProfile recovers buyer account by userId fallback, parses primaryPlantLocation, and derives genuine PAN', async () => {
      const domainQueries = require('../src/db/domainQueries');
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
        found: true,
        profile: {
          ...STORED_PROFILE,
          brandName: '',
          street: '',
          city: '',
          state: '',
          pincode: '',
          country: '',
          gstNumber: '',
          panNumber: '',
        },
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValueOnce([]);
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValueOnce({
        id: 'user-1',
        brandName: 'Veera Brands',
        primaryPlantLocation: 'Bengaluru, Karnataka (560037)',
        gstin: '27AAACK3921P1Z9',
      });
      const updateSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ updated: true });

      const hydrated = await buyerProfileService.getProfile(SESSION);

      expect(hydrated.brandName).toBe('Veera Brands');
      expect(hydrated.city).toBe('Bengaluru');
      expect(hydrated.state).toBe('Karnataka');
      expect(hydrated.pincode).toBe('560037');
      expect(hydrated.street).toBe('Bengaluru, Karnataka');
      expect(hydrated.gstNumber).toBe('27AAACK3921P1Z9');
      expect(hydrated.panNumber).toBe('AAACK3921P');
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        patch: expect.objectContaining({
          brandName: 'Veera Brands',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
          street: 'Bengaluru, Karnataka',
          gstNumber: '27AAACK3921P1Z9',
          panNumber: 'AAACK3921P',
        }),
      }));
    });

    test('saveProfile syncs street, address aliases, constitution, brand, and tax identifiers to buyer_accounts and falls back to userId', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: STORED_PROFILE });
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ updated: true, fieldsUpdated: 10, categoryCount: 1 });
      const updateAccSpy = jest
        .spyOn(storeService, 'updateBuyerAccountDurably')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'user-1' });
      jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue([]);

      await buyerProfileService.saveProfile(SESSION, {
        companyName: 'Veera Solutions Pvt Ltd',
        brandName: 'Veera Sourcing',
        organizationType: 'Private Limited',
        panNumber: 'AAACK3921P',
        gstNumber: '27AAACK3921P1Z9',
        cinNumber: 'L28920MH1946PLC004768',
        website: 'https://veera.example.com',
        annualTurnover: 'INR 50 Cr',
        street: '302, Sharada, AECS Layout',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560037',
        country: 'India',
        contactName: 'Veera',
        contactDesignation: 'Director',
      });

      expect(updateAccSpy).toHaveBeenNthCalledWith(
        1,
        SESSION.email,
        expect.objectContaining({
          organizationName: 'Veera Solutions Pvt Ltd',
          brandName: 'Veera Sourcing',
          organizationType: 'Private Limited',
          street: '302, Sharada, AECS Layout',
          address1: '302, Sharada, AECS Layout',
          address: '302, Sharada, AECS Layout',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
          zip_code: '560037',
          zipCode: '560037',
          country: 'India',
          primaryPlantLocation: 'Bengaluru, Karnataka (560037)',
          gstin: '27AAACK3921P1Z9',
          gstNumber: '27AAACK3921P1Z9',
          pan: 'AAACK3921P',
          panNumber: 'AAACK3921P',
        })
      );
      expect(updateAccSpy).toHaveBeenNthCalledWith(2, 'user-1', expect.any(Object));
    });

    test('D1 overload fallback parses primaryPlantLocation and derives real PAN from GSTIN', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValueOnce(new Error('D1 DB is overloaded'));
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        organizationName: 'Veera Solutions',
        primaryPlantLocation: 'Bengaluru, Karnataka (560037)',
        gstin: '27AAACK3921P1Z9',
      });

      const fallbackProfile = await buyerProfileService.getProfile(SESSION);
      expect(fallbackProfile.city).toBe('Bengaluru');
      expect(fallbackProfile.state).toBe('Karnataka');
      expect(fallbackProfile.pincode).toBe('560037');
      expect(fallbackProfile.street).toBe('Bengaluru, Karnataka');
      expect(fallbackProfile.gstNumber).toBe('27AAACK3921P1Z9');
      expect(fallbackProfile.panNumber).toBe('AAACK3921P');
    });

    test('getProfile derives PAN directly from profile GSTIN when storeService has no buyer account', async () => {
      const domainQueries = require('../src/db/domainQueries');
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
        found: true,
        profile: {
          ...STORED_PROFILE,
          gstNumber: '27AAACK3921P1Z9',
          panNumber: '',
        },
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValueOnce([]);
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValueOnce(null);
      const updateSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({ updated: true });

      const hydrated = await buyerProfileService.getProfile(SESSION);

      expect(hydrated.panNumber).toBe('AAACK3921P');
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        patch: { panNumber: 'AAACK3921P' },
      }));
    });
  });
});
