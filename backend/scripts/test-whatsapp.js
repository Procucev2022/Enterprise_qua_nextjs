'use strict';
// ==============================================================================
// WHATSAPP RFQ INVITATION TEST (MANUAL ONLY)
// ==============================================================================
// Sends one real WhatsApp invitation to TEST_WHATSAPP_TO. Run it by hand only,
// against a number you control. It is never part of CI or npm test.
//
// Required environment variables:
//   TEST_WHATSAPP_TO                  recipient mobile, 10 digits (no country code)
//   TEST_WHATSAPP_VENDOR_NAME         vendor name shown in the template
//   TEST_WHATSAPP_RFQ_NUMBER          RFQ number shown in the template
//   TEST_WHATSAPP_RFQ_TITLE           RFQ title shown in the template
//   TEST_WHATSAPP_DELIVERY_DATE       delivery date, YYYY-MM-DD
//   TEST_WHATSAPP_DELIVERY_LOCATION   delivery location text
//
// Usage: node scripts/test-whatsapp.js
// ==============================================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const whatsAppService = require('../src/services/whatsAppService');

const REQUIRED_ENV = [
  'TEST_WHATSAPP_TO',
  'TEST_WHATSAPP_VENDOR_NAME',
  'TEST_WHATSAPP_RFQ_NUMBER',
  'TEST_WHATSAPP_RFQ_TITLE',
  'TEST_WHATSAPP_DELIVERY_DATE',
  'TEST_WHATSAPP_DELIVERY_LOCATION',
];

async function testWhatsApp() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}. Nothing was sent.`);
    process.exitCode = 1;
    return;
  }

  whatsAppService.clearWhatsAppThrottleCache();
  console.log('Testing WhatsApp notification to the TEST_WHATSAPP_TO number...');
  const res = await whatsAppService.sendRFQInvitationWhatsApp({
    phone: process.env.TEST_WHATSAPP_TO,
    vendorName: process.env.TEST_WHATSAPP_VENDOR_NAME,
    rfqNumber: process.env.TEST_WHATSAPP_RFQ_NUMBER,
    rfqTitle: process.env.TEST_WHATSAPP_RFQ_TITLE,
    deliveryDate: process.env.TEST_WHATSAPP_DELIVERY_DATE,
    deliveryLocation: process.env.TEST_WHATSAPP_DELIVERY_LOCATION,
  });
  console.log('WhatsApp Result:', JSON.stringify(res, null, 2));
  process.exitCode = res && res.success ? 0 : 1;
}

testWhatsApp().catch((err) => {
  console.error('WhatsApp test failed:', err.message);
  process.exitCode = 1;
});
