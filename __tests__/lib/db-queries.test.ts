/**
 * @jest-environment node
 */
import {
  getBuyerAccountsFromDB,
  upsertBuyerAccountInDB,
  getVendorsFromDB,
  upsertVendorInDB,
  getRFQsFromDB,
  upsertRFQInDB,
  getEvaluationsFromDB,
  upsertEvaluationInDB,
  getAuditLogsFromDB,
  insertAuditLogInDB,
  insertRatingRevisionInDB,
} from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { BuyerAccount, VendorEntry, RFQItem, VendorEvaluationRecord, AuditLogEntry, VendorRatingRevisionRecord } from '@/lib/types';

describe('lib/db/queries', () => {
  it('should handle getBuyerAccountsFromDB when pool is not available', async () => {
    if (!pool) {
      const res = await getBuyerAccountsFromDB();
      expect(res).toEqual([]);
    }
  });

  it('should handle upsertBuyerAccountInDB when pool is not available', async () => {
    if (!pool) {
      const buyer: BuyerAccount = {
        id: 'b-1',
        organizationName: 'Org',
        corporateEmail: 'org@test.com',
        contactPerson: 'Person',
        mobileNumber: '1234567890',
        gstin: '27AABCU9603R1ZN',
        industrySector: 'Automotive',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
        accountSource: 'public_system',
        status: 'ACTIVE_VERIFIED',
        primaryPlantLocation: 'Pune',
        supportedMajorCategories: [],
        totalRFQsCreated: 1,
        totalSpend: '$1,000',
        syncTimestamp: '',
        createdDate: '2026-08-29',
      };
      await expect(upsertBuyerAccountInDB(buyer)).resolves.toBeUndefined();
    }
  });

  it('should handle getVendorsFromDB when pool is not available', async () => {
    if (!pool) {
      const res = await getVendorsFromDB();
      expect(res).toEqual([]);
    }
  });

  it('should handle upsertVendorInDB when pool is not available', async () => {
    if (!pool) {
      const vendor: VendorEntry = {
        id: 'v-1',
        name: 'Vendor 1',
        contactPerson: 'Vendor Person',
        email: 'v@test.com',
        phone: '123',
        majorCategory: 'Mechanical',
        minorCategories: ['Valves'],
        location: 'Pune',
        rating: 4.5,
        score: 88,
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        evaluated: true,
        hasRecord: true,
        matchReason: 'Empanelled',
        proximity: 'Local',
        proximityMatch: true,
        isExistingInDatabase: true,
        onboardingEmailStatus: 'sent',
      };
      await expect(upsertVendorInDB(vendor)).resolves.toBeUndefined();
    }
  });

  it('should handle getRFQsFromDB when pool is not available', async () => {
    if (!pool) {
      const res = await getRFQsFromDB();
      expect(res).toEqual([]);
    }
  });

  it('should handle upsertRFQInDB when pool is not available', async () => {
    if (!pool) {
      const rfq: RFQItem = {
        id: 'rfq-1',
        rfqNumber: 'RFQ-001',
        title: 'Title',
        category: 'Cat',
        createdAt: '2026-08-29',
        targetDeliveryDate: '2026-09-29',
        status: 'DRAFT',
        sourcingMode: 'mode_1',
        extractedEntities: [],
        quotes: [],
      };
      await expect(upsertRFQInDB(rfq)).resolves.toBeUndefined();
    }
  });

  it('should handle getEvaluationsFromDB when pool is not available', async () => {
    if (!pool) {
      const res = await getEvaluationsFromDB();
      expect(res).toEqual([]);
    }
  });

  it('should handle upsertEvaluationInDB when pool is not available', async () => {
    if (!pool) {
      const evalRec: VendorEvaluationRecord = {
        id: 'ev-1',
        vendorId: 'v-1',
        vendorName: 'Vendor',
        contactPerson: 'Person',
        email: 'e@test.com',
        phone: '123',
        category: 'Cat',
        submissionDate: '2026-08-29',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        overallScore: 90,
        systemAction: 'Approve',
        moduleScores: { quality: 90, compliance: 90, commercial: 90, delivery: 90 },
        documents: [],
      };
      await expect(upsertEvaluationInDB(evalRec)).resolves.toBeUndefined();
    }
  });

  it('should handle getAuditLogsFromDB when pool is not available', async () => {
    if (!pool) {
      const res = await getAuditLogsFromDB();
      expect(res).toEqual([]);
    }
  });

  it('should handle insertAuditLogInDB when pool is not available', async () => {
    if (!pool) {
      const log: AuditLogEntry = {
        id: 'log-1',
        timestamp: '2026-08-29 10:00:00',
        user: 'user@test.com',
        action: 'Test action',
        shaSignature: 'sha256:abc',
        status: 'TAMPER_CHECK_OK',
      };
      await expect(insertAuditLogInDB(log)).resolves.toBeUndefined();
    }
  });

  it('should handle insertRatingRevisionInDB when pool is not available', async () => {
    if (!pool) {
      const rev: VendorRatingRevisionRecord = {
        id: 'rev-1',
        vendorId: 'v-1',
        vendorName: 'Vendor',
        buyerCompany: 'Tata Motors',
        buyerName: 'Vikram',
        timestamp: '2026-08-29',
        qualityScore: 90,
        costScore: 90,
        deliveryScore: 90,
        buyerAverage: 90,
        previousScore: 80,
        newCompositeScore: 88,
        previousRating: 4.0,
        newRating: 4.5,
        remarks: 'Great supplier',
        shaSignature: 'sha256:abc',
      };
      await expect(insertRatingRevisionInDB(rev)).resolves.toBeUndefined();
    }
  });
});
