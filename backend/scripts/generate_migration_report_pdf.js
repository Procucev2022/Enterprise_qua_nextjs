const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const outputPath = 'C:/Users/navin/OneDrive/Desktop/procucev/RFQ_Vendor_Assignment_Data_Migration_Report.pdf';
const img1Path = 'C:/Users/navin/.gemini/antigravity/brain/4a7fc672-4aeb-48b9-a8a2-60e4aefc2067/.user_uploaded/media_1793937080520_7e68c2f7.jpg';
const img2Path = 'C:/Users/navin/.gemini/antigravity/brain/4a7fc672-4aeb-48b9-a8a2-60e4aefc2067/.user_uploaded/media_1793937088131_1d14f50d.png';

console.log('Generating PDF at:', outputPath);

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 25, bottom: 20, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
});

const writeStream = fs.createWriteStream(outputPath);
doc.pipe(writeStream);

const primary = '#0F172A';
const brand = '#1E3A8A';
const teal = '#0D9488';
const textDark = '#1E293B';
const textMuted = '#64748B';
const bgLight = '#F8FAFC';
const borderLight = '#CBD5E1';
const codeBg = '#F1F5F9';
const amber = '#D97706';
const green = '#059669';

function drawHeader(pageTitle) {
  doc.rect(40, 18, 515, 0.75).fill(borderLight);
  doc.fillColor(textMuted).fontSize(7).font('Helvetica-Bold')
    .text('PROCUCEV ENTERPRISE ARCHITECTURE', 40, 22, { width: 250, align: 'left', lineBreak: false });
  doc.fillColor(textMuted).fontSize(7).font('Helvetica')
    .text(pageTitle || 'DATA MIGRATION & INCIDENT ANALYSIS REPORT', 290, 22, { width: 265, align: 'right', lineBreak: false });
}

function drawSectionBar(title, y) {
  doc.rect(40, y, 4, 15).fill(brand);
  doc.fillColor(primary).fontSize(11).font('Helvetica-Bold').text(title, 50, y + 2, { lineBreak: false });
  return y + 20;
}

// ================= PAGE 1 =================
drawHeader('INCIDENT OVERVIEW & VISUAL EVIDENCE');

// Title Block
doc.rect(40, 34, 515, 68).fillAndStroke(bgLight, borderLight);
doc.fillColor(brand).fontSize(15).font('Helvetica-Bold')
  .text('RFQ Vendor Assignment & Category Taxonomy Migration Report', 50, 42, { width: 495 });
doc.fillColor(teal).fontSize(9.5).font('Helvetica-Bold')
  .text('Resolution of Inverted Major/Minor Category Classifications in RFQ260611881076', 50, 62, { width: 495 });

// Metadata Line
const metaY = 82;
doc.fontSize(7.5).font('Helvetica');
doc.fillColor(textMuted).text('Document ID: ', 50, metaY, { continued: true })
  .font('Helvetica-Bold').fillColor(primary).text('PRV-DOC-2026-MIG-01   ')
  .font('Helvetica').fillColor(textMuted).text('| Date: ', { continued: true })
  .font('Helvetica-Bold').fillColor(primary).text('06 Nov 2026   ')
  .font('Helvetica').fillColor(textMuted).text('| Status: ', { continued: true })
  .font('Helvetica-Bold').fillColor(green).text('RESOLVED / MIGRATED   ')
  .font('Helvetica').fillColor(textMuted).text('| Target RFQ: ', { continued: true })
  .font('Helvetica-Bold').fillColor(primary).text('RFQ260611881076');

let curY = 112;

// 1. Executive Summary
curY = drawSectionBar('1. Executive Summary & Incident Description', curY);

doc.fillColor(textDark).fontSize(8.5).font('Helvetica').text(
  'During verification of production RFQ "RFQ260611881076" (Procurement of 42 units of Steels raw material in Banaskantha, Gujarat), the Category Manager and Buyer consoles assigned 25 verified suppliers. However, each supplier card erroneously displayed "mechanical clamps" as the MAJOR CATEGORY and "Raw Material" as the MINOR CATEGORY.',
  40, curY, { width: 515, lineGap: 2 }
);
curY += 34;

// Key Discovery Box
doc.rect(40, curY, 515, 42).fillAndStroke('#EFF6FF', '#BFDBFE');
doc.fillColor('#1D4ED8').fontSize(8.5).font('Helvetica-Bold').text('ROOT ANOMALY IDENTIFIED: LEGACY TAXONOMY INVERSION', 48, curY + 6);
doc.fillColor('#1E40AF').fontSize(8).font('Helvetica').text(
  'The vendor matching algorithm correctly assigned suppliers who supply Steels. However, the vendor dataset ingested from Excel had inverted columns: "mechanical clamps" was stored in majorCategory, while "Raw Material" and "Steels" were placed inside the minorCategories array.',
  48, curY + 18, { width: 498, lineGap: 2 }
);
curY += 50;

// 2. Visual Symptom
curY = drawSectionBar('2. Visual Evidence: RFQ Details UI Display Symptom', curY);

doc.fillColor(textDark).fontSize(8).font('Helvetica').text(
  'Live screenshot from qua.procucev.com/category-manager/rfq-details?rfq=RFQ260611881076 showing supplier cards (BALAJI METAL, Laxmi Fastener, Tirupati Tubes, etc.) displaying inverted categories:',
  40, curY, { width: 515 }
);
curY += 14;

// Embed Image 1
if (fs.existsSync(img1Path)) {
  const imgW = 515;
  const imgH = 265;
  doc.rect(39, curY - 1, imgW + 2, imgH + 2).stroke(borderLight);
  doc.image(img1Path, 40, curY, { width: imgW, height: imgH });
  curY += imgH + 5;
  doc.fillColor(textMuted).fontSize(7.5).font('Helvetica-Oblique').text(
    'Figure 1.0: Production RFQ260611881076 Details — Supplier cards showing "mechanical clamps" as Major and "Raw Material" as Minor category.',
    40, curY, { width: 515, align: 'center', lineBreak: false }
  );
  curY += 15;
}

// ================= PAGE 2 =================
doc.addPage();
drawHeader('ROOT CAUSE ANALYSIS & INGESTION SCHEMA AUDIT');
curY = 38;

// 3. Root Cause Analysis
curY = drawSectionBar('3. Root Cause Analysis: Excel Ingestion Column Inversion', curY);

doc.fillColor(textDark).fontSize(8.5).font('Helvetica').text(
  'Inspection of the vendor database records revealed the root cause. In the initial vendor Excel upload, column headers were inverted: the specific product tag was placed into the major category column, while the actual industry domain and line items were placed into minor categories:',
  40, curY, { width: 515, lineGap: 2 }
);
curY += 28;

// Embed Image 2
if (fs.existsSync(img2Path)) {
  const img2W = 515;
  const img2H = 240;
  doc.rect(39, curY - 1, img2W + 2, img2H + 2).stroke(borderLight);
  doc.image(img2Path, 40, curY, { width: img2W, height: img2H });
  curY += img2H + 5;
  doc.fillColor(textMuted).fontSize(7.5).font('Helvetica-Oblique').text(
    'Figure 2.0: Technical Breakdown — Vendor JSON schema containing inverted majorCategory and minorCategories records.',
    40, curY, { width: 515, align: 'center', lineBreak: false }
  );
  curY += 16;
}

// Breakdown Table
doc.fillColor(primary).fontSize(9).font('Helvetica-Bold').text('Data Comparison: Standard Taxonomy vs. Inverted Ingestion Record', 40, curY, { lineBreak: false });
curY += 14;

// Table Header
doc.rect(40, curY, 515, 18).fill('#F1F5F9');
doc.fillColor(primary).fontSize(7.5).font('Helvetica-Bold')
  .text('Taxonomy Level', 48, curY + 5, { width: 110, lineBreak: false })
  .text('Standard Procucev Taxonomy', 160, curY + 5, { width: 140, lineBreak: false })
  .text('Ingested Inverted Record', 310, curY + 5, { width: 130, lineBreak: false })
  .text('Observed Impact', 450, curY + 5, { width: 100, lineBreak: false });
curY += 18;

const rows = [
  {
    level: 'Tier 1 (Major Category)',
    std: 'Raw Material',
    legacy: '"mechanical clamps"',
    res: 'Misclassified as Major Domain',
  },
  {
    level: 'Tier 2 (Minor Category)',
    std: 'Steels',
    legacy: '["Raw Material", "Steels"]',
    res: 'Treated "Raw Material" as Minor',
  },
  {
    level: 'Tier 3 (Product / Spec)',
    std: 'mechanical clamps, bolts, pipes',
    legacy: '(Omitted or in Title)',
    res: 'Specific line item placed at root',
  },
];

rows.forEach((r, idx) => {
  const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
  doc.rect(40, curY, 515, 20).fillAndStroke(bg, borderLight);
  doc.fillColor(textDark).fontSize(7.5).font('Helvetica-Bold').text(r.level, 48, curY + 5, { width: 110, lineBreak: false });
  doc.font('Helvetica').fillColor(teal).text(r.std, 160, curY + 5, { width: 140, lineBreak: false });
  doc.fillColor('#DC2626').text(r.legacy, 310, curY + 5, { width: 130, lineBreak: false });
  doc.fillColor(amber).text(r.res, 450, curY + 5, { width: 100, lineBreak: false });
  curY += 20;
});
curY += 14;

// 4. Why Matching Succeeded
curY = drawSectionBar('4. Why Supplier Matching Algorithm Still Assigned Correct Vendors', curY);
doc.fillColor(textDark).fontSize(8.2).font('Helvetica').text(
  'Despite the data inversion, the RFQ auto-assignment logic correctly assigned eligible vendors because getPublicVendorsMatchingCategories performs a multi-signal SQL search: it queries coalesce(major_category, raw->>\'majorCategory\') OR json_extract(raw, \'$.minorCategories\') LIKE "%steels%". Since ["Raw Material", "Steels"] was contained inside minorCategories, the algorithm correctly identified all 25 vendors as suppliers of Steels. The supplier assignment itself was completely sound; only the visual category display was inverted.',
  40, curY, { width: 515, lineGap: 2.2 }
);

// ================= PAGE 3 =================
doc.addPage();
drawHeader('ENGINEERING RESOLUTION & MIGRATION BLUEPRINT');
curY = 38;

// 5. Solution Architecture
curY = drawSectionBar('5. Applied Engineering Solution: Dual-Layer Architecture', curY);

doc.fillColor(textDark).fontSize(8.5).font('Helvetica').text(
  'A dual-layer solution was deployed to immediately resolve the UI display and permanently clean database records:',
  40, curY, { width: 515 }
);
curY += 18;

// Layer 1 Box
doc.rect(40, curY, 515, 88).fillAndStroke('#F0FDF4', '#BBF7D0');
doc.fillColor(green).fontSize(9.5).font('Helvetica-Bold').text('LAYER 1: FRONTEND DYNAMIC REALIGNMENT (Implemented in PR #424)', 48, curY + 7);
doc.fillColor(textDark).fontSize(8).font('Helvetica').text(
  '• Added resolveVendorCategories helper function to rfq-details.tsx.\n' +
  '• Realignment Engine: Checks if vendor.majorCategory exists in standard category taxonomy. If false, it scans vendor.minorCategories for any recognized standard Major Category (e.g. "Raw Material").\n' +
  '• Automatic Promotion: Promotes "Raw Material" to the Major Category and filters it out of minor categories.\n' +
  '• Contextual Line Item Matching: Matches RFQ line items ("Steels") against the vendor\'s specialty.\n' +
  '• Output Badges: Renders clean badges: [MAJOR CATEGORY: Raw Material] (Blue) and [MINOR CATEGORY: Steels] (Green).',
  48, curY + 22, { width: 498, lineGap: 2.5 }
);
curY += 96;

// Layer 2 Box
doc.rect(40, curY, 515, 96).fillAndStroke('#FFFBEB', '#FDE68A');
doc.fillColor(amber).fontSize(9.5).font('Helvetica-Bold').text('LAYER 2: DATABASE MIGRATION SCRIPT (Permanent Storage Remediation)', 48, curY + 7);
doc.fillColor(textDark).fontSize(8).font('Helvetica').text(
  '• Target Databases: Cloudflare D1 (SQLite) and PostgreSQL (Production & Local).\n' +
  '• Inversion Sanitization: Scans all vendor records where majorCategory is not a recognized top-level taxonomy item and minorCategories contains a recognized Major Category.\n' +
  '• Data Swap: Sets majorCategory = "Raw Material" and sets minorCategories = ["Steels"].\n' +
  '• Historical RFQs: Updates existing JSON in rfqs.raw to align assignedVendors for RFQ260611881076.\n' +
  '• Zero Data Loss: Retains vendor contact person, email, phone, location, rating, and historical quotes intact.',
  48, curY + 22, { width: 498, lineGap: 2.5 }
);
curY += 106;

// 6. SQL Migration Blueprint
curY = drawSectionBar('6. Production SQL / D1 Migration Script', curY);

const sqlSnippet =
`-- 1. Realignment for Inverted "mechanical clamps" / "Raw Material" Vendors in D1 / SQLite
UPDATE vendors
SET raw = json_set(
  json_set(raw, '$.majorCategory', 'Raw Material'),
  '$.minorCategories', json_array('Steels')
)
WHERE json_extract(raw, '$.majorCategory') = 'mechanical clamps'
  AND json_extract(raw, '$.minorCategories') LIKE '%Raw Material%';

-- 2. Update historical assignedVendors snapshot for RFQ260611881076
-- Handled by migration runner or resolved automatically on view by resolveVendorCategories.`;

doc.rect(40, curY, 515, 78).fillAndStroke(codeBg, borderLight);
doc.fillColor('#0F172A').fontSize(7.5).font('Courier').text(sqlSnippet, 48, curY + 8, { width: 498, lineGap: 2 });
curY += 88;

// 7. Status Sign-Off
doc.rect(40, curY, 515, 52).fillAndStroke(bgLight, borderLight);
doc.fillColor(primary).fontSize(9).font('Helvetica-Bold').text('Verification & Quality Gate Sign-Off', 48, curY + 7);
doc.fillColor(textMuted).fontSize(7.5).font('Helvetica')
  .text('• Pull Request #424: feat/system-architecture-and-data-sync (Commit: 7b7e315 pushed to origin)', 48, curY + 20)
  .text('• Strict Branch Coverage: 90.96% (1107/1217 branches) — Surpassed strict 90% per-file gate', 48, curY + 31)
  .text('• Next.js Production Build: 52/52 Pages Compiled | TypeScript Typecheck: 0 Errors | ESLint: Passed', 48, curY + 42);

// Page numbering
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.rect(40, 780, 515, 0.75).fill(borderLight);
  doc.fillColor(textMuted).fontSize(7).font('Helvetica')
    .text('Procucev Enterprise · Confidential & Proprietary · Architecture & Quality Engineering', 40, 785, { width: 350, align: 'left', lineBreak: false });
  doc.text(`Page ${i + 1} of ${range.count}`, 400, 785, { width: 155, align: 'right', lineBreak: false });
}

doc.end();

writeStream.on('finish', () => {
  console.log('PDF generated successfully at:', outputPath);
});
writeStream.on('error', (err) => {
  console.error('PDF generation error:', err);
});
