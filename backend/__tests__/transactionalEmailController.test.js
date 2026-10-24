/**
 * Unit Test Suite for transactionalEmailController
 * Enforces >= 90% benchmark on Statements, Branches, Functions, and Lines.
 */

const transactionalEmailController = require('../src/controllers/transactionalEmailController');
const transactionalEmailTemplates = require('../src/services/transactionalEmailTemplates');

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
    test('returns template details when found', async () => {
      req.params.id = '1';
      await transactionalEmailController.getTemplateById(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            templateNumber: 1,
            subject: expect.stringContaining('live on Qua AI'),
          }),
        })
      );
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

    test('handles exceptions by forwarding to next', async () => {
      req.params.id = '1';
      const spy = jest.spyOn(transactionalEmailTemplates, 'renderTransactionalEmail').mockImplementationOnce(() => {
        throw new Error('Render crash');
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
