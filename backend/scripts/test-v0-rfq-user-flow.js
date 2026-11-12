'use strict';

// ==============================================================================
// V0 RFQ CREATION & LIVE SMS DISPATCH (MANUAL ONLY)
// ==============================================================================
// Manual smoke test. It creates a real RFQ, creates a buyer login when one is
// missing, and sends a live RFQ SMS to the vendor phone. It writes to the
// configured database and uses the real gateway, so run it by hand against a
// test environment only. It is never part of CI or npm test.
//
// Required environment variables:
//   TEST_BUYER_EMAIL, TEST_BUYER_PASSWORD, TEST_BUYER_PHONE,
//   TEST_BUYER_NAME, TEST_BUYER_ORG      buyer login (password is used only when creating it)
//   TEST_VENDOR_PHONE                    phone of an EXISTING vendor (this script never creates one)
//   TEST_RFQ_TITLE, TEST_RFQ_CATEGORY,
//   TEST_RFQ_DELIVERY_LOCATION,
//   TEST_RFQ_DELIVERY_PINCODE            RFQ fields
//   TEST_RFQ_LINE_ITEMS_JSON             JSON array of {"description","quantity","unit"}
// Optional:
//   TEST_RFQ_BUDGET                      numeric budget; omitted when unset
//
// Usage: node scripts/test-v0-rfq-user-flow.js
// ==============================================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const smsService = require('../src/services/smsService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

const REQUIRED_ENV = [
  'TEST_BUYER_EMAIL',
  'TEST_BUYER_PASSWORD',
  'TEST_BUYER_PHONE',
  'TEST_BUYER_NAME',
  'TEST_BUYER_ORG',
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
    console.error(`Missing required environment variable(s): ${missing.join(', ')}. Nothing was created or sent.`);
    process.exit(1);
  }

  let lineItems;
  try {
    lineItems = JSON.parse(process.env.TEST_RFQ_LINE_ITEMS_JSON);
  } catch (err) {
    console.error(`TEST_RFQ_LINE_ITEMS_JSON is not valid JSON: ${err.message}. Nothing was created or sent.`);
    process.exit(1);
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    console.error('TEST_RFQ_LINE_ITEMS_JSON must be a non-empty JSON array. Nothing was created or sent.');
    process.exit(1);
  }

  const budget = process.env.TEST_RFQ_BUDGET ? Number(process.env.TEST_RFQ_BUDGET) : undefined;
  if (budget !== undefined && !Number.isFinite(budget)) {
    console.error('TEST_RFQ_BUDGET must be a number when set. Nothing was created or sent.');
    process.exit(1);
  }

  return {
    buyer: {
      email: process.env.TEST_BUYER_EMAIL.trim().toLowerCase(),
      password: process.env.TEST_BUYER_PASSWORD,
      phone: process.env.TEST_BUYER_PHONE.trim(),
      name: process.env.TEST_BUYER_NAME.trim(),
      org: process.env.TEST_BUYER_ORG.trim(),
    },
    vendorPhone: process.env.TEST_VENDOR_PHONE.trim(),
    rfq: {
      title: process.env.TEST_RFQ_TITLE,
      category: process.env.TEST_RFQ_CATEGORY,
      deliveryLocation: process.env.TEST_RFQ_DELIVERY_LOCATION,
      deliveryPincode: process.env.TEST_RFQ_DELIVERY_PINCODE,
      lineItems,
      budget,
    },
  };
}

async function main() {
  console.log('====================================================');
  console.log(' V0 RFQ CREATION & LIVE SMS DISPATCH (MANUAL ONLY)');
  console.log('====================================================\n');

  const config = readConfig();

  // 1. Clear SMS throttle
  smsService.clearSmsThrottleCache();

  // 2. Hydrate database / store
  try {
    await storeService.hydrateFromDB();
    console.log(`[INIT] Store hydrated with ${storeService.vendors.length} vendors and ${storeService.rfqs.length} RFQs.`);
  } catch (err) {
    console.log(`[INIT] Store hydration note: ${err.message}`);
  }

  // 3. The vendor must already exist. This script never creates or edits a vendor.
  const vendor = storeService.vendors.find(
    (v) => v.phone === config.vendorPhone || v.mobile === config.vendorPhone || v.mobileNumber === config.vendorPhone
  );
  if (!vendor) {
    console.error(
      '[VENDOR] No vendor with the TEST_VENDOR_PHONE number exists in the store. Onboard that vendor first. Nothing was created or sent.'
    );
    process.exit(1);
  }
  console.log(`[VENDOR] Found existing vendor: ${vendor.name} (${vendor.id})`);
  console.log(`[DEBUG] vendor.isProcucevVendor: ${storeService.isProcucevVendor(vendor)}`);
  console.log(`[DEBUG] vendor.isBuyerUploaded: ${storeService.isBuyerUploaded(vendor)}`);
  console.log(`[DEBUG] vendorCoversCategory: ${storeService.vendorCoversCategory(vendor, config.rfq.category)}`);

  // 4. Ensure the buyer account exists. A missing buyer is created from TEST_BUYER_* values.
  const { buyer: buyerConfig } = config;
  let buyer = storeService.buyerAccounts.find(
    (b) => (b.corporateEmail || '').toLowerCase() === buyerConfig.email
  );

  if (!buyer) {
    console.log(`[BUYER] Creating buyer account for ${buyerConfig.email}...`);
    buyer = storeService.addBuyerAccount({
      organizationName: buyerConfig.org,
      corporateEmail: buyerConfig.email,
      contactPerson: buyerConfig.name,
      contactPhone: buyerConfig.phone,
      sourcingMode: 'mode_0',
    });
  } else {
    console.log(`[BUYER] Found existing buyer account: ${buyer.organizationName} (${buyer.id})`);
  }

  // Also ensure the identity row exists in the database when one is connected.
  try {
    const idUser = await identityQueries.findUserByEmail(buyerConfig.email);
    if (!idUser) {
      console.log('[IDENTITY] Inserting buyer user in DB...');
      await identityQueries.insertUser({
        email: buyerConfig.email,
        name: buyerConfig.name,
        password: buyerConfig.password,
        role: 'buyer',
        rawRoleName: 'ClientInitiator',
        orgId: buyer.id,
        orgName: buyerConfig.org,
        mobile: `+91${buyerConfig.phone}`,
        status: 'ACTIVE',
        isActive: true,
        isApproved: true,
      });
    }
  } catch (err) {
    console.log(`[IDENTITY] Note: ${err.message}`);
  }

  // 5. Create the V0 RFQ from TEST_RFQ_* values
  console.log(`\n[RFQ] Creating V0 RFQ for category "${config.rfq.category}"...`);
  const rfqData = {
    title: config.rfq.title,
    category: config.rfq.category,
    sourcingMode: 'mode_0',
    deliveryLocation: config.rfq.deliveryLocation,
    deliveryPincode: config.rfq.deliveryPincode,
    targetDeliveryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    lineItems: config.rfq.lineItems,
  };
  if (config.rfq.budget !== undefined) rfqData.budget = config.rfq.budget;

  const createdRfq = storeService.createRFQ(rfqData, buyer);
  console.log(`[RFQ] Created RFQ: ${createdRfq.rfqNumber} (ID: ${createdRfq.id})`);
  console.log(`[RFQ] Sourcing Mode: ${createdRfq.sourcingMode}`);
  console.log(`[RFQ] Assigned Vendors Count: ${(createdRfq.assignedVendors || []).length}`);

  const isMatched = (createdRfq.assignedVendors || []).some(
    (v) => v.phone === config.vendorPhone || (v.id && v.id === vendor.id) || v.name === vendor.name
  );
  console.log(`[MATCHING] Is vendor ${vendor.name} matched to this RFQ? ${isMatched ? 'YES' : 'NO'}`);

  // 6. Send a live RFQ alert SMS to the vendor phone
  console.log(`\n[SMS] Dispatching live RFQ Alert SMS to the TEST_VENDOR_PHONE number...`);
  console.log(`[SMS] Gateway URL: ${process.env.SMS_GATEWAY_URL || '(SMS_GATEWAY_URL not set)'}`);
  console.log(
    `[SMS] DLT Template ID: ${process.env.SMS_GATEWAY_RFQ_SMSGID || '(SMS_GATEWAY_RFQ_SMSGID not set; service default applies)'}`
  );

  const smsResult = await smsService.sendRFQChaserSms({
    mobile: config.vendorPhone,
    vendorName: vendor.name,
    rfqNumber: createdRfq.rfqNumber,
    rfqTitle: createdRfq.title,
  });

  console.log('\n[SMS RESULT]:', JSON.stringify(smsResult, null, 2));

  if (smsResult.success) {
    console.log('\nSUCCESS: Live RFQ alert SMS dispatched to the vendor phone.');
  } else {
    console.log(`\nDISPATCH FAILED: ${smsResult.status || smsResult.error || 'unknown reason'}`);
  }

  process.exit(smsResult.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
