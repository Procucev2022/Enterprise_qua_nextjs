/**
 * test-rfq-sms.js
 *
 * MANUAL ONLY. Sends real WhatsApp and SMS messages and writes a real RFQ to the
 * configured database. Run it by hand against a test environment. It is never
 * part of CI or npm test.
 *
 * Flow:
 *   1. Print the gateway config. Unset values print as "(not set)".
 *   2. Clear throttle caches
 *   3. Hydrate the store from the database
 *   4. Find the EXISTING vendor named by TEST_VENDOR_EMAIL (this script never creates vendors)
 *   5. Create a fresh RFQ from TEST_RFQ_* values
 *   6. Invite the vendor, which triggers WhatsApp, SMS, and the chaser sequence
 *   7. Wait for async dispatches to settle, then check the database and logs
 *   8. Print a summary
 *
 * Required environment variables:
 *   TEST_VENDOR_EMAIL             email of an existing vendor record
 *   TEST_VENDOR_PHONE             phone that receives the messages
 *   TEST_RFQ_TITLE                RFQ title
 *   TEST_RFQ_CATEGORY             major category
 *   TEST_RFQ_DELIVERY_LOCATION    delivery location text
 *   TEST_RFQ_DELIVERY_PINCODE     delivery pincode
 *   TEST_RFQ_LINE_ITEMS_JSON      JSON array of {"description","quantity","unit"}
 * Optional:
 *   TEST_ACTOR_EMAIL              email recorded as the actor of the invitation
 *
 * NOTE: No direct gateway pre-call before the invite flow. That poisoned the
 * 30s throttle and blocked the chaser sends. The invite flow is the single entry
 * point.
 *
 * Run:
 *   node scripts/test-rfq-sms.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const smsService       = require('../src/services/smsService');
const whatsAppService  = require('../src/services/whatsAppService');
const storeService     = require('../src/services/storeService');
const { getD1HttpClient } = require('../src/db/d1Bridge');

// ─── Config ────────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'TEST_VENDOR_EMAIL',
  'TEST_VENDOR_PHONE',
  'TEST_RFQ_TITLE',
  'TEST_RFQ_CATEGORY',
  'TEST_RFQ_DELIVERY_LOCATION',
  'TEST_RFQ_DELIVERY_PINCODE',
  'TEST_RFQ_LINE_ITEMS_JSON',
];

/** Validate every input before anything is created or sent. */
function readConfig() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`[test-rfq-sms] Missing required environment variable(s): ${missing.join(', ')}. Nothing was created or sent.`);
    process.exit(1);
  }

  let lineItems;
  try {
    lineItems = JSON.parse(process.env.TEST_RFQ_LINE_ITEMS_JSON);
  } catch (err) {
    console.error(`[test-rfq-sms] TEST_RFQ_LINE_ITEMS_JSON is not valid JSON: ${err.message}. Nothing was created or sent.`);
    process.exit(1);
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    console.error('[test-rfq-sms] TEST_RFQ_LINE_ITEMS_JSON must be a non-empty JSON array. Nothing was created or sent.');
    process.exit(1);
  }

  return {
    vendorEmail: process.env.TEST_VENDOR_EMAIL.trim().toLowerCase(),
    vendorPhone: process.env.TEST_VENDOR_PHONE.trim(),
    actorEmail: process.env.TEST_ACTOR_EMAIL || null,
    rfq: {
      title: process.env.TEST_RFQ_TITLE,
      category: process.env.TEST_RFQ_CATEGORY,
      deliveryLocation: process.env.TEST_RFQ_DELIVERY_LOCATION,
      deliveryPincode: process.env.TEST_RFQ_DELIVERY_PINCODE,
      lineItems,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function banner(text) {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  banner('RFQ → WhatsApp + SMS end-to-end test (manual only)');
  const config = readConfig();

  // ── 0. Gateway config (printed as-is, never defaulted) ───────────────────
  const smsId = process.env.SMS_GATEWAY_SMSGID;
  const smsIdNote = !smsId ? '⚠️  not set' : (smsId === 'TEST' ? '⚠️  carriers will drop this!' : '✅');
  console.log('\n  SMS gateway:');
  console.log('    URL    :', process.env.SMS_GATEWAY_URL || '(not set)');
  console.log('    USER   :', process.env.SMS_GATEWAY_USER || '(not set)');
  console.log('    SENDER :', process.env.SMS_GATEWAY_SENDER || '(not set)');
  console.log('    SMSGID :', smsId || '(not set)', smsIdNote);
  console.log('  WhatsApp gateway:');
  console.log('    USERNAME:', process.env.WHATSAPP_USERNAME || '(not set)');
  console.log('    FROM    :', process.env.WHATSAPP_FROM_NUMBER || '(not set)');
  console.log('  Delays:');
  console.log('    WA  :', process.env.CHASER_WHATSAPP_DELAY_MS ?? '(not set; service default applies)');
  console.log('    SMS :', process.env.CHASER_SMS_DELAY_MS ?? '(not set; service default applies)');

  // ── 1. Clear all throttles — clean state before test ─────────────────────
  banner('STEP 1 — Clear throttle caches (clean state)');
  smsService.clearSmsThrottleCache();
  whatsAppService.clearWhatsAppThrottleCache();
  console.log('  ✅  Throttle caches cleared.');

  // ── 2. Hydrate store from the database ───────────────────────────────────
  banner('STEP 2 — Hydrate store from the database');
  try {
    await storeService.hydrateFromDB();
    console.log(`  ✅  Store hydrated — vendors: ${(storeService.vendors || []).length}, RFQs: ${(storeService.rfqs || []).length}`);
  } catch (err) {
    console.log('  ⚠️   Hydration error (continuing):', err.message);
  }

  // ── 3. Find the existing vendor (never created here) ─────────────────────
  banner('STEP 3 — Locate existing vendor');
  let vendor = (storeService.vendors || []).find((v) => (v.email || '').toLowerCase() === config.vendorEmail);

  if (!vendor) {
    console.log('  ❌  No vendor with the TEST_VENDOR_EMAIL address is in the store. Onboard it first. Nothing was created or sent.');
    process.exit(1);
  }

  console.log(`  ✅  Vendor found in store: id=${vendor.id}, phone=${vendor.phone || 'MISSING'}`);
  if (!vendor.phone) {
    vendor = storeService.updateVendor(vendor.id, { phone: config.vendorPhone });
    console.log('  🔧  Patched phone from TEST_VENDOR_PHONE');
  }

  if (!vendor || !vendor.phone) {
    console.log('  ❌  Vendor missing phone — aborting.');
    process.exit(1);
  }

  // ── 4. Create test RFQ (mode_3) ──────────────────────────────────────────
  banner('STEP 4 — Create test RFQ (mode_3)');

  const rfq = storeService.createRFQ({
    title             : config.rfq.title,
    category          : config.rfq.category,
    sourcingMode      : 'mode_3',
    deliveryLocation  : config.rfq.deliveryLocation,
    deliveryPincode   : config.rfq.deliveryPincode,
    targetDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    lineItems         : config.rfq.lineItems,
  });

  console.log(`  ✅  RFQ created: ${rfq.rfqNumber} (id=${rfq.id})`);

  // ── 5. Invite vendor — triggers WhatsApp + SMS immediately ───────────────
  banner('STEP 5 — inviteVendorsToRFQ → WhatsApp + SMS + chaser');
  console.log(`  → Inviting ${vendor.name} to ${rfq.rfqNumber} …`);

  const inviteResult = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], config.actorEmail);

  console.log(`  invitedCount : ${inviteResult?.invitedCount ?? 'null'}`);

  if (inviteResult?.invitedCount === 1) {
    console.log('  ✅  Vendor invited.');
    console.log('\n  ⏳  Waiting 5 s for all fire-and-forget dispatches to settle …');
    await sleep(5000);
    console.log('  ✅  Done waiting.');
  } else {
    console.log('  ⚠️   invitedCount !== 1 — vendor may already be on this RFQ.');
  }

  // ── 6. Verify D1 persistence ─────────────────────────────────────────────
  banner('STEP 6 — Verify D1 persistence');
  console.log('  ⏳  Allowing 2 s for async D1 writes …');
  await sleep(2000);

  const d1 = getD1HttpClient();
  if (!d1) {
    console.log('  ⚠️   D1 HTTP client not configured — skipping D1 verification.');
  } else {
    try {
      // RFQ
      const rfqRow = await d1._execHttp(
        'SELECT rfq_number, sourcing_mode, status FROM rfqs WHERE rfq_number = ?', [rfq.rfqNumber]
      );
      if (rfqRow.rows?.length) {
        console.log('  ✅  RFQ in D1:', JSON.stringify(rfqRow.rows[0]));
      } else {
        console.log(`  ❌  RFQ ${rfq.rfqNumber} NOT in D1`);
      }

      // Vendor
      const vRow = await d1._execHttp(
        'SELECT id, email FROM vendors WHERE email = ?', [config.vendorEmail]
      );
      if (vRow.rows?.length) {
        console.log('  ✅  Vendor in D1:', JSON.stringify(vRow.rows[0]));
      } else {
        console.log('  ❌  Vendor NOT in D1');
      }

      // Chaser jobs
      const cRow = await d1._execHttp(
        `SELECT id, channel, status, fire_at FROM chaser_queue
         WHERE rfq_number = ? ORDER BY fire_at ASC`, [rfq.rfqNumber]
      );
      if (cRow.rows?.length) {
        console.log(`  ✅  Chaser jobs in D1 (${cRow.rows.length} rows):`);
        cRow.rows.forEach((r) => console.log(`       ${r.channel.padEnd(10)} ${r.status.padEnd(10)} fire_at=${r.fire_at}`));
      } else {
        console.log(`  ❌  No chaser jobs found in D1 for ${rfq.rfqNumber}`);
      }
    } catch (err) {
      console.log(`  ❌  D1 check failed: ${err.message}`);
    }
  }

  // ── 7. Recent log tail ───────────────────────────────────────────────────
  banner('STEP 7 — Check recent log entries');
  const fs   = require('fs');
  const path = require('path');
  const logPath = path.join(__dirname, '../logs/app.log');
  try {
    const logText = fs.readFileSync(logPath, 'utf8');
    const lines = logText.split('\n').filter(Boolean);
    const recent = lines.slice(-80).filter((l) =>
      l.includes(rfq.rfqNumber) || l.includes(config.vendorPhone) || l.includes('WHATSAPP') || l.includes('SMS_SERVICE')
    );
    if (recent.length) {
      console.log(`  Found ${recent.length} relevant log line(s):`);
      recent.forEach((l) => {
        try {
          const obj = JSON.parse(l);
          const ts  = (obj.timestamp || '').slice(11, 19);
          console.log(`  [${ts}] [${obj.category}] ${obj.message?.slice(0, 100)}`);
        } catch {
          console.log(' ', l.slice(0, 120));
        }
      });
    } else {
      console.log('  (no matching log entries found)');
    }
  } catch {
    console.log('  (could not read app.log)');
  }

  // ── 8. Summary ───────────────────────────────────────────────────────────
  banner('SUMMARY');
  console.log('  Invite flow  :', inviteResult?.invitedCount === 1 ? '✅ vendor invited' : '⚠️  check above');
  console.log('  D1 persisted : see STEP 6 above');
  console.log('  Logs         : see STEP 7 above');
  console.log('');
  console.log('  Check the TEST_VENDOR_PHONE handset for:');
  console.log('    • WhatsApp message (immediate)');
  console.log('    • SMS (immediate if CHASER_SMS_DELAY_MS=0, otherwise after that delay)');
  console.log('');
  console.log('  If WhatsApp/SMS arrived → both channels working ✅');
  console.log('  If not → check STEP 7 logs for "failed" or "throttled" entries\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Unhandled error:', err);
  process.exit(1);
});
