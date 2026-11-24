const {
  STANDARDIZED_COMMUNICATION_CATEGORIES,
  STANDARDIZED_COMMUNICATION_SCENARIO_IDS,
  SCENARIO_TO_STANDARDIZED_CATEGORY,
  resolveStandardizedCommunicationCategory,
} = require('../src/config/constants');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const directoryKPIQueries = require('../src/db/directoryKPIQueries');
const pool = require('../src/db/pool');

describe('Action Center Communication Templates, Two-Track Routing & Analytics Linkage', () => {
  describe('Standardized Communication Categories & Resolution', () => {
    test('contains exactly the 8 standardized communication categories', () => {
      expect(STANDARDIZED_COMMUNICATION_CATEGORIES).toHaveLength(8);
      expect(STANDARDIZED_COMMUNICATION_CATEGORIES).toEqual([
        'Credit / Quote (Buyer / Seller)',
        'Follow-up / New',
        'Demo Schedule',
        'Send Proposal',
        'Send Corporate Email',
        'Onboarding Process',
        'Registration Task',
        'Internal Operations (Others)',
      ]);
    });

    test('maps all 8 scenario IDs to their exact canonical category names', () => {
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.CREDIT_QUOTE))
        .toBe('Credit / Quote (Buyer / Seller)');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.FOLLOWUP_NEW))
        .toBe('Follow-up / New');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.DEMO_SCHEDULE))
        .toBe('Demo Schedule');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.SEND_PROPOSAL))
        .toBe('Send Proposal');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.SEND_CORPORATE_EMAIL))
        .toBe('Send Corporate Email');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.ONBOARDING_PROCESS))
        .toBe('Onboarding Process');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.REGISTRATION_TASK))
        .toBe('Registration Task');
      expect(resolveStandardizedCommunicationCategory(STANDARDIZED_COMMUNICATION_SCENARIO_IDS.INTERNAL_OPERATIONS))
        .toBe('Internal Operations (Others)');
    });

    test('resolves fuzzy and fallback categories accurately', () => {
      expect(resolveStandardizedCommunicationCategory('Quote Revision Request')).toBe('Credit / Quote (Buyer / Seller)');
      expect(resolveStandardizedCommunicationCategory('Schedule Client Demo')).toBe('Demo Schedule');
      expect(resolveStandardizedCommunicationCategory('Commercial Proposal')).toBe('Send Proposal');
      expect(resolveStandardizedCommunicationCategory('Enterprise Partnership Inquiry')).toBe('Send Corporate Email');
      expect(resolveStandardizedCommunicationCategory('Supplier Onboarding Checklist')).toBe('Onboarding Process');
      expect(resolveStandardizedCommunicationCategory('User Registration')).toBe('Registration Task');
      expect(resolveStandardizedCommunicationCategory('Operations Review')).toBe('Internal Operations (Others)');
      expect(resolveStandardizedCommunicationCategory('')).toBe('Follow-up / New');
      expect(resolveStandardizedCommunicationCategory(null)).toBe('Follow-up / New');
    });
  });

  describe('Task Auto-Completion on Send Proposal and Send Corporate Email', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('auto-completes task when entity is an internal task', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const mockTask = {
        id: 'tsk_101',
        title: 'Send Commercial Proposal to Veera Solutions',
        status: 'Open',
      };
      jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue(mockTask);
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
        ...mockTask,
        status: 'Closed',
      });

      const closed = await internalTaskQueries.autoCompleteTasksForScenario(
        'internal_task',
        'tsk_101',
        'send_proposal',
        { id: 'user_1', fullName: 'Category Manager' }
      );

      expect(updateSpy).toHaveBeenCalledWith(
        'tsk_101',
        expect.objectContaining({
          status: 'Closed',
          notes: expect.stringContaining('Commercial Proposal'),
        }),
        expect.any(Object)
      );
      expect(closed).toHaveLength(1);
    });

    test('returns empty array when internal task is already closed or not found', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({
        id: 'tsk_already_closed',
        status: 'Closed',
      });

      const res = await internalTaskQueries.autoCompleteTasksForScenario(
        'internal_task',
        'tsk_already_closed',
        'send_proposal',
        {}
      );
      expect(res).toEqual([]);

      jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue(null);
      const resNull = await internalTaskQueries.autoCompleteTasksForScenario(
        'internal_task',
        'tsk_not_found',
        'send_proposal',
        {}
      );
      expect(resNull).toEqual([]);
    });

    test('auto-completes open linked tasks for a seller/vendor entity upon Send Corporate Email', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { id: 'tsk_seller_1', title: 'Onboard Seller Enterprise', status: 'In Progress' },
        ],
      });
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
        id: 'tsk_seller_1',
        status: 'Closed',
      });

      const closed = await internalTaskQueries.autoCompleteTasksForScenario(
        'SELLER',
        'vdr_abc',
        'send_corporate_email',
        { id: 'cm_1', fullName: 'Category Manager' }
      );

      expect(updateSpy).toHaveBeenCalled();
      expect(closed).toHaveLength(1);
    });

    test('catches errors gracefully and returns empty array when query fails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB Connection Timeout'));

      const res = await internalTaskQueries.autoCompleteTasksForScenario(
        'BUYER',
        'byr_err',
        'send_proposal',
        {}
      );
      expect(res).toEqual([]);
    });

    test('exercises internal task creation with idempotency fingerprint and completion fields', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1, rows: [{ id: 'tsk_created', title: 'Idempotent Credit Task' }] });
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => {
        return callback({
          query: jest.fn().mockResolvedValue({
            rowCount: 1,
            rows: [{ id: 'tsk_created', title: 'Idempotent Credit Task' }],
          }),
        });
      });

      const taskData = {
        title: 'Credit Allocation',
        description: 'Adding 10 credits',
        taskCategory: 'CREDIT_MANAGEMENT',
        taskType: 'Add Credits',
        priority: 'High',
        status: 'Closed',
        completed_at: '2026-11-23T10:00:00Z',
        completed_by_user_id: 'usr_actor_1',
        completed_by_name: 'Actor Name',
        completion_remarks: 'Completed immediately',
        credit_account_type: 'BUYER',
        credit_account_id: 'byr_1',
        credit_quantity: 10,
        credit_reason: 'Annual tier bonus',
      };

      const actor = {
        uuid: 'usr_actor_1',
        email: 'actor@procucev.com',
        name: 'Actor Name',
        role: 'admin',
      };

      const options = {
        idempotencyKey: 'idemp-12345',
        approvalData: {
          module: 'CREDIT',
          project: 'EXPANSION',
          applicant_name: 'Requester',
          applicant_email: 'req@procucev.com',
          value_impact: 'High',
          amount: 5000,
          quantity: 10,
          buyer_id: 'byr_1',
          seller_id: 'vdr_1',
          assigned_approver: 'admin@procucev.com',
          details: 'Details note',
        },
      };

      const created = await internalTaskQueries.createInternalTask(taskData, actor, options);
      expect(created).toBeDefined();

      // Call again with camelCase and wildcards to cover remaining fallback branches
      const taskDataCamel = {
        title: 'Credit Allocation Camel',
        description: 'Adding credits',
        taskCategory: 'CREDIT_MANAGEMENT',
        taskType: 'Add Credits',
        priority: 'High',
        status: 'Closed',
        completedAt: '2026-11-23T10:00:00Z',
        completedByUserId: 'usr_actor_2',
        completedByName: 'Actor Two',
        completionRemarks: 'All set',
        creditAccountType: 'BUYER',
        creditAccountId: 'byr_2',
        creditQuantity: 5,
        creditReason: 'Bonus',
      };
      const actorCamel = {
        id: 'usr_actor_2',
        fullName: 'Actor Two',
        email: 'actor2@procucev.com',
      };
      const optionsCamel = {
        idempotencyKey: 'idemp-67890',
        approvalData: {
          module: 'CREDIT',
          project: 'PROJECT_2',
          applicant_name: 'Requester 2',
          applicant_email: 'req2@procucev.com',
          assigned_approver: 'admin@procucev.com',
          amount: 100,
          quantity: 5,
          seller_id: 'vdr_2',
        },
      };
      const createdCamel = await internalTaskQueries.createInternalTask(taskDataCamel, actorCamel, optionsCamel);
      expect(createdCamel).toBeDefined();

      // Test escapeLikeWildcards with special characters (%, _, \)
      await internalTaskQueries.searchRelatedEntities('RFQ', 'special%_%\\query').catch(() => {});
    });

    test('auto-completes open linked tasks for a buyer entity upon Send Corporate Email', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { id: 'tsk_201', title: 'Connect with Buyer Leadership', status: 'Pending' },
        ],
      });
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
        id: 'tsk_201',
        status: 'Closed',
      });

      const closed = await internalTaskQueries.autoCompleteTasksForScenario(
        'BUYER',
        'byr_veera_123',
        'send_corporate_email',
        { id: 'cm_1', fullName: 'Category Manager' }
      );

      expect(updateSpy).toHaveBeenCalledWith(
        'tsk_201',
        expect.objectContaining({
          status: 'Closed',
          notes: expect.stringContaining('Corporate Email'),
        }),
        expect.any(Object)
      );
      expect(closed).toHaveLength(1);
    });

    test('ignores non-auto-complete scenarios like followup_new or demo_schedule', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask');

      const res = await internalTaskQueries.autoCompleteTasksForScenario(
        'BUYER',
        'byr_veera_123',
        'followup_new',
        {}
      );

      expect(updateSpy).not.toHaveBeenCalled();
      expect(res).toEqual([]);
    });

    test('returns empty array when pool has no storage', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const res = await internalTaskQueries.autoCompleteTasksForScenario(
        'internal_task',
        'tsk_1',
        'send_proposal',
        {}
      );
      expect(res).toEqual([]);
    });
  });

  describe('Category Manager Outreach Analytics Live DB Linkage', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('aggregates communication records into 8 categories and 4 channels', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const mockRows = [
        { channel: 'EMAIL', metadata: { scenarioId: 'credit_quote' } },
        { channel: 'CALL', metadata: { category: 'Follow-up / New' } },
        { channel: 'SMS', metadata: { scenarioId: 'demo_schedule' } },
        { channel: 'WHATSAPP', metadata: { templateType: 'send_proposal' } },
        { channel: 'BOTH', metadata: { scenarioId: 'send_corporate_email' } },
        { channel: 'EMAIL', metadata: { scenarioId: 'onboarding_process' } },
        { channel: 'SMS', metadata: { scenarioId: 'registration_task' } },
        { channel: 'EMAIL', metadata: { scenarioId: 'internal_operations' } },
      ];
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: mockRows });

      const analytics = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB({ accountType: 'buyer' });

      expect(analytics.totalOutreach).toBe(8);
      expect(analytics.byCategory['Credit / Quote (Buyer / Seller)']).toBe(1);
      expect(analytics.byCategory['Follow-up / New']).toBe(1);
      expect(analytics.byCategory['Demo Schedule']).toBe(1);
      expect(analytics.byCategory['Send Proposal']).toBe(1);
      expect(analytics.byCategory['Send Corporate Email']).toBe(1);
      expect(analytics.byCategory['Onboarding Process']).toBe(1);
      expect(analytics.byCategory['Registration Task']).toBe(1);
      expect(analytics.byCategory['Internal Operations (Others)']).toBe(1);

      expect(analytics.byChannel.Call).toBe(1);
      expect(analytics.byChannel.WhatsApp).toBe(1);
      expect(analytics.byChannel.SMS).toBe(3); // 2 SMS + 1 BOTH
      expect(analytics.byChannel.Email).toBe(4); // 3 EMAIL + 1 BOTH
    });

    test('returns default zero counts when pool has no storage or error occurs', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const analytics = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB();

      expect(analytics.totalOutreach).toBe(0);
      expect(analytics.byCategory['Credit / Quote (Buyer / Seller)']).toBe(0);
      expect(analytics.byChannel.Email).toBe(0);

      // Error thrown by pool.query
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB Query Failure'));
      const analyticsOnErr = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB({ accountType: 'seller' });
      expect(analyticsOnErr.totalOutreach).toBe(0);
    });

    test('handles accountType vendor, all, stringified metadata and unknown channels', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const mockRows = [
        { channel: 'UNKNOWN_CHANNEL', metadata: JSON.stringify({ scenarioId: 'followup_new' }) },
        { channel: 'sms', metadata: 'invalid json {' },
        { channel: null, metadata: null },
      ];
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: mockRows });

      const analyticsVendor = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB({ accountType: 'vendor' });
      expect(analyticsVendor.totalOutreach).toBe(3);

      const analyticsAll = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB({ accountType: 'all' });
      expect(analyticsAll.totalOutreach).toBe(3);
    });

    test('wires outreachAnalytics into getBuyerDirectoryKPIStatsFromDB and getSellerDirectoryKPIStatsFromDB', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const buyerStats = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      const sellerStats = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();

      expect(buyerStats.outreachAnalytics).toBeDefined();
      expect(buyerStats.outreachAnalytics.totalOutreach).toBe(0);
      expect(sellerStats.outreachAnalytics).toBeDefined();
      expect(sellerStats.outreachAnalytics.totalOutreach).toBe(0);
    });
  });
});
