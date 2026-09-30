/**
 * test-rfq-sms.js
 *
 * End-to-end smoke test for the RFQ → WhatsApp + SMS notification flow.
 *
 * Flow:
 *   1. Print active gateway config
 *   2. Hydrate store from D1
 *   3. Ensure vendor nodos31566@bitproy.com exists with phone 9157154504
 *   4. Create a fresh mode_3 RFQ
 *   5. Invite vendor → triggers:
 *        • Immediate WhatsApp (sendmsg.in)
 *        • Immediate SMS (sendmsg.in DLT)
 *        • Chaser sequence scheduled (persisted to D1 chaser_queue)
 *   6. Wait for async dispatches to settle, then check logs
 *   7. Verify RFQ + vendor + chaser jobs are in D1
 *   8. Print summary
 *
 * NOTE: No direct gateway pre-call before the invite flow — that was
 * poisoning the 30s throttle and blocking the chaser sends. The invite
 * flow is the single entry point now.
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
const VENDOR_EMAIL  = 'nodos31566@bitproy.com';
const VENDOR_PHONE  = '9157154504';
const VENDOR_NAME   = 'wefgrf';
const TEST_RFQ_TITLE = 'gref – WhatsApp + SMS E2E Test';

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
  banner('RFQ → WhatsApp + SMS end-to-end test');

  // ── 0. Gateway config ────────────────────────────────────────────────────
  const smsId = process.env.SMS_GATEWAY_SMSGID || 'TEST';
  console.log('\n  SMS gateway:');
  console.log('    URL    :', process.env.SMS_GATEWAY_URL    || 'https://sms.sendmsg.in/datasend');
  console.log('    USER   :', process.env.SMS_GATEWAY_USER   || 'Procucev_OTP');
  console.log('    SENDER :', process.env.SMS_GATEWAY_SENDER || 'PROCUC');
  console.log('    SMSGID :', smsId, smsId === 'TEST' ? '⚠️  carriers will drop this!' : '✅');
  console.log('  WhatsApp gateway:');
  console.log('    USERNAME:', process.env.WHATSAPP_USERNAME || '(not set)');
  console.log('    FROM    :', process.env.WHATSAPP_FROM_NUMBER || '(not set)');
  console.log('  Delays:');
  console.log('    WA  :', process.env.CHASER_WHATSAPP_DELAY_MS  ?? '0 (immediate)');
  console.log('    SMS :', process.env.CHASER_SMS_DELAY_MS       ?? '300000 (5 min)');

  // ── 1. Clear all throttles — clean state before test ─────────────────────
  banner('STEP 1 — Clear throttle caches (clean state)');
  smsService.clearSmsThrottleCache();
  whatsAppService.clearWhatsAppThrottleCache();
  console.log('  ✅  Throttle caches cleared.');

  // ── 2. Hydrate store from D1 ─────────────────────────────────────────────
  banner('STEP 2 — Hydrate store from D1');
  try {
    await storeService.hydrateFromDB();
    console.log(`  ✅  Store hydrated — vendors: ${(storeService.vendors || []).length}, RFQs: ${(storeService.rfqs || []).length}`);
  } catch (err) {
    console.log('  ⚠️   Hydration error (continuing):', err.message);
  }

  // ── 3. Ensure vendor exists with phone ───────────────────────────────────
  banner('STEP 3 — Locate / register vendor');

  let vendor = (storeService.vendors || []).find((v) => v.email === VENDOR_EMAIL);

  if (vendor) {
    console.log(`  ✅  Vendor found in store: id=${vendor.id}, phone=${vendor.phone || 'MISSING'}`);
    if (!vendor.phone) {
      vendor = storeService.updateVendor(vendor.id, { phone: VENDOR_PHONE });
      console.log(`  🔧  Patched phone → ${vendor.phone}`);
    }
  } else {
    vendor = storeService.addVendor({
      name           : VENDOR_NAME,
      email          : VENDOR_EMAIL,
      phone          : VENDOR_PHONE,
      majorCategory  : 'Mechanical & Fluid Equipment',
      minorCategories: ['Pumps & Compressors'],
      contactPerson  : 'wefgrf',
      status         : 'REGISTERED / NOT EVALUATED',
      source         : 'test_script',
    });
    console.log(`  ✅  Vendor created: id=${vendor.id}, phone=${vendor.phone}`);
  }

  if (!vendor || !vendor.phone) {
    console.log('  ❌  Vendor missing phone — aborting.');
    process.exit(1);
  }

  // ── 4. Create test RFQ (mode_3) ──────────────────────────────────────────
  banner('STEP 4 — Create test RFQ (mode_3)');

  const rfq = storeService.createRFQ({
    title             : TEST_RFQ_TITLE,
    category          : 'Mechanical & Fluid Equipment',
    sourcingMode      : 'mode_3',
    deliveryLocation  : 'Gandhinagar, Gujarat',
    deliveryPincode   : '382010',
    targetDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    lineItems         : [{ description: 'Industrial pump', quantity: 2, unit: 'nos' }],
  });

  console.log(`  ✅  RFQ created: ${rfq.rfqNumber} (id=${rfq.id})`);

  // ── 5. Invite vendor — triggers WhatsApp + SMS immediately ───────────────
  banner('STEP 5 — inviteVendorsToRFQ → WhatsApp + SMS + chaser');
  console.log(`  → Inviting ${VENDOR_NAME} (${VENDOR_PHONE}) to ${rfq.rfqNumber} …`);

  const inviteResult = await storeService.inviteVendorsToRFQ(
    rfq.id, [vendor.id], 'test-script@procucev.ai'
  );

  console.log(`  invitedCount : ${inviteResult?.invitedCount ?? 'null'}`);

  if (inviteResult?.invitedCount === 1) {
    console.log('  ✅  Vendor invited.');
    console.log(`\n  ⏳  Waiting 5 s for all fire-and-forget dispatches to settle …`);
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
        console.log(`  ✅  RFQ in D1:`, JSON.stringify(rfqRow.rows[0]));
      } else {
        console.log(`  ❌  RFQ ${rfq.rfqNumber} NOT in D1`);
      }

      // Vendor
      const vRow = await d1._execHttp(
        'SELECT id, email FROM vendors WHERE email = ?', [VENDOR_EMAIL]
      );
      if (vRow.rows?.length) {
        console.log(`  ✅  Vendor in D1:`, JSON.stringify(vRow.rows[0]));
      } else {
        console.log(`  ❌  Vendor NOT in D1`);
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
      l.includes(rfq.rfqNumber) || l.includes(VENDOR_PHONE) || l.includes('WHATSAPP') || l.includes('SMS_SERVICE')
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
  console.log('  Check your phone 9157154504 for:');
  console.log('    • WhatsApp message from QUA testing Procucev (immediate)');
  console.log('    • SMS from PROCUC (immediate if CHASER_SMS_DELAY_MS=0, or +5 min)');
  console.log('');
  console.log('  If WhatsApp/SMS arrived → both channels working ✅');
  console.log('  If not → check STEP 7 logs for "failed" or "throttled" entries\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Unhandled error:', err);
  process.exit(1);
});
