const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Manually parse .env
const envPath = path.join(__dirname, '..', '.env');
let connectionString = process.env.DATABASE_URL || '';
if (!connectionString && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      connectionString = trimmed.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
    }
  }
}

if (!connectionString) {
  console.error('❌ No DATABASE_URL found in environment or .env file.');
  process.exit(1);
}

console.log('Connecting to PostgreSQL database:', connectionString.replace(/:[^:@]+@/, ':***@'));

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    // 1. Run DDL Schema
    console.log('\n--- 1. Executing Schema DDL ---');
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
    await pool.query(schemaSql);
    console.log('✅ Schema migration executed successfully.');

    // 2. Check if buyer_accounts exists and count
    const buyerCountRes = await pool.query('SELECT count(*)::int as count FROM buyer_accounts');
    const buyerCount = buyerCountRes.rows[0].count;

    console.log(`\n--- 2. Database Population Check (Existing Buyers: ${buyerCount}) ---`);

    if (buyerCount === 0) {
      console.log('Seeding initial baseline data into PostgreSQL...');

      // Seed Buyer Accounts
      await pool.query(`
        INSERT INTO buyer_accounts (
          id, organization_name, corporate_email, contact_person, contact_phone,
          industry_vertical, account_source, subscription, sourcing_mode, status,
          gstin, primary_plant_location, supported_major_categories, supported_minor_categories,
          remaining_free_rfqs, total_rfqs_created, total_spend, is_verified, created_date
        ) VALUES 
        (
          'buyer-acc-101', 'Tata Motors Commercial Vehicles Ltd.', 'sourcing.commercial@tatamotors.com',
          'Vikram Malhotra', '+91 98201 55431', 'Automotive & Heavy Commercial Vehicles', 'public_system',
          'free_trial', 'mode_1', 'ACTIVE_VERIFIED', '27AAACT2727Q1ZW', 'Pimpri-Chinchwad, Pune, Maharashtra',
          '["Engineering Spares - Mechanical", "Engineering Spares - Electrical", "Customized Machining Parts"]'::jsonb,
          '["Pumps & Accessories", "Valves & Actuators", "Hydraulic Cylinders", "Industrial Fasteners"]'::jsonb,
          5, 8, '$4,280,000', true, '2026-01-15'
        ),
        (
          'buyer-acc-102', 'Larsen & Toubro Heavy Engineering Division', 'procurement.heavyeng@larsentoubro.com',
          'Anita Deshmukh', '+91 98402 11984', 'Heavy Infrastructure & Industrial Machinery', 'public_system',
          'free_trial', 'mode_2', 'ACTIVE_VERIFIED', '24AAACL0149K1ZQ', 'Hazira Manufacturing Complex, Surat, Gujarat',
          '["Engineering Spares - Mechanical", "Structural Fabrication & Heavy Steel", "Raw Materials & Metals"]'::jsonb,
          '["High-Pressure Piping", "Flanges & Forgings", "Pressure Vessels Spares", "CNC Machined Castings"]'::jsonb,
          5, 14, '$11,650,000', true, '2026-02-01'
        ),
        (
          'buyer-acc-103', 'JSW Steel Energy & Industrial Infrastructure', 'direct.procurement@jswsteel.in',
          'Suresh Kulkarni', '+91 98110 77209', 'Metals, Mining & Thermal Utilities', 'public_system',
          'version_1', 'mode_1', 'ACTIVE_VERIFIED', '29AAACJ4321F1ZM', 'Vijayanagar Plant, Ballari, Karnataka',
          '["Engineering Spares - Mechanical", "Raw Materials & Metals", "Pipes, Valves & Flow Control"]'::jsonb,
          '["Slag Handling Spares", "Refractory Linings", "High Temperature Valves", "Heavy Conveyor Belting"]'::jsonb,
          0, 22, '$18,400,000', true, '2026-02-18'
        ),
        (
          'buyer-acc-104', 'Mahindra & Mahindra Farm Equipment Division', 'supplier.desk@mahindra.com',
          'Pooja Hegde', '+91 97654 32100', 'Automotive & Agricultural Machinery', 'public_system',
          'version_2', 'mode_2', 'ACTIVE_VERIFIED', '27AAACM1234H1Z1', 'Kandivali Industrial Area, Mumbai, Maharashtra',
          '["Engineering Spares - Mechanical", "Customized Machining Parts", "Electrical Drives & Motors"]'::jsonb,
          '["Tractor Hydraulics", "Cast Iron Housings", "Forged Gears & Shafts", "Three-Phase Induction Motors"]'::jsonb,
          0, 19, '$7,920,000', true, '2026-03-02'
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed Vendors
      await pool.query(`
        INSERT INTO vendors (
          id, name, contact_person, email, phone, major_category, minor_categories,
          location, rating, score, source, status, evaluated, has_record, match_reason,
          proximity, proximity_match, is_existing_in_database, onboarding_email_status,
          temp_password, first_login_completed, reminder_cadence, added_by_buyer_company,
          client_mapped_categories, vendor_selected_categories, is_category_aligned
        ) VALUES
        (
          'v-001', 'Apex Industrial Dynamics Pvt Ltd', 'Rajesh Nair', 'rajesh@apexindustrial.in', '+91 98201 44820',
          'Engineering Spares - Mechanical', '["Pumps & Accessories", "Compressors & Accessories", "Machinery Parts"]'::jsonb,
          'Bhosari Industrial Estate, Pune, Maharashtra', 4.8, 92.4, 'buyer_uploaded', 'PREFERRED ENTERPRISE SUPPLIER',
          true, true, 'Empanelled Tier-1 Vendor with 100% Quality Conformance', 'Local (within 50km)', true, true,
          'sent', 'Procucev#2026!Apex', true, 'every_3_days', 'Tata Motors Commercial Vehicles Ltd.',
          '["Pumps & Accessories", "Compressors & Accessories"]'::jsonb,
          '["Pumps & Accessories", "Compressors & Accessories", "Machinery Parts"]'::jsonb, true
        ),
        (
          'v-002', 'Precision Hydro-Pneumatics Ltd', 'Sanjay Verma', 'sanjay@precisionhydro.com', '+91 98112 33455',
          'Engineering Spares - Mechanical', '["Hoses, Valves & Fittings", "Pipes & Pipe Fittings"]'::jsonb,
          'Peenya Industrial Area, Bengaluru, Karnataka', 4.6, 88.5, 'buyer_uploaded', 'PREFERRED ENTERPRISE SUPPLIER',
          true, true, 'ISO 9001:2015 & IATF 16949 Certified Hydraulics Fabricator', 'Regional (South Hub)', false, true,
          'sent', 'Procucev#2026!Hydro', true, 'every_3_days', 'Larsen & Toubro Heavy Engineering Division',
          '["Hoses, Valves & Fittings"]'::jsonb,
          '["Hoses, Valves & Fittings", "Pipes & Pipe Fittings"]'::jsonb, true
        ),
        (
          'v-003', 'Bharat Electricals & Switchgear Corp', 'Anil Mehta', 'anil.mehta@bharatelec.in', '+91 98450 67890',
          'Engineering Spares - Electrical', '["Panels", "Circuit Breakers", "Transformers"]'::jsonb,
          'Sanand Industrial Hub, Ahmedabad, Gujarat', 4.9, 95.0, 'procucev_network', 'PREFERRED ENTERPRISE SUPPLIER',
          true, true, 'Double-Blind AI Network Match with CPRI Type-Tested Switchgear', 'Regional (West Hub)', false, true,
          'sent', 'Procucev#2026!Bharat', true, 'every_3_days', 'Tata Motors Commercial Vehicles Ltd.',
          '["Panels", "Circuit Breakers"]'::jsonb,
          '["Panels", "Circuit Breakers", "Transformers"]'::jsonb, true
        ),
        (
          'v-004', 'Kirloskar Flow Technologies Ltd', 'Vikram Joshi', 'vikram.joshi@kirloskarflow.com', '+91 98220 11223',
          'Engineering Spares - Mechanical', '["Pumps & Accessories", "Motors", "Customised Parts"]'::jsonb,
          'Kirloskarvadi, Sangli, Maharashtra', 4.7, 91.2, 'buyer_uploaded', 'PREFERRED ENTERPRISE SUPPLIER',
          true, true, 'Empanelled Heavy Duty Slurry & Boiler Feed Pump Specialist', 'Regional (Maharashtra)', true, true,
          'sent', 'Procucev#2026!Kirloskar', true, 'every_3_days', 'JSW Steel Energy & Industrial Infrastructure',
          '["Pumps & Accessories", "Motors"]'::jsonb,
          '["Pumps & Accessories", "Motors", "Customised Parts"]'::jsonb, true
        ),
        (
          'v-005', 'Godrej Precision Tooling & Dies', 'Meera Rao', 'meera.rao@godrejtooling.com', '+91 98670 99881',
          'Customized Machining Parts', '["CNC Machined Castings", "Forged Gears & Shafts", "Precision Fixtures"]'::jsonb,
          'Vikhroli, Mumbai, Maharashtra', 4.8, 93.8, 'procucev_network', 'PREFERRED ENTERPRISE SUPPLIER',
          true, true, 'Aerospace & Heavy Commercial Grade 5-Axis CNC Facility', 'Local (Mumbai Hub)', true, true,
          'sent', 'Procucev#2026!Godrej', true, 'every_3_days', 'Mahindra & Mahindra Farm Equipment Division',
          '["CNC Machined Castings", "Precision Fixtures"]'::jsonb,
          '["CNC Machined Castings", "Forged Gears & Shafts", "Precision Fixtures"]'::jsonb, true
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed RFQs
      await pool.query(`
        INSERT INTO rfqs (
          id, rfq_number, title, category, created_at, deadline, status,
          sourcing_mode, quotes_count, chasing_active, quotes, line_items, follow_up_data
        ) VALUES
        (
          'rfq-001', 'RFQ-2026-0891', 'Supply of High-Pressure Hydraulic Pump Spares & Impellers',
          'Engineering Spares - Mechanical', '2026-08-25 10:30 UTC', '2026-09-05', 'In Evaluation',
          'mode_1', 3, true,
          '[
            {
              "vendorId": "v-001", "vendorName": "Apex Industrial Dynamics Pvt Ltd", "vendorCategory": "Client List",
              "unitPrice": 4250, "totalPrice": 425000, "leadTimeDays": 14, "aiMatchScore": 96, "isBestPrice": true,
              "isPreferred": true, "warrantyYears": 2, "complianceStatus": "Fully Compliant",
              "paymentTerms": "45 Days Net", "remarks": "OEM equivalent specs with test certs"
            },
            {
              "vendorId": "v-004", "vendorName": "Kirloskar Flow Technologies Ltd", "vendorCategory": "Client List",
              "unitPrice": 4480, "totalPrice": 448000, "leadTimeDays": 10, "aiMatchScore": 94, "isBestPrice": false,
              "isPreferred": true, "warrantyYears": 3, "complianceStatus": "Fully Compliant",
              "paymentTerms": "30 Days Net", "remarks": "Direct OEM manufacturer supply"
            }
          ]'::jsonb,
          '[
            {
              "id": "ent-1", "itemName": "High-Pressure Hydraulic Pump Spares", "quantity": 100, "unit": "Units",
              "targetDate": "2026-09-05", "technicalSpecs": "ANSI/DIN Standard, SS316 Impeller with NBR Seals",
              "confidence": 98.5, "category": "Engineering Spares - Mechanical", "majorCategory": "Engineering Spares - Mechanical",
              "minorCategory": "Pumps & Accessories"
            }
          ]'::jsonb,
          '{
            "rfqNumber": "RFQ-2026-0891", "totalInvited": 4, "respondedCount": 3,
            "callStats": { "total": 4, "connected": 3, "avgDuration": "2m 15s" },
            "whatsappStats": { "total": 4, "delivered": 4, "read": 4, "replied": 3 },
            "smsStats": { "total": 4, "delivered": 4, "clicked": 3 },
            "autoChasingEnabled": true, "vendors": []
          }'::jsonb
        ),
        (
          'rfq-002', 'RFQ-2026-0892', 'Procurement of 11kV Vacuum Circuit Breakers & Switchgear Panels',
          'Engineering Spares - Electrical', '2026-08-27 14:00 UTC', '2026-09-10', 'AI Recommended',
          'mode_2', 4, true,
          '[
            {
              "vendorId": "v-003", "vendorName": "Bharat Electricals & Switchgear Corp", "vendorCategory": "Procucev Network",
              "unitPrice": 125000, "totalPrice": 750000, "leadTimeDays": 21, "aiMatchScore": 98, "isBestPrice": true,
              "isPreferred": false, "warrantyYears": 2, "complianceStatus": "Fully Compliant",
              "paymentTerms": "30 Days Net", "remarks": "CPRI Type-Tested 11kV VCB Panel"
            }
          ]'::jsonb,
          '[
            {
              "id": "ent-2", "itemName": "11kV Vacuum Circuit Breakers", "quantity": 6, "unit": "Sets",
              "targetDate": "2026-09-10", "technicalSpecs": "11kV, 1250A, 25kA for 3 sec, Motor Operated spring charging",
              "confidence": 99.0, "category": "Engineering Spares - Electrical", "majorCategory": "Engineering Spares - Electrical",
              "minorCategory": "Circuit Breakers"
            }
          ]'::jsonb,
          '{
            "rfqNumber": "RFQ-2026-0892", "totalInvited": 5, "respondedCount": 4,
            "callStats": { "total": 5, "connected": 4, "avgDuration": "1m 45s" },
            "whatsappStats": { "total": 5, "delivered": 5, "read": 4, "replied": 4 },
            "smsStats": { "total": 5, "delivered": 5, "clicked": 4 },
            "autoChasingEnabled": true, "vendors": []
          }'::jsonb
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed 360 Evaluations
      await pool.query(`
        INSERT INTO vendor_evaluations (
          id, vendor_id, vendor_name, contact_person, email, phone, category,
          submission_date, status, overall_score, system_action, module_scores, documents
        ) VALUES
        (
          'eval-001', 'v-001', 'Apex Industrial Dynamics Pvt Ltd', 'Rajesh Nair', 'rajesh@apexindustrial.in', '+91 98201 44820',
          'Engineering Spares - Mechanical', '2026-08-20', 'PREFERRED ENTERPRISE SUPPLIER', 92.4,
          'Full Qualification Approved - Circulate High-Value RFQs with Automated PO Issuance',
          '{
            "commercial": { "score": 95, "maxScore": 100, "weight": 25, "weightedScore": 23.75 },
            "technical": { "score": 90, "maxScore": 100, "weight": 15, "weightedScore": 13.5 },
            "quality": { "score": 94, "maxScore": 100, "weight": 20, "weightedScore": 18.8 },
            "delivery": { "score": 92, "maxScore": 100, "weight": 20, "weightedScore": 18.4 },
            "financial": { "score": 88, "maxScore": 100, "weight": 10, "weightedScore": 8.8 },
            "governance": { "score": 92, "maxScore": 100, "weight": 10, "weightedScore": 9.2 }
          }'::jsonb,
          '[
            { "id": "doc-1", "name": "GST_Registration_Certificate.pdf", "type": "Statutory Tax", "uploadDate": "2026-08-20", "verified": true, "status": "Verified" },
            { "id": "doc-2", "name": "ISO_9001_2015_Certificate.pdf", "type": "Quality Assurance", "uploadDate": "2026-08-20", "verified": true, "status": "Verified" }
          ]'::jsonb
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed Audit Logs
      await pool.query(`
        INSERT INTO audit_logs (id, timestamp, user_email, action, rfq_number, sha_signature, status) VALUES
        (
          'log-001', '2026-08-29 10:15:00 UTC', 'vikram.malhotra@tatamotors.com',
          'Created RFQ-2026-0891 under Version 1 Sourcing Mode with 4 empanelled suppliers',
          'RFQ-2026-0891', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'TAMPER_CHECK_OK'
        ),
        (
          'log-002', '2026-08-29 11:30:00 UTC', 'anita.deshmukh@larsentoubro.com',
          'Approved Version 2 Hybrid circulation for RFQ-2026-0892 expanding to verified network partners',
          'RFQ-2026-0892', '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069', 'TAMPER_CHECK_OK'
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed AI Bot Feed
      await pool.query(`
        INSERT INTO ai_bot_feed (id, timestamp, time_ago, type, channel, title, message, recipient, rfq_number, status) VALUES
        (
          'feed-001', '2026-08-29 11:45:00 UTC', '5m ago', 'call', 'call',
          'Autonomous Voice AI Call Connected', 'AI Chaser Bot engaged Rajesh Nair at Apex Industrial. Confirmed RFQ-2026-0891 bid submission by today 4:00 PM.',
          'Rajesh Nair (+91 98201 44820)', 'RFQ-2026-0891', 'completed'
        ),
        (
          'feed-002', '2026-08-29 11:30:00 UTC', '20m ago', 'whatsapp', 'whatsapp',
          'WhatsApp Interactive RFQ Dispatched', 'Interactive quotation link delivered with 256-bit authentication token to Anil Mehta (+91 98450 67890).',
          'Anil Mehta (Bharat Electricals)', 'RFQ-2026-0892', 'read'
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      console.log('✅ Baseline data seeded directly into PostgreSQL tables.');
    }

    // 3. Final Verification Count
    console.log('\n--- 3. Live PostgreSQL Table Verification ---');
    const tables = ['buyer_accounts', 'vendors', 'rfqs', 'vendor_evaluations', 'audit_logs', 'ai_bot_feed'];
    for (const tbl of tables) {
      const r = await pool.query(`SELECT count(*)::int as count FROM ${tbl}`);
      console.log(`📊 Table [${tbl}]: ${r.rows[0].count} rows`);
    }

    console.log('\n🎉 PostgreSQL Database is fully initialized and operational!\n');
    await pool.end();
  } catch (err) {
    console.error('❌ Error during PostgreSQL database bootstrap:', err);
    process.exit(1);
  }
}

main();
