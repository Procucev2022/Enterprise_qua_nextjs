'use strict';
// ==============================================================================
// ENSURE A VENDOR LOGIN EXISTS (MANUAL, WRITES TO THE DATABASE)
// ==============================================================================
// Creates the vendor login when it is missing, or resets the password when it
// already exists. Every value comes from the environment. Nothing is hardcoded.
//
// Required environment variables (set them in the shell or backend/.env):
//   ENSURE_VENDOR_EMAIL      login email
//   ENSURE_VENDOR_PHONE      mobile number
//   ENSURE_VENDOR_NAME       full name
//   ENSURE_VENDOR_PASSWORD   password (never printed)
// Optional:
//   ENSURE_VENDOR_ORG        organisation name (defaults to ENSURE_VENDOR_NAME)
//
// Usage: node scripts/ensure-vendor-account.js
// ==============================================================================
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const identityQueries = require('../src/db/identityQueries');
const pool = require('../src/db/pool');

const ACTOR = 'scripts/ensure-vendor-account.js';
const REQUIRED_ENV = ['ENSURE_VENDOR_EMAIL', 'ENSURE_VENDOR_PHONE', 'ENSURE_VENDOR_NAME', 'ENSURE_VENDOR_PASSWORD'];

async function main() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}. No account was changed.`);
    process.exitCode = 1;
    return;
  }

  const VENDOR_EMAIL = process.env.ENSURE_VENDOR_EMAIL;
  const VENDOR_PHONE = process.env.ENSURE_VENDOR_PHONE;
  const VENDOR_PASS = process.env.ENSURE_VENDOR_PASSWORD;
  const VENDOR_NAME = process.env.ENSURE_VENDOR_NAME;
  const VENDOR_ORG = process.env.ENSURE_VENDOR_ORG || VENDOR_NAME;

  console.log(`Checking vendor user account for ${VENDOR_EMAIL}...`);
  try {
    const user = await identityQueries.findUserByEmail(VENDOR_EMAIL);
    if (!user) {
      console.log('Inserting vendor user account...');
      const created = await identityQueries.insertVendorAccount({
        email: VENDOR_EMAIL,
        password: VENDOR_PASS,
        phone: VENDOR_PHONE,
        fullName: VENDOR_NAME,
        organizationName: VENDOR_ORG,
        createdBy: ACTOR,
      });
      // Log identifiers only. The returned user object carries the stored password hash.
      console.log('Created vendor user result:', {
        created: created?.created,
        uuid: created?.user?.id,
        email: created?.user?.email,
      });
    } else {
      console.log('Updating password for existing vendor user...');
      await identityQueries.updateUserPasswordByUuid(user.id, VENDOR_PASS, ACTOR);
    }

    const verify = await identityQueries.findUserByEmail(VENDOR_EMAIL);
    console.log('Final verification:', {
      found: !!verify,
      email: verify?.email,
      mobile: verify?.mobile,
      role: verify?.role,
      passwordMatches: identityQueries.verifyStoredPassword(VENDOR_PASS, verify?.password),
    });
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  }
}

main().finally(() => pool.closePool().catch(() => {}));
