require('dotenv').config({ path: './.env' });
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

async function repair() {
  console.log('Fetching RFQs from D1...');
  const rows = await pool.rows(
    "SELECT rfq_number, raw FROM rfqs WHERE status = 'Parsing'",
    [],
    { d1: true }
  );

  console.log(`Found ${rows.length} RFQ(s) in Parsing status.`);

  for (const row of rows) {
    const rfq = JSON.parse(row.raw);
    console.log(`\nRepairing ${rfq.rfqNumber} (${rfq.title})...`);
    console.log(`Original status: ${rfq.status}, Vendors: ${(rfq.assignedVendors || []).length}`);

    // Fix line item categories
    if (Array.isArray(rfq.extractedEntities)) {
      rfq.extractedEntities.forEach((item, idx) => {
        const text = `${item.itemName || ''} ${item.technicalSpecs || ''}`.toLowerCase();
        let changed = false;

        if (item.minorCategory === 'IT' || item.majorCategory === 'Others – New Product' || !item.minorCategory) {
          if (text.includes('laptop') || text.includes('notebook')) {
            item.majorCategory = 'IT';
            item.minorCategory = 'Laptop';
            changed = true;
          } else if (text.includes('desktop') || text.includes('computer') || text.includes('pc')) {
            item.majorCategory = 'IT';
            item.minorCategory = 'Computer';
            changed = true;
          } else if (text.includes('printer')) {
            item.majorCategory = 'IT';
            item.minorCategory = 'Printers';
            changed = true;
          } else if (text.includes('monitor') || text.includes('keyboard') || text.includes('mouse') || text.includes('ssd') || text.includes('storage') || text.includes('drive')) {
            item.majorCategory = 'IT';
            item.minorCategory = 'Hardware';
            changed = true;
          } else if (rfq.category === 'IT') {
            item.majorCategory = 'IT';
            item.minorCategory = 'Hardware';
            changed = true;
          }
        }
        item.category = item.minorCategory;
        item.confidence = 90;
        item.classificationStatus = 'KEYWORD';
        delete item.categoryMismatch;

        console.log(`  Line ${idx + 1}: ${item.itemName} -> ${item.majorCategory} / ${item.minorCategory} (${changed ? 'Fixed' : 'Kept'})`);
      });
    }

    // Set status to Quotes Pending if vendors are invited or line items are categorized
    const hasVendors = Array.isArray(rfq.assignedVendors) && rfq.assignedVendors.length > 0;
    const hasValidCategories = Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.length > 0 &&
      rfq.extractedEntities.every(e => e.majorCategory && e.minorCategory && e.minorCategory !== e.majorCategory);

    if (hasVendors || hasValidCategories) {
      rfq.status = 'Quotes Pending';
    }

    // Persist to D1
    await domainQueries.upsertRFQInDB(rfq);
    console.log(`Successfully updated ${rfq.rfqNumber} to status: "${rfq.status}".`);
  }

  console.log('\nRepair finished.');
}

repair()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Repair failed:', err);
    process.exit(1);
  });
