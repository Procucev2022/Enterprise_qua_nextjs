const storeService = require('../src/services/storeService');
const rfqController = require('../src/controllers/rfqController');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const whatsAppService = require('../src/services/whatsAppService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

describe('V1 & V2 Vendor Assignment and Outreach Dispatch', () => {
  let buyerAccount;
  let clientVendor1;
  let clientVendor2;
  let procucevVendor1;

  beforeEach(() => {
    // Reset mailer and scheduler spies
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ success: true, messageId: 'msg-1' });
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-1' });
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true });
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

    buyerAccount = storeService.addBuyerAccount({
      organizationName: 'Alpha Infra Corp',
      corporateEmail: 'procurement@alphainfra.com',
      subscriptionPlan: 'version_2',
    });

    clientVendor1 = storeService.addVendor({
      name: 'Alpha Cement Supplier',
      email: 'cement@alphavendor.com',
      phone: '+919876543210',
      majorCategory: 'Civil Works',
      minorCategories: ['Cement & Concrete'],
      addedByBuyerCompany: 'Alpha Infra Corp',
      source: 'buyer_uploaded',
      buyerAccountId: buyerAccount.id,
    });

    clientVendor2 = storeService.addVendor({
      name: 'Alpha Steel Fabrication',
      email: 'steel@alphavendor.com',
      phone: '+919876543211',
      majorCategory: 'Civil Works',
      minorCategories: ['Structural Steel'],
      addedByBuyerCompany: 'Alpha Infra Corp',
      source: 'buyer_uploaded',
      buyerAccountId: buyerAccount.id,
    });

    procucevVendor1 = storeService.addVendor({
      name: 'Procucev Civil Network Partner',
      email: 'network@procucevpartner.com',
      phone: '+919876543220',
      majorCategory: 'Civil Works',
      minorCategories: ['Cement & Concrete'],
      source: 'procucev_network',
      isProcucevDirect: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Enterprise QUA V1 (Mode 1 - Private Sourcing)', () => {
    test('auto-assigns matching client vendors from private roster when assignedVendors is empty', async () => {
      const createdRfq = storeService.createRFQ(
        {
          title: 'Cement & Steel Procurement for Metro Project',
          category: 'Civil Works',
          sourcingMode: 'mode_1',
          deliveryLocation: 'Mumbai',
          lineItems: [
            { id: 'item-1', name: 'OPC 53 Cement', majorCategory: 'Civil Works', minorCategory: 'Cement & Concrete', quantity: 500 },
          ],
        },
        buyerAccount
      );

      expect(createdRfq.sourcingMode).toBe('mode_1');
      expect(createdRfq.assignedVendors.length).toBeGreaterThan(0);
      expect(createdRfq.procucevVendorCount).toBe(0);

      // Verify all assigned vendors are strictly private client list vendors
      for (const vendor of createdRfq.assignedVendors) {
        expect(vendor.vendorCategory).toBe('Client List');
        expect(vendor.source).toBe('buyer_uploaded');
        expect(storeService.isProcucevVendor(vendor)).toBe(false);
      }

      // Verify followUpData is synchronized
      expect(createdRfq.followUpData).toBeDefined();
      expect(createdRfq.followUpData.totalInvited).toBe(createdRfq.assignedVendors.length);
      expect(createdRfq.followUpData.vendors.length).toBe(createdRfq.assignedVendors.length);

      // Verify chasers and invitations were scheduled
      expect(rfqChaserScheduler.scheduleRFQChasers).toHaveBeenCalled();
    });

    test('preserves explicit private assignedVendors with vendorCategory stamped', async () => {
      const createdRfq = storeService.createRFQ(
        {
          title: 'Direct Private Invitation RFQ',
          category: 'Civil Works',
          sourcingMode: 'mode_1',
          assignedVendors: [
            {
              id: clientVendor1.id,
              name: clientVendor1.name,
              email: clientVendor1.email,
              phone: clientVendor1.phone,
              majorCategory: 'Civil Works',
              vendorCategory: 'Client List',
            },
          ],
        },
        buyerAccount
      );

      expect(createdRfq.assignedVendors.length).toBe(1);
      expect(createdRfq.assignedVendors[0].id).toBe(clientVendor1.id);
      expect(createdRfq.assignedVendors[0].vendorCategory).toBe('Client List');
      expect(createdRfq.procucevVendorCount).toBe(0);
      expect(createdRfq.followUpData.totalInvited).toBe(1);
    });

    test('autoAssignVendorsFromDB enriches empty V1 RFQ with private roster only', async () => {
      const rfq = storeService.createRFQ(
        {
          title: 'Unassigned V1 RFQ',
          category: 'Civil Works',
          sourcingMode: 'mode_1',
          assignedVendors: [],
        },
        buyerAccount
      );

      // Force empty to test autoAssignVendorsFromDB
      rfq.assignedVendors = [];
      const updated = await storeService.autoAssignVendorsFromDB(rfq);

      expect(updated.assignedVendors.length).toBeGreaterThan(0);
      expect(updated.procucevVendorCount).toBe(0);
      expect(updated.assignedVendors.every((v) => v.vendorCategory === 'Client List')).toBe(true);
      expect(updated.followUpData.totalInvited).toBe(updated.assignedVendors.length);
    });
  });

  describe('Enterprise QUA V2 (Mode 2 - Hybrid Sourcing)', () => {
    test('assigns both client roster and Procucev network vendors upon creation', async () => {
      const createdRfq = storeService.createRFQ(
        {
          title: 'Hybrid Sourcing Construction RFQ',
          category: 'Civil Works',
          sourcingMode: 'mode_2',
          deliveryLocation: 'Hyderabad',
          lineItems: [
            { id: 'item-1', name: 'Structural TMT Bars', majorCategory: 'Civil Works', minorCategory: 'Cement & Concrete', quantity: 20 },
          ],
        },
        buyerAccount
      );

      expect(createdRfq.sourcingMode).toBe('mode_2');
      expect(createdRfq.assignedVendors.length).toBeGreaterThan(0);

      const clientListVendors = createdRfq.assignedVendors.filter((v) => v.vendorCategory === 'Client List');
      const networkVendors = createdRfq.assignedVendors.filter((v) => v.vendorCategory === 'Procucev Network');

      expect(clientListVendors.length).toBeGreaterThan(0);
      expect(networkVendors.length).toBeGreaterThan(0);
      expect(createdRfq.procucevVendorCount).toBe(networkVendors.length);
      expect(createdRfq.followUpData.totalInvited).toBe(createdRfq.assignedVendors.length);
    });

    test('autoAssignVendorsFromDB enriches V2 RFQ with both client and network candidates', async () => {
      const rfq = storeService.createRFQ(
        {
          title: 'Hybrid RFQ Pending Assignment',
          category: 'Civil Works',
          sourcingMode: 'mode_2',
          assignedVendors: [],
        },
        buyerAccount
      );

      rfq.assignedVendors = [];
      const updated = await storeService.autoAssignVendorsFromDB(rfq);

      expect(updated.assignedVendors.length).toBeGreaterThan(0);
      expect(updated.assignedVendors.some((v) => v.vendorCategory === 'Client List')).toBe(true);
      expect(updated.assignedVendors.some((v) => v.vendorCategory === 'Procucev Network')).toBe(true);
      expect(updated.followUpData.totalInvited).toBe(updated.assignedVendors.length);
    });
  });

  describe('Controller and Count Verification', () => {
    test('getRFQById auto-assigns vendors for V1 and returns correct assigned count', async () => {
      const created = storeService.createRFQ(
        {
          title: 'Controller Test V1 RFQ',
          category: 'Civil Works',
          sourcingMode: 'mode_1',
          assignedVendors: [],
        },
        buyerAccount
      );

      // Force empty to verify controller auto-assign trigger
      created.assignedVendors = [];
      const req = {
        params: { id: created.id },
        user: { role: 'buyer', email: buyerAccount.corporateEmail, id: buyerAccount.id },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await rfqController.getRFQById(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.success).toBe(true);
      expect(responseData.data.assignedVendors.length).toBeGreaterThan(0);
      expect(responseData.data.procucevVendorCount).toBe(0);
    });

    test('createRFQ controller sets procucevVendorCount to 0 for V1 and >0 for V2', async () => {
      const reqV1 = {
        body: {
          title: 'Controller V1 Creation',
          category: 'Civil Works',
          sourcingMode: 'mode_1',
          budget: 50000,
          targetDeliveryDate: '2099-01-01',
          deliveryLocation: 'Mumbai',
          deliveryPincode: '400001',
          lineItems: [{ id: '1', itemName: 'TMT bars', technicalSpecs: 'Fe 500D, 12 mm dia', quantity: 100, unit: 'Mt', majorCategory: 'Civil Works', minorCategory: 'TMT BARS' }],
        },
        user: { role: 'buyer', email: buyerAccount.corporateEmail, id: buyerAccount.id },
      };
      const resV1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await rfqController.createRFQ(reqV1, resV1, next);
      const dataV1 = resV1.json.mock.calls[0][0]?.data;
      expect(dataV1).toBeDefined();
      expect(dataV1.procucevVendorCount).toBe(0);
      expect(dataV1.assignedVendors.length).toBeGreaterThan(0);

      const reqV2 = {
        body: {
          title: 'Controller V2 Creation',
          category: 'Civil Works',
          sourcingMode: 'mode_2',
          budget: 50000,
          targetDeliveryDate: '2099-01-01',
          deliveryLocation: 'Mumbai',
          deliveryPincode: '400001',
          lineItems: [{ id: '1', itemName: 'TMT bars', technicalSpecs: 'Fe 500D, 12 mm dia', quantity: 100, unit: 'Mt', majorCategory: 'Civil Works', minorCategory: 'TMT BARS' }],
        },
        user: { role: 'buyer', email: buyerAccount.corporateEmail, id: buyerAccount.id },
      };
      const resV2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await rfqController.createRFQ(reqV2, resV2, next);
      const dataV2 = resV2.json.mock.calls[0][0]?.data;
      expect(dataV2).toBeDefined();
      expect(dataV2.assignedVendors.length).toBeGreaterThan(0);
      expect(dataV2.assignedVendors.some((v) => v.vendorCategory === 'Procucev Network')).toBe(true);
    });
  });
});
