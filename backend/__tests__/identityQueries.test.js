const identityQueries = require('../src/db/identityQueries');
const dbPool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const { IDENTITY_MASTER_DATA } = require('../src/config/constants');

function mockAtomicD1Batch({ organizationUuid = 'd1-org', userUuid = 'd1-user' } = {}) {
  const binding = { prepare: jest.fn() };
  jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
  return jest.spyOn(d1Bridge, 'batchD1').mockImplementation(async (_database, statements) => {
    const organizationInsert = statements.find(({ text }) => /insert into organization/i.test(text));
    const resolvedOrganizationUuid = organizationInsert?.params?.[0] || organizationUuid;
    return statements.map(({ text }) => {
      if (/returning uuid, org_uuid/i.test(text)) {
        return { rows: [{ uuid: userUuid, org_uuid: resolvedOrganizationUuid }], rowCount: 1 };
      }
      if (/insert into organization/i.test(text) && /returning uuid/i.test(text)) {
        return { rows: [{ uuid: resolvedOrganizationUuid }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
  });
}

describe('Identity queries (Neon PostgreSQL)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Phone normalisation ───────────────────────────────────────────────────
  describe('normalizePhone', () => {
    test.each([
      ['9157154504', '+919157154504'],
      ['+91 91571 54504', '+919157154504'],
      ['09157154504', '+919157154504'],
      ['91-9157154504', '+919157154504'],
      ['(915) 715-4504', '+919157154504'],
    ])('normalises %p to %p', (input, expected) => {
      expect(identityQueries.normalizePhone(input)).toBe(expected);
    });

    test('returns an empty string for a missing value', () => {
      expect(identityQueries.normalizePhone('')).toBe('');
      expect(identityQueries.normalizePhone(null)).toBe('');
      expect(identityQueries.normalizePhone(undefined)).toBe('');
    });

    // Ported from ProcUserServiceImpl.normalizePhone in the Java p2pservices
    // app, which writes the `user.phone` values this module has to match.
    test.each([
      ['12345', '+12345'],
      ['1234567890123', '+1234567890123'],
      ['449157154504', '+449157154504'],
    ])('falls back to a plain + prefix for %s', (input, expected) => {
      expect(identityQueries.normalizePhone(input)).toBe(expected);
    });

    test('strips leading zeros before deciding the number is a 10-digit Indian mobile', () => {
      expect(identityQueries.normalizePhone('0009157154504')).toBe('+919157154504');
    });

    test('strips a 91 country prefix only when the result is exactly ten digits', () => {
      expect(identityQueries.normalizePhone('919157154504')).toBe('+919157154504');
      // 91 + 11 digits is not a 12-digit value, so it is left as dialled.
      expect(identityQueries.normalizePhone('9191571545040')).toBe('+9191571545040');
    });

    test('preserves whitespace-only input rather than emitting a bare +', () => {
      expect(identityQueries.normalizePhone('   ')).toBe('');
    });
  });

  // ── Role mapping ──────────────────────────────────────────────────────────
  describe('mapRoleName', () => {
    test.each([
      ['ClientInitiator', 'buyer'],
      ['clientinitiator1.1', 'buyer'],
      ['Client', 'buyer'],
      ['PRApprover', 'buyer'],
      ['Vendor', 'vendor'],
      ['PartialVendor', 'vendor'],
      ['CategoryManager', 'category_manager'],
      ['CategoryManagerBasic2', 'category_manager'],
      ['VendorManager', 'admin'],
      ['SuperUser', 'admin'],
    ])('maps %p to %p', (roleName, expected) => {
      expect(identityQueries.mapRoleName(roleName)).toBe(expected);
    });

    test('is case and whitespace insensitive', () => {
      expect(identityQueries.mapRoleName('  cLiEnTiNiTiAtOr  ')).toBe('buyer');
    });

    test('returns null for an unmapped or missing role', () => {
      expect(identityQueries.mapRoleName('SomeFutureRole')).toBeNull();
      expect(identityQueries.mapRoleName('')).toBeNull();
      expect(identityQueries.mapRoleName(null)).toBeNull();
    });
  });

  // ── Plaintext password comparison ─────────────────────────────────────────
  describe('verifyStoredPassword', () => {
    test('matches an identical password', () => {
      expect(identityQueries.verifyStoredPassword('Pass@123', 'Pass@123')).toBe(true);
    });

    test('rejects a different password of the same length', () => {
      expect(identityQueries.verifyStoredPassword('Pass@123', 'Pass@124')).toBe(false);
    });

    test('rejects a length mismatch without throwing', () => {
      expect(identityQueries.verifyStoredPassword('short', 'muchlongerpassword')).toBe(false);
    });

    test('rejects empty or non-string inputs', () => {
      expect(identityQueries.verifyStoredPassword('', 'Pass@123')).toBe(false);
      expect(identityQueries.verifyStoredPassword('Pass@123', '')).toBe(false);
      expect(identityQueries.verifyStoredPassword(null, 'Pass@123')).toBe(false);
      expect(identityQueries.verifyStoredPassword('Pass@123', undefined)).toBe(false);
      expect(identityQueries.verifyStoredPassword(123, 123)).toBe(false);
    });
  });

  // ── Row mapping ───────────────────────────────────────────────────────────
  describe('mapRowToUser', () => {
    test('maps a fully populated row', () => {
      const mapped = identityQueries.mapRowToUser({
        uuid: 'u-1',
        username: 'Buyer@Example.COM',
        email: 'other@example.com',
        password: 'Pass@123',
        full_name: 'Full Name',
        first_name: 'First',
        phone: '+919157154504',
        is_active: true,
        is_approved: true,
        self_client: false,
        verification_status: 'EMAIL_VERIFIED',
        org_uuid: 'org-1',
        role_name: 'ClientInitiator',
        organization_name: 'Example Ltd',
      });

      expect(mapped).toMatchObject({
        id: 'u-1',
        email: 'buyer@example.com',
        name: 'Full Name',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'Example Ltd',
        status: 'ACTIVE',
        isActive: true,
        isApproved: true,
        isSelfClient: false,
      });
    });

    test('falls back through full_name, first_name then the email local part', () => {
      expect(
        identityQueries.mapRowToUser({ username: 'someone@example.com', first_name: 'First' }).name
      ).toBe('First');
      expect(identityQueries.mapRowToUser({ username: 'someone@example.com' }).name).toBe('someone');
    });

    test('falls back to the email column when username is absent', () => {
      expect(identityQueries.mapRowToUser({ email: 'Fallback@Example.com' }).email).toBe(
        'fallback@example.com'
      );
    });

    test('reports an inactive row as INACTIVE', () => {
      const mapped = identityQueries.mapRowToUser({ username: 'a@b.com', is_active: false });
      expect(mapped.status).toBe('INACTIVE');
      expect(mapped.isActive).toBe(false);
    });

    test('returns null for a missing row', () => {
      expect(identityQueries.mapRowToUser(null)).toBeNull();
      expect(identityQueries.mapRowToUser(undefined)).toBeNull();
    });

    test('defaults an absent organisation name and verification status', () => {
      const mapped = identityQueries.mapRowToUser({ username: 'a@b.com' });
      expect(mapped.orgName).toBe('');
      expect(mapped.verificationStatus).toBeNull();
    });
  });

  // ── Lookups ───────────────────────────────────────────────────────────────
  describe('findUserByEmail', () => {
    test('queries with the normalised email and maps the first row', async () => {
      const spy = jest
        .spyOn(dbPool, 'rows')
        .mockResolvedValue([{ uuid: 'u-1', username: 'a@b.com', role_name: 'Vendor' }]);

      const user = await identityQueries.findUserByEmail('  A@B.COM ');

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('lower(u.username) = $1'),
        ['a@b.com'],
        expect.objectContaining({ d1: true })
      );
      expect(user.role).toBe('vendor');
    });

    test('returns null when nothing matches', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await expect(identityQueries.findUserByEmail('a@b.com')).resolves.toBeNull();
    });

    test('short-circuits without querying for a missing email', async () => {
      const spy = jest.spyOn(dbPool, 'rows');
      await expect(identityQueries.findUserByEmail('')).resolves.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('findUserByEmailAndPhone', () => {
    test('matches the Java contract by normalising the phone', async () => {
      const spy = jest
        .spyOn(dbPool, 'rows')
        .mockResolvedValue([{ uuid: 'u-1', username: 'a@b.com', role_name: 'ClientInitiator' }]);

      const user = await identityQueries.findUserByEmailAndPhone('A@B.com', '9157154504');

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        ['a@b.com', '+919157154504'],
        expect.objectContaining({ d1: true })
      );
      expect(user.role).toBe('buyer');
    });

    test('returns null when either argument is missing', async () => {
      const spy = jest.spyOn(dbPool, 'rows');
      await expect(identityQueries.findUserByEmailAndPhone('', '9157154504')).resolves.toBeNull();
      await expect(identityQueries.findUserByEmailAndPhone('a@b.com', '')).resolves.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    test('returns null when no row matches', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await expect(
        identityQueries.findUserByEmailAndPhone('a@b.com', '9157154504')
      ).resolves.toBeNull();
    });
  });

  describe('listUsers', () => {
    test('maps rows and drops any without an email', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([
        { uuid: 'u-1', username: 'a@b.com', role_name: 'ClientInitiator' },
        { uuid: 'u-2', username: null, email: null, role_name: 'Vendor' },
      ]);

      const users = await identityQueries.listUsers();

      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('a@b.com');
    });

    test('honours an explicit limit', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await identityQueries.listUsers(25);
      expect(spy).toHaveBeenCalledWith(expect.any(String), [25], expect.objectContaining({ d1: true }));
    });

    test.each([
      [0, 200],
      [-5, 1],
      [900, 500],
    ])('bounds the requested limit %p to %p', async (requested, expected) => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await identityQueries.listUsers(requested);
      expect(spy).toHaveBeenCalledWith(expect.any(String), [expected], expect.objectContaining({ d1: true }));
    });
  });

  describe('resolveMasterUuid', () => {
    test('returns the uuid for a natural key', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([{ uuid: '5005' }]);
      await expect(identityQueries.resolveMasterUuid('role', 'role_name', 'ClientInitiator')).resolves.toBe(
        '5005'
      );
    });

    test('adds the active filter when requested', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([{ uuid: '5005' }]);
      await identityQueries.resolveMasterUuid('role', 'role_name', 'ClientInitiator', true);
      expect(spy.mock.calls[0][0]).toContain('is_active = true');
    });

    // role/org_types/master_status are already ported to D1 (see d1Bridge.js);
    // this call site opts in explicitly.
    test('opts into the D1 read path', async () => {
      const spy = jest.spyOn(dbPool, 'rows').mockResolvedValue([{ uuid: '5005' }]);
      await identityQueries.resolveMasterUuid('role', 'role_name', 'ClientInitiator');
      expect(spy.mock.calls[0][2]).toEqual({ d1: true });
    });

    test('returns null when the master row is absent', async () => {
      jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
      await expect(identityQueries.resolveMasterUuid('role', 'role_name', 'Nope')).resolves.toBeNull();
    });

    test('uses the active master fallback when the natural key is absent', async () => {
      jest.spyOn(dbPool, 'rows')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ uuid: 'active-fallback' }]);
      await expect(identityQueries.resolveMasterUuid('role', 'role_name', 'Renamed role', true)).resolves.toBe(
        'active-fallback'
      );
    });
  });

  // ── Identifier builders ───────────────────────────────────────────────────
  describe('identifier builders', () => {
    test('buildUniqueId produces the USR-prefixed format', () => {
      expect(identityQueries.buildUniqueId()).toMatch(/^USR\d+$/);
      expect(identityQueries.buildUniqueId()).not.toBe(identityQueries.buildUniqueId());
    });

    test('buildCompanyId uses three uppercase letters plus a timestamp', () => {
      expect(identityQueries.buildCompanyId('Procucev Pvt Ltd')).toMatch(/^PRO\d{12}$/);
    });

    test('buildCompanyId pads a short or symbol-only name', () => {
      expect(identityQueries.buildCompanyId('A')).toMatch(/^AXX\d{12}$/);
      expect(identityQueries.buildCompanyId('123 456')).toMatch(/^XXX\d{12}$/);
      expect(identityQueries.buildCompanyId('')).toMatch(/^ORG\d{12}$/);
      expect(identityQueries.buildCompanyId(null)).toMatch(/^ORG\d{12}$/);
    });
  });

  // ── Buyer creation ────────────────────────────────────────────────────────
  // Only the three tables named here may be reached, and only by their own lookup
  // column. The table and column cannot be parameterised, so this allow-list is
  // what keeps the identifier out of caller control.
  describe('resolveMasterUuid input guarding', () => {
    test('refuses a table that is not a master-data table', async () => {
      const spy = jest.spyOn(dbPool, 'rows');
      await expect(identityQueries.resolveMasterUuid('user', 'username', 'x')).rejects.toThrow(
        'Unknown master-data table "user".'
      );
      expect(spy).not.toHaveBeenCalled();
    });

    test('refuses a column that is not that table\'s lookup key', async () => {
      const spy = jest.spyOn(dbPool, 'rows');
      await expect(identityQueries.resolveMasterUuid('role', 'uuid', 'x')).rejects.toThrow(
        'Column "uuid" is not a lookup key for master-data table "role".'
      );
      expect(spy).not.toHaveBeenCalled();
    });

    test('names every table it will accept', () => {
      expect(identityQueries.MASTER_TABLES).toEqual({
        role: 'role_name',
        org_types: 'type_name',
        master_status: 'status',
      });
    });
  });

  // ── Buyer creation ────────────────────────────────────────────────────────
  describe('insertBuyerAccount', () => {
    let client;
    let originalPool;
    let existingUserRows;
    let masterRows;
    let withTransactionSpy;

    const payload = {
      email: 'New.Buyer@Example.com',
      password: 'Pass@123',
      phone: '9157154504',
      fullName: 'New Buyer',
      organizationName: 'New Buyer Ltd',
    };

    beforeEach(() => {
      existingUserRows = [];
      masterRows = { role: [{ uuid: '5005' }], org_types: [{ uuid: '3001' }], master_status: [{ uuid: '104' }] };

      // pg returns { rows }, and the transaction is driven by pool.withTransaction
      // rather than a checked-out connection with begin/commit/rollback of its own.
      client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      originalPool = dbPool.pool;
      dbPool.pool = { connect: jest.fn() };
      withTransactionSpy = jest
        .spyOn(dbPool, 'withTransaction')
        .mockImplementation(async (fn) => fn(client));

      // The duplicate check and the three master-data lookups all go through
      // pool.rows, so routing on the SQL drives every branch.
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "user"')) return existingUserRows;
        if (sql.includes('from "role"')) return masterRows.role;
        if (sql.includes('from "org_types"')) return masterRows.org_types;
        if (sql.includes('from "master_status"')) return masterRows.master_status;
        return [];
      });
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('creates the organisation and the user in one transaction', async () => {
      const result = await identityQueries.insertBuyerAccount(payload);

      expect(withTransactionSpy).toHaveBeenCalledTimes(1);
      expect(result.created).toBe(true);
      expect(result.organizationReused).toBe(false);
      expect(result.user).toMatchObject({
        email: 'new.buyer@example.com',
        role: 'buyer',
        orgName: 'New Buyer Ltd',
        mobile: '+919157154504',
        status: 'ACTIVE',
      });
      // Both rows are written on the same client, so neither can land without the
      // other.
      const statements = client.query.mock.calls.map(([sql]) => sql);
      expect(statements.some((sql) => sql.includes('insert into organization'))).toBe(true);
      expect(statements.some((sql) => sql.includes('insert into "user"'))).toBe(true);
    });

    test('writes the password as submitted, so migrated accounts keep working', async () => {
      await identityQueries.insertBuyerAccount(payload);

      const userInsert = client.query.mock.calls.find(([sql]) => sql.includes('insert into "user"'));
      expect(userInsert[1]).toContain('Pass@123');
    });

    test('reuses an existing CLIENT organisation with the same name', async () => {
      client.query.mockResolvedValueOnce({ rows: [{ uuid: 'existing-org' }] }).mockResolvedValue({ rows: [] });

      const result = await identityQueries.insertBuyerAccount(payload);

      expect(result.created).toBe(true);
      expect(result.organizationReused).toBe(true);
      expect(result.user.orgId).toBe('existing-org');
      // The organisation is reused, not inserted a second time.
      expect(client.query.mock.calls.some(([sql]) => sql.includes('insert into organization'))).toBe(false);
    });

    test('derives the organisation name and display name from the email when omitted', async () => {
      const result = await identityQueries.insertBuyerAccount({
        email: 'solo@example.com',
        password: 'Pass@123',
        phone: '9157154504',
      });

      expect(result.user.orgName).toBe('solo Enterprises');
      expect(result.user.name).toBe('solo');
    });

    test('reports an existing account without opening a transaction', async () => {
      existingUserRows = [{ uuid: 'u-1', username: 'new.buyer@example.com', role_name: 'ClientInitiator' }];

      const result = await identityQueries.insertBuyerAccount(payload);

      expect(result).toMatchObject({ created: false, reason: 'ALREADY_EXISTS' });
      expect(withTransactionSpy).not.toHaveBeenCalled();
    });

    test('propagates an insert failure so the transaction rolls back', async () => {
      // withTransaction owns the rollback (covered in pool.test.js); what matters
      // here is that the error is not swallowed on the way out.
      client.query.mockRejectedValue(new Error('duplicate key value'));

      await expect(identityQueries.insertBuyerAccount(payload)).rejects.toThrow('duplicate key value');
    });

    test.each([
      ['email', { ...payload, email: '' }],
      ['password', { ...payload, password: '' }],
    ])('requires %s', async (_field, badPayload) => {
      await expect(identityQueries.insertBuyerAccount(badPayload)).rejects.toThrow(
        /email and password are required/
      );
    });

    test('accepts a missing phone and stores it empty, never a placeholder number', async () => {
      const result = await identityQueries.insertBuyerAccount({ ...payload, phone: null });
      expect(result.created).toBe(true);
      expect(result.user.mobile).toBe('');
      expect(JSON.stringify(result)).not.toContain('9999999999');
    });

    test('refuses to run when the database is not configured', async () => {
      dbPool.pool = null;
      await expect(identityQueries.insertBuyerAccount(payload)).rejects.toThrow(
        dbPool.NOT_CONFIGURED_MESSAGE
      );
    });

    test.each([
      ['role', 'role', `Role "${IDENTITY_MASTER_DATA.BUYER_ROLE_NAME}" not found.`],
      ['org type', 'org_types', `Org type "${IDENTITY_MASTER_DATA.BUYER_ORG_TYPE}" not found.`],
      ['status', 'master_status', `Status "${IDENTITY_MASTER_DATA.BUYER_STATUS}" not found.`],
    ])('fails clearly when the %s master row is missing', async (_label, table, expectedError) => {
      masterRows[table] = [];
      await expect(identityQueries.insertBuyerAccount(payload)).rejects.toThrow(expectedError);
    });
  });

  // ── Staff creation (category_manager / admin) ─────────────────────────────
  describe('insertStaffAccount', () => {
    let client;
    let originalPool;
    let existingUserRows;
    let masterRows;
    let withTransactionSpy;

    const payload = {
      email: 'New.Staff@Example.com',
      password: 'Pass@123',
      phone: '9157154504',
      fullName: 'New Staff',
      organizationName: 'New Staff Org',
      roleName: IDENTITY_MASTER_DATA.CATEGORY_MANAGER_ROLE_NAME,
      orgTypeName: IDENTITY_MASTER_DATA.CATEGORY_MANAGER_ORG_TYPE,
      statusName: IDENTITY_MASTER_DATA.CATEGORY_MANAGER_STATUS,
    };

    beforeEach(() => {
      existingUserRows = [];
      masterRows = { role: [{ uuid: '5005' }], org_types: [{ uuid: '3001' }], master_status: [{ uuid: '104' }] };

      client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      originalPool = dbPool.pool;
      dbPool.pool = { connect: jest.fn() };
      withTransactionSpy = jest
        .spyOn(dbPool, 'withTransaction')
        .mockImplementation(async (fn) => fn(client));

      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "user"')) return existingUserRows;
        if (sql.includes('from "role"')) return masterRows.role;
        if (sql.includes('from "org_types"')) return masterRows.org_types;
        if (sql.includes('from "master_status"')) return masterRows.master_status;
        return [];
      });
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('creates the organisation and the user in one transaction', async () => {
      const result = await identityQueries.insertStaffAccount(payload);

      expect(withTransactionSpy).toHaveBeenCalledTimes(1);
      expect(result.created).toBe(true);
      expect(result.organizationReused).toBe(false);
      expect(result.user).toMatchObject({
        email: 'new.staff@example.com',
        role: 'category_manager',
        orgName: 'New Staff Org',
        mobile: '+919157154504',
        status: 'ACTIVE',
      });
      const statements = client.query.mock.calls.map(([sql]) => sql);
      expect(statements.some((sql) => sql.includes('insert into organization'))).toBe(true);
      expect(statements.some((sql) => sql.includes('insert into "user"'))).toBe(true);
    });

    test('maps the SuperUser role name onto the admin app role', async () => {
      const result = await identityQueries.insertStaffAccount({
        ...payload,
        roleName: IDENTITY_MASTER_DATA.ADMIN_ROLE_NAME,
        orgTypeName: IDENTITY_MASTER_DATA.ADMIN_ORG_TYPE,
        statusName: IDENTITY_MASTER_DATA.ADMIN_STATUS,
      });

      expect(result.user.role).toBe('admin');
    });

    test('reuses an existing organisation with the same name', async () => {
      client.query.mockResolvedValueOnce({ rows: [{ uuid: 'existing-org' }] }).mockResolvedValue({ rows: [] });

      const result = await identityQueries.insertStaffAccount(payload);

      expect(result.organizationReused).toBe(true);
      expect(result.user.orgId).toBe('existing-org');
      expect(client.query.mock.calls.some(([sql]) => sql.includes('insert into organization'))).toBe(false);
    });

    test('derives the organisation name and display name from the email when omitted', async () => {
      const result = await identityQueries.insertStaffAccount({
        email: 'solo-staff@example.com',
        password: 'Pass@123',
        phone: '9157154504',
        roleName: payload.roleName,
        orgTypeName: payload.orgTypeName,
        statusName: payload.statusName,
      });

      expect(result.user.orgName).toBe('solo-staff Internal');
      expect(result.user.name).toBe('solo-staff');
    });

    test('reports an existing account without opening a transaction', async () => {
      existingUserRows = [{ uuid: 'u-1', username: 'new.staff@example.com', role_name: 'CategoryManager' }];

      const result = await identityQueries.insertStaffAccount(payload);

      expect(result).toMatchObject({ created: false, reason: 'ALREADY_EXISTS' });
      expect(withTransactionSpy).not.toHaveBeenCalled();
    });

    test.each([
      ['email', { ...payload, email: '' }],
      ['password', { ...payload, password: '' }],
      ['phone', { ...payload, phone: '' }],
    ])('requires %s', async (_field, badPayload) => {
      await expect(identityQueries.insertStaffAccount(badPayload)).rejects.toThrow(
        /email, password and phone are required/
      );
    });

    test.each([
      ['roleName', { ...payload, roleName: '' }],
      ['orgTypeName', { ...payload, orgTypeName: '' }],
      ['statusName', { ...payload, statusName: '' }],
    ])('requires %s', async (_field, badPayload) => {
      await expect(identityQueries.insertStaffAccount(badPayload)).rejects.toThrow(
        /roleName, orgTypeName and statusName are required/
      );
    });

    test('refuses to run when the database is not configured', async () => {
      dbPool.pool = null;
      await expect(identityQueries.insertStaffAccount(payload)).rejects.toThrow(
        dbPool.NOT_CONFIGURED_MESSAGE
      );
    });

    test.each([
      ['role', 'role', (p) => `Role "${p.roleName}" not found.`],
      ['org type', 'org_types', (p) => `Org type "${p.orgTypeName}" not found.`],
      ['status', 'master_status', (p) => `Status "${p.statusName}" not found.`],
    ])('fails clearly when the %s master row is missing', async (_label, table, expectedErrorFn) => {
      masterRows[table] = [];
      await expect(identityQueries.insertStaffAccount(payload)).rejects.toThrow(expectedErrorFn(payload));
    });
  });

  // ── Password updates ──────────────────────────────────────────────────────
  describe('updateUserPassword', () => {
    test('reports success when a row was updated', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      await expect(identityQueries.updateUserPassword('A@B.com', 'New@1234')).resolves.toBe(true);
    });

    test('reports failure when no row matched', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 0 });
      await expect(identityQueries.updateUserPassword('a@b.com', 'New@1234')).resolves.toBe(false);
    });

    test('treats an absent rowCount as no update rather than throwing', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({});
      await expect(identityQueries.updateUserPassword('a@b.com', 'New@1234')).resolves.toBe(false);
    });

    test('normalises the email before updating', async () => {
      const spy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      await identityQueries.updateUserPassword('  A@B.COM ', 'New@1234');
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        ['New@1234', 'a@b.com'],
        expect.objectContaining({ d1: true })
      );
    });
  });

  // `username` has no unique index, so the email-keyed update above can rewrite
  // more than one row. Self-service password changes address the primary key
  // instead, which is what this variant exists for.
  describe('updateUserPasswordByUuid', () => {
    const UUID = '1b7083fa-78b1-4372-bf11-6eca62db9b7e';

    test('reports success when the row was updated', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      await expect(
        identityQueries.updateUserPasswordByUuid(UUID, 'New@1234', 'buyer@procucev.com')
      ).resolves.toBe(true);
    });

    test('reports failure when no row matched the uuid', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 0 });
      await expect(
        identityQueries.updateUserPasswordByUuid(UUID, 'New@1234', 'buyer@procucev.com')
      ).resolves.toBe(false);
    });

    test('treats an absent rowCount as no update rather than throwing', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({});
      await expect(
        identityQueries.updateUserPasswordByUuid(UUID, 'New@1234', 'buyer@procucev.com')
      ).resolves.toBe(false);
    });

    test('filters on the primary key and records the actor', async () => {
      const spy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      await identityQueries.updateUserPasswordByUuid(UUID, 'New@1234', 'buyer@procucev.com');

      const [sql, params] = spy.mock.calls[0];
      expect(sql).toContain('where uuid = $3');
      expect(sql).not.toContain('username');
      expect(params).toEqual(['New@1234', 'buyer@procucev.com', UUID]);
    });

    test('falls back to a system actor when no email is supplied', async () => {
      const spy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      await identityQueries.updateUserPasswordByUuid(UUID, 'New@1234');
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        ['New@1234', 'enterprise-workspace', UUID],
        expect.objectContaining({ d1: true })
      );
    });
  });

  // ── Vendor creation ────────────────────────────────────────────────────────
  describe('insertVendorAccount', () => {
    let client;
    let originalPool;
    let masterRows;

    const payload = {
      email: 'vendor@example.com',
      password: 'Pass@123',
      phone: '9157154504',
      fullName: 'Vendor Name',
      organizationName: 'Vendor Org',
    };

    beforeEach(() => {
      masterRows = { role: [{ uuid: '5002' }], org_types: [{ uuid: '3002' }], master_status: [{ uuid: '102' }] };
      client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      originalPool = dbPool.pool;
      dbPool.pool = { connect: jest.fn() };
      jest.spyOn(dbPool, 'withTransaction').mockImplementation(async (fn) => fn(client));
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "role"')) return masterRows.role;
        if (sql.includes('from "org_types"')) return masterRows.org_types;
        if (sql.includes('from "master_status"')) return masterRows.master_status;
        return [];
      });
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [] });
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('refuses to run when database is not configured', async () => {
      dbPool.pool = null;
      await expect(identityQueries.insertVendorAccount(payload)).rejects.toThrow(dbPool.NOT_CONFIGURED_MESSAGE);
    });

    test('requires email and password', async () => {
      await expect(identityQueries.insertVendorAccount({ password: 'p' })).rejects.toThrow(/email and password are required/);
      await expect(identityQueries.insertVendorAccount({ email: 'e' })).rejects.toThrow(/email and password are required/);
    });

    test('handles existing user with resetExisting true and false', async () => {
      const existing = { uuid: 'v-ex-1', username: 'vendor@example.com', role_name: 'Vendor' };
      dbPool.query.mockClear();
      jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([existing]);

      const res1 = await identityQueries.insertVendorAccount({ ...payload, resetExisting: true });
      expect(res1.created).toBe(false);
      expect(res1.reason).toBe('ALREADY_EXISTS');
      expect(dbPool.query).toHaveBeenCalledTimes(1);
      expect(dbPool.query.mock.calls[0][0]).toContain('phone = $4');
      expect(dbPool.query.mock.calls[0][1]).toEqual(['Pass@123', 'vendor-ingestion', 'v-ex-1', '+919157154504']);

      jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([existing]);
      const res2 = await identityQueries.insertVendorAccount({ ...payload, resetExisting: false });
      expect(res2.created).toBe(false);
    });

    test('creates vendor account in postgres transaction', async () => {
      const onboardingEvent = {
        id: 'retry:vendor_onboarding_email:hashed-vendor-id',
        eventType: 'vendor_onboarding_email',
        payload: { vendorId: 'vendor-1', encryptedTempPassword: 'enc:v1:opaque-token' },
      };
      const res = await identityQueries.insertVendorAccount({ ...payload, onboardingEvent });
      expect(res.created).toBe(true);
      expect(res.user.role).toBe('vendor');
      expect(res.user.orgName).toBe('Vendor Org');
      expect(client.query).toHaveBeenCalledTimes(4);
      expect(client.query.mock.calls[3][0]).toContain('INSERT INTO event_outbox');
      expect(client.query.mock.calls[3][1]).toEqual([
        onboardingEvent.id,
        onboardingEvent.eventType,
        JSON.stringify(onboardingEvent.payload),
      ]);
      expect(JSON.stringify(client.query.mock.calls[3][1])).not.toContain(payload.password);
    });

    test('creates vendor account under D1 path', async () => {
      mockAtomicD1Batch({ organizationUuid: 'd1-vendor-org', userUuid: 'd1-vendor-user' });
      jest.spyOn(dbPool, 'query').mockResolvedValueOnce({ rows: [] }); // orgLookup

      const res = await identityQueries.insertVendorAccount({
        email: 'd1vendor@example.com',
        password: 'Pass@123',
        onboardingEvent: {
          id: 'retry:vendor_onboarding_email:hashed-d1-vendor-id',
          eventType: 'vendor_onboarding_email',
          payload: { vendorId: 'd1-vendor-id', encryptedTempPassword: 'enc:v1:d1-token' },
        },
      });
      expect(res.created).toBe(true);
      expect(res.user.role).toBe('vendor');
      const batchCall = d1Bridge.batchD1.mock.calls[0][1];
      expect(batchCall).toHaveLength(3);
      expect(batchCall.some(({ text }) => text.includes('not exists (select 1 from organization'))).toBe(true);
      expect(batchCall.some(({ text }) => text.includes('returning uuid, org_uuid'))).toBe(true);
      expect(batchCall[2].text).toContain('INSERT INTO event_outbox');
      expect(batchCall[2].text).toContain('WHERE EXISTS (SELECT 1 FROM "user" WHERE uuid = $4)');
      expect(batchCall[2].params[2]).toBe(JSON.stringify({
        vendorId: 'd1-vendor-id',
        encryptedTempPassword: 'enc:v1:d1-token',
      }));
      expect(JSON.stringify(batchCall[2].params)).not.toContain('Pass@123');
      expect(batchCall[0].text).toContain('contact_person, email, organization_phonenumber');
      expect(batchCall[0].text).not.toMatch(/contact_name|contact_email|contact_phone/);
      expect(batchCall[1].text).not.toContain('organization_name, org_uuid');
    });

    test.each([
      ['role', /Role.*not found/],
      ['org_types', /Org type.*not found/],
      ['master_status', /Status.*not found/],
    ])('fails clearly when the %s master row is missing', async (table, expected) => {
      masterRows[table] = [];
      await expect(identityQueries.insertVendorAccount(payload)).rejects.toThrow(expected);
    });

    test('reuses an existing D1 organisation without writing blank profile values', async () => {
      dbPool.pool = { connect: jest.fn() };
      mockAtomicD1Batch({ organizationUuid: 'existing-vendor-org', userUuid: 'existing-vendor-user' });
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) =>
        sql.includes('from "user"') ? [] : [{ uuid: 'master-uuid' }]
      );
      const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [{ uuid: 'existing-vendor-org' }] });

      const result = await identityQueries.insertVendorAccount({ ...payload, city: '', state: '' });

      expect(result).toMatchObject({ created: true, organizationReused: true });
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(d1Bridge.batchD1.mock.calls[0][1]).toHaveLength(1);
    });
  });

  // ── Buyer onboarding update ────────────────────────────────────────────────
  describe('updateBuyerOnboardingStatus', () => {
    test('updates buyer account phone, password, and status', async () => {
      const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      const res = await identityQueries.updateBuyerOnboardingStatus({
        userUuid: 'u-b-1',
        newPhone: '9876543210',
        newPassword: 'NewPassword@123',
      });

      expect(res).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('update "user" set phone = $1, password = $2'),
        ['+919876543210', 'NewPassword@123', 'EMAIL_VERIFIED', 'buyer-onboarding', 'u-b-1'],
        expect.any(Object)
      );
    });

    test('returns false when no buyer row was updated', async () => {
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 0 });
      await expect(
        identityQueries.updateBuyerOnboardingStatus({
          userUuid: 'missing-user',
          newPhone: '9876543210',
          newPassword: 'NewPassword@123',
        })
      ).resolves.toBe(false);
    });
  });

  // ── Username lookup & D1 registration branches ────────────────────────────
  describe('findExistingUsernames and placeholder phone', () => {
    test('findExistingUsernames returns set of existing emails', async () => {
      dbPool.pool = { connect: jest.fn() };
      jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([{ username: 'a@b.com' }]);
      const set = await identityQueries.findExistingUsernames(['a@b.com', 'c@d.com']);
      expect(set.has('a@b.com')).toBe(true);
      expect(set.has('c@d.com')).toBe(false);

      expect(await identityQueries.findExistingUsernames([])).toEqual(new Set());
      expect(await identityQueries.findExistingUsernames()).toEqual(new Set());
      dbPool.pool = null;
      expect(await identityQueries.findExistingUsernames(['a@b.com'])).toEqual(new Set());
    });

    test('normalizes email inputs before the batch username lookup', async () => {
      dbPool.pool = { connect: jest.fn() };
      const rowsSpy = jest.spyOn(dbPool, 'rows').mockResolvedValue([{ username: 'a@b.com' }]);
      await expect(identityQueries.findExistingUsernames([' A@B.COM ', 'C@D.com'])).resolves.toEqual(
        new Set(['a@b.com'])
      );
      expect(rowsSpy).toHaveBeenCalledWith(
        expect.stringContaining('lower(username) = any($1)'),
        [['a@b.com', 'c@d.com']],
        expect.objectContaining({
          d1: true,
          d1Text: expect.stringContaining('lower(username) in ($1, $2)'),
          d1Params: ['a@b.com', 'c@d.com'],
        })
      );
    });

    test('findUserByEmailAndPhone never matches a placeholder phone through a fallback lookup', async () => {
      dbPool.pool = { connect: jest.fn() };
      const rowsSpy = jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([]);

      const user = await identityQueries.findUserByEmailAndPhone('auto@buyer.com', '9999999999');
      expect(user).toBeNull();
      expect(rowsSpy).toHaveBeenCalledTimes(1);
    });

    test('insertBuyerAccount and insertStaffAccount under D1 path with existing org address update', async () => {
      dbPool.pool = { connect: jest.fn() };
      mockAtomicD1Batch({ organizationUuid: 'existing-org-d1' });
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "user"')) return [];
        return [{ uuid: 'master-uuid' }];
      });
      // Return existing org so it executes the update organization branch
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [{ uuid: 'existing-org-d1' }] });

      const buyerRes = await identityQueries.insertBuyerAccount({
        email: 'd1buyer@example.com',
        password: 'Pass@123',
        phone: '9157154504',
        city: 'Mumbai',
        gstin: '27AAAAA0000A1Z5',
      });
      expect(buyerRes.created).toBe(true);
      expect(buyerRes.organizationReused).toBe(true);

      const staffRes = await identityQueries.insertStaffAccount({
        email: 'd1staff@example.com',
        password: 'Pass@123',
        phone: '9157154504',
        roleName: IDENTITY_MASTER_DATA.ADMIN_ROLE_NAME,
        orgTypeName: IDENTITY_MASTER_DATA.ADMIN_ORG_TYPE,
        statusName: IDENTITY_MASTER_DATA.ADMIN_STATUS,
      });
      expect(staffRes.created).toBe(true);
      const batches = d1Bridge.batchD1.mock.calls.map((call) => call[1]);
      expect(batches).toHaveLength(2);
      expect(batches[0].some(({ text }) => text.includes('update organization'))).toBe(true);
      expect(batches.every((batch) => batch.some(({ text }) => text.includes('returning uuid, org_uuid')))).toBe(true);
    });

    test('buyer D1 registration reuses an existing organisation without a blank address update', async () => {
      dbPool.pool = { connect: jest.fn() };
      mockAtomicD1Batch({ organizationUuid: 'existing-org-d1', userUuid: 'buyer-no-address' });
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) =>
        sql.includes('from "user"') ? [] : [{ uuid: 'master-uuid' }]
      );
      const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [{ uuid: 'existing-org-d1' }] });

      const result = await identityQueries.insertBuyerAccount({
        email: 'no-address@example.com',
        password: 'Pass@123',
        phone: '9157154504',
      });

      expect(result).toMatchObject({ created: true, organizationReused: true });
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(d1Bridge.batchD1.mock.calls[0][1]).toHaveLength(1);
    });

    test('returns the account created concurrently when D1 insert guard returns no user row', async () => {
      dbPool.pool = { connect: jest.fn() };
      mockAtomicD1Batch();
      d1Bridge.batchD1.mockResolvedValue([{ rows: [], rowCount: 0 }]);
      let userLookupCount = 0;
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "user"')) {
          userLookupCount += 1;
          return userLookupCount === 3
            ? [{ uuid: 'concurrent-user', username: 'race@example.com', role_name: 'ClientInitiator' }]
            : [];
        }
        return [{ uuid: 'master-uuid' }];
      });
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [{ uuid: 'existing-org' }] });

      const result = await identityQueries.insertBuyerAccount({
        email: 'race@example.com',
        password: 'Pass@123',
        phone: '9157154504',
      });

      expect(result).toMatchObject({ created: false, reason: 'ALREADY_EXISTS', user: { id: 'concurrent-user' } });
    });

    test('rejects D1 identity creation when only the non-atomic HTTP adapter is configured', async () => {
      dbPool.pool = { connect: jest.fn() };
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
      const batchSpy = jest.spyOn(d1Bridge, 'batchD1');
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) =>
        sql.includes('from "user"') ? [] : [{ uuid: 'master-uuid' }]
      );
      const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [] });

      await expect(
        identityQueries.insertBuyerAccount({
          email: 'http-only@example.com',
          password: 'Pass@123',
          phone: '9157154504',
        })
      ).rejects.toThrow('Identity account creation requires a Workers D1 binding with atomic batch support.');

      expect(querySpy).toHaveBeenCalledTimes(1); // advisory organization lookup only
      expect(batchSpy).not.toHaveBeenCalled();
    });

    test('fails registration when the D1 guard returns no user and no concurrent account exists', async () => {
      dbPool.pool = { connect: jest.fn() };
      mockAtomicD1Batch();
      d1Bridge.batchD1.mockResolvedValue([{ rows: [], rowCount: 0 }]);
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) =>
        sql.includes('from "user"') ? [] : [{ uuid: 'master-uuid' }]
      );
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [{ uuid: 'existing-org' }] });

      await expect(
        identityQueries.insertBuyerAccount({
          email: 'guard-rejected@example.com',
          password: 'Pass@123',
          phone: '9157154504',
        })
      ).rejects.toThrow('Buyer account could not be created because its organization no longer exists. Retry the registration.');
    });

    test('insertBuyerAccount under Postgres with existing org updates org address', async () => {
      dbPool.pool = { connect: jest.fn() };
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ uuid: 'existing-pg-org' }] }) // org lookup found
          .mockResolvedValueOnce({ rows: [] }) // org update
          .mockResolvedValueOnce({ rows: [] }), // user insert
      };
      jest.spyOn(dbPool, 'withTransaction').mockImplementation(async (fn) => fn(client));
      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "user"')) return [];
        return [{ uuid: 'master-uuid' }];
      });

      const res = await identityQueries.insertBuyerAccount({
        email: 'pgbuyer@example.com',
        password: 'Pass@123',
        phone: '9157154504',
        city: 'Delhi',
        pincode: '110001',
      });
      expect(res.created).toBe(true);
      expect(res.organizationReused).toBe(true);
    });

    test('insertBuyerAccount and insertStaffAccount under D1 path with new org creation', async () => {
      dbPool.pool = { connect: jest.fn() };
      mockAtomicD1Batch({ organizationUuid: 'new-org-uuid', userUuid: 'new-user-uuid' });

      jest.spyOn(dbPool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('from "user" where lower(email) = lower($1)')) {
          return { rows: [] };
        }
        if (sql.includes('from organization where organization_name = $1')) {
          return { rows: [] }; // Organization not found, so it inserts a new organization
        }
        if (sql.includes('select uuid from "user"')) {
          return { rows: [{ uuid: 'new-user-uuid' }] };
        }
        return { rows: [] };
      });

      jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
        if (sql.includes('from "user"')) return [];
        return [{ uuid: 'resolved-master-uuid' }];
      });

      const buyerRes = await identityQueries.insertBuyerAccount({
        email: 'd1newbuyer@example.com',
        password: 'Pass@123',
        phone: '9157154504',
      });
      expect(buyerRes.created).toBe(true);
      expect(buyerRes.organizationReused).toBe(false);

      const staffRes = await identityQueries.insertStaffAccount({
        email: 'd1newstaff@example.com',
        password: 'Pass@123',
        phone: '9157154504',
        roleName: IDENTITY_MASTER_DATA.ADMIN_ROLE_NAME,
        orgTypeName: IDENTITY_MASTER_DATA.ADMIN_ORG_TYPE,
        statusName: IDENTITY_MASTER_DATA.ADMIN_STATUS,
      });
      expect(staffRes.created).toBe(true);
      expect(staffRes.organizationReused).toBe(false);
      const batches = d1Bridge.batchD1.mock.calls.map((call) => call[1]);
      expect(batches).toHaveLength(2);
      expect(batches.every((batch) => batch.some(({ text }) => text.includes('not exists (select 1 from organization')))).toBe(true);
      const newBuyerOrganization = batches[0].find(({ text }) => text.includes('insert into organization'));
      expect(newBuyerOrganization.text).toContain('contact_person, email, organization_phonenumber');
      expect(newBuyerOrganization.text).not.toMatch(/contact_name|contact_email|contact_phone/);
    });
  });
});
