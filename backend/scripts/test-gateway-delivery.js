'use strict';
// ==============================================================================
// SMS GATEWAY DELIVERY TEST (MANUAL ONLY)
// ==============================================================================
// Sends two real DLT SMS messages through the gateway: the OTP template and the
// RFQ template. Run it by hand only, against a phone you control. It is never
// part of CI or npm test.
//
// Required environment variables:
//   TEST_SMS_TO               recipient mobile, 10 digits (no country code)
//   SMS_GATEWAY_URL           gateway endpoint (see backend/.env.example)
//   SMS_GATEWAY_SENDER        DLT sender ID
//   SMS_GATEWAY_USER          OTP / buyer API account
//   SMS_GATEWAY_PASS          password for SMS_GATEWAY_USER
//   SMS_GATEWAY_SMSGID        DLT template ID for the OTP message
//   SMS_GATEWAY_RFQ_USER      RFQ campaign API account
//   SMS_GATEWAY_RFQ_SMSGID    DLT template ID for the RFQ message
//   TEST_SMS_OTP_CODE         OTP value placed in the OTP template
//   TEST_SMS_RFQ_NUMBER       RFQ number placed in the RFQ template
//   TEST_SMS_RFQ_TITLE        RFQ title placed in the RFQ template
//   PUBLIC_FRONTEND_URL       public frontend origin used to build the quote link
// Optional:
//   SMS_GATEWAY_RFQ_PASS      RFQ campaign password (falls back to SMS_GATEWAY_PASS)
//
// Usage: node scripts/test-gateway-delivery.js
// ==============================================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const REQUIRED_ENV = [
  'TEST_SMS_TO',
  'SMS_GATEWAY_URL',
  'SMS_GATEWAY_SENDER',
  'SMS_GATEWAY_USER',
  'SMS_GATEWAY_PASS',
  'SMS_GATEWAY_SMSGID',
  'SMS_GATEWAY_RFQ_USER',
  'SMS_GATEWAY_RFQ_SMSGID',
  'TEST_SMS_OTP_CODE',
  'TEST_SMS_RFQ_NUMBER',
  'TEST_SMS_RFQ_TITLE',
  'PUBLIC_FRONTEND_URL',
];

async function sendRawSms(label, user, pass, smsgid, text) {
  console.log(`\n--- Testing ${label} ---`);
  console.log(`User: ${user}, SMSGID: ${smsgid}`);
  console.log(`Text: ${text}`);

  const payload = {
    user,
    pass,
    smstosend: [
      {
        to: `91${process.env.TEST_SMS_TO}`,
        from: process.env.SMS_GATEWAY_SENDER,
        smstext: text,
        smsgid,
      },
    ],
  };

  try {
    const res = await fetch(process.env.SMS_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log(`HTTP ${res.status} Response:`, body);
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

async function runTests() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`[test-gateway-delivery] Missing required environment variable(s): ${missing.join(', ')}. Nothing was sent.`);
    process.exitCode = 1;
    return;
  }

  const otpUser = process.env.SMS_GATEWAY_USER;
  const otpPass = process.env.SMS_GATEWAY_PASS;
  const otpSmsgid = process.env.SMS_GATEWAY_SMSGID;
  const rfqUser = process.env.SMS_GATEWAY_RFQ_USER;
  const rfqPass = process.env.SMS_GATEWAY_RFQ_PASS || process.env.SMS_GATEWAY_PASS;
  const rfqSmsgid = process.env.SMS_GATEWAY_RFQ_SMSGID;
  const rfqNumber = process.env.TEST_SMS_RFQ_NUMBER;
  const frontendUrl = process.env.PUBLIC_FRONTEND_URL.replace(/\/+$/, '');
  const quoteUrl = `${frontendUrl}/vendor/quotation-form?rfq=${rfqNumber}`;

  console.log('Target: the number set in TEST_SMS_TO');

  // Test 1: OTP template (registered transactional DLT template)
  await sendRawSms(
    `OTP Template (${otpUser} / ${otpSmsgid})`,
    otpUser,
    otpPass,
    otpSmsgid,
    `OTP for registering your access to Get My quoTe (GMT): ${process.env.TEST_SMS_OTP_CODE}. Valid for 5 mins. Do not share. - Team Procucev.`
  );

  // Test 2: RFQ template
  await sendRawSms(
    `RFQ Template (${rfqUser} / ${rfqSmsgid})`,
    rfqUser,
    rfqPass,
    rfqSmsgid,
    `RFQ Alert ${rfqNumber}: You are invited to bid for ${process.env.TEST_SMS_RFQ_TITLE}. Submit quote : ${quoteUrl} - Team Procucev.`
  );
}

runTests().catch((err) => {
  console.error('[test-gateway-delivery] Unexpected error:', err.message);
  process.exitCode = 1;
});
