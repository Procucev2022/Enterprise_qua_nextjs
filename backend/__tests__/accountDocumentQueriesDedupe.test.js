// De-duplication in listAccountDocuments. Documents are merged by id only, so records that share
// a file name or category remain separate. Storage and the workflow caches are stubbed, so nothing
// reaches a database.
const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const { listAccountDocuments } = require('../src/db/accountDocumentQueries');

const BUYER_ROW = {
  id: 'adoc_1',
  account_type: 'buyer',
  account_id: 'buyer-1',
  document_name: 'Trade Reference',
  file_name: null,
  file_size: null,
  mime_type: null,
  category: 'Other',
  file_url: null,
  description: null,
  uploaded_by: 'Ops User',
  is_active: 1,
  created_at: '2026-01-10T08:00:00.000Z',
  updated_at: '2026-01-10T08:00:00.000Z',
};

let originalRfqs;
let originalEvaluations;

beforeEach(() => {
  originalRfqs = storeService.rfqs;
  originalEvaluations = storeService.evaluations;
  storeService.rfqs = [];
  storeService.evaluations = [];
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
});

afterEach(() => {
  storeService.rfqs = originalRfqs;
  storeService.evaluations = originalEvaluations;
  jest.restoreAllMocks();
});

describe('listAccountDocuments de-duplication by document id', () => {
  test('keeps two different documents that have no file name and share a category', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { ...BUYER_ROW, id: 'adoc_1', document_name: 'Trade Reference' },
        { ...BUYER_ROW, id: 'adoc_2', document_name: 'Bank Letter' },
      ],
    });

    const docs = await listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' });

    expect(docs.map((d) => d.id).sort()).toEqual(['adoc_1', 'adoc_2']);
    expect(docs.every((d) => d.fileName === null)).toBe(true);
  });

  test('keeps documents that share a file name and category when their ids differ', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { ...BUYER_ROW, id: 'adoc_1', file_name: 'gst.pdf', category: 'GST' },
        { ...BUYER_ROW, id: 'adoc_2', file_name: 'gst.pdf', category: 'GST' },
      ],
    });

    const docs = await listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' });

    expect(docs.map((d) => d.id).sort()).toEqual(['adoc_1', 'adoc_2']);
  });

  test('keeps a seller upload and an evaluation document that share a file name and category', async () => {
    storeService.evaluations = [{
      id: 'eval-2',
      vendorId: 'seller-1',
      documents: [{ id: 'doc-gst', name: 'GST Certificate.pdf' }],
    }];
    pool.query.mockResolvedValueOnce({
      rows: [{
        ...BUYER_ROW,
        id: 'adoc_gst',
        account_type: 'seller',
        account_id: 'seller-1',
        document_name: 'GST Certificate',
        file_name: 'GST Certificate.pdf',
        category: 'GST',
      }],
    });

    const docs = await listAccountDocuments({ accountType: 'seller', accountId: 'seller-1' });

    expect(docs.map((d) => d.id).sort()).toEqual(['adoc_gst', 'eval_doc_seller-1_doc-gst']);
  });

  test('drops a repeated document id, such as two quote lines from the same vendor on one RFQ', async () => {
    storeService.rfqs = [{
      id: 'rfq-q1',
      rfqNumber: 'RFQ-Q1',
      createdAt: '2026-02-01T00:00:00.000Z',
      quotes: [{ vendorId: 'seller-1' }, { vendorId: 'seller-1' }],
    }];

    const docs = await listAccountDocuments({ accountType: 'seller', accountId: 'seller-1' });

    expect(docs.map((d) => d.id)).toEqual(['quote_doc_rfq-q1_seller-1']);
  });

  test('keeps documents that carry no id, because they cannot be matched as duplicates', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { ...BUYER_ROW, id: null, document_name: 'Bank Letter' },
        { ...BUYER_ROW, id: null, document_name: 'Trade Licence' },
      ],
    });

    const docs = await listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' });

    expect(docs.map((d) => d.documentName).sort()).toEqual(['Bank Letter', 'Trade Licence']);
  });
});
