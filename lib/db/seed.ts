import { pool, initializeSchema } from './index';
import {
  INITIAL_BUYER_ACCOUNTS,
  INITIAL_BUYER_VENDORS,
  INITIAL_RFQS,
  INITIAL_VENDOR_EVALUATIONS,
  INITIAL_AUDIT_LOG,
} from '@/lib/mock-data';
import {
  upsertBuyerAccountInDB,
  upsertVendorInDB,
  upsertRFQInDB,
  upsertEvaluationInDB,
  insertAuditLogInDB,
} from './queries';

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

  // 1. Ensure Schema is Initialized
  await initializeSchema();

  let buyerCount = 0;
  let vendorCount = 0;
  let rfqCount = 0;
  let evalCount = 0;
  let auditCount = 0;

  // 2. Seed Buyer Accounts
  for (const buyer of INITIAL_BUYER_ACCOUNTS) {
    try {
      await upsertBuyerAccountInDB(buyer);
      buyerCount++;
    } catch (e) {
      console.error('Seed buyer error:', e);
    }
  }

  // 3. Seed Vendors
  for (const v of INITIAL_BUYER_VENDORS) {
    try {
      await upsertVendorInDB(v);
      vendorCount++;
    } catch (e) {
      console.error('Seed vendor error:', e);
    }
  }

  // 4. Seed RFQs
  for (const rfq of INITIAL_RFQS) {
    try {
      await upsertRFQInDB(rfq);
      rfqCount++;
    } catch (e) {
      console.error('Seed rfq error:', e);
    }
  }

  // 5. Seed Vendor Evaluations
  for (const ev of INITIAL_VENDOR_EVALUATIONS) {
    try {
      await upsertEvaluationInDB(ev);
      evalCount++;
    } catch (e) {
      console.error('Seed eval error:', e);
    }
  }

  // 6. Seed Audit Logs
  for (const log of INITIAL_AUDIT_LOG) {
    try {
      await insertAuditLogInDB(log);
      auditCount++;
    } catch (e) {
      console.error('Seed audit error:', e);
    }
  }

  return {
    success: true,
    message: `Database synchronization complete. Seeded ${buyerCount} buyers, ${vendorCount} vendors, ${rfqCount} RFQs, ${evalCount} evaluations, and ${auditCount} audit entries into PostgreSQL.`,
    counts: {
      buyerAccounts: buyerCount,
      vendors: vendorCount,
      rfqs: rfqCount,
      evaluations: evalCount,
      auditLogs: auditCount,
    },
  };
}
