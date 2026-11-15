const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const dbPool = require('../src/db/pool');

// Every test drives the real query builders and row mappers against a stubbed
// MySQL layer, so the SQL text and the shape handed to the service are asserted
// without needing the shared database to be reachable from CI.
describe('Buyer profile queries (Neon PostgreSQL)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Value coercion ────────────────────────────────────────────────────────
  describe('text', () => {
    test('trims a value and maps NULL / undefined to an empty string', () => {
      expect(buyerProfileQueries.text('  Larsen & Toubro  ')).toBe('Larsen & Toubro');
      expect(buyerProfileQueries.text(null)).toBe('');
      expect(buyerProfileQueries.text(undefined)).toBe('');
    });

    test('stringifies non-string column values', () => {
      expect(buyerProfileQueries.text(400001)).toBe('400001');
    });
  });

  describe('preferred', () => {
    // The dedicated column wins so a value written by this app is what comes
    // back, and the legacy alias covers rows the Java app wrote.
    test('prefers the dedicated column when it carries a value', () => {
      expect(buyerProfileQueries.preferred('L28920MH1946PLC004768', 'legacy-crn')).toBe(
        'L28920MH1946PLC004768'
      );
    });

    test('falls back to the legacy alias column', () => {
      expect(buyerProfileQueries.preferred(null, 'legacy-crn')).toBe('legacy-crn');
      expect(buyerProfileQueries.preferred('   ', 'legacy-crn')).toBe('legacy-crn');
    });

    test('returns an empty string when neither column is populated', () => {
      expect(buyerProfileQueries.preferred(null, null)).toBe('');
    });
  });

  describe('normalizeTurnover', () => {
    // Ported from updateBuyer, which rewrites the rupee sign because
    // organization.annual_turnover is a latin1 column.
    test('rewrites the rupee sign to an ASCII currency code', () => {
      expect(buyerProfileQueries.normalizeTurnover('₹ 1,80,000 Cr+')).toBe('INR 1,80,000 Cr+');
    });

    test('collapses the double space the Java replacement left behind', () => {
      expect(buyerProfileQueries.normalizeTurnover('₹180 Cr')).toBe('INR 180 Cr');
      expect(buyerProfileQueries.normalizeTurnover('₹   180    Cr')).toBe('INR 180 Cr');
    });

    test('leaves a value with no rupee sign alone', () => {
      expect(buyerProfileQueries.normalizeTurnover('USD 20M')).toBe('USD 20M');
    });

    test('returns an empty string for a blank value', () => {
      expect(buyerProfileQueries.normalizeTurnover('')).toBe('');
      expect(buyerProfileQueries.normalizeTurnover(null)).toBe('');
    });
  });

  describe('normalizeCategories', () => {
    test('trims labels, drops blanks and collapses case-insensitive duplicate pairs', () => {
      expect(buyerProfileQueries.normalizeCategories([
        { major: ' IT ', minor: 'Laptop' },
        { major: 'it', minor: ' laptop ' },
        { major: 'IT', minor: 'Servers' },
        { major: '', minor: 'Ignored' },
        null,
      ])).toEqual([
        { major: 'IT', minor: 'Laptop' },
        { major: 'IT', minor: 'Servers' },
      ]);
    });

    test('returns an empty list for non-array input', () => {
      expect(buyerProfileQueries.normalizeCategories(null)).toEqual([]);
    });
  });

  // ── Row mapping ───────────────────────────────────────────────────────────
  describe('mapRowToProfile', () => {
    const row = {
      user_uuid: 'user-1',
      org_uuid: 'org-1',
      username: 'buyer@procucev.com',
      user_email: 'contact@procucev.com',
      full_name: 'Rajesh Sharma',
      phone: '+919820144820',
      organization_name: 'Larsen & Toubro Limited',
      brand_name: 'L&T Heavy Engineering',
      refference: 'legacy-brand',
      type: 'Public Limited',
      pan: 'AAACL1234F',
      gstin: '27AAACL1234F1Z5',
      cin: 'L28920MH1946PLC004768',
      crn: 'legacy-cin',
      website: 'https://www.larsentoubro.com',
      annual_turnover: 'INR 1,80,000 Cr+',
      others: 'legacy-turnover',
      address1: 'L&T House, Ballard Estate',
      city: 'Mumbai',
      state: 'Maharashtra',
      zip_code: '400001',
      country: 'India',
      contact_person: 'Rajesh Sharma',
      contact_designation: 'Chief Procurement Officer (CPO)',
      sub_category: 'legacy-designation',
      email: 'org@procucev.com',
      organization_phonenumber: '+912212345678',
    };

    test('maps every profile column and prefers dedicated columns over aliases', () => {
      const profile = buyerProfileQueries.mapRowToProfile(row);
      expect(profile).toMatchObject({
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
        street: 'L&T House, Ballard Estate',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        country: 'India',
        contactName: 'Rajesh Sharma',
        contactDesignation: 'Chief Procurement Officer (CPO)',
      });
      expect(profile.categories).toEqual([]);
    });

    test('reads contact email and phone from the user row, not the organisation', () => {
      // getOrgByUserId overrides both with the account's own values, because the
      // signed-in user is the authoritative contact.
      const profile = buyerProfileQueries.mapRowToProfile(row);
      expect(profile.contactEmail).toBe('buyer@procucev.com');
      expect(profile.contactPhone).toBe('+919820144820');
    });

    test('falls back to the organisation email and phone when the user row has none', () => {
      const profile = buyerProfileQueries.mapRowToProfile({
        ...row,
        username: null,
        user_email: null,
        phone: null,
      });
      expect(profile.contactEmail).toBe('org@procucev.com');
      expect(profile.contactPhone).toBe('+912212345678');
    });

    test('falls back to the user email when username is blank', () => {
      const profile = buyerProfileQueries.mapRowToProfile({ ...row, username: null });
      expect(profile.contactEmail).toBe('contact@procucev.com');
    });

    test('falls back to legacy alias columns for a row the Java app wrote', () => {
      const profile = buyerProfileQueries.mapRowToProfile({
        ...row,
        brand_name: null,
        cin: null,
        annual_turnover: null,
        contact_designation: null,
      });
      expect(profile.brandName).toBe('legacy-brand');
      expect(profile.cinNumber).toBe('legacy-cin');
      expect(profile.annualTurnover).toBe('legacy-turnover');
      expect(profile.contactDesignation).toBe('legacy-designation');
    });

    test('leaves an unset constitution and country empty instead of inventing them', () => {
      const profile = buyerProfileQueries.mapRowToProfile({ ...row, type: null, country: null });
      expect(profile.organizationType).toBe('');
      expect(profile.country).toBe('');
    });

    test('falls back to the account holder name when the organisation has no contact person', () => {
      const profile = buyerProfileQueries.mapRowToProfile({ ...row, contact_person: null });
      expect(profile.contactName).toBe('Rajesh Sharma');
    });

    test('returns null for a missing row', () => {
      expect(buyerProfileQueries.mapRowToProfile(null)).toBeNull();
      expect(buyerProfileQueries.mapRowToProfile(undefined)).toBeNull();
    });
  });

  // ── Category reads ────────────────────────────────────────────────────────
  describe('loadCategories', () => {
    test('reads the user-scoped rows first, matching the Java read path', async () => {
      const spy = jest
        .spyOn(dbPool, 'rows')
        .mockResolvedValue([{ division: 'IT', category: 'Laptop' }]);

      const result = await buyerProfileQueries.loadCategories('org-1', 'user-1');

      expect(result).toEqual([{ major: 'IT', minor: 'Laptop' }]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('user_id = $1');
      expect(spy.mock.calls[0][0]).toContain('is_active = true');
      expect(spy.mock.calls[0][0]).toContain('trim(category) <>');
      expect(spy.mock.calls[0][1]).toEqual(['user-1']);
    });

    test('falls back to organisation scope for rows written before user_id existed', async () => {
      const spy = jest
        .spyOn(dbPool, 'rows')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ division: 'Civil Works', category: 'Piling' }]);

      const result = await buyerProfileQueries.loadCategories('org-1', 'user-1');

      expect(result).toEqual([{ major: 'Civil Works', minor: 'Piling' }]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1][0]).toContain('organization_id = $1');
      expect(spy.mock.calls[1][1]).toEqual(['org-1']);
    });

    test('queries organisation scope directly when there is no user id', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await buyerProfileQueries.loadCategories('org-1', null);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('organization_id = $1');
      expect(spy.mock.calls[0][0]).toContain('is_active = true');
    });

    test('deduplicates legacy category rows before returning them to the profile', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([
        { division: 'IT', category: 'Laptop' },
        { division: ' it ', category: ' laptop ' },
        { division: 'IT', category: 'Servers' },
      ]);

      await expect(buyerProfileQueries.loadCategories('org-1', null)).resolves.toEqual([
        { major: 'IT', minor: 'Laptop' },
        { major: 'IT', minor: 'Servers' },
      ]);
    });

    test('returns an empty list without querying when neither scope is known', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await expect(buyerProfileQueries.loadCategories(null, null)).resolves.toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('findProfileByUserId', () => {
    test('returns the profile with its categories joined in', async () => {
      jest
        .spyOn(dbPool, 'rows')
        .mockResolvedValueOnce([
          { user_uuid: 'user-1', org_uuid: 'org-1', organization_name: 'ACME', username: 'a@b.com' },
        ])
        .mockResolvedValueOnce([{ division: 'IT', category: 'Laptop' }]);

      const result = await buyerProfileQueries.findProfileByUserId('user-1');

      expect(result.found).toBe(true);
      expect(result.profile.companyName).toBe('ACME');
      expect(result.profile.categories).toEqual([{ major: 'IT', minor: 'Laptop' }]);
    });

    test('reports NO_USER_ID without querying when no id is supplied', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await expect(buyerProfileQueries.findProfileByUserId('')).resolves.toEqual({
        found: false,
        reason: 'NO_USER_ID',
      });
      expect(spy).not.toHaveBeenCalled();
    });

    test('reports USER_NOT_FOUND for an unknown account', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await expect(buyerProfileQueries.findProfileByUserId('nobody')).resolves.toEqual({
        found: false,
        reason: 'USER_NOT_FOUND',
      });
    });

    test('reports ORG_NOT_LINKED when the account has no organisation', async () => {
      jest
        .spyOn(dbPool, 'rows')
        .mockResolvedValue([{ user_uuid: 'user-1', org_uuid: null }]);
      await expect(buyerProfileQueries.findProfileByUserId('user-1')).resolves.toEqual({
        found: false,
        reason: 'ORG_NOT_LINKED',
      });
    });
  });

  // ── Update building ───────────────────────────────────────────────────────
  describe('buildProfileUpdate', () => {
    test('writes both the dedicated and the legacy alias column for aliased fields', () => {
      const { assignments, params } = buyerProfileQueries.buildProfileUpdate({
        brandName: 'L&T Heavy',
      });
      expect(assignments).toEqual(['brand_name = $1', 'refference = $2']);
      expect(params).toEqual(['L&T Heavy', 'L&T Heavy']);
    });

    test('uppercases the statutory identifiers', () => {
      const { assignments, params } = buyerProfileQueries.buildProfileUpdate({
        panNumber: 'aaacl1234f',
        gstNumber: '27aaacl1234f1z5',
        cinNumber: 'l28920mh1946plc004768',
      });
      expect(assignments).toContain('pan = $1');
      expect(params).toContain('AAACL1234F');
      expect(params).toContain('27AAACL1234F1Z5');
      expect(params).toContain('L28920MH1946PLC004768');
    });

    test('normalises the currency symbol on the way to both turnover columns', () => {
      const { assignments, params } = buyerProfileQueries.buildProfileUpdate({
        annualTurnover: '₹ 180 Cr',
      });
      expect(assignments).toEqual(['annual_turnover = $1', 'others = $2']);
      expect(params).toEqual(['INR 180 Cr', 'INR 180 Cr']);
    });

    // Null-skip semantics: this is what stops a client that renders a subset of
    // the form from blanking the columns it does not show.
    test('skips fields the caller omitted or sent as null', () => {
      const { assignments } = buyerProfileQueries.buildProfileUpdate({
        companyName: 'ACME',
        city: null,
        state: undefined,
      });
      expect(assignments).toEqual(['organization_name = $1']);
    });

    test('applies an explicit empty string so a buyer can clear a field', () => {
      const { assignments, params } = buyerProfileQueries.buildProfileUpdate({ website: '' });
      expect(assignments).toEqual(['website = $1']);
      expect(params).toEqual(['']);
    });

    test('produces nothing for an empty patch', () => {
      expect(buyerProfileQueries.buildProfileUpdate({})).toEqual({ assignments: [], params: [], nextIndex: 1 });
    });

    test('maps every patchable field to a column', () => {
      const patch = {};
      buyerProfileQueries.PROFILE_COLUMN_MAP.forEach(({ field }) => {
        patch[field] = 'value';
      });
      const { assignments } = buyerProfileQueries.buildProfileUpdate(patch);
      const aliasCount = buyerProfileQueries.PROFILE_COLUMN_MAP.filter((e) => e.aliasColumn).length;
      expect(assignments).toHaveLength(buyerProfileQueries.PROFILE_COLUMN_MAP.length + aliasCount);
    });
  });

  // ── Category replacement ──────────────────────────────────────────────────
  describe('replaceCategories', () => {
    function makeClient() {
      return { query: jest.fn().mockResolvedValue({ rows: [] }) };
    }

    test('locks the organization, clears both scopes and inserts the new selection in one statement', async () => {
      const client = makeClient();
      const count = await buyerProfileQueries.replaceCategories(client, 'org-1', 'user-1', [
        { major: 'IT', minor: 'Laptop' },
        { major: 'IT', minor: 'Servers' },
      ]);

      expect(count).toBe(2);
      expect(client.query.mock.calls[0][0]).toContain('for update');
      expect(client.query.mock.calls[0][1]).toEqual(['org-1']);
      expect(client.query.mock.calls[1][0]).toContain('delete from org_division_category');
      expect(client.query.mock.calls[1][1]).toEqual(['org-1']);
      expect(client.query.mock.calls[2][1]).toEqual(['user-1']);

      // One multi-row INSERT, not one statement per category: a 10-category
      // selection would otherwise be 10 round trips inside an open transaction.
      const [sql, params] = client.query.mock.calls[3];
      expect(sql).toContain('insert into org_division_category');
      expect(sql).toContain('($1, $2, $3, $4, $5, true, now())');
      expect(sql).toContain('($6, $7, $8, $9, $10, true, now())');
      expect(client.query).toHaveBeenCalledTimes(4);

      // Five bound values per row: uuid, division, category, organization_id, user_id.
      expect(params).toHaveLength(10);
      expect(params[1]).toBe('IT');
      expect(params[2]).toBe('Laptop');
      expect(params[3]).toBe('org-1');
      expect(params[4]).toBe('user-1');
      expect(params[6]).toBe('IT');
      expect(params[7]).toBe('Servers');
    });

    test('clears the selection when handed an empty array', async () => {
      const client = makeClient();
      const count = await buyerProfileQueries.replaceCategories(client, 'org-1', 'user-1', []);
      expect(count).toBe(0);
      // One row lock and two deletes, no insert.
      expect(client.query).toHaveBeenCalledTimes(3);
    });

    test('treats a non-array selection as nothing to insert', async () => {
      const client = makeClient();
      await expect(buyerProfileQueries.replaceCategories(client, 'org-1', 'user-1', null)).resolves.toBe(0);
      expect(client.query).toHaveBeenCalledTimes(3);
    });

    test('skips the user-scoped delete when there is no user id', async () => {
      const client = makeClient();
      await buyerProfileQueries.replaceCategories(client, 'org-1', null, [{ major: 'IT', minor: 'Laptop' }]);
      expect(client.query.mock.calls[0][0]).toContain('for update');
      expect(client.query.mock.calls[1][1]).toEqual(['org-1']);
      expect(client.query.mock.calls[2][0]).toContain('insert into');
      // user_id is left null rather than invented.
      expect(client.query.mock.calls[2][1][4]).toBeNull();
    });

    test('inserts only one row for duplicate selections', async () => {
      const client = makeClient();
      const count = await buyerProfileQueries.replaceCategories(client, 'org-1', 'user-1', [
        { major: 'IT', minor: 'Laptop' },
        { major: ' it ', minor: ' laptop ' },
      ]);
      expect(count).toBe(1);
      expect(client.query).toHaveBeenCalledTimes(4);
      expect(client.query.mock.calls[3][1]).toHaveLength(5);
    });
  });

  // ── Transactional update ──────────────────────────────────────────────────
  describe('updateProfile', () => {
    let withTransactionSpy;

    // pool.withTransaction owns BEGIN/COMMIT/ROLLBACK and the client release —
    // that is covered in pool.test.js. Here it is doubled so these tests assert
    // what updateProfile does *inside* the transaction.
    function stubPool(orgRows = [{ uuid: 'org-1' }]) {
      const client = { query: jest.fn().mockResolvedValue({ rows: orgRows }) };
      dbPool.pool = { connect: jest.fn() };
      withTransactionSpy = jest
        .spyOn(dbPool, 'withTransaction')
        .mockImplementation(async (fn) => fn(client));
      return client;
    }

    const originalPool = dbPool.pool;
    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('updates the organisation, the user display name and the categories in one transaction', async () => {
      const client = stubPool();

      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { companyName: 'ACME Ltd', contactName: 'Rajesh Sharma' },
        categories: [{ major: 'IT', minor: 'Laptop' }],
        actor: 'buyer@procucev.com',
      });

      expect(result).toEqual({ updated: true, fieldsUpdated: 4, categoryCount: 1 });
      // All three writes share one transaction, so a failure part-way cannot leave
      // the organisation updated but its categories half-replaced.
      expect(withTransactionSpy).toHaveBeenCalledTimes(1);

      const sql = client.query.mock.calls.map((c) => c[0]).join('\n');
      expect(sql).toContain('update organization set');
      expect(sql).toContain('update "user" set full_name = $1');
      expect(sql).toContain('insert into org_division_category');
    });

    test('reports ORG_NOT_FOUND rather than throwing when the organisation is gone', async () => {
      // Returned, not thrown, so the caller can answer 404 instead of 500.
      const client = stubPool([]);
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'missing',
        userId: 'user-1',
        patch: { companyName: 'ACME' },
      });
      expect(result).toEqual({ updated: false, reason: 'ORG_NOT_FOUND' });
      // Nothing was written beyond the existence check.
      expect(client.query).toHaveBeenCalledTimes(1);
    });

    test('leaves categories untouched when the caller did not supply them', async () => {
      const client = stubPool();
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { city: 'Pune' },
      });
      expect(result.categoryCount).toBeNull();
      expect(client.query.mock.calls.map((c) => c[0]).join('\n')).not.toContain('org_division_category');
    });

    test('skips the organisation update when the patch is empty', async () => {
      const client = stubPool();
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: {},
      });
      expect(result.fieldsUpdated).toBe(0);
      expect(client.query.mock.calls.map((c) => c[0]).join('\n')).not.toContain('update organization set');
    });

    test('does not blank the user display name when the contact name is cleared', async () => {
      const client = stubPool();
      await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { contactName: '' },
      });
      expect(client.query.mock.calls.map((c) => c[0]).join('\n')).not.toContain('update "user"');
    });

    test('skips the user update when there is no user id', async () => {
      const client = stubPool();
      await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: null,
        patch: { contactName: 'Someone' },
      });
      expect(client.query.mock.calls.map((c) => c[0]).join('\n')).not.toContain('update "user"');
    });

    test('uses a documented actor when none is supplied', async () => {
      const client = stubPool();
      await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { companyName: 'ACME' },
      });
      expect(client.query.mock.calls[1][1]).toContain('enterprise-workspace');
    });

    test('numbers the actor and uuid placeholders after the patch columns', async () => {
      // buildProfileUpdate reports the next free index so the caller can append
      // its own bindings without renumbering the ones already emitted.
      const client = stubPool();
      await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { brandName: 'L&T' },
        actor: 'buyer@procucev.com',
      });

      const [sql, params] = client.query.mock.calls[1];
      // brand_name = $1, refference = $2, last_modified_by = $3, where uuid = $4.
      expect(sql).toContain('last_modified_by = $3');
      expect(sql).toContain('where uuid = $4');
      expect(params).toEqual(['L&T', 'L&T', 'buyer@procucev.com', 'org-1']);
    });

    test('propagates a statement failure so the transaction rolls back', async () => {
      const client = stubPool();
      client.query
        .mockResolvedValueOnce({ rows: [{ uuid: 'org-1' }] })
        .mockRejectedValueOnce(new Error('deadlock detected'));

      await expect(
        buyerProfileQueries.updateProfile({
          organizationId: 'org-1',
          userId: 'user-1',
          patch: { companyName: 'ACME' },
        })
      ).rejects.toThrow('deadlock detected');
    });

    test('refuses to run without an organisation id', async () => {
      stubPool();
      await expect(
        buyerProfileQueries.updateProfile({ organizationId: '', userId: 'user-1', patch: {} })
      ).rejects.toThrow('organizationId is required');
    });

    test('refuses to run when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(
        buyerProfileQueries.updateProfile({ organizationId: 'org-1', patch: {} })
      ).rejects.toThrow(dbPool.NOT_CONFIGURED_MESSAGE);
    });
  });

  // D1 Worker writes use one binding batch, so the profile, user name and
  // category selection commit or roll back together.
  describe('updateProfile (D1 path)', () => {
    const originalCfEnv = globalThis.__CF_ENV__;
    const originalPool = dbPool.pool;
    let d1Binding;

    function makeD1Binding({ organizationExists = true, failure } = {}) {
      return {
        prepare: jest.fn((sql) => ({
          bind: (...params) => ({ _sql: sql, _params: params }),
        })),
        batch: jest.fn(async (statements) => {
          if (failure) throw failure;
          return statements.map((statement, index) => ({
            results: index === 0 && organizationExists ? [{ uuid: 'org-1' }] : [],
            meta: { changes: index === 0 ? 0 : 1 },
            _statement: statement,
          }));
        }),
      };
    }

    beforeEach(() => {
      d1Binding = makeD1Binding();
      globalThis.__CF_ENV__ = { DB: d1Binding };
      dbPool.pool = null; // no pg pool at all on Workers — D1 alone must satisfy hasStorage()
    });

    afterEach(() => {
      globalThis.__CF_ENV__ = originalCfEnv;
      dbPool.pool = originalPool;
    });

    test('updates the organisation, user display name and categories in one atomic batch', async () => {
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { companyName: 'ACME Ltd', contactName: 'Rajesh Sharma' },
        categories: [{ major: 'IT', minor: 'Laptop' }],
        actor: 'buyer@procucev.com',
      });

      expect(result).toEqual({ updated: true, fieldsUpdated: 4, categoryCount: 1 });
      expect(d1Binding.batch).toHaveBeenCalledTimes(1);
      const statements = d1Binding.batch.mock.calls[0][0];
      const allSql = statements.map((statement) => statement._sql).join('\n');
      expect(statements).toHaveLength(6); // existence, two updates, two deletes, one insert
      expect(allSql).toContain('update organization set');
      expect(allSql).toContain('update "user" set full_name = ?');
      expect(allSql).toContain('delete from org_division_category');
      expect(allSql).toContain('where user_id = ?');
      expect(allSql).toContain('insert into org_division_category');
      expect(allSql).toContain('exists (select 1 from organization');
    });

    test('reports ORG_NOT_FOUND rather than throwing when the organisation is gone', async () => {
      d1Binding = makeD1Binding({ organizationExists: false });
      globalThis.__CF_ENV__ = { DB: d1Binding };
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'missing',
        userId: 'user-1',
        patch: { companyName: 'ACME' },
      });
      expect(result).toEqual({ updated: false, reason: 'ORG_NOT_FOUND' });
      expect(d1Binding.batch).toHaveBeenCalledTimes(1);
    });

    test('leaves categories untouched when the caller did not supply them', async () => {
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { city: 'Pune' },
      });
      expect(result.categoryCount).toBeNull();
      const allSql = d1Binding.batch.mock.calls[0][0].map((statement) => statement._sql).join('\n');
      expect(allSql).not.toContain('org_division_category');
    });

    test('skips the organisation update when the patch is empty', async () => {
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: {},
      });
      expect(result.fieldsUpdated).toBe(0);
      expect(d1Binding.batch.mock.calls[0][0]).toHaveLength(1);
    });

    test('skips the user update when there is no user id', async () => {
      await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: null,
        patch: { contactName: 'Someone' },
      });
      const allSql = d1Binding.batch.mock.calls[0][0].map((statement) => statement._sql).join('\n');
      expect(allSql).not.toContain('update "user"');
    });

    test('clears the category selection when an empty array is supplied', async () => {
      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: {},
        categories: [],
      });
      expect(result.categoryCount).toBe(0);
      const statements = d1Binding.batch.mock.calls[0][0];
      expect(statements).toHaveLength(3); // existence and both scoped deletes
      expect(statements.map((statement) => statement._sql).join('\n')).not.toContain('insert into');
    });

    test('collapses duplicate selections and splits inserts at D1 parameter limits', async () => {
      const categories = Array.from({ length: 17 }, (_, index) => ({ major: 'IT', minor: `Item ${index}` }));
      categories.push({ major: ' it ', minor: ' item 0 ' });

      const result = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: null,
        patch: {},
        categories,
      });

      expect(result.categoryCount).toBe(17);
      const statements = d1Binding.batch.mock.calls[0][0];
      const inserts = statements.filter((statement) => statement._sql.includes('insert into org_division_category'));
      expect(inserts).toHaveLength(2);
      expect(inserts.map((statement) => statement._params.length)).toEqual([96, 6]);
    });

    test('rolls back the complete batch when any D1 write fails', async () => {
      const failure = new Error('injected D1 batch failure');
      d1Binding = makeD1Binding({ failure });
      globalThis.__CF_ENV__ = { DB: d1Binding };

      await expect(buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'user-1',
        patch: { companyName: 'ACME' },
        categories: [{ major: 'IT', minor: 'Laptop' }],
      })).rejects.toThrow('injected D1 batch failure');
      expect(d1Binding.batch).toHaveBeenCalledTimes(1);
    });

    test('executes a multi-write D1 HTTP update with the atomic batch client', async () => {
      const d1Bridge = require('../src/db/d1Bridge');
      const keys = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];
      const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      keys.forEach((key, index) => { process.env[key] = `test-${index}`; });
      globalThis.__CF_ENV__ = undefined;
      d1Bridge.resetD1HttpClientCache();
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          success: true,
          result: [
            { results: [{ uuid: 'org-1' }], meta: { changes: 0 } },
            { results: [], meta: { changes: 1 } },
            { results: [], meta: { changes: 1 } },
          ],
        })),
      });

      try {
        const result = await buyerProfileQueries.updateProfile({
          organizationId: 'org-1',
          userId: 'user-1',
          patch: { companyName: 'ACME', contactName: 'Buyer' },
          categories: [],
        });
        expect(result).toMatchObject({ updated: true });
        expect(fetchSpy).toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        keys.forEach((key) => {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        });
        d1Bridge.resetD1HttpClientCache();
      }
    });

    test('allows a single-statement D1 HTTP profile write', async () => {
      const d1Bridge = require('../src/db/d1Bridge');
      const keys = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];
      const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      keys.forEach((key, index) => { process.env[key] = `test-single-${index}`; });
      globalThis.__CF_ENV__ = undefined;
      d1Bridge.resetD1HttpClientCache();
      const querySpy = jest.spyOn(dbPool, 'query')
        .mockResolvedValueOnce({ rows: [{ uuid: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [] });

      try {
        const result = await buyerProfileQueries.updateProfile({
          organizationId: 'org-1',
          userId: null,
          patch: { companyName: 'ACME Ltd' },
        });
        expect(result.updated).toBe(true);
        expect(querySpy).toHaveBeenCalledTimes(2);
        expect(querySpy.mock.calls[1][0]).toContain('update organization set');
      } finally {
        querySpy.mockRestore();
        keys.forEach((key) => {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        });
        d1Bridge.resetD1HttpClientCache();
      }
    });
  });

  // ── Taxonomy ──────────────────────────────────────────────────────────────
  describe('findCategoryTaxonomy', () => {
    test('groups minors under their major, preserving the row order', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([
        { division: 'Civil Works', category: 'Piling' },
        { division: 'Civil Works', category: 'Excavation' },
        { division: 'IT', category: 'Laptop' },
      ]);

      const taxonomy = await buyerProfileQueries.findCategoryTaxonomy();

      expect(taxonomy).toEqual([
        { majorCategory: 'Civil Works', minorCategories: ['Piling', 'Excavation'] },
        { majorCategory: 'IT', minorCategories: ['Laptop'] },
      ]);
    });

    // The master is loaded from a spreadsheet and contains near-duplicate rows;
    // rendering the same checkbox twice would make one copy look unselected.
    test('collapses minors that differ only by case or spacing', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([
        { division: 'Packing Material', category: 'Pet Jars' },
        { division: 'Packing Material', category: ' pet jars ' },
      ]);

      const taxonomy = await buyerProfileQueries.findCategoryTaxonomy();
      expect(taxonomy[0].minorCategories).toEqual(['Pet Jars']);
    });

    test('skips rows with no usable division or category', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([
        { division: '   ', category: 'Orphan' },
        { division: 'IT', category: '   ' },
        { division: 'IT', category: 'Laptop' },
      ]);

      const taxonomy = await buyerProfileQueries.findCategoryTaxonomy();
      expect(taxonomy).toEqual([{ majorCategory: 'IT', minorCategories: ['Laptop'] }]);
    });

    test('orders divisions by when they first entered the master, not alphabetically', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await buyerProfileQueries.findCategoryTaxonomy();
      expect(spy.mock.calls[0][0]).toContain('min(created_ts)');
      expect(spy.mock.calls[0][0]).toContain('order by ord.first_seen');
    });
  });

  // ── Vendor onboarding dispatch templates (Template A / Template B) ─────────
  describe('getDispatchTemplates / upsertDispatchTemplate', () => {
    const originalCfEnv = globalThis.__CF_ENV__;
    const originalPool = dbPool.pool;

    beforeEach(() => {
      globalThis.__CF_ENV__ = { DB: { prepare: jest.fn() } };
      dbPool.pool = null;
    });

    afterEach(() => {
      globalThis.__CF_ENV__ = originalCfEnv;
      dbPool.pool = originalPool;
    });

    test('getDispatchTemplates returns {} without querying when organizationId is missing', async () => {
      const spy = jest.spyOn(dbPool, 'rows');
      await expect(buyerProfileQueries.getDispatchTemplates(null)).resolves.toEqual({});
      expect(spy).not.toHaveBeenCalled();
    });

    test('getDispatchTemplates keys the result by template_type', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([
        { template_type: 'category_mapped', subject: 'Welcome', message: 'Hi there' },
        { template_type: 'self_map_required', subject: null, message: null },
      ]);

      const result = await buyerProfileQueries.getDispatchTemplates('org-1');

      expect(result).toEqual({
        category_mapped: { subject: 'Welcome', message: 'Hi there' },
        self_map_required: { subject: null, message: null },
      });
    });

    test('upsertDispatchTemplate rejects an unknown template type', async () => {
      await expect(
        buyerProfileQueries.upsertDispatchTemplate('org-1', 'not_a_real_type', { subject: 'x', message: 'y' })
      ).rejects.toThrow('Unknown vendor dispatch template type');
    });

    test('upsertDispatchTemplate deletes the row when both fields are blank', async () => {
      const spy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [] });

      const result = await buyerProfileQueries.upsertDispatchTemplate('org-1', 'category_mapped', {
        subject: '  ',
        message: '',
      });

      expect(result).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('delete from vendor_dispatch_templates');
      expect(spy.mock.calls[0][1]).toEqual(['org-1', 'category_mapped']);
    });

    test('upsertDispatchTemplate upserts and returns the saved subject/message', async () => {
      const spy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [] });

      const result = await buyerProfileQueries.upsertDispatchTemplate(
        'org-1',
        'self_map_required',
        { subject: 'Please map your categories', message: 'Welcome to Procucev' },
        'buyer@acme.com'
      );

      expect(result).toEqual({ subject: 'Please map your categories', message: 'Welcome to Procucev' });
      expect(spy).toHaveBeenCalledTimes(1);
      const [sql, params, options] = spy.mock.calls[0];
      expect(sql).toContain('insert into vendor_dispatch_templates');
      expect(sql).toContain('on conflict (organization_id, template_type) do update');
      expect(params).toEqual([
        expect.any(String),
        'org-1',
        'self_map_required',
        'Please map your categories',
        'Welcome to Procucev',
        'buyer@acme.com',
      ]);
      expect(options.d1).toBe(true);
    });
  });

  // ── findProfileByIdentifier ────────────────────────────────────────────────
  describe('findProfileByIdentifier', () => {
    test('returns NO_IDENTIFIER when no identifier parameters are provided', async () => {
      const res = await buyerProfileQueries.findProfileByIdentifier();
      expect(res).toEqual({ found: false, reason: 'NO_IDENTIFIER' });

      const resEmpty = await buyerProfileQueries.findProfileByIdentifier({});
      expect(resEmpty).toEqual({ found: false, reason: 'NO_IDENTIFIER' });
    });

    test('returns USER_NOT_FOUND when database query returns no rows', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([]);

      const res = await buyerProfileQueries.findProfileByIdentifier({
        email: 'missing@buyer.com',
        organizationName: 'Missing Corp',
        organizationId: 'org-missing',
        userId: 'u-missing',
      });

      expect(res).toEqual({ found: false, reason: 'USER_NOT_FOUND' });
    });

    test('successfully finds profile and loads categories by email and name', async () => {
      const fakeRow = {
        org_uuid: 'org-123',
        user_uuid: 'user-456',
        organization_name: 'Alpha Ltd',
        brand_name: 'Alpha Brand',
        type: 'Public Limited',
        pan: 'AAACL1234F',
        gstin: '27AAACL1234F1Z5',
        cin: 'L28920MH1946PLC004768',
        website: 'https://alpha.com',
        annual_turnover: 'INR 100 Cr',
        address1: '100 Alpha Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip_code: '400001',
        country: 'India',
        contact_person: 'Rajesh Sharma',
        contact_designation: 'CPO',
        user_email: 'rajesh@alpha.com',
        phone: '+919820144820',
      };

      const rowsSpy = jest.spyOn(dbPool, 'rows').mockImplementation((sql) => {
        if (sql.includes('from "user" u')) {
          return Promise.resolve([fakeRow]);
        }
        return Promise.resolve([{ division: 'Industrial', category: 'Motors' }]);
      });

      const res = await buyerProfileQueries.findProfileByIdentifier({
        email: 'rajesh@alpha.com',
        organizationName: 'Alpha Ltd',
      });

      expect(res.found).toBe(true);
      expect(res.profile.companyName).toBe('Alpha Ltd');
      expect(res.profile.contactEmail).toBe('rajesh@alpha.com');
      expect(res.profile.categories).toEqual([{ major: 'Industrial', minor: 'Motors' }]);
      expect(rowsSpy).toHaveBeenCalled();
    });

    test('prioritizes exact user identity over organization fallback', async () => {
      const calls = [];
      jest.spyOn(dbPool, 'rows').mockImplementation((sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('u.uuid = $1')) {
          return Promise.resolve([
            {
              org_uuid: 'org-123',
              user_uuid: 'user-exact',
              organization_name: 'Alpha Ltd',
              user_email: 'exact@alpha.com',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await buyerProfileQueries.findProfileByIdentifier({
        userId: 'user-exact',
        organizationName: 'Alpha Ltd',
      });

      expect(res.found).toBe(true);
      expect(res.profile.contactEmail).toBe('exact@alpha.com');
      // Verify first query was user-scoped (u.uuid)
      expect(calls[0].sql).toContain('u.uuid = $1');
      // Should NOT have run the fallback query for organization since exact user matched
      expect(calls.some((c) => c.sql.includes('lower(o.organization_name)'))).toBe(false);
    });

    test('handles loadCategories failure gracefully when user is found', async () => {
      jest.spyOn(dbPool, 'rows').mockImplementation((sql) => {
        if (sql.includes('from "user" u')) {
          return Promise.resolve([{
            org_uuid: 'org-fail-cat',
            user_uuid: 'user-fail-cat',
            organization_name: 'Beta Ltd',
            user_email: 'beta@example.com',
          }]);
        }
        return Promise.reject(new Error('Category fetch failed'));
      });

      const res = await buyerProfileQueries.findProfileByIdentifier({
        userId: 'user-fail-cat',
      });

      expect(res.found).toBe(true);
      expect(res.profile.companyName).toBe('Beta Ltd');
      expect(res.profile.categories).toEqual([]);
    });

    test('handles db error in user conditions query', async () => {
      jest.spyOn(dbPool, 'rows').mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await buyerProfileQueries.findProfileByIdentifier({
        email: 'error@example.com',
      });

      expect(res).toEqual({
        found: false,
        reason: 'DB_ERROR',
        error: 'DB connection failed',
      });
    });

    test('falls back to organization-level identifiers when user identity is omitted', async () => {
      jest.spyOn(dbPool, 'rows').mockImplementation((sql) => {
        if (sql.includes('o.uuid = $1')) {
          return Promise.resolve([{
            org_uuid: 'org-fallback-1',
            user_uuid: 'user-fallback-1',
            organization_name: 'Gamma Corp',
            user_email: 'admin@gamma.com',
          }]);
        }
        return Promise.resolve([{ division: 'Services', category: 'Consulting' }]);
      });

      const res = await buyerProfileQueries.findProfileByIdentifier({
        organizationId: 'org-fallback-1',
        organizationName: 'Gamma Corp',
      });

      expect(res.found).toBe(true);
      expect(res.profile.companyName).toBe('Gamma Corp');
      expect(res.profile.categories).toEqual([{ major: 'Services', minor: 'Consulting' }]);
    });

    test('falls back to organization-level identifiers and handles category load error', async () => {
      jest.spyOn(dbPool, 'rows').mockImplementation((sql) => {
        if (sql.includes('o.uuid = $1')) {
          return Promise.resolve([{
            org_uuid: 'org-fallback-2',
            user_uuid: 'user-fallback-2',
            organization_name: 'Delta Corp',
            user_email: 'admin@delta.com',
          }]);
        }
        return Promise.reject(new Error('Category load error'));
      });

      const res = await buyerProfileQueries.findProfileByIdentifier({
        organizationId: 'org-fallback-2',
      });

      expect(res.found).toBe(true);
      expect(res.profile.categories).toEqual([]);
    });

    test('handles db error in organization fallback query', async () => {
      jest.spyOn(dbPool, 'rows').mockRejectedValueOnce(new Error('Org DB query failed'));

      const res = await buyerProfileQueries.findProfileByIdentifier({
        organizationName: 'Failing Org',
      });

      expect(res).toEqual({
        found: false,
        reason: 'DB_ERROR',
        error: 'Org DB query failed',
      });
    });
  });

  // ── findCategoryTaxonomy ──────────────────────────────────────────────────
  describe('findCategoryTaxonomy', () => {
    test('builds taxonomy with legacy category mappings and defaults', async () => {
      const mockRows = [
        { division: ' ', category: ' ' }, // Should be skipped
        { division: 'IT & Telecom', category: 'Cloud Infrastructure' },
        { division: 'IT & Telecom', category: 'cloud infrastructure' }, // Duplicate case should be skipped
        { division: 'new category-product', category: 'Custom Widget' },
        { division: 'new category product', category: 'Custom Gizmo' },
        { division: 'others - new product', category: 'Custom Hardware' },
        { division: 'new category', category: 'Special Equipment' },
        { division: 'new category-service', category: 'Custom Advisory' },
        { division: 'new category service', category: 'Custom Repair' },
        { division: 'others - new service', category: 'Custom Maintenance' },
      ];

      jest.spyOn(dbPool, 'rows').mockResolvedValueOnce(mockRows);

      const taxonomy = await buyerProfileQueries.findCategoryTaxonomy();
      expect(Array.isArray(taxonomy)).toBe(true);

      const itTelecom = taxonomy.find((t) => t.majorCategory === 'IT & Telecom');
      expect(itTelecom).toBeDefined();
      expect(itTelecom.minorCategories).toEqual(['Cloud Infrastructure']);

      const newProduct = taxonomy.find((t) => t.majorCategory === 'Others – New Product');
      expect(newProduct).toBeDefined();
      expect(newProduct.minorCategories).toContain('Custom Widget');
      expect(newProduct.minorCategories).toContain('Custom Gizmo');
      expect(newProduct.minorCategories).toContain('Custom Hardware');
      expect(newProduct.minorCategories).toContain('Special Equipment');

      const newService = taxonomy.find((t) => t.majorCategory === 'Others – New Service');
      expect(newService).toBeDefined();
      expect(newService.minorCategories).toContain('Custom Advisory');
      expect(newService.minorCategories).toContain('Custom Repair');
      expect(newService.minorCategories).toContain('Custom Maintenance');
    });

    test('automatically seeds default Others – New Service when only Others – New Product exists', async () => {
      const mockRows = [
        { division: 'Others – New Product', category: 'Innovative Drone' },
      ];

      jest.spyOn(dbPool, 'rows').mockResolvedValueOnce(mockRows);

      const taxonomy = await buyerProfileQueries.findCategoryTaxonomy();
      const newService = taxonomy.find((t) => t.majorCategory === 'Others – New Service');
      expect(newService).toBeDefined();
      expect(newService.minorCategories).toContain('Consulting');
      expect(newService.minorCategories).toContain('Maintenance & AMC');
    });
  });
});


