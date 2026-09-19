#!/usr/bin/env node
// ==============================================================================
// SEED IDENTITY MASTER DATA (role / org_types / master_status)
// ==============================================================================
// A fresh Neon database has zero rows in these three lookup tables, so
// insertBuyerAccount/insertVendorAccount/insertStaffAccount throw immediately
// (resolveMasterUuid never auto-creates a missing row by design). This script
// inserts exactly the rows this app's account-creation paths look up by name.
// Idempotent: checks each name via resolveMasterUuid first, only inserts if
// missing. No ALTER/DROP anywhere. Safe to re-run against any environment.
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const pool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const { IDENTITY_MASTER_DATA } = require('../src/config/constants');

const ROLES = [IDENTITY_MASTER_DATA.BUYER_ROLE_NAME, IDENTITY_MASTER_DATA.VENDOR_ROLE_NAME, IDENTITY_MASTER_DATA.CATEGORY_MANAGER_ROLE_NAME, IDENTITY_MASTER_DATA.ADMIN_ROLE_NAME];
const ORG_TYPES = [IDENTITY_MASTER_DATA.BUYER_ORG_TYPE, IDENTITY_MASTER_DATA.VENDOR_ORG_TYPE, IDENTITY_MASTER_DATA.CATEGORY_MANAGER_ORG_TYPE];
const STATUSES = [IDENTITY_MASTER_DATA.BUYER_STATUS, IDENTITY_MASTER_DATA.VENDOR_STATUS, IDENTITY_MASTER_DATA.CATEGORY_MANAGER_STATUS];

async function ensureRow(table, column, value) {
  const existingUuid = await identityQueries.resolveMasterUuid(table, column, value);
  if (existingUuid) {
    console.log(`  ${table}.${column} = "${value}" already exists (${existingUuid})`);
    return;
  }
  const uuid = crypto.randomUUID();
  await pool.query(`insert into ${table} (uuid, ${column}, is_active) values ($1, $2, true)`, [uuid, value]);
  console.log(`  ${table}.${column} = "${value}" inserted (${uuid})`);
}

async function main() {
  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    console.error(`Database unavailable: ${health.errorMessage}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Database: ${health.providerLabel} — ${health.database}\n`);

  console.log('role.role_name:');
  for (const name of ROLES) await ensureRow('role', 'role_name', name);

  console.log('\norg_types.type_name:');
  for (const name of ORG_TYPES) await ensureRow('org_types', 'type_name', name);

  console.log('\nmaster_status.status:');
  for (const name of STATUSES) await ensureRow('master_status', 'status', name);

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Failed to seed master data:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.closePool().catch(() => {}));
