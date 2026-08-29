import { pool, initializeSchema } from './index';
import {
  upsertBuyerAccountInDB,
  upsertVendorInDB,
  upsertRFQInDB,
  upsertEvaluationInDB,
  insertAuditLogInDB,
} from './queries';
import { BuyerAccount, VendorEntry, RFQItem, VendorEvaluationRecord, AuditLogEntry } from '@/lib/types';

export const SEED_BUYER_ACCOUNTS: BuyerAccount[] = [
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
];

export const SEED_VENDORS: VendorEntry[] = [
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
    source: 'buyer_manual',
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
    source: 'buyer_manual',
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
];

export async function seedInitialDataToPostgres(): Promise<{
  success: boolean;
  message: string;
  counts: {
    buyerAccounts: number;
    vendors: number;
    rfqs: number;
    evaluations: number;
    auditLogs: number;
  };
}> {
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

  return {
    success: true,
    message: `Database synchronization complete. Seeded ${buyerCount} buyers and ${vendorCount} vendors into PostgreSQL.`,
    counts: {
      buyerAccounts: buyerCount,
      vendors: vendorCount,
      rfqs: 0,
      evaluations: 0,
      auditLogs: 0,
    },
  };
}
