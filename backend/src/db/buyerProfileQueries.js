// ==============================================================================
// BUYER PROFILE QUERIES (shared Procucev MySQL schema)
// ==============================================================================
// Read/write helpers for the buyer organisation profile, which in the shared
// schema is the `organization` row whose org type is CLIENT, plus the linked
// `user` row, plus N rows in `org_division_category`.
//
// Ported from GMTServiceImpl.getOrgByUserId (read) and
// ProcUserServiceImpl.updateBuyer (write) in the Java p2pservices app. Both
// applications write the same rows, so the column choices below are a
// compatibility contract, not a preference.
//
// Schema facts this module depends on (verified against development_gmtbfs):
//   - `organization.uuid` and `user.uuid` are application-assigned strings.
//   - Four profile fields exist twice: a legacy column the Java entity persists
//     (`refference`, `crn`, `others`, `sub_category`) and a dedicated column
//     added later (`brand_name`, `cin`, `annual_turnover`, `contact_designation`).
//     Reads prefer the dedicated column and fall back to the legacy one; writes
//     set BOTH, so a profile saved here is readable by the Java app and vice
//     versa. Dropping either side silently loses data for one of the two clients.
//   - `org_division_category` carries both `organization_id` and a denormalised
//     `user_id`; the Java read path scopes by `user_id`, so this one does too,
//     with an organisation-scoped fallback for rows written before `user_id`
//     was populated.
//   - `category_division` is the major ("division") / minor ("category") master.
// ==============================================================================

const crypto = require('crypto');
const identityPoolModule = require('./identityPool');
const { BUYER_PROFILE_CONFIG } = require('../config/constants');

/**
 * Trim a value read from MySQL, mapping NULL to an empty string.
 *
 * The profile form binds every field to a controlled input, so a null would
 * render as the literal "null" and then be saved back as that string.
 */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Pick the dedicated column when populated, else the legacy alias.
 *
 * Mirrors the alias getters on the Java `Organization` entity
 * (`getCin()` returns `cin != null ? cin : crn`, and so on), which is what makes
 * a row written by either application readable by both.
 */
function preferred(dedicated, legacy) {
  const first = text(dedicated);
  return first !== '' ? first : text(legacy);
}

/**
 * Rewrite the rupee sign to an ASCII currency code before storage.
 *
 * Ported from updateBuyer, which does `annualTurnover.replace("₹", "INR ")`.
 * `organization.annual_turnover` is a latin1 column, so storing the symbol itself
 * produces mojibake that both applications would then display.
 *
 * Runs of whitespace are collapsed afterwards, which the Java version does not
 * do: because its replacement ends in a space, the common input "₹ 180 Cr"
 * became "INR  180 Cr" with a double space, and that value is shown verbatim in
 * a text input. Collapsing is safe — the column is free-form display text.
 */
function normalizeTurnover(value) {
  const raw = text(value);
  if (raw === '') return '';
  const { CURRENCY_SYMBOL, CURRENCY_REPLACEMENT } = BUYER_PROFILE_CONFIG;
  return raw.split(CURRENCY_SYMBOL).join(CURRENCY_REPLACEMENT).replace(/\s+/g, ' ').trim();
}

/**
 * Shape a joined user + organization row into the profile the API returns.
 *
 * Two fields are taken from the `user` row rather than the organisation, exactly
 * as getOrgByUserId does: the account's own login email and mobile number are
 * the authoritative contact details, and the profile screen shows them
 * read-only.
 */
function mapRowToProfile(row) {
  if (!row) return null;
  return {
    organizationId: row.org_uuid,
    userId: row.user_uuid,

    // Section 1 — legal entity and tax registration
    companyName: text(row.organization_name),
    brandName: preferred(row.brand_name, row.refference),
    organizationType: text(row.type) || BUYER_PROFILE_CONFIG.DEFAULT_ORGANIZATION_TYPE,
    panNumber: text(row.pan),
    gstNumber: text(row.gstin),
    cinNumber: preferred(row.cin, row.crn),
    website: text(row.website),
    annualTurnover: preferred(row.annual_turnover, row.others),

    // Section 2 — registered corporate address
    street: text(row.address1),
    city: text(row.city),
    state: text(row.state),
    pincode: text(row.zip_code),
    country: text(row.country) || BUYER_PROFILE_CONFIG.DEFAULT_COUNTRY,

    // Section 3 — primary procurement contact. Name falls back to the account
    // holder's name so a profile that has never been saved is not blank.
    contactName: text(row.contact_person) || text(row.full_name),
    contactDesignation: preferred(row.contact_designation, row.sub_category),
    contactEmail: text(row.username) || text(row.user_email) || text(row.email),
    contactPhone: text(row.phone) || text(row.organization_phonenumber),

    // Populated by loadCategories() — the caller joins them in.
    categories: [],
  };
}

const PROFILE_SELECT = `
  select u.uuid          as user_uuid,
         u.username,
         u.email         as user_email,
         u.full_name,
         u.phone,
         u.org_uuid,
         o.organization_name,
         o.brand_name, o.refference,
         o.type,
         o.pan, o.gstin,
         o.cin, o.crn,
         o.website,
         o.annual_turnover, o.others,
         o.address1, o.city, o.state, o.zip_code, o.country,
         o.contact_person,
         o.contact_designation, o.sub_category,
         o.email,
         o.organization_phonenumber
    from \`user\` u
    left join organization o on o.uuid = u.org_uuid
`;

/**
 * Load the procurement categories selected against a buyer.
 *
 * Scoped by `user_id` first, matching OrgCategoryDivisionDao.findbyUser, which
 * is what the Java profile screen reads. Rows created before `user_id` was
 * populated only carry `organization_id`, so an organisation-scoped read is used
 * as a fallback rather than showing an established buyer an empty selection.
 */
async function loadCategories(organizationId, userId) {
  if (!organizationId && !userId) return [];

  let rows = [];
  if (userId) {
    rows = await identityPoolModule.identityQuery(
      `select division, category from org_division_category
        where user_id = ? and category is not null and category <> ''
        order by division, category`,
      [userId]
    );
  }

  if (rows.length === 0 && organizationId) {
    rows = await identityPoolModule.identityQuery(
      `select division, category from org_division_category
        where organization_id = ? and category is not null and category <> ''
        order by division, category`,
      [organizationId]
    );
  }

  return rows.map((row) => ({ major: text(row.division), minor: text(row.category) }));
}

/**
 * Load the buyer profile for a signed-in user id.
 *
 * Returns a discriminated result rather than throwing, so the service can map
 * "no such user" and "user has no organisation" onto different HTTP statuses and
 * different remediation advice. getOrgByUserId draws the same distinction.
 */
async function findProfileByUserId(userId) {
  if (!userId) return { found: false, reason: 'NO_USER_ID' };

  const rows = await identityPoolModule.identityQuery(
    `${PROFILE_SELECT} where u.uuid = ? limit 1`,
    [userId]
  );

  if (rows.length === 0) return { found: false, reason: 'USER_NOT_FOUND' };
  if (!rows[0].org_uuid) return { found: false, reason: 'ORG_NOT_LINKED' };

  const profile = mapRowToProfile(rows[0]);
  profile.categories = await loadCategories(profile.organizationId, profile.userId);
  return { found: true, profile };
}

// Columns written by a profile save, in the order the UPDATE below binds them.
// Each entry maps one API field onto the column(s) that hold it. `aliasColumn`
// is the legacy column the Java entity persists and must be kept in step.
const PROFILE_COLUMN_MAP = [
  { field: 'companyName', column: 'organization_name' },
  { field: 'brandName', column: 'brand_name', aliasColumn: 'refference' },
  { field: 'organizationType', column: 'type' },
  { field: 'panNumber', column: 'pan', transform: (v) => v.toUpperCase() },
  { field: 'gstNumber', column: 'gstin', transform: (v) => v.toUpperCase() },
  { field: 'cinNumber', column: 'cin', aliasColumn: 'crn', transform: (v) => v.toUpperCase() },
  { field: 'website', column: 'website' },
  { field: 'annualTurnover', column: 'annual_turnover', aliasColumn: 'others', transform: normalizeTurnover },
  { field: 'street', column: 'address1' },
  { field: 'city', column: 'city' },
  { field: 'state', column: 'state' },
  { field: 'pincode', column: 'zip_code' },
  { field: 'country', column: 'country' },
  { field: 'contactName', column: 'contact_person' },
  { field: 'contactDesignation', column: 'contact_designation', aliasColumn: 'sub_category' },
];

/**
 * Build the SET clause for a profile update from the fields actually supplied.
 *
 * Null-skip semantics, ported from updateBuyer: a field the caller omitted is
 * left untouched rather than overwritten with null. That matters because the
 * shared `organization` row carries vendor, subscription and status columns this
 * endpoint has no business clearing, and because a client that renders a subset
 * of the form must not wipe the fields it does not show.
 *
 * An explicit empty string IS applied, so a buyer can clear a field they had
 * previously filled in.
 */
function buildProfileUpdate(patch) {
  const assignments = [];
  const params = [];

  PROFILE_COLUMN_MAP.forEach(({ field, column, aliasColumn, transform }) => {
    const incoming = patch[field];
    if (incoming === undefined || incoming === null) return;

    const value = transform ? transform(text(incoming)) : text(incoming);
    assignments.push(`${column} = ?`);
    params.push(value);

    if (aliasColumn) {
      assignments.push(`${aliasColumn} = ?`);
      params.push(value);
    }
  });

  return { assignments, params };
}

/**
 * Replace the category selection for a buyer.
 *
 * Delete-then-insert rather than a merge, matching updateBuyer, where
 * `orphanRemoval = true` on the association produces exactly this effect.
 *
 * The delete is organisation-wide, not per-user. That is deliberate and matches
 * the Java service: a procurement scope belongs to the organisation, and the RFQ
 * distribution engine reads it organisation-scoped
 * (OrgCategoryDivisionDao.findCategoryByOrg). Replacing only the saving user's
 * rows would leave a second user's stale rows to keep steering RFQ fan-out after
 * the scope had been narrowed. Rows are still stamped with `user_id` so the read
 * path can attribute the most recent edit.
 *
 * Deliberately different from the Java version in one respect: an empty array
 * clears the selection. updateBuyer ignores an empty collection, which made
 * de-selecting every category impossible — the buyer's last selection was
 * permanent, with no way to correct an over-broad scope.
 */
async function replaceCategories(conn, organizationId, userId, categories) {
  await conn.query('delete from org_division_category where organization_id = ?', [organizationId]);
  if (userId) {
    await conn.query('delete from org_division_category where user_id = ?', [userId]);
  }

  if (!Array.isArray(categories) || categories.length === 0) return 0;

  const now = new Date();
  const rows = categories.map((entry) => [
    crypto.randomUUID(),
    text(entry.major),
    text(entry.minor),
    organizationId,
    userId || null,
    userId || organizationId,
    now,
    userId || organizationId,
    now,
  ]);

  await conn.query(
    `insert into org_division_category
       (uuid, division, category, organization_id, user_id,
        created_by, created_ts, last_modified_by, last_modified_ts)
     values ?`,
    [rows]
  );

  return rows.length;
}

/**
 * Persist a buyer organisation profile and its category selection.
 *
 * Runs as one transaction so a failure part-way cannot leave the organisation
 * updated but its categories half-replaced.
 *
 * Also writes `user.full_name` from the contact name, a side effect of
 * updateBuyer that other screens depend on: the account holder's display name is
 * read from that column, so omitting it would make the profile disagree with the
 * name shown in the header.
 */
async function updateProfile({ organizationId, userId, patch, categories, actor }) {
  if (!identityPoolModule.pool) {
    throw new Error('Identity database is not configured.');
  }
  if (!organizationId) {
    throw new Error('organizationId is required to update a buyer profile.');
  }

  const conn = await identityPoolModule.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query('select uuid from organization where uuid = ? limit 1', [
      organizationId,
    ]);
    if (existing.length === 0) {
      await conn.rollback();
      return { updated: false, reason: 'ORG_NOT_FOUND' };
    }

    const { assignments, params } = buildProfileUpdate(patch);
    if (assignments.length > 0) {
      assignments.push('last_modified_by = ?', 'last_modified_ts = now(6)');
      params.push(actor || 'enterprise-workspace', organizationId);
      await conn.query(
        `update organization set ${assignments.join(', ')} where uuid = ?`,
        params
      );
    }

    // Keep the account holder's display name in step with the contact name.
    if (userId && patch.contactName !== undefined && patch.contactName !== null) {
      const contactName = text(patch.contactName);
      if (contactName !== '') {
        await conn.query(
          'update `user` set full_name = ?, last_modified_by = ?, last_modified_ts = now(6) where uuid = ?',
          [contactName, actor || 'enterprise-workspace', userId]
        );
      }
    }

    let categoryCount = null;
    if (categories !== undefined) {
      categoryCount = await replaceCategories(conn, organizationId, userId, categories);
    }

    await conn.commit();
    return { updated: true, fieldsUpdated: assignments.length, categoryCount };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Load the major/minor procurement taxonomy from the shared master table.
 *
 * The old client fetched divisions and their categories over two endpoints and
 * one round trip per division, which meant 14 requests to render the picker. The
 * whole master is a few hundred short rows, so it is returned in one shape the
 * category tree can render directly.
 *
 * Ordering is taken from the data rather than imposed here:
 *   - divisions by the earliest `created_ts` in each, which is the order the
 *     master was loaded from Divisionlist.xlsx and the order buyers have always
 *     seen (Civil Works first, not the alphabetical "CAPEX" first)
 *   - categories alphabetically within a division, matching the ASC sort
 *     CategoryDivisionDao.getCategoryByDivision applies
 *
 * Rows with a blank division exist in the master and are skipped: they have no
 * major category to group under, so they cannot be displayed or selected.
 */
async function findCategoryTaxonomy() {
  const rows = await identityPoolModule.identityQuery(
    `select cd.division, cd.category
       from category_division cd
       join (
         select division, min(created_ts) as first_seen
           from category_division
          where division is not null and division <> ''
          group by division
       ) ord on ord.division = cd.division
      where cd.division is not null and cd.division <> ''
        and cd.category is not null and cd.category <> ''
      order by ord.first_seen, cd.division, cd.category`
  );

  const byDivision = new Map();
  rows.forEach((row) => {
    const major = text(row.division);
    const minor = text(row.category);
    if (major === '' || minor === '') return;
    if (!byDivision.has(major)) byDivision.set(major, []);
    const minors = byDivision.get(major);
    // The master contains near-duplicate rows differing only by case or spacing;
    // showing the same checkbox twice would let one selection appear unselected.
    if (!minors.some((existing) => existing.toLowerCase() === minor.toLowerCase())) {
      minors.push(minor);
    }
  });

  return Array.from(byDivision.entries()).map(([majorCategory, minorCategories]) => ({
    majorCategory,
    minorCategories,
  }));
}

module.exports = {
  text,
  preferred,
  normalizeTurnover,
  mapRowToProfile,
  loadCategories,
  findProfileByUserId,
  buildProfileUpdate,
  replaceCategories,
  updateProfile,
  findCategoryTaxonomy,
  PROFILE_COLUMN_MAP,
};
