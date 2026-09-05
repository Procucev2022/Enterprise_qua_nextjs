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

    test('applies documented defaults for an unset constitution and country', () => {
      const profile = buyerProfileQueries.mapRowToProfile({ ...row, type: null, country: null });
      expect(profile.organizationType).toBe('Public Limited');
      expect(profile.country).toBe('India');
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

    test('clears both scopes then inserts the new selection in one statement', async () => {
      const client = makeClient();
      const count = await buyerProfileQueries.replaceCategories(client, 'org-1', 'user-1', [
        { major: 'IT', minor: 'Laptop' },
        { major: 'IT', minor: 'Servers' },
      ]);

      expect(count).toBe(2);
      expect(client.query.mock.calls[0][0]).toContain('delete from org_division_category');
      expect(client.query.mock.calls[0][1]).toEqual(['org-1']);
      expect(client.query.mock.calls[1][1]).toEqual(['user-1']);

      // One multi-row INSERT, not one statement per category: a 10-category
      // selection would otherwise be 10 round trips inside an open transaction.
      const [sql, params] = client.query.mock.calls[2];
      expect(sql).toContain('insert into org_division_category');
      expect(sql).toContain('($1, $2, $3, $4, $5, true, now())');
      expect(sql).toContain('($6, $7, $8, $9, $10, true, now())');
      expect(client.query).toHaveBeenCalledTimes(3);

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
      // Two deletes, no insert.
      expect(client.query).toHaveBeenCalledTimes(2);
    });

    test('treats a non-array selection as nothing to insert', async () => {
      const client = makeClient();
      await expect(buyerProfileQueries.replaceCategories(client, 'org-1', 'user-1', null)).resolves.toBe(0);
      expect(client.query).toHaveBeenCalledTimes(2);
    });

    test('skips the user-scoped delete when there is no user id', async () => {
      const client = makeClient();
      await buyerProfileQueries.replaceCategories(client, 'org-1', null, [{ major: 'IT', minor: 'Laptop' }]);
      expect(client.query.mock.calls[0][1]).toEqual(['org-1']);
      expect(client.query.mock.calls[1][0]).toContain('insert into');
      // user_id is left null rather than invented.
      expect(client.query.mock.calls[1][1][4]).toBeNull();
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
});
