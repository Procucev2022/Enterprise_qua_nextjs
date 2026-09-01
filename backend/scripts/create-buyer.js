#!/usr/bin/env node
// ==============================================================================
// CREATE BUYER ACCOUNT IN THE SHARED IDENTITY DATABASE
// ==============================================================================
// Creates a CLIENT organisation + ClientInitiator user in the shared Procucev
// MySQL schema so the account can sign in to this workspace and to the Java
// p2pservices portal.
//
// Usage:
//   node scripts/create-buyer.js --email a@b.com --phone 9876543210 \
//        --password 'Secret@123' [--name "Full Name"] [--org "Company Pvt Ltd"]
//
// Connection settings come from backend/.env (MYSQL_*). Nothing is hardcoded.
// The script is idempotent: re-running it reports the existing account instead
// of creating a duplicate.
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const identityPoolModule = require('../src/db/identityPool');
const identityQueries = require('../src/db/identityQueries');

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

async function main() {
  const args = parseArgs(process.argv);
  const missing = ['email', 'phone', 'password'].filter((k) => !args[k] || args[k] === true);

  if (missing.length > 0) {
    console.error(`Missing required argument(s): ${missing.map((m) => `--${m}`).join(', ')}`);
    console.error(
      "Usage: node scripts/create-buyer.js --email a@b.com --phone 9876543210 --password 'Secret@123' [--name \"Full Name\"] [--org \"Company\"]"
    );
    process.exitCode = 1;
    return;
  }

  const health = await identityPoolModule.checkIdentityHealth();
  if (!health.isConnected) {
    console.error(`Identity database unavailable: ${health.errorMessage}`);
    console.error('Check the MYSQL_* settings in backend/.env and the server firewall rules.');
    process.exitCode = 1;
    return;
  }

  console.log(`Identity database: ${health.providerLabel}`);
  console.log(`Schema: ${health.database} (${health.userCount} active users)\n`);

  const result = await identityQueries.insertBuyerAccount({
    email: args.email,
    password: args.password,
    phone: args.phone,
    fullName: args.name === true ? undefined : args.name,
    organizationName: args.org === true ? undefined : args.org,
    createdBy: 'scripts/create-buyer.js',
  });

  if (!result.created) {
    console.log(`Account already exists for ${args.email} — nothing inserted.`);
    console.log(
      `  role=${result.user.role} active=${result.user.isActive} approved=${result.user.isApproved} org=${result.user.orgName}`
    );
    return;
  }

  console.log('Buyer account created:');
  console.log(`  user uuid  : ${result.user.id}`);
  console.log(`  login email: ${result.user.email}`);
  console.log(`  phone      : ${result.user.mobile}`);
  console.log(`  role       : ${result.user.role} (ClientInitiator)`);
  console.log(`  org uuid   : ${result.user.orgId}`);
  console.log(`  org name   : ${result.user.orgName}${result.organizationReused ? ' (reused existing)' : ' (created)'}`);

  // Prove the credentials actually authenticate through the same read path the
  // login endpoint uses, rather than trusting the INSERT alone.
  const verify = await identityQueries.findUserByEmail(args.email);
  const passwordOk = identityQueries.verifyStoredPassword(args.password, verify?.password);
  console.log(`\nVerification read-back: found=${!!verify} passwordMatches=${passwordOk} role=${verify?.role}`);
}

main()
  .catch((err) => {
    console.error('Failed to create buyer account:', err.message);
    process.exitCode = 1;
  })
  .finally(() => identityPoolModule.closeIdentityPool().catch(() => {}));
