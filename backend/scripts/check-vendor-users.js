'use strict';
// ==============================================================================
// FIND ACCOUNTS AND VENDOR RECORDS BY MOBILE OR EMAIL (READ-ONLY, PostgreSQL)
// ==============================================================================
// Usage:
//   node scripts/check-vendor-users.js --mobile <10-digit mobile>
//   node scripts/check-vendor-users.js --email <email fragment>
//   CHECK_VENDOR_MOBILE=<mobile> CHECK_VENDOR_EMAIL=<email fragment> node scripts/check-vendor-users.js
//
// At least one of mobile or email is required. Matching is a substring search.
// Password hashes are never printed.
// ==============================================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../src/db/pool');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const name = key.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        args[name] = true;
      } else {
        args[name] = value;
        i += 1;
      }
    }
  }
  return args;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readFilters(argv) {
  const args = parseArgs(argv);
  return {
    mobile: cleanText(args.mobile) || cleanText(process.env.CHECK_VENDOR_MOBILE),
    email: (cleanText(args.email) || cleanText(process.env.CHECK_VENDOR_EMAIL)).toLowerCase(),
  };
}

async function checkVendorCredentials() {
  const { mobile, email } = readFilters(process.argv);
  if (!mobile && !email) {
    console.error('Provide --mobile and/or --email (or CHECK_VENDOR_MOBILE / CHECK_VENDOR_EMAIL). Nothing was searched.');
    process.exitCode = 1;
    return;
  }

  try {
    const userClauses = [];
    const userParams = [];
    if (mobile) {
      userParams.push(`%${mobile}%`);
      userClauses.push(`u.phone LIKE $${userParams.length}`);
    }
    if (email) {
      userParams.push(`%${email}%`);
      userClauses.push(`(lower(u.email) LIKE $${userParams.length} OR lower(u.username) LIKE $${userParams.length})`);
    }
    const usersRes = await pool.query(
      `SELECT u.uuid, u.username, u.email, u.phone, u.is_active, u.is_approved,
              r.role_name, o.organization_name
         FROM "user" u
         LEFT JOIN role r ON r.uuid = u.role_uuid
         LEFT JOIN organization o ON o.uuid = u.org_uuid
        WHERE ${userClauses.join(' OR ')}`,
      userParams
    );
    console.log('USERS FOUND:', JSON.stringify(usersRes.rows, null, 2));

    const vendorClauses = [];
    const vendorParams = [];
    if (mobile) {
      vendorParams.push(`%${mobile}%`);
      const placeholder = `$${vendorParams.length}`;
      vendorClauses.push(`(v.id LIKE ${placeholder} OR CAST(v.raw AS TEXT) LIKE ${placeholder})`);
    }
    if (email) {
      vendorParams.push(`%${email}%`);
      vendorClauses.push(`lower(v.email) LIKE $${vendorParams.length}`);
    }
    const vendorsRes = await pool.query(
      `SELECT v.id, v.email, v.major_category, v.status, v.raw
         FROM vendors v
        WHERE ${vendorClauses.join(' OR ')}`,
      vendorParams
    );
    console.log('VENDORS FOUND:', JSON.stringify(vendorsRes.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.closePool().catch(() => {});
  }
}

checkVendorCredentials();
