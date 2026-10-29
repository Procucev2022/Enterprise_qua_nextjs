/**
 * Comprehensive Unit Tests for Gmail Label Handling Workflow
 * 
 * Verifies that:
 * 1. Successfully created RFQs automatically move the email to the Processed label in Gmail.
 * 2. Failed RFQs automatically move the email to the Error label in Gmail and retain error details.
 * 3. Labels are resolved via list/create with in-memory caching.
 * 4. Error details are preserved across state.recentErrors, outcomes, and emailGateway.getStatus().
 */

const { google } = require('googleapis');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const mailerService = require('../src/services/mailerService');
const {
  EMAIL_GATEWAY_CONFIG,
  GMAIL_GATEWAY_LABELS,
  EMAIL_GATEWAY_MESSAGES,
} = require('../src/config/constants');
const { INGESTION_OUTCOME } = emailGatewayQueries;

describe('Gmail Label-Handling Workflow (Processed & Error Labels)', () => {
  const PROCESSED_LABEL_ID = 'Label_Processed_101';
  const ERROR_LABEL_ID = 'Label_Error_102';

  function mockGmailApi({
    labels = [
      { id: PROCESSED_LABEL_ID, name: GMAIL_GATEWAY_LABELS.PROCESSED },
      { id: ERROR_LABEL_ID, name: GMAIL_GATEWAY_LABELS.ERROR },
    ],
    messages = [{ id: 'msg_001' }],
    rawContent = 'From: buyer@corp.com\r\nSubject: Need Steel Pipes\r\n\r\nItem: Steel Pipe, Qty: 100',
    createLabelSuccess = true,
  } = {}) {
    const listLabels = jest.fn().mockResolvedValue({ data: { labels } });
    const createLabel = jest.fn().mockImplementation(({ requestBody }) => {
      if (createLabelSuccess) {
        return Promise.resolve({ data: { id: `Label_Created_${requestBody.name}`, name: requestBody.name } });
      }
      return Promise.reject(new Error('Label creation quota exceeded'));
    });
    const listMessages = jest.fn().mockResolvedValue({ data: { messages } });
    const getMessage = jest.fn().mockResolvedValue({
      data: rawContent ? { raw: Buffer.from(rawContent, 'utf8').toString('base64url') } : {},
    });
    const modifyMessage = jest.fn().mockResolvedValue({});

    return {
      users: {
        labels: {
          list: listLabels,
          create: createLabel,
        },
        messages: {
          list: listMessages,
          get: getMessage,
          modify: modifyMessage,
        },
      },
    };
  }

  const enabledConfig = (overrides = {}) =>
    emailGatewayService.resolveConfig({
      EMAIL_GATEWAY_ENABLED: 'true',
      EMAIL_GATEWAY_USER: 'rfq@procucev.com',
      ...overrides,
    });

  beforeEach(() => {
    emailGatewayService.clearLabelCache();
    emailGatewayService.runtime.recentErrors = [];
    emailGatewayService.runtime.lastError = null;
    emailGatewayService.runtime.isPolling = false;
    jest.spyOn(mailerService, 'getGmailOAuthClient').mockReturnValue({});
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
    jest.spyOn(emailGatewayQueries, 'countFailedAttempts').mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Label Resolution and Creation (getOrCreateLabelId)', () => {
    test('resolves existing label ID from Gmail and caches it for repeat calls', async () => {
      const api = mockGmailApi();
      const id1 = await emailGatewayService.getOrCreateLabelId(api, 'Processed');
      expect(id1).toBe(PROCESSED_LABEL_ID);
      expect(api.users.labels.list).toHaveBeenCalledTimes(1);

      // Repeat call must hit cache and NOT call API again
      const id2 = await emailGatewayService.getOrCreateLabelId(api, 'Processed');
      expect(id2).toBe(PROCESSED_LABEL_ID);
      expect(api.users.labels.list).toHaveBeenCalledTimes(1);
    });

    test('creates label when it does not exist in Gmail', async () => {
      const api = mockGmailApi({ labels: [] });
      const id = await emailGatewayService.getOrCreateLabelId(api, 'CustomError');
      expect(id).toBe('Label_Created_CustomError');
      expect(api.users.labels.list).toHaveBeenCalledTimes(1);
      expect(api.users.labels.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          requestBody: expect.objectContaining({ name: 'CustomError' }),
        })
      );
    });

    test('handles errors during labels.list gracefully and falls back to null', async () => {
      const api = mockGmailApi();
      api.users.labels.list.mockRejectedValueOnce(new Error('Network error on list'));
      api.users.labels.create.mockRejectedValueOnce(new Error('Network error on create'));

      const id = await emailGatewayService.getOrCreateLabelId(api, 'Processed');
      expect(id).toBeNull();
    });

    test('returns null when gmail client or label name is missing', async () => {
      expect(await emailGatewayService.getOrCreateLabelId(null, 'Processed')).toBeNull();
      expect(await emailGatewayService.getOrCreateLabelId({}, '')).toBeNull();
    });

    test('handles missing labels.list function gracefully and proceeds to create', async () => {
      const api = { users: { labels: { create: jest.fn().mockResolvedValue({ data: { id: 'created-list-missing' } }) } } };
      const id = await emailGatewayService.getOrCreateLabelId(api, 'NewListMissing');
      expect(id).toBe('created-list-missing');
    });

    test('handles missing labels.create function gracefully and returns null', async () => {
      const api = { users: { labels: { list: jest.fn().mockResolvedValue({ data: { labels: [] } }) } } };
      const id = await emailGatewayService.getOrCreateLabelId(api, 'NewCreateMissing');
      expect(id).toBeNull();
    });

    test('handles list response without labels array', async () => {
      const api = {
        users: {
          labels: {
            list: jest.fn().mockResolvedValue({ data: {} }),
            create: jest.fn().mockResolvedValue({ data: { id: 'created-no-array' } }),
          },
        },
      };
      const id = await emailGatewayService.getOrCreateLabelId(api, 'NoArray');
      expect(id).toBe('created-no-array');
    });

    test('continues to create if existing label object has no id', async () => {
      const api = {
        users: {
          labels: {
            list: jest.fn().mockResolvedValue({ data: { labels: [{ name: 'NoIdLabel' }] } }),
            create: jest.fn().mockResolvedValue({ data: { id: 'created-after-no-id' } }),
          },
        },
      };
      const id = await emailGatewayService.getOrCreateLabelId(api, 'NoIdLabel');
      expect(id).toBe('created-after-no-id');
    });

    test('returns null if createRes returns no id', async () => {
      const api = {
        users: {
          labels: {
            list: jest.fn().mockResolvedValue({ data: { labels: [] } }),
            create: jest.fn().mockResolvedValue({ data: {} }),
          },
        },
      };
      const id = await emailGatewayService.getOrCreateLabelId(api, 'CreateEmpty');
      expect(id).toBeNull();
    });
  });

  describe('Successful RFQ Creation -> Processed Label', () => {
    test('moves email to Processed label (adds Processed, removes UNREAD and INBOX) upon successful RFQ creation', async () => {
      const api = mockGmailApi({ messages: [{ id: 'msg_success_1' }] });
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.INGESTED,
        detail: 'Raised with 5 line items',
        rfq: { id: 'rfq-101', rfqNumber: 'RFQ2026102801' },
        message: { messageId: '<req-001@corp.com>', fromAddress: 'buyer@corp.com', subject: 'Pipes' },
      });

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.ingested).toBe(1);
      expect(result.outcomes[0]).toEqual(
        expect.objectContaining({
          uid: 'msg_success_1',
          status: INGESTION_OUTCOME.INGESTED,
          labelApplied: 'Processed',
        })
      );

      // Verify that modify was called with Processed label added, and UNREAD + INBOX removed
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg_success_1',
        requestBody: {
          addLabelIds: [PROCESSED_LABEL_ID],
          removeLabelIds: ['UNREAD', 'INBOX'],
        },
      });
    });

    test('moves duplicate or already processed message to Processed label', async () => {
      const api = mockGmailApi({ messages: [{ id: 'dup_msg' }] });
      jest.spyOn(google, 'gmail').mockReturnValue(api);
      jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0].status).toBe(EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED);
      expect(result.outcomes[0].labelApplied).toBe('Processed');
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'dup_msg',
        requestBody: {
          addLabelIds: [PROCESSED_LABEL_ID],
          removeLabelIds: ['UNREAD', 'INBOX'],
        },
      });
    });

    test('falls back to removeLabelIds UNREAD when processed label id cannot be resolved', async () => {
      const api = mockGmailApi({ messages: [{ id: 'msg_no_labels' }] });
      api.users.labels.list.mockRejectedValue(new Error('Labels API unavailable'));
      api.users.labels.create.mockRejectedValue(new Error('Labels API unavailable'));
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.INGESTED,
        detail: 'Success',
        rfq: { id: 'rfq-fallback', rfqNumber: 'RFQ-FALLBACK' },
      });

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0].labelApplied).toBeNull();
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg_no_labels',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });

    test('falls back to removeLabelIds UNREAD for duplicate when processed label id cannot be resolved', async () => {
      const api = mockGmailApi({ messages: [{ id: 'dup_no_labels' }] });
      api.users.labels.list.mockRejectedValue(new Error('Labels API unavailable'));
      api.users.labels.create.mockRejectedValue(new Error('Labels API unavailable'));
      jest.spyOn(google, 'gmail').mockReturnValue(api);
      jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0].status).toBe(EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED);
      expect(result.outcomes[0].labelApplied).toBeNull();
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'dup_no_labels',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });
  });

  describe('Failed RFQ Creation -> Error Label & Debugging Retention', () => {
    test('moves email to Error label and retains error details when processMessage returns NO_LINE_ITEMS', async () => {
      const api = mockGmailApi({ messages: [{ id: 'fail_msg_1' }] });
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      const errorDetail = 'AI extraction produced no line items (EMPTY_TABLE)';
      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.NO_LINE_ITEMS,
        detail: errorDetail,
        message: { messageId: '<empty@corp.com>', fromAddress: 'buyer@corp.com', subject: 'Empty RFQ' },
      });

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.ingested).toBe(0);
      expect(result.outcomes[0]).toEqual(
        expect.objectContaining({
          uid: 'fail_msg_1',
          status: INGESTION_OUTCOME.NO_LINE_ITEMS,
          detail: errorDetail,
          error: errorDetail,
          labelApplied: 'Error',
        })
      );

      // Verify modify was called to move to Error label
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'fail_msg_1',
        requestBody: {
          addLabelIds: [ERROR_LABEL_ID],
          removeLabelIds: ['UNREAD', 'INBOX'],
        },
      });

      // Verify error details are retained in runtime state
      expect(emailGatewayService.runtime.lastError).toBe(errorDetail);
      expect(emailGatewayService.runtime.recentErrors.length).toBeGreaterThan(0);
      expect(emailGatewayService.runtime.recentErrors[0]).toEqual(
        expect.objectContaining({
          status: INGESTION_OUTCOME.NO_LINE_ITEMS,
          detail: errorDetail,
          uid: 'fail_msg_1',
        })
      );
    });

    test('moves email to Error label when email body is unreadable or empty', async () => {
      const api = mockGmailApi({ messages: [{ id: 'unreadable_1' }], rawContent: null });
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0]).toEqual(
        expect.objectContaining({
          uid: 'unreadable_1',
          status: INGESTION_OUTCOME.UNREADABLE,
          error: 'Gmail returned no message body',
          labelApplied: 'Error',
        })
      );

      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'unreadable_1',
        requestBody: {
          addLabelIds: [ERROR_LABEL_ID],
          removeLabelIds: ['UNREAD', 'INBOX'],
        },
      });
      expect(emailGatewayService.runtime.lastError).toBe('Gmail returned no message body');
    });

    test('moves email to Error label and retains error stack trace when retries are exhausted', async () => {
      const api = mockGmailApi({ messages: [{ id: 'exhausted_msg' }] });
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      const errorMsg = 'Gemini quota completely exhausted';
      jest.spyOn(emailGatewayService, 'processMessage').mockRejectedValue(new Error(errorMsg));
      // Simulate attempts >= max attempts
      emailGatewayQueries.countFailedAttempts.mockResolvedValue(emailGatewayService.EMAIL_GATEWAY_MAX_ATTEMPTS - 1);

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0]).toEqual(
        expect.objectContaining({
          uid: 'exhausted_msg',
          status: INGESTION_OUTCOME.FAILED,
          error: errorMsg,
          willRetry: false,
          labelApplied: 'Error',
        })
      );

      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'exhausted_msg',
        requestBody: {
          addLabelIds: [ERROR_LABEL_ID],
          removeLabelIds: ['UNREAD', 'INBOX'],
        },
      });

      expect(emailGatewayService.runtime.recentErrors[0]).toEqual(
        expect.objectContaining({
          status: INGESTION_OUTCOME.FAILED,
          error: errorMsg,
          exhausted: true,
        })
      );
    });

    test('does NOT move to Error label while retry attempts remain (leaves mail unread for retry)', async () => {
      const api = mockGmailApi({ messages: [{ id: 'transient_msg' }] });
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      jest.spyOn(emailGatewayService, 'processMessage').mockRejectedValue(new Error('Transient 503 error'));
      emailGatewayQueries.countFailedAttempts.mockResolvedValue(0); // attempt 1 of 3

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0]).toEqual(
        expect.objectContaining({
          status: INGESTION_OUTCOME.FAILED,
          willRetry: true,
          labelApplied: null,
        })
      );

      // Should NOT have modified message labels yet, leaving it unread
      expect(api.users.messages.modify).not.toHaveBeenCalled();
      // But error details are still retained in recentErrors for debugging
      expect(emailGatewayService.runtime.recentErrors[0].error).toBe('Transient 503 error');
    });

    test('marks outbound system message as read without applying Processed or Error labels', async () => {
      const api = mockGmailApi({ messages: [{ id: 'outbound_msg' }] });
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.SKIPPED_OUTBOUND,
        detail: 'Skipped outbound system notification',
      });

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0]).toEqual(
        expect.objectContaining({
          uid: 'outbound_msg',
          status: INGESTION_OUTCOME.SKIPPED_OUTBOUND,
          labelApplied: null,
        })
      );
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'outbound_msg',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });

    test('falls back to removeLabelIds UNREAD on failure when error label id cannot be resolved', async () => {
      const api = mockGmailApi({ messages: [{ id: 'fail_no_labels' }] });
      api.users.labels.list.mockRejectedValue(new Error('Labels API unavailable'));
      api.users.labels.create.mockRejectedValue(new Error('Labels API unavailable'));
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.NO_LINE_ITEMS,
        detail: 'No items',
      });

      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());

      expect(result.outcomes[0].labelApplied).toBeNull();
      expect(api.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'fail_no_labels',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });
  });

  describe('Status Endpoint & Centralized Error Debugging Visibility', () => {
    test('getStatus() exposes recentErrors and configured label names', async () => {
      emailGatewayService.recordRecentError(emailGatewayService.runtime, {
        messageId: 'gmail-test-1',
        status: INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT,
        detail: 'Maximum 49 line items exceeded (received 60)',
      });

      const status = await emailGatewayService.getStatus();
      expect(status.labels).toEqual({
        processed: 'Processed',
        error: 'Error',
      });
      expect(status.recentErrors).toHaveLength(1);
      expect(status.recentErrors[0].detail).toContain('Maximum 49 line items exceeded');
    });

    test('recordRecentError bounds history to maximum 20 entries', () => {
      const state = { recentErrors: [] };
      for (let i = 0; i < 25; i++) {
        emailGatewayService.recordRecentError(state, {
          messageId: `err-${i}`,
          detail: `Error ${i}`,
        });
      }
      expect(state.recentErrors).toHaveLength(20);
      expect(state.recentErrors[0].messageId).toBe('err-24');
    });

    test('recordRecentError handles empty state and empty error info gracefully', () => {
      expect(() => emailGatewayService.recordRecentError(null, {})).not.toThrow();
      const state = {};
      emailGatewayService.recordRecentError(state, {});
      expect(state.lastError).toBe('Email processing error');
      expect(state.recentErrors).toHaveLength(1);

      // Default errorInfo = {}
      const stateDefault = { recentErrors: [] };
      emailGatewayService.recordRecentError(stateDefault);
      expect(stateDefault.lastError).toBe('Email processing error');

      // errorInfo.error branch
      const stateErr = { recentErrors: [] };
      emailGatewayService.recordRecentError(stateErr, { error: 'Direct error message' });
      expect(stateErr.lastError).toBe('Direct error message');

      // errorInfo.status branch
      const stateStatus = { recentErrors: [] };
      emailGatewayService.recordRecentError(stateStatus, { status: 'STATUS_ONLY' });
      expect(stateStatus.lastError).toBe('STATUS_ONLY');
    });

    test('supports custom label names via environment variables in resolveConfig and resolveVendorConfig', () => {
      const customBuyer = emailGatewayService.resolveConfig({
        GMAIL_LABEL_PROCESSED: 'MyProcessed',
        GMAIL_LABEL_ERROR: 'MyError',
      });
      expect(customBuyer.labelProcessed).toBe('MyProcessed');
      expect(customBuyer.labelError).toBe('MyError');

      const customVendor = emailGatewayService.resolveVendorConfig({
        VENDOR_GMAIL_LABEL_PROCESSED: 'VendorProcessed',
        VENDOR_GMAIL_LABEL_ERROR: 'VendorError',
      });
      expect(customVendor.labelProcessed).toBe('VendorProcessed');
      expect(customVendor.labelError).toBe('VendorError');
    });

    test('swallows and logs warning when gmail.users.messages.modify fails', async () => {
      const api = mockGmailApi({ messages: [{ id: 'fail_modify' }] });
      api.users.messages.modify.mockRejectedValueOnce(new Error('Label modification rejected by Gmail API'));
      jest.spyOn(google, 'gmail').mockReturnValue(api);

      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.INGESTED,
        detail: 'Created',
        rfq: { id: 'rfq-2' },
      });

      // Must not throw despite modify failure
      const result = await emailGatewayService.pollViaGmailApi(enabledConfig());
      expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.INGESTED);
    });
  });
});
