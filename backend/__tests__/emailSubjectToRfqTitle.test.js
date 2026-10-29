const request = require('supertest');
const app = require('../src/app');
const emailIngestionService = require('../src/services/emailIngestionService');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const geminiService = require('../src/services/geminiService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const domainQueries = require('../src/db/domainQueries');
const dbPool = require('../src/db/pool');
const {
  EMAIL_GATEWAY_CONFIG,
  INGESTION_OUTCOME,
} = require('../src/config/constants');
const { authHeader } = require('./testHelpers');
const taxonomyFixture = require('./fixtures/categoryTaxonomy');

describe('Email & Ingestion RFQ Title Analysis Pipeline Tests', () => {
  const SENDER = 'buyer.project@enterprise-corp.com';
  const BUYER_ACCOUNT = {
    id: 'buyer-acc-enterprise',
    organizationName: 'Enterprise Corp',
    corporateEmail: SENDER,
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    subscriptionPlan: 'enterprise_pro',
  };

  function createEmlString({
    subject = '',
    from = SENDER,
    to = 'rfq@procucev.com',
    messageId = '<test-msg-001@enterprise-corp.com>',
    body = 'Please provide quotation for the items attached.',
  }) {
    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'Date: Wed, 28 Oct 2026 10:00:00 +0530',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');
  }

  beforeEach(() => {
    emailGatewayService.resetAutoReplyMemory();
    rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
    jest.spyOn(emailGatewayQueries, 'findProcessed').mockResolvedValue(null);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(BUYER_ACCOUNT);
    jest.spyOn(storeService, 'consumeRFQCreditIfApplicable').mockReturnValue({ consumed: true, remaining: 99 });
    jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: true });
    jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rfqIngestionService.resetTaxonomyIndex();
    emailGatewayService.runtime.isPolling = false;
  });

  describe('Unit Functions: Subject Extraction, Decoding & Normalization', () => {
    test('decodeQuotedPrintable decodes UTF-8 and Latin-1 correctly', () => {
      expect(emailIngestionService.decodeQuotedPrintable('Urgent_Requirement_-_Dell_Laptops')).toBe('Urgent Requirement - Dell Laptops');
      expect(emailIngestionService.decodeQuotedPrintable('CCTV=20Requirement')).toBe('CCTV Requirement');
      expect(emailIngestionService.decodeQuotedPrintable('Caf=E9', 'iso-8859-1')).toBe('Café');
      expect(emailIngestionService.decodeQuotedPrintable('')).toBe('');
      expect(emailIngestionService.decodeQuotedPrintable(null)).toBe('');
      expect(emailIngestionService.decodeQuotedPrintable('CCTV', 'unsupported-charset-xyz')).toBe('CCTV');
    });

    test('decodeBase64 decodes UTF-8 and Latin-1 correctly', () => {
      const b64Utf8 = Buffer.from('CCTV Requirement for Bangalore Office', 'utf8').toString('base64');
      expect(emailIngestionService.decodeBase64(b64Utf8)).toBe('CCTV Requirement for Bangalore Office');
      const b64Latin1 = Buffer.from('Café', 'latin1').toString('base64');
      expect(emailIngestionService.decodeBase64(b64Latin1, 'latin1')).toBe('Café');
      expect(emailIngestionService.decodeBase64('')).toBe('');
      expect(emailIngestionService.decodeBase64(null)).toBe('');
    });

    test('decodeRfc2047 decodes B and Q encoded headers and collapses whitespace', () => {
      const bEncoded = '=?UTF-8?B?Q0NUViBSZXF1aXJlbWVudCBmb3IgQmFuZ2Fsb3JlIE9mZmljZQ==?=';
      expect(emailIngestionService.decodeRfc2047(bEncoded)).toBe('CCTV Requirement for Bangalore Office');

      const qEncoded = '=?UTF-8?Q?Urgent_Requirement_-_Dell_Laptops?=';
      expect(emailIngestionService.decodeRfc2047(qEncoded)).toBe('Urgent Requirement - Dell Laptops');

      const adjacent = '=?UTF-8?B?Q0NUViA=?= \r\n\t =?UTF-8?B?UmVxdWlyZW1lbnQ=?=';
      expect(emailIngestionService.decodeRfc2047(adjacent)).toBe('CCTV Requirement');

      expect(emailIngestionService.decodeRfc2047('=?UTF-8?Z?unknown?=')).toBe('=?UTF-8?Z?unknown?=');
      expect(emailIngestionService.decodeRfc2047('Unencoded Subject')).toBe('Unencoded Subject');
      expect(emailIngestionService.decodeRfc2047('')).toBe('');
      expect(emailIngestionService.decodeRfc2047(null)).toBe('');
    });

    test('headerText handles arrays, objects, numbers, and null values', () => {
      const mockHeaders = {
        data: {
          'auto-submitted': 12345,
          precedence: ['bulk'],
          'list-unsubscribe': { text: '<mailto:unsub@example.com>' },
          'list-id': { value: 'list-123' },
          list: { other: 'custom' },
        },
        get(name) {
          return this.data[name];
        },
      };

      expect(emailIngestionService.detectAutomatedMessage(mockHeaders)).toBe('auto-submitted: 12345');

      delete mockHeaders.data['auto-submitted'];
      expect(emailIngestionService.detectAutomatedMessage(mockHeaders)).toBe('precedence: bulk');

      delete mockHeaders.data.precedence;
      expect(emailIngestionService.detectAutomatedMessage(mockHeaders)).toBe('mailing list');

      expect(emailIngestionService.detectAutomatedMessage(null)).toBeNull();
      expect(emailIngestionService.detectAutomatedMessage({})).toBeNull();
    });

    test('decodeHtmlEntities decodes named, decimal, and hex entities', () => {
      expect(emailIngestionService.decodeHtmlEntities('&amp; &lt; &gt; &quot; &#39; &apos; &nbsp;')).toBe('& < > " \' \'  ');
      expect(emailIngestionService.decodeHtmlEntities('&#65;&#66;&#67; &#x44;&#x45;')).toBe('ABC DE');
      expect(emailIngestionService.decodeHtmlEntities('')).toBe('');
      expect(emailIngestionService.decodeHtmlEntities(null)).toBe('');
    });

    test('decodeAndNormalizeEmailSubject handles whitespace, length limit and null safely', () => {
      const subjectWithWhitespace = '   \r\n\t  CCTV   Requirement   for   Bangalore   Office   \r\n\t  ';
      expect(emailIngestionService.decodeAndNormalizeEmailSubject(subjectWithWhitespace)).toBe('CCTV Requirement for Bangalore Office');

      const longSubject = 'Requirement for Industrial Spares and Hardware - '.repeat(10);
      const normalizedLong = emailIngestionService.decodeAndNormalizeEmailSubject(longSubject);
      expect(normalizedLong.length).toBeLessThanOrEqual(200);
      expect(normalizedLong.endsWith('…')).toBe(true);

      expect(emailIngestionService.decodeAndNormalizeEmailSubject(null)).toBe('');
      expect(emailIngestionService.decodeAndNormalizeEmailSubject(undefined)).toBe('');
      expect(emailIngestionService.decodeAndNormalizeEmailSubject('')).toBe('');
      expect(emailIngestionService.decodeAndNormalizeEmailSubject('   ')).toBe('');
    });

    test('resolveEmailRfqTitle returns subject or fallback when empty', () => {
      expect(emailIngestionService.resolveEmailRfqTitle('CCTV Requirement for Bangalore Office')).toBe('CCTV Requirement for Bangalore Office');
      expect(emailIngestionService.resolveEmailRfqTitle('   Urgent Requirement - Dell Laptops   ')).toBe('Urgent Requirement - Dell Laptops');
      expect(emailIngestionService.resolveEmailRfqTitle('')).toBe('Request for Quotation');
      expect(emailIngestionService.resolveEmailRfqTitle('   ')).toBe('Request for Quotation');
      expect(emailIngestionService.resolveEmailRfqTitle(null)).toBe('Request for Quotation');
      expect(emailIngestionService.resolveEmailRfqTitle('', 'Custom Fallback')).toBe('Custom Fallback');
    });
  });

  describe('Item Data Analyzed as RFQ Title (Option B)', () => {
    test('Case 1: Multiple items in email → analyzes items and derives pluralized procurement title', async () => {
      const rawEml = Buffer.from(createEmlString({
        subject: 'CCTV Requirement for Bangalore Office',
        messageId: '<case-1@enterprise-corp.com>',
      }));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'request for quotation',
        category: 'Electronics & Electrical',
        lineItems: [
          { itemName: 'Hikvision 4K IP Dome Camera', quantity: 10, unit: 'Nos' },
          { itemName: 'NVR 16 Channel 4K', quantity: 2, unit: 'Nos' },
        ],
      });

      const outcome = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );

      expect(outcome.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      expect(outcome.rfq).toBeDefined();
      expect(outcome.rfq.title).toBe('Hikvision 4K IP Dome Camera & Allied Items Procurement');
    });

    test('Case 2: Single item in email → analyzes item and derives singular procurement title', async () => {
      const rawEml = Buffer.from(createEmlString({
        subject: 'Urgent Requirement - Dell Laptops',
        messageId: '<case-2@enterprise-corp.com>',
      }));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'Request for Quotation',
        category: 'IT Hardware & Networking',
        lineItems: [
          { itemName: 'Dell Latitude 5420 i7 16GB', quantity: 25, unit: 'Nos' },
        ],
      });

      const outcome = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );

      expect(outcome.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      expect(outcome.rfq.title).toBe('Dell Latitude 5420 i7 16GB Procurement');
    });

    test('Case 3: Email with encoded subject → title is derived from analyzed item data', async () => {
      const encodedSubject = '=?UTF-8?B?Q0NUViBSZXF1aXJlbWVudCBmb3IgQmFuZ2Fsb3JlIE9mZmljZQ==?=';
      const rawEml = Buffer.from(createEmlString({
        subject: encodedSubject,
        messageId: '<case-3a@enterprise-corp.com>',
      }));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'Generic CCTV',
        category: 'Electronics & Electrical',
        lineItems: [{ itemName: 'CCTV Camera', quantity: 4, unit: 'Nos' }],
      });

      const outcome = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );

      expect(outcome.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      expect(outcome.rfq.title).toBe('CCTV Camera Procurement');
    });

    test('Case 4: Email with whitespace subject → title is derived from analyzed item data', async () => {
      const subjectWithWhitespace = '   \t  Urgent Requirement - Dell Laptops   \r\n  ';
      const rawEml = Buffer.from(createEmlString({
        subject: subjectWithWhitespace,
        messageId: '<case-4@enterprise-corp.com>',
      }));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'Dell Laptops',
        category: 'IT Hardware & Networking',
        lineItems: [{ itemName: 'Dell Laptop', quantity: 5, unit: 'Nos' }],
      });

      const outcome = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );

      expect(outcome.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      expect(outcome.rfq.title).toBe('Dell Laptop Procurement');
    });

    test('Case 5: Empty line items in buildRFQDraft → safe fallback title "Request for Quotation"', async () => {
      const draft = await rfqIngestionService.buildRFQDraft({
        lineItems: [],
        source: 'email_gateway',
      });
      expect(draft.draft.title).toBe('Request for Quotation');
    });

    test('Case 6: Email containing multiple products → analyzes item data and derives title', async () => {
      const rawEml = Buffer.from(createEmlString({
        subject: 'Urgent Requirement - Dell Laptops',
        messageId: '<case-6@enterprise-corp.com>',
      }));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'Laptops and Accessories',
        category: 'IT Hardware & Networking',
        lineItems: [
          { itemName: 'Dell Latitude 5420', quantity: 20, unit: 'Nos' },
          { itemName: 'Dell 24-inch Monitor', quantity: 20, unit: 'Nos' },
          { itemName: 'Wireless Keyboard and Mouse Combo', quantity: 20, unit: 'Sets' },
        ],
      });

      const outcome = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );

      expect(outcome.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      expect(outcome.rfq.title).toBe('Dell Latitude 5420 & Allied Items Procurement');
    });

    test('Case 7: Manual RFQ creation → explicit title preserved, unstated derived from item data', async () => {
      const manualDraft = await rfqIngestionService.buildRFQDraft({
        title: 'Custom Procurement Package for Site A',
        lineItems: [
          { itemName: 'Cement OPC 53 Grade', quantity: 500, unit: 'Bags' },
        ],
        category: 'Civil & Construction',
        source: 'manual_entry',
      });
      expect(manualDraft.draft.title).toBe('Custom Procurement Package for Site A');

      const derivedDraft = await rfqIngestionService.buildRFQDraft({
        lineItems: [
          { itemName: 'Steel Rebar 12mm', quantity: 50, unit: 'Tons' },
          { itemName: 'Binding Wire', quantity: 5, unit: 'Rolls' },
        ],
        category: 'Civil & Construction',
        source: 'manual_entry',
      });
      expect(derivedDraft.draft.title).toBe('Steel Rebar 12mm & Allied Items Procurement');
    });

    test('Case 8: Regression test → duplicate email message-id prevents second RFQ creation', async () => {
      const messageId = '<duplicate-check-008@enterprise-corp.com>';
      const rawEml = Buffer.from(createEmlString({
        subject: 'CCTV Requirement for Bangalore Office',
        messageId,
      }));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        category: 'Electronics & Electrical',
        lineItems: [{ itemName: 'Hikvision CCTV', quantity: 8, unit: 'Nos' }],
      });

      const outcome1 = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );
      expect(outcome1.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      const createdRfqId = outcome1.rfq.id;
      const createdRfqNumber = outcome1.rfq.rfqNumber;

      jest.spyOn(emailGatewayQueries, 'findProcessed').mockResolvedValue({
        message_id: `${messageId}#rfq-0`,
        rfq_id: createdRfqId,
        rfq_number: createdRfqNumber,
        status: emailGatewayQueries.INGESTION_OUTCOME.RFQ_GROUP_CREATED,
      });

      const createSpy = jest.spyOn(storeService, 'createRFQ');
      const outcome2 = await emailGatewayService.processMessage(
        rawEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(outcome2.status).toBe(emailGatewayQueries.INGESTION_OUTCOME.INGESTED);
      expect(outcome2.rfqs[0].rfqNumber).toBe(createdRfqNumber);
    });
  });

  describe('Web Upload Flow: /api/rfqs/extract', () => {
    test('POST /api/rfqs/extract with .eml derives title from analyzed items', async () => {
      const emlContent = createEmlString({
        subject: 'CCTV Requirement for Bangalore Office',
        messageId: '<upload-test-01@enterprise-corp.com>',
      });
      const inlineData = Buffer.from(emlContent, 'utf8').toString('base64');

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'request for quotation',
        category: 'Electronics & Electrical',
        lineItems: [{ itemName: '4K Camera', quantity: 5, unit: 'Nos' }],
      });

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader())
        .send({
          fileName: 'requisition-email.eml',
          inlineData,
          mimeType: 'message/rfc822',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('4K Camera Procurement');
    });

    test('POST /api/rfqs/extract with non-email document uses AI documentTitle or line items', async () => {
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'Excavation BOQ Document',
        category: 'Civil & Construction',
        lineItems: [{ itemName: 'Excavator 20T', quantity: 2, unit: 'Nos' }],
      });

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader())
        .send({
          fileName: 'boq-sheet.pdf',
          inlineData: Buffer.from('%PDF-1.4 mock').toString('base64'),
          mimeType: 'application/pdf',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Excavation BOQ Document');
    });

    test('POST /api/rfqs/extract with explicit body.title preserves body.title for non-email documents', async () => {
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-1.5-pro',
        documentTitle: 'AI Generated Title',
        category: 'Civil & Construction',
        lineItems: [{ itemName: 'Excavator 20T', quantity: 2, unit: 'Nos' }],
      });

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader())
        .send({
          fileName: 'custom-spec.pdf',
          title: 'Explicit User Title',
          inlineData: Buffer.from('%PDF-1.4 mock').toString('base64'),
          mimeType: 'application/pdf',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Explicit User Title');
    });

    test('POST /api/rfqs/extract handles email parsing failure', async () => {
      jest.spyOn(emailIngestionService, 'prepareEmailForExtraction').mockResolvedValue({
        status: 'EMAIL_PARSING_FAILED',
        error: 'Corrupted email headers',
      });

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader())
        .send({
          fileName: 'corrupt.eml',
          inlineData: Buffer.from('corrupt content').toString('base64'),
          mimeType: 'message/rfc822',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/rfqs/extract handles Gemini extraction failure and rejection', async () => {
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.FAILED,
        error: 'API quota exceeded',
      });

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader())
        .send({
          fileName: 'document.pdf',
          inlineData: Buffer.from('%PDF-1.4').toString('base64'),
          mimeType: 'application/pdf',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.detail).toBe('API quota exceeded');
    });
  });

  describe('Database Persistence & Consistency Verification', () => {
    test('persists RFQ with analyzed item title in raw JSONB and returns it in getRFQByNumberFromDB', async () => {
      const rfqToPersist = {
        id: 'rfq-test-db-101',
        rfqNumber: 'RFQ262810032346',
        title: 'Hikvision 4K IP Dome Camera & Allied Items Procurement',
        category: 'CAPEX - Equipment & Machinery',
        status: 'Quotes Pending',
        sourcingMode: 'mode_0',
        budget: 500000,
        createdAt: '2026-10-28 10:00 UTC',
      };

      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(dbPool, 'query').mockImplementation((text, params) => {
        if (text.includes('INSERT INTO rfqs')) {
          return Promise.resolve({ rows: [{ raw: params[6] }] });
        }
        if (text.includes('SELECT raw FROM rfqs')) {
          return Promise.resolve({ rows: [{ raw: JSON.stringify(rfqToPersist) }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await domainQueries.upsertRFQInDB(rfqToPersist);

      const loaded = await domainQueries.getRFQByNumberFromDB('RFQ262810032346');
      expect(loaded).toBeDefined();
      expect(loaded.title).toBe('Hikvision 4K IP Dome Camera & Allied Items Procurement');
      expect(loaded.rfqNumber).toBe('RFQ262810032346');
    });

    test('GET /api/rfqs returns correct title for email-generated RFQs', async () => {
      const emailRfq = {
        id: 'rfq-email-test-01',
        rfqNumber: 'RFQ262810032346',
        title: 'Hikvision 4K IP Dome Camera & Allied Items Procurement',
        category: 'CAPEX - Equipment & Machinery',
        status: 'Quotes Pending',
        sourcingMode: 'mode_0',
        budget: 500000,
        source: 'email_gateway',
        sourceEmail: SENDER,
        buyerAccountId: BUYER_ACCOUNT.id,
        buyerAccountName: BUYER_ACCOUNT.organizationName,
        createdAt: '2026-10-28 10:00 UTC',
      };

      jest.spyOn(storeService, 'getRFQs').mockReturnValue([emailRfq]);

      const res = await request(app)
        .get('/api/rfqs')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const matched = res.body.data.find((r) => r.rfqNumber === 'RFQ262810032346');
      expect(matched).toBeDefined();
      expect(matched.title).toBe('Hikvision 4K IP Dome Camera & Allied Items Procurement');
    });

    test('Additional coverage: getAllRFQs error handling and standard email download', async () => {
      // 1. getAllRFQs error branch
      jest.spyOn(storeService, 'syncRFQsFromDB').mockRejectedValueOnce(new Error('DB failure'));
      const errRes = await request(app).get('/api/rfqs/all').set(authHeader('admin'));
      expect(errRes.status).toBe(500);

      // 2. downloadRFQ 404
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const notFoundRes = await request(app)
        .post('/api/rfqs/non-existent-rfq/download')
        .set(authHeader('admin'));
      expect(notFoundRes.status).toBe(404);

      // 3. downloadRFQ with vendor role
      const mockRfq = {
        id: 'rfq-vendor-dl',
        rfqNumber: 'RFQ-DL-1',
        title: 'RFQ for DL',
        category: 'Electronics & Electrical',
        lineItems: [{ name: 'Item', quantity: 1 }],
      };
      const mockVendor = {
        id: 'v-1',
        email: 'vendor@apexsupplies.com',
        majorCategory: 'Electronics & Electrical',
        rfqDownloadsUsed: 0,
      };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockVendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);
      jest.spyOn(storeService, 'unlockRFQForVendor').mockResolvedValue({ success: true, creditBalance: 10 });
      jest.spyOn(storeService, 'updateVendor').mockReturnValue(mockVendor);

      const vendorRes = await request(app)
        .post('/api/rfqs/rfq-vendor-dl/download')
        .set(authHeader('vendor'));
      expect(vendorRes.status).toBe(200);
      expect(vendorRes.body.unlocked).toBe(true);

      // 4. downloadRFQ with vendor role whose category does NOT match (line 147: return false -> 404)
      const nonMatchingVendor = {
        id: 'v-mismatch',
        email: 'mismatch@apexsupplies.com',
        majorCategory: 'Civil & Construction',
        rfqDownloadsUsed: 0,
      };
      const electronicsRfq = {
        id: 'rfq-electronics-01',
        rfqNumber: 'RFQ-ELEC-01',
        title: 'Electronics RFQ',
        category: 'Electronics & Electrical',
        sourcingMode: 'mode_0',
        lineItems: [{ name: 'Camera', quantity: 1 }],
      };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(electronicsRfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(nonMatchingVendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(false);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Electronics & Electrical']);
      jest.spyOn(storeService, 'vendorCoversCategory').mockReturnValue(false);

      const mismatchRes = await request(app)
        .post('/api/rfqs/rfq-electronics-01/download')
        .set(authHeader('vendor'));
      expect(mismatchRes.status).toBe(404);
      expect(mismatchRes.body.error).toContain('not found');

      // 5. Summary branch in getAllRFQs and getRFQs with vendor mappings
      const summaryRfq = {
        id: 'rfq-summary-01',
        rfqNumber: 'RFQ-SUM-01',
        title: 'Summary RFQ',
        category: 'IT Hardware & Networking',
        createdAt: '2026-10-28 10:00 UTC',
        assignedVendors: [
          { id: 'v1', vendorName: 'Vendor One' },
          { vendorId: 'v2', companyName: 'Company Two' },
          { vendorId: 'v3', name: 'Name Three' },
        ],
        quotes: [{ id: 'q1', vendorId: 'v1', submittedAt: '2026-10-28 11:00 UTC' }],
      };
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([summaryRfq]);
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue(true);

      const allSummaryRes = await request(app)
        .get('/api/rfqs/all?summary=true&limit=10')
        .set(authHeader('admin'));
      expect(allSummaryRes.status).toBe(200);
      expect(allSummaryRes.body.data[0].assignedVendors).toHaveLength(3);

      const scopedSummaryRes = await request(app)
        .get('/api/rfqs?summary=true&limit=10')
        .set(authHeader('buyer'));
      expect(scopedSummaryRes.status).toBe(200);

      // 6. Vendor download credits exhausted (403 branch)
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockVendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);
      jest.spyOn(storeService, 'unlockRFQForVendor').mockResolvedValue({
        success: false,
        creditsExhausted: true,
        error: 'Credits exhausted',
        freeCreditsRemaining: 0,
      });

      const exhaustedRes = await request(app)
        .post('/api/rfqs/rfq-vendor-dl/download')
        .set(authHeader('vendor'));
      expect(exhaustedRes.status).toBe(403);
      expect(exhaustedRes.body.exhausted).toBe(true);

      // 7. Privacy quotes with createdAt and timestamp branches in getRFQById
      const privacyRfq = {
        id: 'rfq-privacy-01',
        rfqNumber: 'RFQ-PRIV-01',
        title: 'Privacy RFQ',
        category: 'Electronics & Electrical',
        quotes: [
          { id: 'q-created', vendorId: 'v-1', createdAt: new Date().toISOString() },
          { id: 'q-ts', vendorId: 'v-1', timestamp: new Date().toISOString() },
          { id: 'q-no-time', vendorId: 'v-1' },
        ],
      };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(privacyRfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockVendor);

      const privacyRes = await request(app)
        .get('/api/rfqs/rfq-privacy-01')
        .set(authHeader('vendor'));
      expect(privacyRes.status).toBe(200);
      expect(privacyRes.body.data.buyerDetailsHidden).toBe(true);
    });
  });
});
