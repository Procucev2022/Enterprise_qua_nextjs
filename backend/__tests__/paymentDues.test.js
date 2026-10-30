// ==============================================================================
// PAYMENT DUES MODULE UNIT TESTS
// ==============================================================================
// Comprehensive test suite for paymentDuesQueries, paymentDuesController, and routes.
// Enforces >= 90% coverage across statements, branches, functions, and lines.
// ==============================================================================

const request = require('supertest');
const pool = require('../src/db/pool');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const paymentDuesController = require('../src/controllers/paymentDuesController');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const whatsAppService = require('../src/services/whatsAppService');
const app = require('../src/app');

describe('Payment Dues – Low Credit Monitoring & Communication', () => {
  beforeEach(() => {
    paymentDuesQueries.resetInMemoryCommunications();
    jest.restoreAllMocks();
  });

  describe('paymentDuesQueries Unit Tests', () => {
    describe('fetchRawBuyers & fetchRawVendors', () => {
      test('fetches buyers and vendors from storeService when pool storage is unavailable', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

        const buyers = await paymentDuesQueries.fetchRawBuyers();
        expect(Array.isArray(buyers)).toBe(true);

        const vendors = await paymentDuesQueries.fetchRawVendors();
        expect(Array.isArray(vendors)).toBe(true);
      });

      test('fetches buyers and vendors from pool when pool storage is available', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        const mockBuyerRows = [
          {
            id: 'buyer-db-1',
            is_active: true,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
            raw: JSON.stringify({
              organizationName: 'DB Buyer Corp',
              contactPerson: 'Alice',
              corporateEmail: 'alice@dbcorp.com',
              remainingFreeRFQs: 1,
            }),
          },
        ];
        const mockVendorRows = [
          {
            id: 'vendor-db-1',
            email: 'bob@dbvendor.com',
            status: 'Active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
            raw: JSON.stringify({
              name: 'DB Vendor Corp',
              contactPerson: 'Bob',
              phone: '9876543210',
              freeQuotationCredits: 0,
            }),
          },
        ];

        jest.spyOn(pool, 'query').mockImplementation((sql) => {
          if (sql.includes('buyer_accounts')) {
            return Promise.resolve({ rows: mockBuyerRows });
          }
          if (sql.includes('vendors')) {
            return Promise.resolve({ rows: mockVendorRows });
          }
          return Promise.resolve({ rows: [] });
        });

        const buyers = await paymentDuesQueries.fetchRawBuyers();
        expect(buyers.length).toBe(1);
        expect(buyers[0].organizationName).toBe('DB Buyer Corp');

        const vendors = await paymentDuesQueries.fetchRawVendors();
        expect(vendors.length).toBe(1);
        expect(vendors[0].name).toBe('DB Vendor Corp');
      });

      test('falls back gracefully to storeService on pool query error', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB Connection Refused'));
        jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([{ id: 'fb-1', organizationName: 'Fallback Buyer' }]);
        jest.spyOn(storeService, 'getVendors').mockResolvedValue([{ id: 'fv-1', name: 'Fallback Vendor' }]);

        const buyers = await paymentDuesQueries.fetchRawBuyers();
        expect(buyers.length).toBe(1);

        const vendors = await paymentDuesQueries.fetchRawVendors();
        expect(vendors.length).toBe(1);
      });
    });

    describe('getLowCreditAccounts Filtering & Sorting', () => {
      beforeEach(() => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([
          {
            id: 'b-0',
            organizationName: 'Alpha Tech',
            contactPerson: 'John Buyer',
            corporateEmail: 'john@alphatech.com',
            phone: '9876543210',
            remainingFreeRFQs: 0, // Eligible
            totalCredits: 5,
            status: 'Active',
            createdAt: '2026-01-10T00:00:00Z',
            lastActivity: '2026-02-01T00:00:00Z',
            assignedExecutive: 'Devin',
          },
          {
            id: 'b-1',
            organizationName: 'Beta Logistics',
            contactPerson: 'Sarah Buyer',
            corporateEmail: 'sarah@betalog.com',
            phone: '9123456789',
            remainingFreeRFQs: 1, // Eligible
            totalCredits: 5,
            status: 'Pending',
            createdAt: '2026-01-15T00:00:00Z',
            lastActivity: '2026-02-05T00:00:00Z',
            assignedExecutive: 'Arun',
          },
          {
            id: 'b-5',
            organizationName: 'High Credit Buyer',
            remainingFreeRFQs: 5, // Excluded (> 2)
          },
          {
            id: 'b-neg',
            organizationName: 'Negative Credit Buyer',
            remainingFreeRFQs: -1, // Excluded (< 0)
          },
        ]);

        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
          {
            id: 'v-0',
            name: 'Zenith Fasteners',
            contactPerson: 'Zack Seller',
            email: 'zack@zenith.com',
            phone: '9988776655',
            freeQuotationCredits: 0, // Eligible
            totalCredits: 10,
            status: 'Preferred',
            createdAt: '2026-01-05T00:00:00Z',
            lastActivity: '2026-01-20T00:00:00Z',
            assignedExecutive: 'Devin',
          },
          {
            id: 'v-2',
            name: 'Delta Bearings',
            contactPerson: 'David Seller',
            email: 'david@deltabearings.com',
            phone: '9112233445',
            freeQuotationCredits: 2, // Eligible
            totalCredits: 10,
            status: 'Active',
            createdAt: '2026-01-08T00:00:00Z',
            lastActivity: '2026-01-25T00:00:00Z',
            assignedExecutive: 'Nisha',
          },
          {
            id: 'v-10',
            name: 'Rich Seller',
            freeQuotationCredits: 10, // Excluded (> 2)
          },
        ]);
      });

      test('fetches eligible low credit accounts and calculates accurate summary', async () => {
        const result = await paymentDuesQueries.getLowCreditAccounts();
        expect(result.summary.totalLowCreditAccounts).toBe(4); // b-0, b-1, v-0, v-2
        expect(result.summary.totalBuyers).toBe(2);
        expect(result.summary.totalSellers).toBe(2);
        expect(result.summary.zeroCredits).toBe(2); // b-0, v-0
        expect(result.summary.oneToTwoCredits).toBe(2); // b-1, v-2
        expect(result.summary.acknowledgementPending).toBe(0);
        expect(result.total).toBe(4);
      });

      test('filters by global search keyword across multiple fields', async () => {
        const searchCompany = await paymentDuesQueries.getLowCreditAccounts({ search: 'Zenith' });
        expect(searchCompany.total).toBe(1);
        expect(searchCompany.accounts[0].companyName).toBe('Zenith Fasteners');

        const searchEmail = await paymentDuesQueries.getLowCreditAccounts({ search: 'sarah@betalog.com' });
        expect(searchEmail.total).toBe(1);
        expect(searchEmail.accounts[0].accountId).toBe('b-1');

        const searchContact = await paymentDuesQueries.getLowCreditAccounts({ search: 'David' });
        expect(searchContact.total).toBe(1);
        expect(searchContact.accounts[0].contactPerson).toBe('David Seller');

        const searchPhone = await paymentDuesQueries.getLowCreditAccounts({ search: '9988776655' });
        expect(searchPhone.total).toBe(1);
        expect(searchPhone.accounts[0].phoneNumber).toBe('9988776655');

        const searchExec = await paymentDuesQueries.getLowCreditAccounts({ search: 'Arun' });
        expect(searchExec.total).toBe(1);
      });

      test('filters by accountType (buyer vs seller)', async () => {
        const buyersOnly = await paymentDuesQueries.getLowCreditAccounts({ accountType: 'buyer' });
        expect(buyersOnly.total).toBe(2);
        expect(buyersOnly.accounts.every((a) => a.accountType === 'buyer')).toBe(true);

        const sellersOnly = await paymentDuesQueries.getLowCreditAccounts({ accountType: 'seller' });
        expect(sellersOnly.total).toBe(2);
        expect(sellersOnly.accounts.every((a) => a.accountType === 'seller')).toBe(true);
      });

      test('filters by available credits (0 vs 1-2 vs exact number)', async () => {
        const zeroCredits = await paymentDuesQueries.getLowCreditAccounts({ credits: '0' });
        expect(zeroCredits.total).toBe(2);
        expect(zeroCredits.accounts.every((a) => a.availableCredits === 0)).toBe(true);

        const oneToTwo = await paymentDuesQueries.getLowCreditAccounts({ credits: '1-2' });
        expect(oneToTwo.total).toBe(2);
        expect(oneToTwo.accounts.every((a) => a.availableCredits === 1 || a.availableCredits === 2)).toBe(true);

        const exactOne = await paymentDuesQueries.getLowCreditAccounts({ credits: '1' });
        expect(exactOne.total).toBe(1);
        expect(exactOne.accounts[0].accountId).toBe('b-1');

        const invalidCredit = await paymentDuesQueries.getLowCreditAccounts({ credits: 'abc' });
        expect(invalidCredit.total).toBe(4);
      });

      test('filters by accountStatus and assignedExecutive and notificationChannel', async () => {
        const activeOnly = await paymentDuesQueries.getLowCreditAccounts({ accountStatus: 'Active' });
        expect(activeOnly.total).toBe(2);

        const devinOnly = await paymentDuesQueries.getLowCreditAccounts({ assignedExecutive: 'Devin' });
        expect(devinOnly.total).toBe(2);

        const channelNone = await paymentDuesQueries.getLowCreditAccounts({ notificationChannel: 'email' });
        expect(channelNone.total).toBe(0);
      });

      test('supports sorting ascending and descending on numeric and string columns', async () => {
        const sortCreditsAsc = await paymentDuesQueries.getLowCreditAccounts({
          sortBy: 'availableCredits',
          sortOrder: 'asc',
        });
        expect(sortCreditsAsc.accounts[0].availableCredits).toBe(0);
        expect(sortCreditsAsc.accounts[sortCreditsAsc.accounts.length - 1].availableCredits).toBe(2);

        const sortCreditsDesc = await paymentDuesQueries.getLowCreditAccounts({
          sortBy: 'availableCredits',
          sortOrder: 'desc',
        });
        expect(sortCreditsDesc.accounts[0].availableCredits).toBe(2);
        expect(sortCreditsDesc.accounts[sortCreditsDesc.accounts.length - 1].availableCredits).toBe(0);

        const sortNameAsc = await paymentDuesQueries.getLowCreditAccounts({
          sortBy: 'companyName',
          sortOrder: 'asc',
        });
        expect(sortNameAsc.accounts[0].companyName).toBe('Alpha Tech');

        const sortNameDesc = await paymentDuesQueries.getLowCreditAccounts({
          sortBy: 'companyName',
          sortOrder: 'desc',
        });
        expect(sortNameDesc.accounts[0].companyName).toBe('Zenith Fasteners');
      });

      test('supports pagination with custom page and limit', async () => {
        const page1 = await paymentDuesQueries.getLowCreditAccounts({ page: 1, limit: 2 });
        expect(page1.accounts.length).toBe(2);
        expect(page1.page).toBe(1);
        expect(page1.limit).toBe(2);
        expect(page1.total).toBe(4);

        const page2 = await paymentDuesQueries.getLowCreditAccounts({ page: 2, limit: 2 });
        expect(page2.accounts.length).toBe(2);
        expect(page2.page).toBe(2);
        expect(page2.accounts[0].accountId).not.toBe(page1.accounts[0].accountId);
      });

      test('filters by acknowledgementStatus', async () => {
        const notNotified = await paymentDuesQueries.getLowCreditAccounts({ acknowledgementStatus: 'Not Notified' });
        expect(notNotified.total).toBe(4);
      });

      test('sorts equal strings correctly (return 0 branch)', async () => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([
          { id: 'b-eq-1', organizationName: 'Equal Name', remainingFreeRFQs: 1 },
          { id: 'b-eq-2', organizationName: 'Equal Name', remainingFreeRFQs: 1 },
        ]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([]);
        const sorted = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'companyName' });
        expect(sorted.accounts.length).toBe(2);
      });

      test('parseRaw handles invalid JSON and pickFirst works', () => {
        expect(paymentDuesQueries.parseRaw('invalid{json', { def: true })).toEqual({ def: true });
        expect(paymentDuesQueries.pickFirst(undefined, null, '', 'FirstValid')).toBe('FirstValid');
        expect(paymentDuesQueries.pickFirst(undefined, null)).toBe('');
      });

      test('getLowCreditAccounts retrieves communications from database when pool has storage', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([
          { id: 'b-1', organizationName: 'Alpha Corp', remainingFreeRFQs: 1 },
        ]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([]);
        jest.spyOn(pool, 'query').mockImplementation((sql) => {
          if (sql.includes('payment_dues_communications')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'comm-db-1',
                  account_id: 'b-1',
                  account_type: 'buyer',
                  channel: 'email',
                  recipient: 'alice@alpha.com',
                  subject: 'Low Credit Alert',
                  message: 'Your credits are low',
                  notification_status: 'Delivered',
                  delivery_status: 'Delivered',
                  acknowledgement_status: 'Acknowledgement Pending',
                  communicated_by: 'Test Admin',
                  sent_at: '2026-02-01T00:00:00.000Z',
                  notes: 'Test note',
                  metadata: '{"source":"crm"}',
                  created_at: '2026-02-01T00:00:00.000Z',
                  updated_at: '2026-02-01T00:00:00.000Z',
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        });

        const res = await paymentDuesQueries.getLowCreditAccounts({ acknowledgementStatus: 'Acknowledgement Pending' });
        expect(res.accounts.some((a) => a.accountId === 'b-1' && a.lastNotification !== null)).toBe(true);
      });

      
      test('populates latestComm fields for buyers and sellers when communications exist in memory', async () => {
        await paymentDuesQueries.recordCommunication({
          accountId: 'b-0',
          accountType: 'buyer',
          channel: 'email',
          recipient: 'test@b0.com',
          subject: 'Alert',
          message: 'Zero credits',
          notificationStatus: 'Delivered',
          deliveryStatus: 'Delivered',
          acknowledgementStatus: 'Acknowledgement Pending',
        });
        await paymentDuesQueries.recordCommunication({
          accountId: 'v-0',
          accountType: 'seller',
          channel: 'whatsapp',
          recipient: '9988776655',
          message: 'Zero credits seller',
          notificationStatus: 'Notification Sent',
          deliveryStatus: 'Delivered',
          acknowledgementStatus: 'Acknowledgement Pending',
        });

        const res = await paymentDuesQueries.getLowCreditAccounts();
        const b0 = res.accounts.find((a) => a.accountId === 'b-0');
        const v0 = res.accounts.find((a) => a.accountId === 'v-0');

        expect(b0.lastNotification).toBeDefined();
        expect(b0.notificationChannel).toBe('email');
        expect(b0.acknowledgementStatus).toBe('Acknowledgement Pending');
        expect(v0.lastNotification).toBeDefined();
        expect(v0.notificationChannel).toBe('whatsapp');
        expect(v0.acknowledgementStatus).toBe('Acknowledgement Pending');
        expect(res.summary.acknowledgementPending).toBe(2);
      });

      test('handles inactive buyer and vendor rfqDownloadsUsed edge cases', async () => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([
          {
            id: 'b-inactive',
            organizationName: 'Inactive Buyer',
            remainingFreeRFQs: 0,
            isActive: false,
            totalCredits: 10,
          },
        ]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
          {
            id: 'v-used',
            name: 'Vendor With Downloads',
            freeQuotationCredits: 1,
            rfqDownloadsUsed: 7,
            totalCredits: 8,
          },
        ]);

        const res = await paymentDuesQueries.getLowCreditAccounts();
        const bInactive = res.accounts.find((a) => a.accountId === 'b-inactive');
        const vUsed = res.accounts.find((a) => a.accountId === 'v-used');

        expect(bInactive.accountStatus).toBe('Inactive');
        expect(bInactive.totalCredits).toBe(10);
        expect(bInactive.creditsUsed).toBe(10);
        expect(vUsed.creditsUsed).toBe(7);
      });

      test('parseCredits handles null, undefined, invalid and valid numbers', () => {
        expect(paymentDuesQueries.parseCredits(null, 5)).toBe(5);
        expect(paymentDuesQueries.parseCredits(undefined, 10)).toBe(10);
        expect(paymentDuesQueries.parseCredits('not-a-number', 3)).toBe(3);
        expect(paymentDuesQueries.parseCredits(0, 5)).toBe(0);
        expect(paymentDuesQueries.parseCredits('2', 5)).toBe(2);
      });

      test('sorting handles null or undefined values gracefully', async () => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([
          { id: 'b-null-1', organizationName: null, remainingFreeRFQs: 1 },
          { id: 'b-null-2', organizationName: 'Valid Name', remainingFreeRFQs: 1 },
        ]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([]);

        const resAsc = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'companyName', sortOrder: 'asc' });
        expect(resAsc.accounts.length).toBe(2);

        const resDesc = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'companyName', sortOrder: 'desc' });
        expect(resDesc.accounts.length).toBe(2);
      });

      test('updateAcknowledgementStatus handles non-Acknowledged status and empty notes', async () => {
        await paymentDuesQueries.recordCommunication({
          accountId: 'b-pending',
          accountType: 'buyer',
          channel: 'message',
          recipient: 'b-pending',
          message: 'Notice',
        });
        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'b-pending',
          accountType: 'buyer',
          acknowledgementStatus: 'Delivery Pending',
          notes: '',
        });
        expect(updated.acknowledgementStatus).toBe('Delivery Pending');
        expect(updated.acknowledgedAt).toBeNull();
      });

      
      test('defaults invalid pagination in getLowCreditAccounts', async () => {
        const res = await paymentDuesQueries.getLowCreditAccounts({ page: 'not-num', limit: 'not-num' });
        expect(res.page).toBe(1);
        expect(res.limit).toBe(25);
      });

      test('updateAcknowledgementStatus defaults accountType to buyer if unspecified', async () => {
        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'no-type-acc',
          acknowledgementStatus: 'Acknowledged',
        });
        expect(updated.accountType).toBe('buyer');
      });

      
      test('parseRaw returns object if val is already an object', () => {
        const obj = { custom: 123 };
        expect(paymentDuesQueries.parseRaw(obj)).toBe(obj);
      });

      test('getSellerAvailableCredits covers all credit property fallbacks', () => {
        expect(paymentDuesQueries.getSellerAvailableCredits({ availableCredits: 2 })).toBe(2);
        expect(paymentDuesQueries.getSellerAvailableCredits({ freeQuotationCredits: 1 })).toBe(1);
        expect(paymentDuesQueries.getSellerAvailableCredits({ freeRfqDownloadCredits: 0 })).toBe(0);
        expect(paymentDuesQueries.getSellerAvailableCredits({ freeCreditsRemaining: 2 })).toBe(2);
        expect(paymentDuesQueries.getSellerAvailableCredits({ credits: 1 })).toBe(1);
        expect(paymentDuesQueries.getSellerAvailableCredits({})).toBe(0);
      });

      test('getSellerCreditsUsed covers freeCreditsUsed, rfqDownloadsUsed and calculated fallback', () => {
        expect(paymentDuesQueries.getSellerCreditsUsed({ freeCreditsUsed: 4 }, 10, 2)).toBe(4);
        expect(paymentDuesQueries.getSellerCreditsUsed({ rfqDownloadsUsed: 6 }, 10, 2)).toBe(6);
        expect(paymentDuesQueries.getSellerCreditsUsed({}, 10, 2)).toBe(8);
        expect(paymentDuesQueries.getSellerCreditsUsed({}, 2, 5)).toBe(0);
      });

      test('records communication with non-object metadata and handles DB empty rows on update and history', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

        const comm = await paymentDuesQueries.recordCommunication({
          accountId: 'v-str',
          accountType: 'seller',
          channel: 'whatsapp',
          recipient: '9988776655',
          message: 'Low credits',
          metadata: 'plain-string-metadata',
        });
        expect(comm.accountId).toBe('v-str');

        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'v-str',
          accountType: 'seller',
          acknowledgementStatus: 'Acknowledged',
          notes: 'Direct note',
        });
        expect(updated.acknowledgementStatus).toBe('Acknowledged');

        const history = await paymentDuesQueries.getCommunicationHistory('v-str');
        expect(Array.isArray(history)).toBe(true);
      });

      test('seller with undefined totalCredits defaults to 10', async () => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
          { id: 'v-no-tc', name: 'No TC Vendor', freeQuotationCredits: 0 },
        ]);
        const res = await paymentDuesQueries.getLowCreditAccounts();
        expect(res.accounts[0].totalCredits).toBe(10);
      });

      test('updateAcknowledgementStatus when no prior communication and not Acknowledged', async () => {
        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'failed-acc',
          acknowledgementStatus: 'Failed',
        });
        expect(updated.acknowledgementStatus).toBe('Failed');
        expect(updated.acknowledgedAt).toBeNull();
      });

      test('getPaymentDuesSummary returns summary metrics', async () => {
        const summary = await paymentDuesQueries.getPaymentDuesSummary();
        expect(summary.totalLowCreditAccounts).toBe(4);
        expect(summary.totalBuyers).toBe(2);
      });
    });

    describe('recordCommunication & updateAcknowledgementStatus & getCommunicationHistory', () => {
      test('records communication in-memory and retrieves history', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

        const comm = await paymentDuesQueries.recordCommunication({
          accountId: 'b-0',
          accountType: 'buyer',
          channel: 'email',
          recipient: 'john@alphatech.com',
          subject: 'Credit Notice',
          message: 'You have 0 credits left',
          communicatedBy: 'CM Officer',
          notes: 'Test email note',
        });

        expect(comm.id).toBeDefined();
        expect(comm.channel).toBe('email');
        expect(comm.acknowledgementStatus).toBe('Acknowledgement Pending');

        const history = await paymentDuesQueries.getCommunicationHistory('b-0');
        expect(history.length).toBe(1);
        expect(history[0].id).toBe(comm.id);
      });

      test('records communication in PostgreSQL / D1 when pool has storage', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

        const comm = await paymentDuesQueries.recordCommunication({
          accountId: 'v-0',
          accountType: 'seller',
          channel: 'whatsapp',
          recipient: '9988776655',
          message: 'Low credits',
        });

        expect(comm.channel).toBe('whatsapp');
        expect(querySpy).toHaveBeenCalled();
      });

      test('updates acknowledgement status to Acknowledged with timestamps and user', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

        await paymentDuesQueries.recordCommunication({
          accountId: 'b-0',
          accountType: 'buyer',
          channel: 'message',
          recipient: 'b-0',
          message: 'Low balance',
        });

        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'b-0',
          accountType: 'buyer',
          acknowledgementStatus: 'Acknowledged',
          notes: 'Client confirmed renewal order via phone',
          updatedBy: 'Lead CM',
        });

        expect(updated.acknowledgementStatus).toBe('Acknowledged');
        expect(updated.acknowledgedBy).toBe('Lead CM');
        expect(updated.acknowledgedAt).toBeDefined();
        expect(updated.notes).toBe('Client confirmed renewal order via phone');
      });

      test('updates acknowledgement status when no prior communication existed', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'new-account',
          accountType: 'seller',
          acknowledgementStatus: 'Acknowledged',
          notes: 'Direct physical acknowledgement',
          updatedBy: 'Executive',
        });

        expect(updated.acknowledgementStatus).toBe('Acknowledged');
        expect(updated.acknowledgedBy).toBe('Executive');
      });

      test('handles DB updateAcknowledgementStatus with pool storage', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        const mockRow = {
          id: 'pdc_1',
          account_id: 'b-0',
          account_type: 'buyer',
          channel: 'email',
          recipient: 'test@b.com',
          message: 'msg',
          acknowledgement_status: 'Acknowledged',
          acknowledged_by: 'Lead CM',
          acknowledged_at: '2026-02-01T00:00:00Z',
          sent_at: '2026-02-01T00:00:00Z',
        };
        jest.spyOn(pool, 'query').mockResolvedValue({ rows: [mockRow] });

        const updated = await paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'b-0',
          accountType: 'buyer',
          acknowledgementStatus: 'Acknowledged',
          updatedBy: 'Lead CM',
        });

        expect(updated.acknowledgementStatus).toBe('Acknowledged');
      });

      test('fetches communication history from DB when pool has storage', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockResolvedValue({
          rows: [
            {
              id: 'pdc_db_1',
              account_id: 'b-0',
              account_type: 'buyer',
              channel: 'email',
              recipient: 'test@b.com',
              message: 'Low credit alert',
              notification_status: 'Delivered',
              acknowledgement_status: 'Acknowledgement Pending',
              sent_at: '2026-02-01T00:00:00Z',
            },
          ],
        });

        const history = await paymentDuesQueries.getCommunicationHistory('b-0');
        expect(history.length).toBe(1);
        expect(history[0].id).toBe('pdc_db_1');
      });
    });
  });

  describe('paymentDuesController & API Route Tests', () => {
    beforeEach(() => {
      jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockResolvedValue({
        accounts: [
          {
            accountId: 'b-test-1',
            accountType: 'buyer',
            companyName: 'Test Buyer Ltd',
            contactPerson: 'Alice',
            email: 'alice@test.com',
            phoneNumber: '9876543210',
            availableCredits: 1,
            totalCredits: 5,
            creditsUsed: 4,
            accountStatus: 'Active',
            registrationDate: '2026-01-01T00:00:00Z',
            lastActivity: '2026-02-01T00:00:00Z',
            assignedExecutive: 'Devin',
            lastNotification: null,
            notificationChannel: '–',
            acknowledgementStatus: 'Not Notified',
          },
        ],
        total: 1,
        summary: {
          totalLowCreditAccounts: 1,
          totalBuyers: 1,
          totalSellers: 0,
          zeroCredits: 0,
          oneToTwoCredits: 1,
          acknowledgementPending: 0,
        },
        page: 1,
        limit: 25,
      });
    });

    test('GET /api/payment-dues returns low credit accounts and summary', async () => {
      const res = await request(app).get('/api/payment-dues');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.accounts.length).toBe(1);
      expect(res.body.summary.totalLowCreditAccounts).toBe(1);
    });

    test('GET /api/payment-dues handles internal server errors', async () => {
      jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockRejectedValue(new Error('Internal DB failure'));
      const res = await request(app).get('/api/payment-dues');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/payment-dues/summary returns summary stats', async () => {
      jest.spyOn(paymentDuesQueries, 'getPaymentDuesSummary').mockResolvedValue({
        totalLowCreditAccounts: 5,
        totalBuyers: 3,
        totalSellers: 2,
        zeroCredits: 2,
        oneToTwoCredits: 3,
        acknowledgementPending: 1,
      });

      const res = await request(app).get('/api/payment-dues/summary');
      expect(res.status).toBe(200);
      expect(res.body.summary.totalLowCreditAccounts).toBe(5);
    });

    test('GET /api/payment-dues/summary handles errors', async () => {
      jest.spyOn(paymentDuesQueries, 'getPaymentDuesSummary').mockRejectedValue(new Error('Summary error'));
      const res = await request(app).get('/api/payment-dues/summary');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/payment-dues/email validates payload and dispatches email', async () => {
      const mailSpy = jest.fn().mockResolvedValue(true);
      jest.spyOn(mailerService, 'getTransporter').mockReturnValue({ sendMail: mailSpy });
      const res = await request(app)
        .post('/api/payment-dues/email')
        .send({
          accountId: 'b-test-1',
          accountType: 'buyer',
          recipientEmail: 'alice@test.com',
          subject: 'Low Credits Notice',
          message: 'Your credits are low. Please replenish.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.communication.channel).toBe('email');
      expect(mailSpy).toHaveBeenCalled();
    });

    test('POST /api/payment-dues/email rejects invalid payload with 400', async () => {
      const res = await request(app)
        .post('/api/payment-dues/email')
        .send({
          accountId: 'b-test-1',
          recipientEmail: 'invalid-email',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/payment-dues/message validates payload and creates in-app notification', async () => {
      const res = await request(app)
        .post('/api/payment-dues/message')
        .send({
          accountId: 'b-test-1',
          accountType: 'buyer',
          title: 'Alert',
          message: 'Low credit balance in your account.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.communication.channel).toBe('message');
    });

    test('POST /api/payment-dues/message rejects invalid payload with 400', async () => {
      const res = await request(app)
        .post('/api/payment-dues/message')
        .send({
          accountId: 'b-test-1',
          // missing message
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/payment-dues/whatsapp validates payload and returns wa.me direct link', async () => {
      const res = await request(app)
        .post('/api/payment-dues/whatsapp')
        .send({
          accountId: 'v-test-1',
          accountType: 'seller',
          phone: '9876543210',
          message: 'Low credit balance alert for your seller account.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.directLink).toContain('wa.me');
      expect(res.body.communication.channel).toBe('whatsapp');
    });

    test('POST /api/payment-dues/whatsapp rejects invalid payload with 400', async () => {
      const res = await request(app)
        .post('/api/payment-dues/whatsapp')
        .send({
          accountId: 'v-test-1',
          accountType: 'seller',
          phone: '', // invalid
          message: '',
        });

      expect(res.status).toBe(400);
    });

    test('POST /api/payment-dues/acknowledge updates status and audit log', async () => {
      const res = await request(app)
        .post('/api/payment-dues/acknowledge')
        .send({
          accountId: 'b-test-1',
          accountType: 'buyer',
          acknowledgementStatus: 'Acknowledged',
          notes: 'Customer confirmed top-up',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.communication.acknowledgementStatus).toBe('Acknowledged');
    });

    test('POST /api/payment-dues/acknowledge rejects invalid status with 400', async () => {
      const res = await request(app)
        .post('/api/payment-dues/acknowledge')
        .send({
          accountId: 'b-test-1',
          accountType: 'buyer',
          acknowledgementStatus: 'InvalidStatus',
        });

      expect(res.status).toBe(400);
    });

    test('GET /api/payment-dues/history/:accountId returns communication history', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([
        {
          id: 'pdc_1',
          channel: 'email',
          message: 'Low credits',
          sentAt: '2026-02-01T00:00:00Z',
        },
      ]);

      const res = await request(app).get('/api/payment-dues/history/b-test-1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.history.length).toBe(1);
    });

    test('GET /api/payment-dues/history/:accountId handles errors', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockRejectedValue(new Error('History error'));
      const res = await request(app).get('/api/payment-dues/history/b-test-1');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/payment-dues/export streams CSV format', async () => {
      const res = await request(app).get('/api/payment-dues/export');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename="payment_dues_report.csv"');
      expect(res.text).toContain('Account ID,Account Type,Company Name');
      expect(res.text).toContain('Test Buyer Ltd');
    });

    test('GET /api/payment-dues/export handles errors', async () => {
      jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockRejectedValue(new Error('Export error'));
      const res = await request(app).get('/api/payment-dues/export');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/payment-dues/email continues recording if transporter throws', async () => {
      jest.spyOn(mailerService, 'getTransporter').mockReturnValue({
        sendMail: jest.fn().mockRejectedValue(new Error('SMTP timeout')),
      });
      const res = await request(app)
        .post('/api/payment-dues/email')
        .send({
          accountId: 'b-1',
          accountType: 'buyer',
          recipientEmail: 'buyer@example.com',
          subject: 'Low credits',
          message: 'Notice',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/payment-dues/email returns 500 when recordCommunication fails', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('DB failure'));
      const res = await request(app)
        .post('/api/payment-dues/email')
        .send({
          accountId: 'b-1',
          accountType: 'buyer',
          recipientEmail: 'buyer@example.com',
          subject: 'Low credits',
          message: 'Notice',
        });
      expect(res.status).toBe(500);
    });

    test('POST /api/payment-dues/message handles notification error and 500 error', async () => {
      jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {
        throw new Error('Store notification error');
      });
      const res = await request(app)
        .post('/api/payment-dues/message')
        .send({
          accountId: 'b-1',
          accountType: 'buyer',
          message: 'Notice',
        });
      expect(res.status).toBe(200);

      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('Fatal error'));
      const resErr = await request(app)
        .post('/api/payment-dues/message')
        .send({
          accountId: 'b-1',
          accountType: 'buyer',
          message: 'Notice',
        });
      expect(resErr.status).toBe(500);
    });

    test('POST /api/payment-dues/whatsapp returns 500 when recordCommunication fails', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('WhatsApp query fail'));
      const res = await request(app)
        .post('/api/payment-dues/whatsapp')
        .send({
          accountId: 'v-1',
          accountType: 'seller',
          phone: '+919876543210',
          message: 'WA message',
        });
      expect(res.status).toBe(500);
    });

    test('POST /api/payment-dues/acknowledge returns 500 when query fails', async () => {
      jest.spyOn(paymentDuesQueries, 'updateAcknowledgementStatus').mockRejectedValue(new Error('Update fail'));
      const res = await request(app)
        .post('/api/payment-dues/acknowledge')
        .send({
          accountId: 'b-1',
          accountType: 'buyer',
          acknowledgementStatus: 'Acknowledged',
        });
      expect(res.status).toBe(500);
    });

    test('getHistory returns 400 if accountId is missing', async () => {
      const reqMissing = { params: {} };
      const resMissing = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await paymentDuesController.getHistory(reqMissing, resMissing);
      expect(resMissing.status).toHaveBeenCalledWith(400);
    });




    test('GET /api/payment-dues defaults invalid page and limit', async () => {
      const res = await request(app).get('/api/payment-dues?page=invalid&limit=invalid');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/payment-dues/whatsapp falls back to default link generator if buildDirectWhatsAppLink is missing', async () => {
      const orig = whatsAppService.buildDirectWhatsAppLink;
      whatsAppService.buildDirectWhatsAppLink = null;
      const res = await request(app)
        .post('/api/payment-dues/whatsapp')
        .send({
          accountId: 'v-1',
          accountType: 'seller',
          phone: '+919876543210',
          message: 'WA fallback test',
        });
      whatsAppService.buildDirectWhatsAppLink = orig;
      expect(res.status).toBe(200);
      expect(res.body.directLink).toContain('wa.me');
    });

    test('POST /api/payment-dues/email succeeds when getTransporter is not available', async () => {
      const orig = mailerService.getTransporter;
      mailerService.getTransporter = null;
      const res = await request(app)
        .post('/api/payment-dues/email')
        .send({
          accountId: 'b-1',
          accountType: 'buyer',
          recipientEmail: 'notransporter@example.com',
          subject: 'No transporter',
          message: 'Notice text',
        });
      mailerService.getTransporter = orig;
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

  });
});
