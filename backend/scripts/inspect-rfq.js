require('dotenv').config({ path: './.env' });
const pool = require('../src/db/pool');

// Usage: node scripts/inspect-rfq.js RFQ_NUMBER [RFQ_NUMBER ...]
// Prints the stored status, category, vendors, and line-item classification for each RFQ.
(async () => {
  const rfqNumbers = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  if (rfqNumbers.length === 0) {
    console.error('Usage: node scripts/inspect-rfq.js RFQ_NUMBER [RFQ_NUMBER ...]');
    process.exitCode = 1;
    return;
  }

  try {
    const placeholders = rfqNumbers.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `select rfq_number, status, category, raw from rfqs where rfq_number in (${placeholders})`;
    const res = await pool.rows(sql, rfqNumbers, { d1: true, d1Text: sql, d1Params: rfqNumbers });
    if (res.length === 0) {
      console.log('No RFQs matched the given numbers.');
    }
    res.forEach((r) => {
      const parsed = JSON.parse(r.raw);
      console.log('=== ' + r.rfq_number + ' ===');
      console.log('Status in column:', r.status, '| Status in raw:', parsed.status);
      console.log('Category:', parsed.category);
      console.log('Vendors:', (parsed.assignedVendors || []).map((v) => v.name || v.id));
      console.log('FollowUpData:', parsed.followUpData);
      console.log('Line Items:');
      (parsed.extractedEntities || []).forEach((e, idx) => {
        console.log(`  ${idx + 1}. ${e.itemName} -> major: "${e.majorCategory}" | minor: "${e.minorCategory}" | conf: ${e.confidence}`);
      });
    });
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
