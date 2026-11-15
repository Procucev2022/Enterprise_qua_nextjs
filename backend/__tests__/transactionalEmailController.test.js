/**
 * Unit Test Suite for transactionalEmailController
 * Enforces >= 90% benchmark on Statements, Branches, Functions, and Lines.
 */

const transactionalEmailController = require('../src/controllers/transactionalEmailController');
const transactionalEmailTemplates = require('../src/services/transactionalEmailTemplates');
const { QUA_AI_EMAIL_TEMPLATES } = require('../src/config/constants');

const EMAIL_1 = QUA_AI_EMAIL_TEMPLATES.EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED;
const EMAIL_4 = QUA_AI_EMAIL_TEMPLATES.EMAIL_4_NEW_RFQ_TO_QUOTE;

describe('transactionalEmailController', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      params: {},
      body: {},
      query: {},
      user: { role: 'admin', email: 'admin@procucev.com' },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listTemplates', () => {
    test('returns all templates successfully', async () => {
      await transactionalEmailController.listTemplates(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          total: 13,
          data: expect.any(Array),
        })
      );
    });

    test('handles exceptions by forwarding to next', async () => {
      const spy = jest.spyOn(transactionalEmailTemplates, 'getAllTransactionalEmailTemplates').mockImplementationOnce(() => {
        throw new Error('Database/Service failure');
      });

      await transactionalEmailController.listTemplates(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('getTemplateById', () => {
    test('returns catalog metadata for the template without rendering it', async () => {
      const renderSpy = jest.spyOn(transactionalEmailTemplates, 'renderTransactionalEmail');
      req.params.id = '1';

      await transactionalEmailController.getTemplateById(req, res, next);

      expect(renderSpy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          templateId: EMAIL_1.id,
          templateNumber: EMAIL_1.number,
          name: EMAIL_1.name,
          who: EMAIL_1.who,
          trigger: EMAIL_1.trigger,
          subject: EMAIL_1.subject,
          subjectPlaceholders: ['rfq_id'],
        },
      });
    });

    test('lists each subject placeholder once, in order of first appearance', async () => {
      jest.spyOn(transactionalEmailTemplates, 'getAllTransactionalEmailTemplates').mockReturnValueOnce([
        {
          templateId: EMAIL_4.id,
          number: EMAIL_4.number,
          name: EMAIL_4.name,
          who: EMAIL_4.who,
          trigger: EMAIL_4.trigger,
          subjectPattern: 'New RFQ {rfq_id}: {rfq_title}, quotes close {quote_deadline}, RFQ {rfq_id}',
        },
      ]);
      req.params.id = EMAIL_4.id;

      await transactionalEmailController.getTemplateById(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          subjectPlaceholders: ['rfq_id', 'rfq_title', 'quote_deadline'],
        }),
      }));
    });

    test('returns 404 when template id is unknown', async () => {
      req.params.id = '999';
      await transactionalEmailController.getTemplateById(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found'),
        })
      );
    });

    test('returns 404 when the template key resolves but the catalog has no entry for it', async () => {
      jest.spyOn(transactionalEmailTemplates, 'getAllTransactionalEmailTemplates').mockReturnValueOnce([]);
      req.params.id = '1';

      await transactionalEmailController.getTemplateById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found'),
        })
      );
    });

    test('handles exceptions by forwarding to next', async () => {
      req.params.id = '1';
      const spy = jest.spyOn(transactionalEmailTemplates, 'getAllTransactionalEmailTemplates').mockImplementationOnce(() => {
        throw new Error('Catalog read failure');
      });

      await transactionalEmailController.getTemplateById(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('previewTemplate', () => {
    test('returns rendered template preview on valid request', async () => {
      req.body = {
        templateId: 'EMAIL_2_RFQ_CREATED',
        params: {
          first_name: 'Anand',
          rfq_id: 'RFQ-7711',
          rfq_title: 'Seamless Pipes',
          item_count: 3,
          suppliers_invited: 12,
        },
      };

      await transactionalEmailController.previewTemplate(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            subject: expect.stringContaining('RFQ-7711'),
            text: expect.stringContaining('Anand'),
          }),
        })
      );
    });

    test('forwards the error instead of rendering a default when a required value is missing', async () => {
      req.body = {
        templateId: 'EMAIL_2_RFQ_CREATED',
        params: { first_name: 'Anand', rfq_id: 'RFQ-7711', item_count: 3 },
      };

      await transactionalEmailController.previewTemplate(req, res, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('suppliers_invited') })
      );
    });

    test('returns 400 when validation fails (missing templateId)', async () => {
      req.body = {};
      await transactionalEmailController.previewTemplate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Validation failed'),
        })
      );
    });

    test('returns 404 when templateId is not found', async () => {
      req.body = { templateId: 'unknown_template_id' };
      await transactionalEmailController.previewTemplate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found'),
        })
      );
    });

    test('handles exceptions by forwarding to next', async () => {
      req.body = { templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED' };
      const spy = jest.spyOn(transactionalEmailTemplates, 'renderTransactionalEmail').mockImplementationOnce(() => {
        throw new Error('Template engine failure');
      });

      await transactionalEmailController.previewTemplate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('sendTemplate', () => {
    test('dispatches email and returns success on valid payload', async () => {
      req.body = {
        templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
        recipientEmail: 'buyer@procucev.com',
        params: { first_name: 'Tarun' },
      };

      const spy = jest.spyOn(transactionalEmailTemplates, 'sendTransactionalEmail').mockResolvedValueOnce({
        sent: true,
        success: true,
        status: 'sent',
        messageId: 'mock-tx-123',
      });

      await transactionalEmailController.sendTemplate(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          result: expect.objectContaining({ sent: true, messageId: 'mock-tx-123' }),
        })
      );
      spy.mockRestore();
    });

    test('reports success false when the provider did not accept the message', async () => {
      req.body = {
        templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
        recipientEmail: 'buyer@procucev.com',
      };
      jest.spyOn(transactionalEmailTemplates, 'sendTransactionalEmail').mockResolvedValueOnce({
        sent: false,
        success: false,
        status: 'not_configured',
        reason: 'SMTP not configured',
      });

      await transactionalEmailController.sendTemplate(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          result: expect.objectContaining({ sent: false, status: 'not_configured' }),
        })
      );
    });

    test('returns 400 when recipient email is invalid or missing', async () => {
      req.body = {
        templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
        recipientEmail: 'not-an-email',
      };

      await transactionalEmailController.sendTemplate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Validation failed'),
        })
      );
    });

    test('returns 404 when templateId in send is unknown', async () => {
      req.body = {
        templateId: 'invalid_template_id',
        recipientEmail: 'valid@procucev.com',
      };

      await transactionalEmailController.sendTemplate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found'),
        })
      );
    });

    test('handles delivery exceptions by forwarding to next', async () => {
      req.body = {
        templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
        recipientEmail: 'valid@procucev.com',
      };

      const spy = jest.spyOn(transactionalEmailTemplates, 'sendTransactionalEmail').mockRejectedValueOnce(
        new Error('SMTP Transport failure')
      );

      await transactionalEmailController.sendTemplate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      spy.mockRestore();
    });
  });
});
