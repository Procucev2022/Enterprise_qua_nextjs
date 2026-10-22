require('dotenv').config({ path: './.env' });
const pool = require('../src/db/pool');

(async () => {
  try {
    const res = await pool.rows(
      "select rfq_number, status, category, raw from rfqs where rfq_number in ('RFQ262210504708', 'RFQ262110316607')",
      [],
      { d1: true }
    );
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
  }
})();
