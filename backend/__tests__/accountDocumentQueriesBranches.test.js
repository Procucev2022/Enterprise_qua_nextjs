const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const accountDocumentQueries = require('../src/db/accountDocumentQueries');

const {
  listAccountDocuments,
  createAccountDocument,
  deleteAccountDocument,
  getAllAccountDocuments,
  mapRow,
  matchesDocumentType,
  escapeLikeWildcards,
} = accountDocumentQueries;

const DB_ROW = {
  id: 'adoc_1',
  account_type: 'buyer',
  account_id: 'buyer-1',
  document_name: 'GST Registration',
  file_name: 'gst.pdf',
  file_size: 2048,
  mime_type: 'application/pdf',
  category: 'GST',
  file_url: 'https://files.test/gst.pdf',
  description: 'Registration certificate',
  uploaded_by: 'Ops User',
  is_active: 1,
  created_at: '2026-01-10T08:00:00.000Z',
  updated_at: '2026-01-11T08:00:00.000Z',
};

const BUYER_VALID_PAYLOAD = {
  accountType: 'Buyer',
  accountId: 'buyer-1',
  documentName: 'Company Profile',
  fileName: 'profile.pdf',
  category: 'Company Profile',
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

describe('mapRow', () => {
  test('returns null for a missing row', () => {
    expect(mapRow(null)).toBeNull();
  });

  test('maps a database row and uses created_at when updated_at is missing', () => {
    const mapped = mapRow({ ...DB_ROW, id: null, file_size: '2048', updated_at: null });

    expect(mapped).toMatchObject({
      id: null,
      accountType: 'buyer',
      accountId: 'buyer-1',
      documentName: 'GST Registration',
      fileSize: 2048,
      isActive: true,
      uploadDate: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
      sourceWorkflow: 'Direct Upload',
    });
  });

  test('maps an application-shaped record and drops invalid numbers and dates', () => {
    const mapped = mapRow({
      id: 42,
      accountType: 'SELLER',
      accountId: 'seller-9',
      documentName: 'PAN Card',
      fileName: 'pan.png',
      fileSize: 'not-a-number',
      mimeType: 'image/png',
      category: 'PAN',
      fileUrl: 'https://files.test/pan.png',
      description: '',
      uploadedBy: 'Vendor Admin',
      isActive: false,
      createdAt: 'not-a-date',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });

    expect(mapped).toMatchObject({
      id: '42',
      accountType: 'seller',
      fileSize: null,
      isActive: false,
      uploadDate: null,
      createdAt: null,
      updatedAt: '2026-02-01T00:00:00.000Z',
      sourceWorkflow: null,
    });
  });
});

describe('document type and search helpers', () => {
  test.each([
    [{ mimeType: 'application/pdf', fileName: 'a.bin' }, 'pdf', true],
    [{ mimeType: '', fileName: 'report.PDF' }, 'pdf', true],
    [{ mimeType: 'image/jpeg', fileName: 'a' }, 'image', true],
    [{ mimeType: '', fileName: 'logo.SVG' }, 'image', true],
    [{ mimeType: 'application/vnd.ms-excel', fileName: 'a' }, 'excel', true],
    [{ mimeType: '', fileName: 'sheet.csv' }, 'excel', true],
    [{ mimeType: 'application/msword', fileName: 'a' }, 'word', true],
    [{ mimeType: '', fileName: 'memo.docx' }, 'word', true],
    [{ mimeType: 'text/plain', fileName: 'note.txt' }, 'pdf', false],
    [{ mimeType: 'text/plain', fileName: 'note.txt' }, 'unknown-type', true],
  ])('classifies %j as %s -> %s', (doc, type, expected) => {
    expect(matchesDocumentType(doc, type)).toBe(expected);
  });

  test('treats a missing or all type filter as a match', () => {
    expect(matchesDocumentType({}, undefined)).toBe(true);
    expect(matchesDocumentType({}, 'all')).toBe(true);
  });

  test('escapes LIKE wildcards and returns an empty string for non-text input', () => {
    expect(escapeLikeWildcards('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeLikeWildcards(123)).toBe('');
  });
});

describe('listAccountDocuments', () => {
  test('requires an account type and id before touching storage', async () => {
    await expect(listAccountDocuments({ accountType: 'buyer' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('reports persistence unavailable when storage is not configured', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test('treats a query result without rows as no persisted documents', async () => {
    pool.query.mockResolvedValueOnce(undefined);

    await expect(listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' })).resolves.toEqual([]);
  });

  test('wraps a failed persisted-document query and keeps the cause', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection reset'));

    await expect(listAccountDocuments({ accountType: 'seller', accountId: 'seller-1' })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.any(Error),
    });
  });

  test('merges buyer RFQ attachments from RFQs matched by buyer id or buyer field', async () => {
    storeService.rfqs = [
      {
        id: 'rfq-1',
        buyerId: 'buyer-1',
        rfqNumber: 'RFQ-001',
        createdAt: '2026-03-01T00:00:00.000Z',
        attachments: [
          {
            id: 'att-1',
            fileName: 'spec.pdf',
            fileSize: 1024,
            mimeType: 'application/pdf',
            fileUrl: 'https://files.test/spec.pdf',
            uploadedBy: 'Buyer User',
          },
          { name: 'drawing.dwg', size: 55, url: 'https://files.test/drawing.dwg' },
        ],
      },
      { id: 'rfq-2', buyer: 'buyer-1', attachments: 'not-a-list' },
      { id: 'rfq-3', buyerId: 'other-buyer', attachments: [{ id: 'att-x', fileName: 'other.pdf' }] },
      { id: 'rfq-4', buyer: 'buyer-1', attachments: [{}] },
    ];

    const docs = await listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' });

    expect(docs.map((d) => d.id)).toEqual(['rfq_doc_rfq-1_att-1', 'rfq_doc_rfq-1_1', 'rfq_doc_rfq-4_0']);
    expect(docs[0]).toMatchObject({
      accountType: 'buyer',
      accountId: 'buyer-1',
      documentName: 'RFQ Specification - RFQ-001',
      fileName: 'spec.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      category: 'RFQ',
      fileUrl: 'https://files.test/spec.pdf',
      uploadedBy: 'Buyer User',
      sourceWorkflow: 'RFQ Requisition',
    });
    expect(docs[1]).toMatchObject({
      fileName: 'drawing.dwg',
      fileSize: 55,
      fileUrl: 'https://files.test/drawing.dwg',
      uploadedBy: null,
    });
    expect(docs[2]).toMatchObject({ documentName: 'RFQ Specification - rfq-4', uploadDate: null });
  });

  test('returns no workflow documents when the RFQ and evaluation caches are missing', async () => {
    storeService.rfqs = null;
    storeService.evaluations = undefined;

    await expect(listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1' })).resolves.toEqual([]);
    await expect(listAccountDocuments({ accountType: 'seller', accountId: 'seller-1' })).resolves.toEqual([]);
  });

  test('returns no workflow documents for an account type that has no workflow source', async () => {
    storeService.rfqs = [{ id: 'rfq-x', buyerId: 'anyone', attachments: [{ id: 'a' }] }];

    await expect(listAccountDocuments({ accountType: 'partner', accountId: 'anyone' })).resolves.toEqual([]);
  });

  test('builds seller evaluation documents with category keywords and quotation submissions', async () => {
    storeService.evaluations = [
      { id: 'eval-unrelated', vendorId: 'someone-else', documents: [{ name: 'Ignored.pdf' }] },
      {
        id: 'eval-2',
        vendorId: 'seller-1',
        documents: [
          { id: 'doc-gst', name: 'GST Certificate.pdf', uploadDate: '2026-01-05T00:00:00.000Z' },
          { id: 'doc-pan', name: 'PAN card scan', uploadDate: 'not-a-date' },
          { name: 'Company profile.pdf' },
          { name: 'Misc notes' },
          {},
        ],
      },
    ];
    storeService.rfqs = [
      {
        id: 'rfq-q1',
        rfqNumber: 'RFQ-Q1',
        createdAt: '2026-02-01T00:00:00.000Z',
        quotes: [
          { vendorId: 'seller-1', vendorName: 'Seller One', submittedAt: '2026-02-03T00:00:00.000Z' },
          { vendorId: 'seller-1' },
          { vendorId: 'other' },
        ],
      },
      { id: 'rfq-q2', quotes: 'not-a-list' },
    ];

    const docs = await listAccountDocuments({ accountType: 'seller', accountId: 'seller-1' });

    expect(docs.map((d) => d.id)).toEqual([
      'quote_doc_rfq-q1_seller-1',
      'eval_doc_seller-1_doc-gst',
      'eval_doc_seller-1_doc-pan',
      'eval_doc_seller-1_2',
      'eval_doc_seller-1_3',
      'eval_doc_seller-1_4',
    ]);
    expect(docs[0]).toMatchObject({
      category: 'Quotation',
      uploadedBy: 'Seller One',
      sourceWorkflow: 'Quotation Submission',
      fileName: 'Quotation_Bid_RFQ-Q1.pdf',
    });
    expect(docs.find((d) => d.id === 'eval_doc_seller-1_doc-gst')).toMatchObject({
      category: 'GST',
      sourceWorkflow: 'Vendor Evaluation',
      fileName: 'GST Certificate.pdf',
      description: 'Statutory verification and onboarding document: GST Certificate.pdf',
    });
    expect(docs.find((d) => d.id === 'eval_doc_seller-1_doc-pan')).toMatchObject({ category: 'PAN' });
    expect(docs.find((d) => d.id === 'eval_doc_seller-1_2')).toMatchObject({ category: 'Company Profile' });
    expect(docs.find((d) => d.id === 'eval_doc_seller-1_3')).toMatchObject({ category: null });
    expect(docs.find((d) => d.id === 'eval_doc_seller-1_4')).toMatchObject({
      documentName: 'Compliance audit document',
      fileName: null,
      description: null,
      category: null,
    });
  });

  test('finds a seller evaluation by its own id when no vendor id matches', async () => {
    storeService.evaluations = [
      { id: 'seller-2', vendorId: 'vendor-x', documents: [{ id: 'd-1', name: 'Profile.docx' }] },
    ];

    const docs = await listAccountDocuments({ accountType: 'seller', accountId: 'seller-2' });

    expect(docs.map((d) => d.id)).toEqual(['eval_doc_seller-2_d-1']);
    expect(docs[0].category).toBe('Company Profile');
  });

  test('filters persisted and workflow documents by category, type, and search text', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          ...DB_ROW,
          id: 'adoc_a',
          document_name: 'Spec Sheet',
          file_name: 'spec.xlsx',
          mime_type: 'application/vnd.ms-excel',
          category: null,
        },
        {
          ...DB_ROW,
          id: 'adoc_b',
          document_name: null,
          file_name: 'photo.jpg',
          mime_type: 'image/jpeg',
          category: 'GST',
          created_at: 'not-a-date',
          updated_at: null,
          description: null,
          uploaded_by: null,
        },
      ],
    });

    const docs = await listAccountDocuments({
      accountType: 'buyer',
      accountId: 'buyer-1',
      category: 'gst',
      type: 'image',
      search: 'photo',
    });

    expect(docs.map((d) => d.id)).toEqual(['adoc_b']);
  });

  test('returns no documents when the search text matches nothing', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DB_ROW] });

    await expect(
      listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1', search: 'nothing-matches-this' })
    ).resolves.toEqual([]);
  });

  test('matches the uploader name in search and ignores blank search text', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...DB_ROW, uploaded_by: 'Priya Nair' }] });
    const matched = await listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1', search: 'priya' });
    expect(matched.map((d) => d.id)).toEqual(['adoc_1']);

    pool.query.mockResolvedValueOnce({ rows: [DB_ROW] });
    const unfiltered = await listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-1', search: '   ' });
    expect(unfiltered).toHaveLength(1);
  });

  test('sorts oldest first when asked and treats undated documents as oldest', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { ...DB_ROW, id: 'adoc_new', created_at: '2026-05-01T00:00:00.000Z' },
        { ...DB_ROW, id: 'adoc_undated', file_name: 'undated.pdf', created_at: null, updated_at: null },
      ],
    });

    const docs = await listAccountDocuments({
      accountType: 'buyer',
      accountId: 'buyer-1',
      sortOrder: 'asc',
    });

    expect(docs.map((d) => d.id)).toEqual(['adoc_undated', 'adoc_new']);
  });
});

describe('createAccountDocument', () => {
  test('requires an account reference before validating the document', async () => {
    await expect(createAccountDocument()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
    await expect(createAccountDocument({ documentName: 'X' }, { name: 'Ana' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([
    ['name', { ...BUYER_VALID_PAYLOAD, documentName: '   ' }, 'Account document name is required.'],
    ['file name', { ...BUYER_VALID_PAYLOAD, fileName: '' }, 'Account document file name is required.'],
    ['category', { ...BUYER_VALID_PAYLOAD, category: undefined }, 'Account document category is required.'],
  ])('rejects a missing document %s', async (_field, payload, message) => {
    await expect(createAccountDocument(payload, { name: 'Ana' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
      message,
    });
  });

  test('requires an uploader identity from the actor', async () => {
    await expect(createAccountDocument(BUYER_VALID_PAYLOAD, '   ')).rejects.toMatchObject({
      code: 'ACTOR_REQUIRED',
      statusCode: 401,
    });
    await expect(createAccountDocument(BUYER_VALID_PAYLOAD, null)).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' });
    await expect(createAccountDocument(BUYER_VALID_PAYLOAD)).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' });
    await expect(createAccountDocument(BUYER_VALID_PAYLOAD, { id: 'u-1' })).rejects.toMatchObject({
      code: 'ACTOR_REQUIRED',
    });
  });

  test.each([
    ['a plain name string', ' Ana Rao ', 'Ana Rao'],
    ['a full name on the actor', { fullName: 'Ana Rao', name: 'A', email: 'ana@procure.test' }, 'Ana Rao'],
    ['a name on the actor', { name: 'Ana' }, 'Ana'],
    ['an email on the actor', { email: 'ana@procure.test' }, 'ana@procure.test'],
  ])('records uploaded_by from %s', async (_label, actor, expectedUploader) => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...DB_ROW, uploaded_by: expectedUploader }] });

    await createAccountDocument(BUYER_VALID_PAYLOAD, actor);

    expect(pool.query.mock.calls[0][1][10]).toBe(expectedUploader);
  });

  test('stores the document with defaults for optional fields and returns the mapped row', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DB_ROW] });

    const created = await createAccountDocument(BUYER_VALID_PAYLOAD, { fullName: 'Ana Rao' });
    const params = pool.query.mock.calls[0][1];

    expect(params[0]).toMatch(/^adoc_[0-9a-f]{16}$/);
    expect(params.slice(1, 3)).toEqual(['buyer', 'buyer-1']);
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
    expect(params[8]).toBe('');
    expect(params[9]).toBe('');
    expect(params[11]).toBe(1);
    expect(created).toMatchObject({ id: 'adoc_1', accountType: 'buyer' });
  });

  test('stores optional fields and an inactive flag when they are supplied', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DB_ROW] });

    await createAccountDocument(
      {
        ...BUYER_VALID_PAYLOAD,
        fileSize: '512',
        mimeType: 'application/pdf',
        fileUrl: 'https://files.test/p.pdf',
        description: 'Signed copy',
        isActive: false,
      },
      { name: 'Ana' }
    );

    expect(pool.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([512, 'application/pdf', 'https://files.test/p.pdf', 'Signed copy', 0])
    );
  });

  test('reports persistence unavailable without storage and never queries', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(createAccountDocument(BUYER_VALID_PAYLOAD, { name: 'Ana' })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('wraps a failed insert and an insert that returns no row', async () => {
    pool.query.mockRejectedValueOnce(new Error('insert failed'));
    await expect(createAccountDocument(BUYER_VALID_PAYLOAD, { name: 'Ana' })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });

    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(createAccountDocument(BUYER_VALID_PAYLOAD, { name: 'Ana' })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.objectContaining({ message: 'Insert returned no row.' }),
    });
  });
});

describe('deleteAccountDocument', () => {
  test('returns false without an id and refuses workflow-generated documents', async () => {
    await expect(deleteAccountDocument('', 'buyer', 'buyer-1')).resolves.toBe(false);
    await expect(deleteAccountDocument('rfq_doc_rfq-1_att-1', 'buyer', 'buyer-1')).rejects.toMatchObject({
      code: 'WORKFLOW_DOCUMENT_NOT_DELETABLE',
      statusCode: 409,
    });
    await expect(deleteAccountDocument('quote_doc_x', 'seller', 'seller-1')).rejects.toMatchObject({
      code: 'WORKFLOW_DOCUMENT_NOT_DELETABLE',
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('reports persistence unavailable without storage', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(deleteAccountDocument('adoc_1', 'buyer', 'buyer-1')).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test('marks a persisted document inactive and reports whether a row changed', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'adoc_1' }] });
    await expect(deleteAccountDocument('adoc_1', 'Buyer', 'buyer-1')).resolves.toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual(['adoc_1', 'buyer', 'buyer-1']);

    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(deleteAccountDocument('adoc_2', 'buyer', 'buyer-1')).resolves.toBe(false);

    pool.query.mockResolvedValueOnce(undefined);
    await expect(deleteAccountDocument('adoc_3', 'buyer', 'buyer-1')).resolves.toBe(false);
  });

  test('uses empty account parameters when the account is not supplied', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(deleteAccountDocument('adoc_4')).resolves.toBe(false);
    expect(pool.query.mock.calls[0][1]).toEqual(['adoc_4', '', '']);
  });

  test('wraps a failed delete query', async () => {
    pool.query.mockRejectedValueOnce(new Error('timeout'));

    await expect(deleteAccountDocument('adoc_5', 'buyer', 'buyer-1')).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });
});

describe('getAllAccountDocuments', () => {
  test('reports persistence unavailable without storage', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(getAllAccountDocuments({})).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('returns active documents when called without a filter', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DB_ROW] });

    const docs = await getAllAccountDocuments();

    expect(docs.map((d) => d.id)).toEqual(['adoc_1']);
    expect(pool.query.mock.calls[0][0]).not.toContain('WHERE');
  });

  test('restricts the vault list to active documents when asked', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DB_ROW] });

    await getAllAccountDocuments({ activeOnly: true });

    expect(pool.query.mock.calls[0][0]).toContain('is_active = 1');
    expect(pool.query.mock.calls[0][2]).toEqual({ d1: true });
  });

  test('builds parameterised filters for account type, category, and escaped search text', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getAllAccountDocuments({ accountType: 'SELLER', category: 'PAN', search: ' 50%_off ', activeOnly: false });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain('account_type = $1');
    expect(sql).toContain('category = $2');
    expect(sql).toContain('ILIKE $3');
    expect(values).toEqual(['seller', 'PAN', '%50\\%\\_off%']);
  });

  test('ignores the all placeholders and blank search text', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await getAllAccountDocuments({ accountType: 'all', category: 'all', search: '   ' });

    expect(pool.query.mock.calls[0][1]).toEqual([]);
    expect(pool.query.mock.calls[0][0]).not.toContain('WHERE');
  });

  test('wraps a failed vault query and a result without a row list', async () => {
    pool.query.mockRejectedValueOnce(new Error('syntax'));
    await expect(getAllAccountDocuments({})).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

    pool.query.mockResolvedValueOnce({});
    await expect(getAllAccountDocuments({})).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });
});
