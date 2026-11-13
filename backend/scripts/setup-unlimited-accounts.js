#!/usr/bin/env node
// ==============================================================================
// SETUP UNLIMITED BUYER & VENDOR ACCOUNTS
// ==============================================================================
// Sets up dedicated accounts with database-level flags for unlimited access.
//
// Usage:
//   node scripts/setup-unlimited-accounts.js \
//     --buyer-email <email> --buyer-phone <phone> --buyer-password <pwd> \
//     --vendor-email <email> --vendor-phone <phone> --vendor-password <pwd>
//
// Alternatively provide credentials via environment variables:
//   BUYER_EMAIL, BUYER_PHONE, BUYER_PASSWORD, BUYER_NAME, BUYER_ORG
//   VENDOR_EMAIL, VENDOR_PHONE, VENDOR_PASSWORD, VENDOR_NAME, VENDOR_ORG
//   VENDOR_MAJOR_CATEGORY (optional, or --vendor-major-category)
//
// There are no defaults. Email, password, name and organisation are required for
// both accounts. The script never sets vendor ratings, scores, evaluation results
// or the preferred-supplier status. Those come from the evaluation flow only.
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const domainQueries = require('../src/db/domainQueries');

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

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

async function setupBuyer(config) {
  const email = (config.email || process.env.BUYER_EMAIL || '').trim().toLowerCase();
  const phone = (config.phone || process.env.BUYER_PHONE || '').trim();
  const password = config.password || process.env.BUYER_PASSWORD;
  const name = cleanText(config.name) || cleanText(process.env.BUYER_NAME);
  const org = cleanText(config.org) || cleanText(process.env.BUYER_ORG);

  if (!email || !password || !name || !org) {
    throw new Error(
      'Buyer email, password, name and organisation are required (--buyer-email, --buyer-password, --buyer-name, --buyer-org, or the BUYER_* environment variables)'
    );
  }

  console.log(`Setting up Buyer Account: ${email}`);

  let existingUser = await identityQueries.findUserByEmail(email);
  let userUuid = existingUser?.id;
  let orgUuid = existingUser?.orgId;

  if (!existingUser) {
    const insertRes = await identityQueries.insertBuyerAccount({
      email,
      phone,
      password,
      fullName: name,
      organizationName: org,
      createdBy: 'setup-unlimited-accounts.js',
    });
    existingUser = insertRes.user;
    userUuid = insertRes.user?.id;
    orgUuid = insertRes.user?.orgId;
    console.log(`  Created identity user: ${userUuid}, org: ${orgUuid}`);
  } else {
    console.log(`  Identity user already exists (${userUuid}), updating password, role, and phone`);
    const [buyerRoleUuid, buyerOrgTypeUuid] = await Promise.all([
      identityQueries.resolveMasterUuid('role', 'role_name', 'ClientInitiator', true),
      identityQueries.resolveMasterUuid('org_types', 'type_name', 'CLIENT'),
    ]);
    await identityQueries.updateUserPasswordByUuid(userUuid, password, email);
    await pool.query(
      'UPDATE "user" SET role_uuid = $1, phone = $2, is_active = true, is_approved = true WHERE uuid = $3',
      [buyerRoleUuid, identityQueries.normalizePhone(phone), userUuid],
      { d1: true }
    );
    if (orgUuid) {
      await pool.query(
        'UPDATE organization SET org_type_uuid = $1, organization_name = $2 WHERE uuid = $3',
        [buyerOrgTypeUuid, org, orgUuid],
        { d1: true }
      );
    }
    // Delete any conflicting legacy vendor rows for this email
    await pool.query('DELETE FROM vendors WHERE lower(email) = $1', [email], { d1: true });
  }

  // Ensure buyer_accounts domain row has database-level unlimited flags
  const existingDomainAccount = await domainQueries.getBuyerAccountByEmailFromDB(email);
  const accountId = existingDomainAccount?.id || orgUuid || `ba-${Date.now()}`;

  const buyerDomainData = {
    ...(existingDomainAccount || {}),
    id: accountId,
    organizationId: orgUuid || accountId,
    userId: userUuid,
    organizationName: org,
    corporateEmail: email,
    contactPerson: name,
    mobileNumber: phone,
    subscriptionPlan: 'unlimited',
    remainingFreeRFQs: 999999,
    unlimitedRfqAccess: true,
    unlimitedAccess: true,
    sourcingMode: 'mode_3',
    status: 'ACTIVE_VERIFIED',
    totalRFQsCreated: existingDomainAccount?.totalRFQsCreated || 0,
    totalSpend: existingDomainAccount?.totalSpend || 0,
    syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    createdDate: existingDomainAccount?.createdDate || new Date().toISOString(),
  };

  await domainQueries.upsertBuyerAccountInDB(buyerDomainData);
  console.log(`  Upserted buyer_accounts record: id=${accountId}, unlimitedRfqAccess=true`);

  // Verify
  const verifyIdentity = await identityQueries.findUserByEmail(email);
  const passOk = identityQueries.verifyStoredPassword(password, verifyIdentity?.password);
  const verifyDomain = await domainQueries.getBuyerAccountByEmailFromDB(email);
  console.log(
    `  Buyer verification: identityFound=${!!verifyIdentity}, passwordValid=${passOk}, unlimitedRfqAccess=${verifyDomain?.unlimitedRfqAccess}`
  );
  return { user: verifyIdentity, domainAccount: verifyDomain };
}

async function setupVendor(config) {
  const email = (config.email || process.env.VENDOR_EMAIL || '').trim().toLowerCase();
  const phone = (config.phone || process.env.VENDOR_PHONE || '').trim();
  const password = config.password || process.env.VENDOR_PASSWORD;
  const name = cleanText(config.name) || cleanText(process.env.VENDOR_NAME);
  const org = cleanText(config.org) || cleanText(process.env.VENDOR_ORG);

  if (!email || !password || !name || !org) {
    throw new Error(
      'Vendor email, password, name and organisation are required (--vendor-email, --vendor-password, --vendor-name, --vendor-org, or the VENDOR_* environment variables)'
    );
  }

  console.log(`Setting up Vendor Account: ${email}`);

  let existingUser = await identityQueries.findUserByEmail(email);
  let userUuid = existingUser?.id;
  let orgUuid = existingUser?.orgId;

  if (!existingUser) {
    const insertRes = await identityQueries.insertVendorAccount({
      email,
      phone,
      password,
      fullName: name,
      organizationName: org,
      createdBy: 'setup-unlimited-accounts.js',
    });
    existingUser = insertRes.user;
    userUuid = insertRes.user?.id;
    orgUuid = insertRes.user?.orgId;
    console.log(`  Created identity user: ${userUuid}, org: ${orgUuid}`);
  } else {
    console.log(`  Identity user already exists (${userUuid}), updating password and phone`);
    await identityQueries.updateUserPasswordByUuid(userUuid, password, email);
    if (phone) {
      await pool.query(
        'UPDATE "user" SET phone = $1, is_active = true, is_approved = true WHERE uuid = $2',
        [identityQueries.normalizePhone(phone), userUuid],
        { d1: true }
      );
    }
  }

  // Ensure vendors domain row has database-level unlimited flags. Rating, score,
  // evaluation and status are never written here. Existing values are kept as
  // stored, and a new row leaves them empty until the evaluation flow sets them.
  const existingDomainVendor = await domainQueries.getVendorByEmailFromDB(email);
  const vendorId = existingDomainVendor?.id || `v-${Date.now()}`;
  const majorCategory =
    existingDomainVendor?.majorCategory || cleanText(config.majorCategory) || cleanText(process.env.VENDOR_MAJOR_CATEGORY) || null;
  if (!majorCategory) {
    console.log(
      '  Vendor major category is not set, so this vendor will not match RFQs yet. Set --vendor-major-category or VENDOR_MAJOR_CATEGORY.'
    );
  }

  const vendorDomainData = {
    ...(existingDomainVendor || {}),
    id: vendorId,
    name,
    email,
    phone,
    majorCategory,
    subscriptionPlan: 'premium',
    unlimitedQuoteSubmissions: true,
    unlimitedRfqDownloads: true,
    unlimitedAccess: true,
    source: 'procucev_network',
    freeQuotationCredits: 999999,
    hasRecord: true,
    isExistingInDatabase: true,
  };

  await domainQueries.upsertVendorInDB(vendorDomainData);
  console.log(`  Upserted vendors record: id=${vendorId}, unlimitedQuoteSubmissions=true, unlimitedRfqDownloads=true`);

  // Verify
  const verifyIdentity = await identityQueries.findUserByEmail(email);
  const passOk = identityQueries.verifyStoredPassword(password, verifyIdentity?.password);
  const verifyDomain = await domainQueries.getVendorByEmailFromDB(email);
  console.log(
    `  Vendor verification: identityFound=${!!verifyIdentity}, passwordValid=${passOk}, unlimitedQuotes=${verifyDomain?.unlimitedQuoteSubmissions}, unlimitedDownloads=${verifyDomain?.unlimitedRfqDownloads}`
  );
  return { user: verifyIdentity, domainVendor: verifyDomain };
}

async function main() {
  const args = parseArgs(process.argv);

  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    console.error(`Database is not reachable: ${health.errorMessage}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Connected to: ${health.providerLabel} (${health.database})`);

  await setupBuyer({
    email: args['buyer-email'],
    phone: args['buyer-phone'],
    password: args['buyer-password'],
    name: args['buyer-name'],
    org: args['buyer-org'],
  });

  await setupVendor({
    email: args['vendor-email'],
    phone: args['vendor-phone'],
    password: args['vendor-password'],
    name: args['vendor-name'],
    org: args['vendor-org'],
    majorCategory: args['vendor-major-category'],
  });

  console.log('\nBoth Buyer and Vendor accounts successfully provisioned and verified.');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Account setup failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.closePool().catch(() => {}));
}

module.exports = { setupBuyer, setupVendor };
