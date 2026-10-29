const quoteAttachmentService = require('../src/services/quoteAttachmentService');
const rfqAttachmentService = require('../src/services/rfqAttachmentService');

describe('quoteAttachmentService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('saveQuoteAttachment', () => {
    test('throws if rfqId is missing', () => {
      expect(() => {
        quoteAttachmentService.saveQuoteAttachment({ fileName: 'quote.pdf' }, { vendorId: 'v-1' });
      }).toThrow('RFQ and vendor identities are required to store bid documents.');
    });

    test('throws if vendorId is missing', () => {
      expect(() => {
        quoteAttachmentService.saveQuoteAttachment({ fileName: 'quote.pdf' }, { rfqId: 'rfq-1' });
      }).toThrow('RFQ and vendor identities are required to store bid documents.');
    });

    test('delegates to rfqAttachmentService.saveAttachment with quote config', () => {
      const mockResult = { id: 'att-1', fileName: 'quote.pdf' };
      const saveSpy = jest.spyOn(rfqAttachmentService, 'saveAttachment').mockReturnValue(mockResult);

      const input = { fileName: 'quote.pdf', content: 'data' };
      const res = quoteAttachmentService.saveQuoteAttachment(input, { rfqId: 'rfq-1', vendorId: 'v-1' });

      expect(res).toEqual(mockResult);
      expect(saveSpy).toHaveBeenCalledWith(
        input,
        expect.objectContaining({
          STORAGE_DIR: expect.stringContaining('-quotes'),
        }),
        { rfqId: 'rfq-1', vendorId: 'v-1' }
      );
    });
  });

  describe('loadQuoteAttachment', () => {
    test('delegates to rfqAttachmentService.loadAttachment with quote config', () => {
      const mockAttachment = { id: 'att-1', data: 'content' };
      const loadSpy = jest.spyOn(rfqAttachmentService, 'loadAttachment').mockReturnValue(mockAttachment);

      const res = quoteAttachmentService.loadQuoteAttachment('att-1');
      expect(res).toEqual(mockAttachment);
      expect(loadSpy).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          STORAGE_DIR: expect.stringContaining('-quotes'),
        })
      );
    });
  });
});
