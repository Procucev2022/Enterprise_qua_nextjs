const identityQueries = require('../src/db/identityQueries');
const dbPool = require('../src/db/pool');
const { IDENTITY_MASTER_DATA } = require('../src/config/constants');

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

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('lower(u.username) = $1'), ['a@b.com']);
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

      expect(spy).toHaveBeenCalledWith(expect.any(String), ['a@b.com', '+919157154504']);
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
      expect(spy).toHaveBeenCalledWith(expect.any(String), [25]);
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
      ['phone', { ...payload, phone: '' }],
    ])('requires %s', async (_field, badPayload) => {
      await expect(identityQueries.insertBuyerAccount(badPayload)).rejects.toThrow(
        /email, password and phone are required/
      );
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
      expect(spy).toHaveBeenCalledWith(expect.any(String), ['New@1234', 'a@b.com']);
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
      expect(spy).toHaveBeenCalledWith(expect.any(String), [
        'New@1234',
        'enterprise-workspace',
        UUID,
      ]);
    });
  });
});
