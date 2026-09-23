// ==============================================================================
// BUYER PROFILE QUERIES (Neon PostgreSQL)
// ==============================================================================
// Read/write helpers for the buyer organisation profile: the `organization` row
// whose org type is CLIENT, plus the linked `user` row, plus N rows in
// `org_division_category`. Also serves the `category_division` taxonomy that
// every category picker in the app renders.
//
// Schema facts this module depends on (see schema.sql):
//   - `organization.uuid` and `user.uuid` are application-assigned strings.
//   - Four profile fields exist twice: a legacy column (`refference`, `crn`,
//     `others`, `sub_category`) and a dedicated column added later
//     (`brand_name`, `cin`, `annual_turnover`, `contact_designation`). Migrated
//     rows populated whichever one the writing client used, so reads prefer the
//     dedicated column and fall back to the legacy one, and writes set BOTH.
//     Dropping either side makes some historical rows read as blank.
//   - `org_division_category` carries both `organization_id` and a denormalised
//     `user_id`; the read path scopes by `user_id` with an organisation-scoped
//     fallback for rows written before `user_id` was populated.
//   - `category_division` is the major ("division") / minor ("category") master.
// ==============================================================================

const crypto = require('crypto');
const pool = require('./pool');
const { getD1Binding } = require('./d1Bridge');
const { BUYER_PROFILE_CONFIG } = require('../config/constants');

/**
 * Trim a value read from the database, mapping NULL to an empty string.
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
 */
function preferred(dedicated, legacy) {
  const first = text(dedicated);
  return first !== '' ? first : text(legacy);
}

/**
 * Rewrite the rupee sign to an ASCII currency code before storage.
 *
 * Retained after the move to Postgres for consistency with the values already
 * stored: `annual_turnover` rows migrated from the previous schema hold
 * "INR 180 Cr" rather than "₹180 Cr", and the field is displayed verbatim in a
 * text input, so mixing the two forms would show the same figure two ways.
 *
 * Runs of whitespace are collapsed afterwards: because the replacement ends in a
 * space, the common input "₹ 180 Cr" would otherwise become "INR  180 Cr" with a
 * double space. Collapsing is safe — the column is free-form display text.
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
 * The account's own login email and mobile number are taken from the `user` row
 * rather than the organisation: they are the authoritative contact details, and
 * the profile screen shows them read-only.
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
    from "user" u
    left join organization o on o.uuid = u.org_uuid
`;

/**
 * Load the procurement categories selected against a buyer.
 *
 * Scoped by `user_id` first, which attributes the most recent edit. Rows created
 * before `user_id` was populated only carry `organization_id`, so an
 * organisation-scoped read is used as a fallback rather than showing an
 * established buyer an empty selection.
 */
async function loadCategories(organizationId, userId) {
  if (!organizationId && !userId) return [];

  let rows = [];
  if (userId) {
    rows = await pool.rows(
      `select division, category from org_division_category
        where user_id = $1 and category is not null and category <> ''
        order by division, category`,
      [userId],
      { d1: true }
    );
  }

  if (rows.length === 0 && organizationId) {
    rows = await pool.rows(
      `select division, category from org_division_category
        where organization_id = $1 and category is not null and category <> ''
        order by division, category`,
      [organizationId],
      { d1: true }
    );
  }

  return rows.map((row) => ({ major: text(row.division), minor: text(row.category) }));
}

/**
 * Load the buyer profile for a signed-in user id.
 *
 * Returns a discriminated result rather than throwing, so the service can map
 * "no such user" and "user has no organisation" onto different HTTP statuses and
 * different remediation advice.
 */
async function findProfileByUserId(userId) {
  if (!userId) return { found: false, reason: 'NO_USER_ID' };

  const rows = await pool.rows(`${PROFILE_SELECT} where u.uuid = $1 limit 1`, [userId], { d1: true });

  if (rows.length === 0) return { found: false, reason: 'USER_NOT_FOUND' };
  if (!rows[0].org_uuid) return { found: false, reason: 'ORG_NOT_LINKED' };

  const profile = mapRowToProfile(rows[0]);
  profile.categories = await loadCategories(profile.organizationId, profile.userId);
  return { found: true, profile };
}

// Columns written by a profile save, in the order the UPDATE below binds them.
// Each entry maps one API field onto the column(s) that hold it. `aliasColumn`
// is the legacy column that must be kept in step.
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
 * Null-skip semantics: a field the caller omitted is left untouched rather than
 * overwritten with null. That matters because the `organization` row carries
 * vendor, subscription and status columns this endpoint has no business clearing,
 * and because a client that renders a subset of the form must not wipe the fields
 * it does not show.
 *
 * An explicit empty string IS applied, so a buyer can clear a field they had
 * previously filled in.
 *
 * `startIndex` is where this clause's positional parameters begin, so the caller
 * can append its own ($n for the actor, $n+1 for the uuid) without renumbering.
 */
function buildProfileUpdate(patch, startIndex = 1) {
  const assignments = [];
  const params = [];
  let next = startIndex;

  PROFILE_COLUMN_MAP.forEach(({ field, column, aliasColumn, transform }) => {
    const incoming = patch[field];
    if (incoming === undefined || incoming === null) return;

    const value = transform ? transform(text(incoming)) : text(incoming);
    assignments.push(`${column} = $${next}`);
    params.push(value);
    next += 1;

    if (aliasColumn) {
      assignments.push(`${aliasColumn} = $${next}`);
      params.push(value);
      next += 1;
    }
  });

  return { assignments, params, nextIndex: next };
}

/**
 * Replace the category selection for a buyer.
 *
 * Delete-then-insert rather than a merge, so a de-selection actually takes
 * effect. The delete is organisation-wide, not per-user: a procurement scope
 * belongs to the organisation and the RFQ distribution engine reads it
 * organisation-scoped, so replacing only the saving user's rows would leave a
 * second user's stale rows steering RFQ fan-out after the scope had been
 * narrowed. Rows are still stamped with `user_id` so the read path can attribute
 * the most recent edit.
 *
 * An empty array clears the selection, which is what makes an over-broad scope
 * correctable.
 */
async function replaceCategories(client, organizationId, userId, categories) {
  await client.query('delete from org_division_category where organization_id = $1', [organizationId]);
  if (userId) {
    await client.query('delete from org_division_category where user_id = $1', [userId]);
  }

  if (!Array.isArray(categories) || categories.length === 0) return 0;

  // One multi-row INSERT rather than one statement per category: a 10-category
  // selection is 10 network round trips to Neon otherwise, inside a transaction
  // that holds a connection open for all of them.
  const params = [];
  const tuples = categories.map((entry) => {
    const base = params.length;
    params.push(
      crypto.randomUUID(),
      text(entry.major),
      text(entry.minor),
      organizationId,
      userId || null
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, true, now())`;
  });

  await client.query(
    `insert into org_division_category
       (uuid, division, category, organization_id, user_id, is_active, created_ts)
     values ${tuples.join(', ')}`,
    params
  );

  return categories.length;
}

/**
 * D1 equivalent of replaceCategories — D1 has no `client`/transaction object
 * to run these through (see updateProfile's D1 branch), so this runs the same
 * delete-then-insert sequence as plain `pool.query(..., { d1: true })` calls,
 * with `strftime` in place of Postgres's `now()`.
 */
async function replaceCategoriesD1(organizationId, userId, categories) {
  await pool.query('delete from org_division_category where organization_id = $1', [organizationId], { d1: true });
  if (userId) {
    await pool.query('delete from org_division_category where user_id = $1', [userId], { d1: true });
  }

  if (!Array.isArray(categories) || categories.length === 0) return 0;

  const params = [];
  const tuples = categories.map((entry) => {
    const base = params.length;
    params.push(
      crypto.randomUUID(),
      text(entry.major),
      text(entry.minor),
      organizationId,
      userId || null
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, true, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
  });

  await pool.query(
    `insert into org_division_category
       (uuid, division, category, organization_id, user_id, is_active, created_ts)
     values ${tuples.join(', ')}`,
    params,
    { d1: true }
  );

  return categories.length;
}

/**
 * Persist a buyer organisation profile and its category selection.
 *
 * Runs as one transaction so a failure part-way cannot leave the organisation
 * updated but its categories half-replaced.
 *
 * Also writes `user.full_name` from the contact name, which other screens depend
 * on: the account holder's display name is read from that column, so omitting it
 * would make the profile disagree with the name shown in the header.
 */
async function updateProfile({ organizationId, userId, patch, categories, actor }) {
  if (!pool.hasStorage()) {
    throw new Error(pool.NOT_CONFIGURED_MESSAGE);
  }
  if (!organizationId) {
    throw new Error('organizationId is required to update a buyer profile.');
  }

  // D1 has no equivalent of pool.withTransaction — its batch() API only runs a
  // pre-decided fixed list of statements, not "read, then conditionally decide
  // what to write" (see insertBuyerAccount's identical comment in
  // identityQueries.js for the fuller rationale). This runs the same steps
  // sequentially instead, via plain pool.query(..., { d1: true }) calls.
  if (getD1Binding()) {
    const existing = await pool.query('select uuid from organization where uuid = $1 limit 1', [organizationId], {
      d1: true,
    });
    if (existing.rows.length === 0) {
      return { updated: false, reason: 'ORG_NOT_FOUND' };
    }

    const { assignments, params, nextIndex } = buildProfileUpdate(patch);
    if (assignments.length > 0) {
      const actorIndex = nextIndex;
      const uuidIndex = nextIndex + 1;
      assignments.push(`last_modified_by = $${actorIndex}`, `last_modified_ts = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
      params.push(actor || 'enterprise-workspace', organizationId);
      await pool.query(`update organization set ${assignments.join(', ')} where uuid = $${uuidIndex}`, params, {
        d1: true,
      });
    }

    if (userId && patch.contactName !== undefined && patch.contactName !== null) {
      const contactName = text(patch.contactName);
      if (contactName !== '') {
        await pool.query(
          `update "user" set full_name = $1, last_modified_by = $2, last_modified_ts = strftime('%Y-%m-%dT%H:%M:%fZ','now') where uuid = $3`,
          [contactName, actor || 'enterprise-workspace', userId],
          { d1: true }
        );
      }
    }

    let categoryCount = null;
    if (categories !== undefined) {
      categoryCount = await replaceCategoriesD1(organizationId, userId, categories);
    }

    return { updated: true, fieldsUpdated: assignments.length, categoryCount };
  }

  return pool.withTransaction(async (client) => {
    const existing = await client.query('select uuid from organization where uuid = $1 limit 1', [
      organizationId,
    ]);
    if (existing.rows.length === 0) {
      // Returned rather than thrown so the caller can answer 404 instead of 500.
      // withTransaction commits an empty transaction here, which is a no-op.
      return { updated: false, reason: 'ORG_NOT_FOUND' };
    }

    const { assignments, params, nextIndex } = buildProfileUpdate(patch);
    if (assignments.length > 0) {
      const actorIndex = nextIndex;
      const uuidIndex = nextIndex + 1;
      assignments.push(`last_modified_by = $${actorIndex}`, 'last_modified_ts = now()');
      params.push(actor || 'enterprise-workspace', organizationId);
      await client.query(
        `update organization set ${assignments.join(', ')} where uuid = $${uuidIndex}`,
        params
      );
    }

    // Keep the account holder's display name in step with the contact name.
    if (userId && patch.contactName !== undefined && patch.contactName !== null) {
      const contactName = text(patch.contactName);
      if (contactName !== '') {
        await client.query(
          'update "user" set full_name = $1, last_modified_by = $2, last_modified_ts = now() where uuid = $3',
          [contactName, actor || 'enterprise-workspace', userId]
        );
      }
    }

    let categoryCount = null;
    if (categories !== undefined) {
      categoryCount = await replaceCategories(client, organizationId, userId, categories);
    }

    return { updated: true, fieldsUpdated: assignments.length, categoryCount };
  });
}

/**
 * Load the major/minor procurement taxonomy from the master table.
 *
 * Returned in one shape the category tree can render directly. The whole master
 * is a few hundred short rows, so fetching it per-division — which is what the
 * old client did, one request per division — cost 14 round trips to render one
 * picker.
 *
 * Ordering is taken from the data rather than imposed here:
 *   - divisions by the earliest `created_ts` in each, which is the order the
 *     master was loaded and the order buyers have always seen (Civil Works
 *     first, not the alphabetical "CAPEX" first)
 *   - categories alphabetically within a division
 *
 * Rows with a blank division exist in the master and are skipped: they have no
 * major category to group under, so they cannot be displayed or selected.
 */
async function findCategoryTaxonomy() {
  // category_division has already been ported to D1 (see d1Bridge.js) — this
  // opts into it explicitly. On Node/Render, { d1: true } is a no-op and this
  // still runs the same query against Postgres as before.
  const rows = await pool.rows(
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
      order by ord.first_seen, cd.division, cd.category`,
    [],
    { d1: true }
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
  PROFILE_SELECT,
};
