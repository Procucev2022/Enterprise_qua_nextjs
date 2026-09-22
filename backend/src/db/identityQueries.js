// ==============================================================================
// IDENTITY QUERIES (Neon PostgreSQL)
// ==============================================================================
// Read/write helpers for the `user`, `organization`, `role`, `org_types` and
// `master_status` tables in schema.sql.
//
// These tables previously lived in a shared MySQL schema owned by another
// application, which constrained the storage format in ways this file no longer
// has to honour. What changed with the move to Postgres:
//   - `bit(1)` columns read back as Buffers and needed converting on every row.
//     They are real BOOLEANs now, so the conversion helper is gone.
//   - `now(6)` became `now()`, and DATETIME became TIMESTAMPTZ, so a stored
//     instant carries its zone instead of being UTC by convention only.
//   - `user` is a reserved word in Postgres and is quoted as "user".
//
// What deliberately did NOT change:
//   - `user.uuid` is still application-assigned, because existing ids are
//     referenced by issued session tokens and by every org_uuid/role_uuid link.
//   - Passwords are still stored as submitted, so accounts migrated from the
//     previous schema keep working. Verification is therefore a constant-time
//     comparison, not a hash comparison. See verifyStoredPassword.
//   - There is no unique index on `user.username` — the migrated data contains
//     repeated login emails — so duplicate-email guarding stays in application
//     code and every read resolves a single row explicitly.
// ==============================================================================

const crypto = require('crypto');
const pool = require('./pool');
const {
  IDENTITY_ROLE_MAP,
  IDENTITY_MASTER_DATA,
  IDENTITY_PHONE_CONFIG,
} = require('../config/constants');

/**
 * Normalise a phone number to the form the `user.phone` column stores, so login
 * lookups match byte-for-byte:
 *   - keep digits only, then strip leading zeros
 *   - exactly 10 digits            -> +91XXXXXXXXXX (assumed Indian mobile)
 *   - 12 digits beginning with 91  -> +91 + the trailing 10
 *   - anything else                -> '+' + the digits, untouched
 *
 * The branch order and the fallback are load-bearing: the stored values were
 * written by this exact algorithm, so any divergence silently stops matching
 * existing accounts.
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
 * Translate a stored role name into one of the four application roles.
 * Returns null for roles the workspace has no screens for.
 */
function mapRoleName(roleName) {
  if (!roleName) return null;
  return IDENTITY_ROLE_MAP[String(roleName).trim().toLowerCase()] || null;
}

/**
 * Constant-time password comparison.
 *
 * The stored value is the password as submitted at registration, so this compares
 * directly while avoiding a length-leaking early return.
 */
function verifyStoredPassword(submitted, stored) {
  if (typeof submitted !== 'string' || typeof stored !== 'string') return false;
  if (submitted.length === 0 || stored.length === 0) return false;
  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Coerce a Postgres boolean to a plain boolean, tolerating null. */
function flag(value) {
  return value === true;
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
    status: flag(row.is_active) ? 'ACTIVE' : 'INACTIVE',
    isActive: flag(row.is_active),
    isApproved: flag(row.is_approved),
    isSelfClient: flag(row.self_client),
    verificationStatus: row.verification_status || null,
  };
}

const USER_SELECT = `
  select u.uuid, u.username, u.email, u.password, u.full_name, u.first_name,
         u.phone, u.is_active, u.is_approved, u.self_client, u.verification_status,
         u.org_uuid, r.role_name, o.organization_name
    from "user" u
    left join role r on r.uuid = u.role_uuid
    left join organization o on o.uuid = u.org_uuid
`;

/**
 * Look up a single account by login email.
 *
 * Prefers an active row, then the most recently created, because repeated login
 * emails exist in the data and a bare `limit 1` would otherwise return an
 * arbitrary one of them.
 */
async function findUserByEmail(email) {
  if (!email) return null;
  const result = await pool.rows(
    `${USER_SELECT} where lower(u.username) = $1 order by u.is_active desc, u.created_ts desc limit 1`,
    [String(email).trim().toLowerCase()]
  );
  return mapRowToUser(result[0]);
}

/**
 * Look up an account by email + phone together.
 *
 * Sign-in narrows to the pair because email alone can match more than one row,
 * and because it lets a mistyped mobile number be reported as such instead of
 * failing later as a bad password.
 */
async function findUserByEmailAndPhone(email, phone) {
  if (!email || !phone) return null;
  const result = await pool.rows(
    `${USER_SELECT} where lower(u.username) = $1 and u.phone = $2 order by u.is_active desc, u.created_ts desc limit 1`,
    [String(email).trim().toLowerCase(), normalizePhone(phone)]
  );
  return mapRowToUser(result[0]);
}

/**
 * List accounts for the admin users screen.
 */
async function listUsers(limit = 200) {
  const result = await pool.rows(
    `${USER_SELECT} where u.is_active = true order by u.created_ts desc limit $1`,
    [Number(limit)]
  );
  return result.map(mapRowToUser).filter((u) => !!u.email);
}

// Master tables reachable by resolveMasterUuid, mapped to the column each one is
// looked up by. An allow-list rather than free interpolation: the table and
// column names cannot be parameterised, so restricting them to these three pairs
// is what keeps the identifier out of caller control.
const MASTER_TABLES = {
  role: 'role_name',
  org_types: 'type_name',
  master_status: 'status',
};

/**
 * Resolve a master-data uuid by its natural key, e.g. the ClientInitiator role.
 */
async function resolveMasterUuid(table, column, value, extraActiveFilter = false) {
  if (!Object.prototype.hasOwnProperty.call(MASTER_TABLES, table)) {
    throw new Error(`Unknown master-data table "${table}".`);
  }
  if (MASTER_TABLES[table] !== column) {
    throw new Error(`Column "${column}" is not a lookup key for master-data table "${table}".`);
  }
  const activeClause = extraActiveFilter ? ' and is_active = true' : '';
  // role/org_types/master_status have already been ported to D1 (see
  // d1Bridge.js) — this opts in explicitly. { d1: true } is a no-op on
  // Node/Render, so this still runs the same query against Postgres there.
  const result = await pool.rows(
    `select uuid from "${table}" where lower(${column}) = lower($1)${activeClause} limit 1`,
    [value],
    { d1: true }
  );
  return result[0] ? result[0].uuid : null;
}

/**
 * Build the USR-prefixed unique_id format the schema uses.
 */
function buildUniqueId() {
  return `USR${Date.now()}${crypto.randomInt(1000000000, 9999999999)}`;
}

/**
 * Build the companyId format: first 3 letters of the organisation name,
 * uppercased, plus a yyMMddHHmmss stamp.
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
 * Create a buyer account (organization + user).
 *
 * ClientInitiator role, CLIENT org type, CLIENT_NEW status. The account is
 * written active and pre-approved so it can sign in immediately.
 *
 * Runs in a single transaction and reuses an existing CLIENT organisation when
 * one already matches the requested name, so two people registering under the
 * same company land in the same organisation rather than creating a duplicate
 * that would split their RFQ portfolio in two.
 */
async function insertBuyerAccount({
  email,
  password,
  phone,
  fullName,
  organizationName,
  createdBy = 'enterprise-workspace',
}) {
  if (!pool.pool) {
    throw new Error(pool.NOT_CONFIGURED_MESSAGE);
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

  return pool.withTransaction(async (client) => {
    const orgLookup = await client.query(
      'select uuid from organization where organization_name = $1 and org_type_uuid = $2 limit 1',
      [orgName, orgTypeUuid]
    );

    const organizationReused = orgLookup.rows.length > 0;
    let orgUuid = organizationReused ? orgLookup.rows[0].uuid : null;

    if (!orgUuid) {
      orgUuid = crypto.randomUUID();
      await client.query(
        `insert into organization
           (uuid, organization_name, email, organization_phonenumber, contact_person,
            org_type_uuid, client_status_uuid, self_client, source_type, company_id,
            gmt_name, bfs_name, is_india, upgrade_days, rfq_credits, rfq_used_count,
            quote_submitted, created_by, created_ts, last_modified_by, last_modified_ts)
         values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, true, 0, 0, 0, 0, $12, now(), $13, now())`,
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
    await client.query(
      `insert into "user"
         (uuid, username, email, password, full_name, first_name, phone,
          org_uuid, role_uuid, client_status_uuid, unique_id,
          is_active, self_client, is_approved, reset_password,
          is_web_app, is_whats_app, is_bot,
          source_type, verification_status, created_by, created_ts,
          last_modified_by, last_modified_ts)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               true, false, true, false, true, false, false,
               $12, $13, $14, now(), $15, now())`,
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
      organizationReused,
    };
  });
}

/**
 * Create an internal staff account (category_manager or admin) in the identity
 * database. Same organization-reuse + transaction pattern as insertBuyerAccount,
 * but the role/org-type/status names are passed in rather than hardcoded, since
 * this covers two different app roles that share no other master-data name.
 */
async function insertStaffAccount({
  email,
  password,
  phone,
  fullName,
  organizationName,
  roleName,
  orgTypeName,
  statusName,
  createdBy = 'enterprise-workspace',
}) {
  if (!pool.pool) {
    throw new Error(pool.NOT_CONFIGURED_MESSAGE);
  }
  if (!email || !password || !phone) {
    throw new Error('email, password and phone are required to create a staff account.');
  }
  if (!roleName || !orgTypeName || !statusName) {
    throw new Error('roleName, orgTypeName and statusName are required to create a staff account.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = normalizePhone(phone);
  const orgName = organizationName || `${normalizedEmail.split('@')[0]} Internal`;
  const displayName = fullName || normalizedEmail.split('@')[0];

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return { created: false, reason: 'ALREADY_EXISTS', user: existing };
  }

  const [roleUuid, orgTypeUuid, statusUuid] = await Promise.all([
    resolveMasterUuid('role', 'role_name', roleName, true),
    resolveMasterUuid('org_types', 'type_name', orgTypeName),
    resolveMasterUuid('master_status', 'status', statusName),
  ]);

  if (!roleUuid) throw new Error(`Role "${roleName}" not found.`);
  if (!orgTypeUuid) throw new Error(`Org type "${orgTypeName}" not found.`);
  if (!statusUuid) throw new Error(`Status "${statusName}" not found.`);

  return pool.withTransaction(async (client) => {
    const orgLookup = await client.query(
      'select uuid from organization where organization_name = $1 and org_type_uuid = $2 limit 1',
      [orgName, orgTypeUuid]
    );

    const organizationReused = orgLookup.rows.length > 0;
    let orgUuid = organizationReused ? orgLookup.rows[0].uuid : null;

    if (!orgUuid) {
      orgUuid = crypto.randomUUID();
      await client.query(
        `insert into organization
           (uuid, organization_name, email, organization_phonenumber, contact_person,
            org_type_uuid, client_status_uuid, self_client, source_type, company_id,
            gmt_name, bfs_name, is_india, upgrade_days, rfq_credits, rfq_used_count,
            quote_submitted, created_by, created_ts, last_modified_by, last_modified_ts)
         values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, true, 0, 0, 0, 0, $12, now(), $13, now())`,
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
    await client.query(
      `insert into "user"
         (uuid, username, email, password, full_name, first_name, phone,
          org_uuid, role_uuid, client_status_uuid, unique_id,
          is_active, self_client, is_approved, reset_password,
          is_web_app, is_whats_app, is_bot,
          source_type, verification_status, created_by, created_ts,
          last_modified_by, last_modified_ts)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               true, false, true, false, true, false, false,
               $12, $13, $14, now(), $15, now())`,
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

    return {
      created: true,
      user: {
        id: userUuid,
        email: normalizedEmail,
        name: displayName,
        role: mapRoleName(roleName),
        orgId: orgUuid,
        orgName,
        mobile: normalizedPhone,
        status: 'ACTIVE',
      },
      organizationReused,
    };
  });
}

/**
 * Create a vendor user account in the identity database.
 * Similar to insertBuyerAccount but for vendor role and org type.
 */
async function insertVendorAccount({
  email,
  password,
  phone,
  fullName,
  organizationName,
  createdBy = 'vendor-ingestion',
}) {
  if (!pool.pool) {
    throw new Error(pool.NOT_CONFIGURED_MESSAGE);
  }
  if (!email || !password) {
    throw new Error('email and password are required to create a vendor account.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = phone ? normalizePhone(phone) : '+919999999999'; // Default phone if not provided
  const orgName = organizationName || `${normalizedEmail.split('@')[0]} Vendor`;
  const displayName = fullName || normalizedEmail.split('@')[0];

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    if (password) {
      await updateUserPasswordByUuid(existing.id, password, createdBy);
      if (phone) {
        await pool.query(
          'update "user" set phone = $1, last_modified_by = $2, last_modified_ts = now() where uuid = $3',
          [normalizedPhone, createdBy, existing.id]
        );
      }
    }
    return { created: false, reason: 'ALREADY_EXISTS', user: { ...existing, mobile: normalizedPhone, password } };
  }

  const [roleUuid, orgTypeUuid, statusUuid] = await Promise.all([
    resolveMasterUuid('role', 'role_name', IDENTITY_MASTER_DATA.VENDOR_ROLE_NAME, true),
    resolveMasterUuid('org_types', 'type_name', IDENTITY_MASTER_DATA.VENDOR_ORG_TYPE),
    resolveMasterUuid('master_status', 'status', IDENTITY_MASTER_DATA.VENDOR_STATUS),
  ]);

  if (!roleUuid) throw new Error(`Role "${IDENTITY_MASTER_DATA.VENDOR_ROLE_NAME}" not found.`);
  if (!orgTypeUuid) throw new Error(`Org type "${IDENTITY_MASTER_DATA.VENDOR_ORG_TYPE}" not found.`);
  if (!statusUuid) throw new Error(`Status "${IDENTITY_MASTER_DATA.VENDOR_STATUS}" not found.`);

  return pool.withTransaction(async (client) => {
    const orgLookup = await client.query(
      'select uuid from organization where organization_name = $1 and org_type_uuid = $2 limit 1',
      [orgName, orgTypeUuid]
    );

    const organizationReused = orgLookup.rows.length > 0;
    let orgUuid = organizationReused ? orgLookup.rows[0].uuid : null;

    if (!orgUuid) {
      orgUuid = crypto.randomUUID();
      await client.query(
        `insert into organization
           (uuid, organization_name, email, organization_phonenumber, contact_person,
            org_type_uuid, client_status_uuid, self_client, source_type, company_id,
            gmt_name, bfs_name, is_india, upgrade_days, rfq_credits, rfq_used_count,
            quote_submitted, created_by, created_ts, last_modified_by, last_modified_ts)
         values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, true, 0, 0, 0, 0, $12, now(), $13, now())`,
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
    await client.query(
      `insert into "user"
         (uuid, username, email, password, full_name, first_name, phone,
          org_uuid, role_uuid, client_status_uuid, unique_id,
          is_active, self_client, is_approved, reset_password,
          is_web_app, is_whats_app, is_bot,
          source_type, verification_status, created_by, created_ts,
          last_modified_by, last_modified_ts)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               true, false, true, false, true, false, false,
               $12, $13, $14, now(), $15, now())`,
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

    return {
      created: true,
      user: {
        id: userUuid,
        email: normalizedEmail,
        name: displayName,
        role: 'vendor',
        orgId: orgUuid,
        orgName,
        mobile: normalizedPhone,
        status: 'ACTIVE',
      },
      organizationReused,
    };
  });
}

/**
 * Update an account password, addressed by login email.
 *
 * `username` carries no unique index, so this can touch more than one row when
 * the migrated data holds duplicate logins. It is kept for the provisioning
 * script, which works from an email address and no session. Self-service changes
 * must use updateUserPasswordByUuid instead.
 */
async function updateUserPassword(email, newPassword) {
  const result = await pool.query(
    'update "user" set password = $1, last_modified_ts = now() where lower(username) = $2',
    [newPassword, String(email).trim().toLowerCase()]
  );
  return (result.rowCount || 0) > 0;
}

/**
 * Update an account password, addressed by primary key.
 *
 * Used by the self-service change-password endpoint, where the account is known
 * from the session token's `sub` claim. Keying on the primary key guarantees the
 * write lands on exactly the caller's row, which the email-keyed variant above
 * cannot promise.
 */
async function updateUserPasswordByUuid(userUuid, newPassword, actorEmail) {
  const result = await pool.query(
    'update "user" set password = $1, last_modified_by = $2, last_modified_ts = now() where uuid = $3',
    [newPassword, actorEmail || 'enterprise-workspace', String(userUuid)]
  );
  return (result.rowCount || 0) > 0;
}

module.exports = {
  normalizePhone,
  mapRoleName,
  verifyStoredPassword,
  flag,
  mapRowToUser,
  findUserByEmail,
  findUserByEmailAndPhone,
  listUsers,
  resolveMasterUuid,
  buildUniqueId,
  buildCompanyId,
  insertBuyerAccount,
  insertVendorAccount,
  insertStaffAccount,
  updateUserPassword,
  updateUserPasswordByUuid,
  MASTER_TABLES,
  USER_SELECT,
};
