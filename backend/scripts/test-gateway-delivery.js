'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const TARGET_MOBILE = '9157154504';
const GATEWAY_URL = 'https://sms.sendmsg.in/datasend';

async function sendRawSms(label, user, pass, smsgid, text) {
  console.log(`\n--- Testing ${label} ---`);
  console.log(`User: ${user}, SMSGID: ${smsgid}`);
  console.log(`Text: ${text}`);

  const payload = {
    user,
    pass,
    smstosend: [
      {
        to: `91${TARGET_MOBILE}`,
        from: 'PROCUC',
        smstext: text,
        smsgid,
      },
    ],
  };

  try {
    const res = await fetch(GATEWAY_URL, {
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
    console.error(`Fetch error:`, err.message);
  }
}

async function runTests() {
  console.log(`Target phone: +91${TARGET_MOBILE}`);

  const otpUser = process.env.SMS_GATEWAY_USER || 'Procucev_OTP';
  const otpPass = process.env.SMS_GATEWAY_PASS;
  const rfqUser = process.env.SMS_GATEWAY_RFQ_USER || 'ProcucevWapp1';
  const rfqPass = process.env.SMS_GATEWAY_RFQ_PASS || process.env.SMS_GATEWAY_PASS;
  const rfqSmsgid = process.env.SMS_GATEWAY_RFQ_SMSGID || '1777179076323440961';
  const otpSmsgid = process.env.SMS_GATEWAY_SMSGID || '1102294821';

  if (!otpPass) {
    console.warn('[test-gateway-delivery] SMS_GATEWAY_PASS is unset in environment. Skipping live tests.');
    return;
  }

  // Test 1: OTP Template (Known working transactional DLT)
  await sendRawSms(
    `OTP Template (${otpUser} / ${otpSmsgid})`,
    otpUser,
    otpPass,
    otpSmsgid,
    'OTP for registering your access to Get My quoTe (GMT): 482910. Valid for 5 mins. Do not share. - Team Procucev.'
  );

  // Test 2: RFQ Template
  await sendRawSms(
    `RFQ Template (${rfqUser} / ${rfqSmsgid})`,
    rfqUser,
    rfqPass,
    rfqSmsgid,
    'RFQ Alert RFQ260910168889: You are invited to bid for Enterprise Server & Cloud Infrastructure Procurement. Submit quote : https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/vendor/quotation-form?rfq=RFQ260910168889 - Team Procucev.'
  );
}

runTests();
