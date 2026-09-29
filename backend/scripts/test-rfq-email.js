#!/usr/bin/env node
// ==============================================================================
// TEST RFQ NOTIFICATION EMAIL DISPATCH (LOCAL VERIFICATION)
// ==============================================================================
// Dispatches a test RFQ notification email with line items, quantities, and specs
// to verify outbound delivery locally.
//
// Usage:
//   node scripts/test-rfq-email.js [optional-recipient-email]
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mailerService = require('../src/services/mailerService');

async function main() {
  const targetEmail = process.argv[2] || process.env.RFQ_NOTIFICATION_EMAIL || 'navin.procucev@gmail.com';
  const provider = process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'gmail / smtp');

  console.log('================================================================');
  console.log('       ENTERPRISE QUA - RFQ EMAIL NOTIFICATION TEST (LOCAL)     ');
  console.log('================================================================');
  console.log(`Target Recipient : ${targetEmail}`);
  console.log(`Detected Provider: ${provider}`);
  console.log(`From Address     : ${process.env.SMTP_FROM || process.env.SMTP_USER || 'RFQ@procucev.com'}`);
  console.log('----------------------------------------------------------------\n');

  const testRfq = {
    rfqNumber: 'RFQ-LOCAL-' + Math.floor(1000 + Math.random() * 9000),
    title: 'Industrial High-Pressure Flanges & Gate Valves',
    category: 'Piping & Valves',
    status: 'Quotes Pending',
    budget: 125000,
    targetDeliveryDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    extractedEntities: [
      {
        itemName: 'Stainless Steel Flange 4-inch',
        quantity: 25,
        unit: 'pcs',
        technicalSpecs: 'Class 150 ANSI, SS 316, Raised Face',
      },
      {
        itemName: 'Forged Steel Gate Valve',
        quantity: 10,
        unit: 'units',
        technicalSpecs: 'DN50 PN16, Flanged Ends, Handwheel Operated',
      },
    ],
  };

  console.log(`Dispatching test RFQ ${testRfq.rfqNumber} notification to ${targetEmail}...`);

  try {
    const result = await mailerService.sendRequisitionNotificationEmail(
      targetEmail,
      testRfq,
      'buyer.testing@procucev.com'
    );

    console.log('\n----------------------------------------------------------------');
    if (result.sent) {
      console.log('✔ [SUCCESS] Email dispatched successfully!');
      console.log(`✔ Message ID: ${result.messageId || 'N/A'}`);
      console.log(`✔ Check inbox of: ${targetEmail}`);
    } else {
      console.log('⚠ [NOTICE] Email was not sent:');
      console.log(`  Reason: ${result.reason || result.error || 'Unknown'}`);
    }
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n✖ [FAILED] Error dispatching email:');
    console.error(err.message || err);
    console.log('================================================================\n');
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
