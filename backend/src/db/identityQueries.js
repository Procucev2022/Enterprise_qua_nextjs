// ==============================================================================
// IDENTITY QUERIES (shared Procucev MySQL schema)
// ==============================================================================
// Read/write helpers for the `user`, `organization`, `role`, `org_types` and
// `master_status` tables that the Java p2pservices application owns.
//
// Schema facts this module depends on (verified against development_gmtbfs):
//   - `user.uuid` is application-assigned (no AUTO_INCREMENT).
//   - `user.username` holds the login email; `user.email` is a separate column.
//   - Passwords are stored in PLAINTEXT (the Java app uses NoOpPasswordEncoder),
//     so verification is a constant-time comparison, not a hash comparison.
//   - `bit(1)` columns (is_active, is_approved, self_client, ...) read back as
//     Buffers and must be written as 0/1.
//   - There is NO unique index on `user.username`, so duplicate-email guarding
//     has to happen in application code.
// ==============================================================================

const crypto = require('crypto');
const identityPoolModule = require('./identityPool');
const {
  IDENTITY_ROLE_MAP,
  IDENTITY_MASTER_DATA,
  IDENTITY_PHONE_CONFIG,
} = require('../config/constants');

const { bitToBoolean } = identityPoolModule;

/**
 * Normalise a phone number to the form the shared schema stores, so login
 * lookups match byte-for-byte.
 *
 * This is a direct port of ProcUserServiceImpl.normalizePhone in the Java
 * p2pservices app, which owns the `user.phone` column. Any divergence would
 * silently break sign-in for accounts that service created, so the branch order
 * and the fallback are deliberately identical:
 *   - keep digits only, then strip leading zeros
 *   - exactly 10 digits            -> +91XXXXXXXXXX (assumed Indian mobile)
 *   - 12 digits beginning with 91  -> +91 + the trailing 10
 *   - anything else                -> '+' + the digits, untouched
 */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (trimmed === '') return trimmed;

  const { DEFAULT_COUNTRY_CODE, NATIONAL_NUMBER_LENGTH, COUNTRY_DIALLING_DIGITS } =
    IDENTITY_PHONE_CONFIG;

  const digits = String(raw).replace(/[^0-9]/g, '').replace(/^0+/, '');

  if (digits.length === NATIONAL_NUMBER_LENGTH) {
    return `${DEFAULT_COUNTRY_CODE}${digits}`;
  }
  if (
    digits.length === COUNTRY_DIALLING_DIGITS.length + NATIONAL_NUMBER_LENGTH &&
    digits.startsWith(COUNTRY_DIALLING_DIGITS)
  ) {
    return `${DEFAULT_COUNTRY_CODE}${digits.slice(COUNTRY_DIALLING_DIGITS.length)}`;
  }
  return `+${digits}`;
}

/**
 * Translate a shared-schema role name into one of the four application roles.
 * Returns null for roles the workspace has no screens for.
 */
function mapRoleName(roleName) {
  if (!roleName) return null;
  return IDENTITY_ROLE_MAP[String(roleName).trim().toLowerCase()] || null;
}

/**
 * Constant-time plaintext password comparison. The shared schema stores
 * passwords unhashed, so this compares the submitted value directly while
 * avoiding a length-leaking early return.
 */
function verifyStoredPassword(submitted, stored) {
  if (typeof submitted !== 'string' || typeof stored !== 'string') return false;
  if (submitted.length === 0 || stored.length === 0) return false;
  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Shape a joined `user` row into the record the auth service works with.
 */
function mapRowToUser(row) {
  if (!row) return null;
  return {
    id: row.uuid,
    email: (row.username || row.email || '').toLowerCase(),
    name: row.full_name || row.first_name || (row.username || '').split('@')[0],
    role: mapRoleName(row.role_name),
    rawRoleName: row.role_name,
    orgId: row.org_uuid,
    orgName: row.organization_name || '',
    password: row.password,
    mobile: row.phone || '',
    status: bitToBoolean(row.is_active) ? 'ACTIVE' : 'INACTIVE',
    isActive: bitToBoolean(row.is_active),
    isApproved: bitToBoolean(row.is_approved),
    isSelfClient: bitToBoolean(row.self_client),
    verificationStatus: row.verification_status || null,
  };
}

const USER_SELECT = `
  select u.uuid, u.username, u.email, u.password, u.full_name, u.first_name,
         u.phone, u.is_active, u.is_approved, u.self_client, u.verification_status,
         u.org_uuid, r.role_name, o.organization_name
    from \`user\` u
    left join role r on r.uuid = u.role_uuid
    left join organization o on o.uuid = u.org_uuid
`;

/**
 * Look up a single active account by login email.
 * Prefers an active row, since the shared schema permits duplicate usernames.
 */
async function findUserByEmail(email) {
  if (!email) return null;
  const rows = await identityPoolModule.identityQuery(
    `${USER_SELECT} where lower(u.username) = ? order by u.is_active desc, u.created_ts desc limit 1`,
    [String(email).trim().toLowerCase()]
  );
  return mapRowToUser(rows[0]);
}

/**
 * Look up an account by email + phone, matching the Java `/authenticate` contract.
 */
async function findUserByEmailAndPhone(email, phone) {
  if (!email || !phone) return null;
  const rows = await identityPoolModule.identityQuery(
    `${USER_SELECT} where lower(u.username) = ? and u.phone = ? order by u.is_active desc limit 1`,
    [String(email).trim().toLowerCase(), normalizePhone(phone)]
  );
  return mapRowToUser(rows[0]);
}

/**
 * List accounts for the admin users screen.
 */
async function listUsers(limit = 200) {
  const rows = await identityPoolModule.identityQuery(
    `${USER_SELECT} where u.is_active = 1 order by u.created_ts desc limit ?`,
    [Number(limit)]
  );
  return rows.map(mapRowToUser).filter((u) => !!u.email);
}

/**
 * Resolve a master-data uuid by its natural key, e.g. the ClientInitiator role.
 */
async function resolveMasterUuid(table, column, value, extraActiveFilter = false) {
  const activeClause = extraActiveFilter ? ' and is_active = 1' : '';
  const rows = await identityPoolModule.identityQuery(
    `select uuid from \`${table}\` where ${column} = ?${activeClause} limit 1`,
    [value]
  );
  return rows[0] ? rows[0].uuid : null;
}

/**
 * Build the USR-prefixed unique_id format the shared schema uses.
 */
function buildUniqueId() {
  return `USR${Date.now()}${crypto.randomInt(1000000000, 9999999999)}`;
}

/**
 * Build the companyId format the Java app generates: first 3 letters of the
 * organisation name, uppercased, plus a yyMMddHHmmss stamp.
 */
function buildCompanyId(organizationName) {
  const prefix = String(organizationName || 'ORG')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${String(d.getFullYear()).slice(-2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${prefix}${stamp}`;
}

/**
 * Create a buyer account (organization + user) in the shared schema.
 *
 * Mirrors SelfRegistrationServiceImpl.setUserDetails in the Java service:
 * ClientInitiator role, CLIENT org type, CLIENT_NEW status. The account is
 * written as active and pre-approved so it can sign in immediately, since the
 * Java login path blocks self-registered accounts until an admin approves them.
 *
 * Runs in a single transaction and reuses an existing CLIENT organisation when
 * one already matches the requested name.
 */
async function insertBuyerAccount({
  email,
  password,
  phone,
  fullName,
  organizationName,
  createdBy = 'enterprise-workspace',
}) {
  if (!identityPoolModule.pool) {
    throw new Error('Identity database is not configured.');
  }
  if (!email || !password || !phone) {
    throw new Error('email, password and phone are required to create a buyer account.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = normalizePhone(phone);
  const orgName = organizationName || `${normalizedEmail.split('@')[0]} Enterprises`;
  const displayName = fullName || normalizedEmail.split('@')[0];

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return { created: false, reason: 'ALREADY_EXISTS', user: existing };
  }

  const [roleUuid, orgTypeUuid, statusUuid] = await Promise.all([
    resolveMasterUuid('role', 'role_name', IDENTITY_MASTER_DATA.BUYER_ROLE_NAME, true),
    resolveMasterUuid('org_types', 'type_name', IDENTITY_MASTER_DATA.BUYER_ORG_TYPE),
    resolveMasterUuid('master_status', 'status', IDENTITY_MASTER_DATA.BUYER_STATUS),
  ]);

  if (!roleUuid) throw new Error(`Role "${IDENTITY_MASTER_DATA.BUYER_ROLE_NAME}" not found.`);
  if (!orgTypeUuid) throw new Error(`Org type "${IDENTITY_MASTER_DATA.BUYER_ORG_TYPE}" not found.`);
  if (!statusUuid) throw new Error(`Status "${IDENTITY_MASTER_DATA.BUYER_STATUS}" not found.`);

  const conn = await identityPoolModule.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orgRows] = await conn.query(
      'select uuid from organization where organization_name = ? and org_type_uuid = ? limit 1',
      [orgName, orgTypeUuid]
    );

    let orgUuid = orgRows[0] ? orgRows[0].uuid : null;
    if (!orgUuid) {
      orgUuid = crypto.randomUUID();
      await conn.query(
        `insert into organization
           (uuid, organization_name, email, organization_phonenumber, contact_person,
            org_type_uuid, client_status_uuid, self_client, source_type, company_id,
            gmt_name, bfs_name, is_india, upgrade_days, rfq_credits, rfq_used_count,
            quote_submitted, created_by, created_ts, last_modified_by, last_modified_ts)
         values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, 0, 0, 0, 0, ?, now(6), ?, now(6))`,
        [
          orgUuid,
          orgName,
          normalizedEmail,
          normalizedPhone,
          displayName,
          orgTypeUuid,
          statusUuid,
          IDENTITY_MASTER_DATA.SOURCE_TYPE_WEB,
          buildCompanyId(orgName),
          IDENTITY_MASTER_DATA.DEFAULT_GMT_PLAN,
          IDENTITY_MASTER_DATA.DEFAULT_BFS_PLAN,
          createdBy,
          createdBy,
        ]
      );
    }

    const userUuid = crypto.randomUUID();
    await conn.query(
      `insert into \`user\`
         (uuid, username, email, password, full_name, first_name, phone,
          org_uuid, role_uuid, client_status_uuid, unique_id,
          is_active, self_client, is_approved, reset_password,
          is_web_app, is_whats_app, is_bot,
          source_type, verification_status, created_by, created_ts,
          last_modified_by, last_modified_ts)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, 0, 1, 0, 0, ?, ?, ?, now(6), ?, now(6))`,
      [
        userUuid,
        normalizedEmail,
        normalizedEmail,
        password,
        displayName,
        displayName,
        normalizedPhone,
        orgUuid,
        roleUuid,
        statusUuid,
        buildUniqueId(),
        IDENTITY_MASTER_DATA.SOURCE_TYPE_WEB,
        IDENTITY_MASTER_DATA.VERIFICATION_VERIFIED,
        createdBy,
        createdBy,
      ]
    );

    await conn.commit();

    return {
      created: true,
      user: {
        id: userUuid,
        email: normalizedEmail,
        name: displayName,
        role: 'buyer',
        orgId: orgUuid,
        orgName,
        mobile: normalizedPhone,
        status: 'ACTIVE',
      },
      organizationReused: !!orgRows[0],
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Update an account password in the shared schema (stored plaintext, matching
 * the Java NoOpPasswordEncoder contract).
 */
async function updateUserPassword(email, newPassword) {
  const rows = await identityPoolModule.identityQuery(
    'update `user` set password = ?, last_modified_ts = now(6) where lower(username) = ?',
    [newPassword, String(email).trim().toLowerCase()]
  );
  return rows.affectedRows > 0;
}

module.exports = {
  normalizePhone,
  mapRoleName,
  verifyStoredPassword,
  mapRowToUser,
  findUserByEmail,
  findUserByEmailAndPhone,
  listUsers,
  resolveMasterUuid,
  buildUniqueId,
  buildCompanyId,
  insertBuyerAccount,
  updateUserPassword,
};
