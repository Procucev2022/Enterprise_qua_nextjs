const { pool, initializeSchema } = require('./pool');
const {
  upsertBuyerAccountInDB,
  upsertVendorInDB,
  upsertRFQInDB,
  upsertEvaluationInDB,
  insertAuditLogInDB,
  upsertSystemConfigInDB,
} = require('./queries');
const { INITIAL_SYSTEM_CONFIG } = require('../config/constants');

const SEED_BUYER_ACCOUNTS = [
  {
    id: 'buyer-acc-101',
    organizationName: 'Tata Motors Commercial Vehicles Ltd.',
    corporateEmail: 'sourcing.commercial@tatamotors.com',
    contactPerson: 'Vikram Malhotra',
    mobileNumber: '+91 98201 55431',
    industrySector: 'Automotive & Heavy Commercial Vehicles',
    accountSource: 'public_system',
    subscriptionPlan: 'free_trial',
    sourcingMode: 'mode_1',
    status: 'ACTIVE_VERIFIED',
    gstin: '27AAACT2727Q1ZW',
    primaryPlantLocation: 'Pimpri-Chinchwad, Pune, Maharashtra',
    supportedMajorCategories: ['Engineering Spares - Mechanical', 'Engineering Spares - Electrical', 'Customized Machining Parts'],
    supportedMinorCategories: ['Pumps & Accessories', 'Valves & Actuators', 'Hydraulic Cylinders', 'Industrial Fasteners'],
    remainingFreeRFQs: 5,
    totalRFQsCreated: 8,
    totalSpend: '$4,280,000',
    createdDate: '2026-01-15',
    syncTimestamp: '2026-08-29 10:00 UTC',
  },
  {
    id: 'buyer-acc-102',
    organizationName: 'Larsen & Toubro Heavy Engineering Division',
    corporateEmail: 'procurement.heavyeng@larsentoubro.com',
    contactPerson: 'Anita Deshmukh',
    mobileNumber: '+91 98402 11984',
    industrySector: 'Heavy Infrastructure & Industrial Machinery',
    accountSource: 'public_system',
    subscriptionPlan: 'free_trial',
    sourcingMode: 'mode_2',
    status: 'ACTIVE_VERIFIED',
    gstin: '24AAACL0149K1ZQ',
    primaryPlantLocation: 'Hazira Manufacturing Complex, Surat, Gujarat',
    supportedMajorCategories: ['Engineering Spares - Mechanical', 'Structural Fabrication & Heavy Steel', 'Raw Materials & Metals'],
    supportedMinorCategories: ['High-Pressure Piping', 'Flanges & Forgings', 'Pressure Vessels Spares', 'CNC Machined Castings'],
    remainingFreeRFQs: 5,
    totalRFQsCreated: 14,
    totalSpend: '$11,650,000',
    createdDate: '2026-02-01',
    syncTimestamp: '2026-08-29 10:00 UTC',
  },
  {
    id: 'buyer-acc-103',
    organizationName: 'JSW Steel Energy & Industrial Infrastructure',
    corporateEmail: 'direct.procurement@jswsteel.in',
    contactPerson: 'Suresh Kulkarni',
    mobileNumber: '+91 98110 77209',
    industrySector: 'Metals, Mining & Thermal Utilities',
    accountSource: 'public_system',
    subscriptionPlan: 'version_1',
    sourcingMode: 'mode_1',
    status: 'ACTIVE_VERIFIED',
    gstin: '29AAACJ4321F1ZM',
    primaryPlantLocation: 'Vijayanagar Plant, Ballari, Karnataka',
    supportedMajorCategories: ['Engineering Spares - Mechanical', 'Raw Materials & Metals', 'Pipes, Valves & Flow Control'],
    supportedMinorCategories: ['Slag Handling Spares', 'Refractory Linings', 'High Temperature Valves', 'Heavy Conveyor Belting'],
    remainingFreeRFQs: 0,
    totalRFQsCreated: 22,
    totalSpend: '$18,400,000',
    createdDate: '2026-02-18',
    syncTimestamp: '2026-08-29 10:00 UTC',
  },
  {
    id: 'buyer-acc-104',
    organizationName: 'Mahindra & Mahindra Farm Equipment Division',
    corporateEmail: 'supplier.desk@mahindra.com',
    contactPerson: 'Pooja Hegde',
    mobileNumber: '+91 97654 32100',
    industrySector: 'Automotive & Agricultural Machinery',
    accountSource: 'public_system',
    subscriptionPlan: 'version_2',
    sourcingMode: 'mode_2',
    status: 'ACTIVE_VERIFIED',
    gstin: '27AAACM1234H1Z1',
    primaryPlantLocation: 'Kandivali Industrial Area, Mumbai, Maharashtra',
    supportedMajorCategories: ['Engineering Spares - Mechanical', 'Customized Machining Parts', 'Electrical Drives & Motors'],
    supportedMinorCategories: ['Tractor Hydraulics', 'Cast Iron Housings', 'Forged Gears & Shafts', 'Three-Phase Induction Motors'],
    remainingFreeRFQs: 0,
    totalRFQsCreated: 19,
    totalSpend: '$7,920,000',
    createdDate: '2026-03-02',
    syncTimestamp: '2026-08-29 10:00 UTC',
  },
];

const SEED_VENDORS = [
  {
    id: 'v-001',
    name: 'Apex Industrial Dynamics Pvt Ltd',
    contactPerson: 'Rajesh Nair',
    email: 'rajesh@apexindustrial.in',
    phone: '+91 98201 44820',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories', 'Compressors & Accessories', 'Machinery Parts'],
    location: 'Bhosari Industrial Estate, Pune, Maharashtra',
    rating: 4.8,
    score: 92.4,
    source: 'buyer_uploaded',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    evaluated: true,
    hasRecord: true,
    matchReason: 'Empanelled Tier-1 Vendor with 100% Quality Conformance',
    proximity: 'Local (within 50km)',
    proximityMatch: true,
    isExistingInDatabase: true,
    onboardingEmailStatus: 'sent',
    tempPassword: 'Procucev#2026!Apex',
    firstLoginCompleted: true,
    reminderCadence: 'every_3_days',
    addedByBuyerCompany: 'Tata Motors Commercial Vehicles Ltd.',
    clientMappedCategories: ['Pumps & Accessories', 'Compressors & Accessories'],
    vendorSelectedCategories: ['Pumps & Accessories', 'Compressors & Accessories', 'Machinery Parts'],
    isCategoryAligned: true,
  },
  {
    id: 'v-002',
    name: 'Precision Hydro-Pneumatics Ltd',
    contactPerson: 'Sanjay Verma',
    email: 'sanjay@precisionhydro.com',
    phone: '+91 98112 33455',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Hoses, Valves & Fittings', 'Pipes & Pipe Fittings'],
    location: 'Peenya Industrial Area, Bengaluru, Karnataka',
    rating: 4.6,
    score: 88.5,
    source: 'buyer_uploaded',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    evaluated: true,
    hasRecord: true,
    matchReason: 'ISO 9001:2015 & IATF 16949 Certified Hydraulics Fabricator',
    proximity: 'Regional (South Hub)',
    proximityMatch: false,
    isExistingInDatabase: true,
    onboardingEmailStatus: 'sent',
    tempPassword: 'Procucev#2026!Hydro',
    firstLoginCompleted: true,
    reminderCadence: 'every_3_days',
    addedByBuyerCompany: 'Larsen & Toubro Heavy Engineering Division',
    clientMappedCategories: ['Hoses, Valves & Fittings'],
    vendorSelectedCategories: ['Hoses, Valves & Fittings', 'Pipes & Pipe Fittings'],
    isCategoryAligned: true,
  },
  {
    id: 'v-003',
    name: 'Bharat Electricals & Switchgear Corp',
    contactPerson: 'Anil Mehta',
    email: 'anil.mehta@bharatelec.in',
    phone: '+91 98450 67890',
    majorCategory: 'Engineering Spares - Electrical',
    minorCategories: ['Panels', 'Circuit Breakers', 'Transformers'],
    location: 'Sanand Industrial Hub, Ahmedabad, Gujarat',
    rating: 4.9,
    score: 95.0,
    source: 'procucev_network',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    evaluated: true,
    hasRecord: true,
    matchReason: 'Double-Blind AI Network Match with CPRI Type-Tested Switchgear',
    proximity: 'Regional (West Hub)',
    proximityMatch: false,
    isExistingInDatabase: true,
    onboardingEmailStatus: 'sent',
    tempPassword: 'Procucev#2026!Bharat',
    firstLoginCompleted: true,
    reminderCadence: 'every_3_days',
    addedByBuyerCompany: 'Tata Motors Commercial Vehicles Ltd.',
    clientMappedCategories: ['Panels', 'Circuit Breakers'],
    vendorSelectedCategories: ['Panels', 'Circuit Breakers', 'Transformers'],
    isCategoryAligned: true,
  },
  {
    id: 'v-004',
    name: 'Kirloskar Flow Technologies Ltd',
    contactPerson: 'Vikram Joshi',
    email: 'vikram.joshi@kirloskarflow.com',
    phone: '+91 98220 11223',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories', 'Motors', 'Customised Parts'],
    location: 'Kirloskarvadi, Sangli, Maharashtra',
    rating: 4.7,
    score: 91.2,
    source: 'buyer_uploaded',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    evaluated: true,
    hasRecord: true,
    matchReason: 'Empanelled Heavy Duty Slurry & Boiler Feed Pump Specialist',
    proximity: 'Regional (Maharashtra)',
    proximityMatch: true,
    isExistingInDatabase: true,
    onboardingEmailStatus: 'sent',
    tempPassword: 'Procucev#2026!Kirloskar',
    firstLoginCompleted: true,
    reminderCadence: 'every_3_days',
    addedByBuyerCompany: 'JSW Steel Energy & Industrial Infrastructure',
    clientMappedCategories: ['Pumps & Accessories', 'Motors'],
    vendorSelectedCategories: ['Pumps & Accessories', 'Motors', 'Customised Parts'],
    isCategoryAligned: true,
  },
  {
    id: 'v-005',
    name: 'Godrej Precision Tooling & Dies',
    contactPerson: 'Meera Rao',
    email: 'meera.rao@godrejtooling.com',
    phone: '+91 98670 99881',
    majorCategory: 'Customized Machining Parts',
    minorCategories: ['CNC Machined Castings', 'Forged Gears & Shafts', 'Precision Fixtures'],
    location: 'Vikhroli, Mumbai, Maharashtra',
    rating: 4.8,
    score: 93.8,
    source: 'procucev_network',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    evaluated: true,
    hasRecord: true,
    matchReason: 'Aerospace & Heavy Commercial Grade 5-Axis CNC Facility',
    proximity: 'Local (Mumbai Hub)',
    proximityMatch: true,
    isExistingInDatabase: true,
    onboardingEmailStatus: 'sent',
    tempPassword: 'Procucev#2026!Godrej',
    firstLoginCompleted: true,
    reminderCadence: 'every_3_days',
    addedByBuyerCompany: 'Mahindra & Mahindra Farm Equipment Division',
    clientMappedCategories: ['CNC Machined Castings', 'Precision Fixtures'],
    vendorSelectedCategories: ['CNC Machined Castings', 'Forged Gears & Shafts', 'Precision Fixtures'],
    isCategoryAligned: true,
  },
];

const SEED_RFQS = [
  {
    id: 'rfq-001',
    rfqNumber: 'RFQ-2026-0891',
    title: 'Supply of High-Pressure Hydraulic Pump Spares & Impellers',
    category: 'Engineering Spares - Mechanical',
    createdAt: '2026-08-25 10:30 UTC',
    deadline: '2026-09-05',
    status: 'In Evaluation',
    sourcingMode: 'mode_1',
    quotesCount: 2,
    chasingActive: true,
    allocatedTime: '24 hrs',
    elapsedTime: '18 hrs',
    targetSavings: '15.4%',
    quotes: [
      {
        vendorId: 'v-001',
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        vendorCategory: 'Client List',
        unitPrice: 4250,
        totalPrice: 425000,
        leadTimeDays: 14,
        aiMatchScore: 96,
        isBestPrice: true,
        isPreferred: true,
        warrantyYears: 2,
        complianceStatus: 'Fully Compliant',
        paymentTerms: '45 Days Net',
        remarks: 'OEM equivalent specs with material test certificates',
      },
      {
        vendorId: 'v-004',
        vendorName: 'Kirloskar Flow Technologies Ltd',
        vendorCategory: 'Client List',
        unitPrice: 4480,
        totalPrice: 448000,
        leadTimeDays: 10,
        aiMatchScore: 94,
        isBestPrice: false,
        isPreferred: true,
        warrantyYears: 3,
        complianceStatus: 'Fully Compliant',
        paymentTerms: '30 Days Net',
        remarks: 'Direct OEM manufacturer supply with factory hydrostatic test',
      },
    ],
    lineItems: [
      {
        id: 'ent-1',
        itemName: 'High-Pressure Hydraulic Pump Spares (Impellers & Shaft Seals)',
        quantity: 100,
        unit: 'Units',
        targetDate: '2026-09-05',
        technicalSpecs: 'ANSI/DIN Standard, SS316 Impeller with NBR Double Mechanical Seals',
        confidence: 98.5,
        category: 'Engineering Spares - Mechanical',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Pumps & Accessories',
      },
    ],
    followUpData: {
      rfqNumber: 'RFQ-2026-0891',
      totalInvited: 4,
      respondedCount: 3,
      callStats: { total: 4, connected: 3, avgDuration: '2m 15s' },
      whatsappStats: { total: 4, delivered: 4, read: 4, replied: 3 },
      smsStats: { total: 4, delivered: 4, clicked: 3 },
      autoChasingEnabled: true,
      vendors: [],
    },
  },
  {
    id: 'rfq-002',
    rfqNumber: 'RFQ-2026-0892',
    title: 'Procurement of 11kV Vacuum Circuit Breakers & Switchgear Panels',
    category: 'Engineering Spares - Electrical',
    createdAt: '2026-08-27 14:00 UTC',
    deadline: '2026-09-10',
    status: 'AI Recommended',
    sourcingMode: 'mode_2',
    quotesCount: 1,
    chasingActive: true,
    allocatedTime: '24 hrs',
    elapsedTime: '12 hrs',
    targetSavings: '18.2%',
    quotes: [
      {
        vendorId: 'v-003',
        vendorName: 'Bharat Electricals & Switchgear Corp',
        vendorCategory: 'Procucev Network',
        unitPrice: 125000,
        totalPrice: 750000,
        leadTimeDays: 21,
        aiMatchScore: 98,
        isBestPrice: true,
        isPreferred: false,
        warrantyYears: 2,
        complianceStatus: 'Fully Compliant',
        paymentTerms: '30 Days Net',
        remarks: 'CPRI Type-Tested 11kV VCB Panel with numerical protection relay',
      },
    ],
    lineItems: [
      {
        id: 'ent-2',
        itemName: '11kV Vacuum Circuit Breakers (VCB)',
        quantity: 6,
        unit: 'Sets',
        targetDate: '2026-09-10',
        technicalSpecs: '11kV, 1250A, 25kA for 3 sec, Motor Operated spring charging mechanism',
        confidence: 99.0,
        category: 'Engineering Spares - Electrical',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategory: 'Circuit Breakers',
      },
    ],
    followUpData: {
      rfqNumber: 'RFQ-2026-0892',
      totalInvited: 5,
      respondedCount: 4,
      callStats: { total: 5, connected: 4, avgDuration: '1m 45s' },
      whatsappStats: { total: 5, delivered: 5, read: 4, replied: 4 },
      smsStats: { total: 5, delivered: 5, clicked: 4 },
      autoChasingEnabled: true,
      vendors: [],
    },
  },
];

const SEED_EVALUATIONS = [
  {
    id: 'eval-001',
    vendorId: 'v-001',
    vendorName: 'Apex Industrial Dynamics Pvt Ltd',
    contactPerson: 'Rajesh Nair',
    email: 'rajesh@apexindustrial.in',
    phone: '+91 98201 44820',
    category: 'Engineering Spares - Mechanical',
    submissionDate: '2026-08-20',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    overallScore: 92.4,
    systemAction: 'Full Qualification Approved - Circulate High-Value RFQs with Automated PO Issuance',
    moduleScores: {
      commercial: { score: 95, maxScore: 100, weight: 25, weightedScore: 23.75 },
      technical: { score: 90, maxScore: 100, weight: 15, weightedScore: 13.5 },
      quality: { score: 94, maxScore: 100, weight: 20, weightedScore: 18.8 },
      delivery: { score: 92, maxScore: 100, weight: 20, weightedScore: 18.4 },
      financial: { score: 88, maxScore: 100, weight: 10, weightedScore: 8.8 },
      governance: { score: 92, maxScore: 100, weight: 10, weightedScore: 9.2 },
    },
    documents: [
      { id: 'doc-1', name: 'GST_Registration_Certificate.pdf', type: 'Statutory Tax', uploadDate: '2026-08-20', verified: true, status: 'Verified' },
      { id: 'doc-2', name: 'ISO_9001_2015_Certificate.pdf', type: 'Quality Assurance', uploadDate: '2026-08-20', verified: true, status: 'Verified' },
      { id: 'doc-3', name: 'Audited_Financials_FY25.pdf', type: 'Financial Statements', uploadDate: '2026-08-20', verified: true, status: 'Verified' },
    ],
  },
];

const SEED_AUDIT_LOGS = [
  {
    id: 'log-001',
    timestamp: '2026-08-29 10:15:00 UTC',
    userEmail: 'vikram.malhotra@tatamotors.com',
    action: 'Created RFQ-2026-0891 under Version 1 Sourcing Mode with 4 empanelled suppliers',
    rfqNumber: 'RFQ-2026-0891',
    shaSignature: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'TAMPER_CHECK_OK',
    ipAddress: '10.0.4.12 (Azure Private VNet)',
  },
  {
    id: 'log-002',
    timestamp: '2026-08-29 11:30:00 UTC',
    userEmail: 'anita.deshmukh@larsentoubro.com',
    action: 'Approved Version 2 Hybrid circulation for RFQ-2026-0892 expanding to verified network partners',
    rfqNumber: 'RFQ-2026-0892',
    shaSignature: '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
    status: 'TAMPER_CHECK_OK',
    ipAddress: '10.0.4.14 (Azure Private VNet)',
  },
];

const SEED_AI_FEED = [
  {
    id: 'feed-001',
    timestamp: '2026-08-29 11:45:00 UTC',
    timeAgo: '5m ago',
    type: 'call',
    channel: 'call',
    title: 'Autonomous Voice AI Call Connected',
    message: 'AI Chaser Bot engaged Rajesh Nair at Apex Industrial. Confirmed RFQ-2026-0891 bid submission by today 4:00 PM.',
    recipient: 'Rajesh Nair (+91 98201 44820)',
    rfqNumber: 'RFQ-2026-0891',
    status: 'completed',
    channelDetails: { duration: '2m 14s', outcome: 'Promise to Bid by 4 PM' },
  },
  {
    id: 'feed-002',
    timestamp: '2026-08-29 11:30:00 UTC',
    timeAgo: '20m ago',
    type: 'whatsapp',
    channel: 'whatsapp',
    title: 'WhatsApp Interactive RFQ Dispatched',
    message: 'Interactive quotation link delivered with 256-bit authentication token to Anil Mehta (+91 98450 67890).',
    recipient: 'Anil Mehta (Bharat Electricals)',
    rfqNumber: 'RFQ-2026-0892',
    status: 'read',
    channelDetails: { readReceipt: '11:32 UTC', clickedQuoteLink: true },
  },
];

async function seedInitialDataToPostgres() {
  if (!pool) {
    return {
      success: false,
      message: 'DATABASE_URL is not set. Skipped PostgreSQL seed.',
      counts: { buyerAccounts: 0, vendors: 0, rfqs: 0, evaluations: 0, auditLogs: 0 },
    };
  }

  await initializeSchema();

  let buyerCount = 0;
  let vendorCount = 0;
  let rfqCount = 0;
  let evalCount = 0;
  let auditCount = 0;

  for (const buyer of SEED_BUYER_ACCOUNTS) {
    try {
      await upsertBuyerAccountInDB(buyer);
      buyerCount++;
    } catch (e) {
      console.error('Seed buyer error:', e);
    }
  }

  for (const v of SEED_VENDORS) {
    try {
      await upsertVendorInDB(v);
      vendorCount++;
    } catch (e) {
      console.error('Seed vendor error:', e);
    }
  }

  for (const rfq of SEED_RFQS) {
    try {
      await upsertRFQInDB(rfq);
      rfqCount++;
    } catch (e) {
      console.error('Seed RFQ error:', e);
    }
  }

  for (const ev of SEED_EVALUATIONS) {
    try {
      await upsertEvaluationInDB(ev);
      evalCount++;
    } catch (e) {
      console.error('Seed Evaluation error:', e);
    }
  }

  for (const log of SEED_AUDIT_LOGS) {
    try {
      await insertAuditLogInDB(log);
      auditCount++;
    } catch (e) {
      console.error('Seed Audit log error:', e);
    }
  }

  try {
    await upsertSystemConfigInDB(INITIAL_SYSTEM_CONFIG);
  } catch (e) {
    console.error('Seed System config error:', e);
  }

  return {
    success: true,
    message: `Database synchronization complete. Seeded ${buyerCount} buyers, ${vendorCount} vendors, ${rfqCount} RFQs, ${evalCount} evaluations, ${auditCount} audit logs into PostgreSQL.`,
    counts: {
      buyerAccounts: buyerCount,
      vendors: vendorCount,
      rfqs: rfqCount,
      evaluations: evalCount,
      auditLogs: auditCount,
    },
  };
}

if (require.main === module) {
  seedInitialDataToPostgres()
    .then((res) => {
      console.log('Seed result:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}

module.exports = {
  SEED_BUYER_ACCOUNTS,
  SEED_VENDORS,
  SEED_RFQS,
  SEED_EVALUATIONS,
  SEED_AUDIT_LOGS,
  SEED_AI_FEED,
  seedInitialDataToPostgres,
};
