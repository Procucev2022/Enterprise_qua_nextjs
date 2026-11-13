const documentVaultQueries = require('../src/db/documentVaultQueries');
const accountDocumentQueries = require('../src/db/accountDocumentQueries');
const pool = require('../src/db/pool');

const rawVaultRow = {
  id: 'doc_pg_101',
  document_name: 'PG Enterprise Pitch',
  file_name: 'pg_pitch.pdf',
  file_size: 204800,
  mime_type: 'application/pdf',
  category: 'marketing_overview',
  file_url: '/documents/pg_pitch.pdf',
  description: 'SQL stored pitch deck',
  uploaded_by: 'SQL Admin',
  is_active: 1,
  created_at: new Date('2026-02-01T12:00:00Z'),
  updated_at: new Date('2026-02-01T12:00:00Z'),
};

function vaultRow(overrides = {}) {
  return { ...rawVaultRow, ...overrides };
}

function accountDocument(overrides = {}) {
  return {
    id: 'adoc_buyer_1',
    accountType: 'buyer',
    accountId: 'buyer-1',
    documentName: 'Buyer GST Certificate',
    fileName: 'buyer_gst.pdf',
    fileSize: 1000,
    mimeType: 'application/pdf',
    category: 'GST',
    fileUrl: '/docs/buyer_gst.pdf',
    description: 'Buyer GST proof',
    uploadedBy: 'Buyer Admin',
    isActive: true,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('Document Vault Queries', () => {
  let querySpy;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(accountDocumentQueries, 'getAllAccountDocuments').mockResolvedValue([]);
    // Any query a test does not script fails loudly instead of reaching a real pool.
    querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('Unexpected pool.query call in this test.'));
  });

  describe('listDocuments', () => {
    it('reads vault rows with no SQL filters and returns them mapped', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow], rowCount: 1 });

      const docs = await documentVaultQueries.listDocuments();

      expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('FROM document_vault'), [], { d1: true });
      expect(accountDocumentQueries.getAllAccountDocuments).toHaveBeenCalledWith({
        category: undefined,
        search: undefined,
        activeOnly: undefined,
        accountType: undefined,
      });
      expect(docs).toEqual([expect.objectContaining({
        id: 'doc_pg_101',
        documentName: 'PG Enterprise Pitch',
        fileName: 'pg_pitch.pdf',
        fileSize: 204800,
        category: 'marketing_overview',
        isActive: true,
        accountType: 'vault',
      })]);
    });

    it('pushes the category, active, and search filters into the vault SQL', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });

      await documentVaultQueries.listDocuments({ category: 'marketing_overview', search: 'Enterprise', activeOnly: true });

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('category = $1');
      expect(sql).toContain('is_active = 1');
      expect(sql).toContain("LOWER(document_name) LIKE LOWER($2) ESCAPE '!'");
      expect(params).toEqual(['marketing_overview', '%Enterprise%']);
      expect(options).toEqual({ d1: true });
    });

    it('treats category "all" and a blank search as no filter', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      const docs = await documentVaultQueries.listDocuments({ category: 'all', search: '   ', activeOnly: false });

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).not.toMatch(/category = \$|is_active = 1|LIKE/);
      expect(params).toEqual([]);
      expect(docs).toEqual([]);
    });

    it('escapes LIKE wildcards in the search term before binding it', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      await documentVaultQueries.listDocuments({ search: '50%_off!' });

      expect(querySpy.mock.calls[0][1]).toEqual(['%50!%!_off!!%']);
    });

    it.each([
      ['alpha', 'doc_name'],
      ['beta_sheet', 'doc_file'],
      ['gamma', 'doc_desc'],
      ['priya', 'doc_uploader'],
    ])('matches the search term "%s" against the document name, file name, description, or uploader', async (term, expectedId) => {
      const rows = [
        vaultRow({ id: 'doc_name', document_name: 'Alpha Deck', file_name: 'a.pdf', description: null, uploaded_by: null }),
        vaultRow({ id: 'doc_file', document_name: 'Other', file_name: 'Beta_Sheet.pdf', description: null, uploaded_by: null }),
        vaultRow({ id: 'doc_desc', document_name: 'Other', file_name: 'x.pdf', description: 'Gamma notes', uploaded_by: null }),
        vaultRow({ id: 'doc_uploader', document_name: 'Other', file_name: 'y.pdf', description: null, uploaded_by: 'Priya Rao' }),
        vaultRow({ id: 'doc_blank', document_name: null, file_name: null, description: null, uploaded_by: null }),
      ];
      querySpy.mockResolvedValueOnce({ rows });

      const docs = await documentVaultQueries.listDocuments({ search: term });

      expect(docs.map((d) => d.id)).toEqual([expectedId]);
    });

    it('applies the category and activeOnly filters to the combined vault and account rows', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow, vaultRow({ id: 'doc_inactive', is_active: 0 })] });
      accountDocumentQueries.getAllAccountDocuments.mockResolvedValueOnce([
        accountDocument({ category: 'rate_cards' }),
      ]);

      const docs = await documentVaultQueries.listDocuments({ category: 'marketing_overview', activeOnly: true });

      expect(docs.map((d) => d.id)).toEqual(['doc_pg_101']);
      expect(accountDocumentQueries.getAllAccountDocuments).toHaveBeenCalledWith({
        category: 'marketing_overview',
        search: undefined,
        activeOnly: true,
        accountType: undefined,
      });
    });

    it.each([
      ['vault', ['doc_pg_101']],
      ['platform', ['doc_pg_101']],
      ['buyer', ['adoc_buyer_1']],
      ['seller', ['adoc_seller_1']],
      ['all', ['doc_pg_101', 'adoc_buyer_1', 'adoc_seller_1']],
    ])('keeps the documents that belong to source "%s"', async (source, expectedIds) => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });
      accountDocumentQueries.getAllAccountDocuments.mockResolvedValueOnce([
        accountDocument({ id: 'adoc_buyer_1', accountType: 'buyer' }),
        accountDocument({ id: 'adoc_seller_1', accountType: 'seller', accountId: 'seller-1' }),
      ]);

      const docs = await documentVaultQueries.listDocuments({ source });

      expect(docs.map((d) => d.id).sort()).toEqual([...expectedIds].sort());
    });

    it.each([
      [{ source: 'buyer' }, 'buyer'],
      [{ accountType: 'seller' }, 'seller'],
      [{ source: 'vault' }, null],
      [{ source: 'all' }, undefined],
      [{}, undefined],
    ])('asks the account document lookup for the accountType implied by %j', async (filters, expectedAccountType) => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      await documentVaultQueries.listDocuments(filters);

      expect(accountDocumentQueries.getAllAccountDocuments.mock.calls[0][0].accountType).toBe(expectedAccountType);
    });

    it('orders the combined rows newest first and keeps only the first copy of a duplicate id', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [
          vaultRow({ id: 'doc_old', created_at: '2026-01-01T00:00:00Z' }),
          vaultRow({ id: 'doc_new', created_at: '2026-03-01T00:00:00Z' }),
          vaultRow({ id: 'doc_mid', created_at: '2026-02-01T00:00:00Z' }),
        ],
      });
      accountDocumentQueries.getAllAccountDocuments.mockResolvedValueOnce([
        accountDocument({ id: 'doc_old', createdAt: '2025-06-01T00:00:00.000Z' }),
        accountDocument({ id: 'doc_undated', createdAt: null }),
      ]);

      const docs = await documentVaultQueries.listDocuments();

      expect(docs.map((d) => d.id)).toEqual(['doc_new', 'doc_mid', 'doc_old', 'doc_undated']);
      expect(docs.find((d) => d.id === 'doc_old').accountType).toBe('vault');
    });

    it('treats a missing account document result as no account documents', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });
      accountDocumentQueries.getAllAccountDocuments.mockResolvedValueOnce(undefined);

      const docs = await documentVaultQueries.listDocuments();

      expect(docs.map((d) => d.id)).toEqual(['doc_pg_101']);
    });

    it('throws PERSISTENCE_UNAVAILABLE instead of answering from memory when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(documentVaultQueries.listDocuments()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('throws PERSISTENCE_UNAVAILABLE with the cause when the vault query fails', async () => {
      const cause = new Error('Connection terminated');
      querySpy.mockRejectedValueOnce(cause);

      await expect(documentVaultQueries.listDocuments()).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
      expect(accountDocumentQueries.getAllAccountDocuments).not.toHaveBeenCalled();
    });

    it('fails the whole listing when the account document lookup fails', async () => {
      const cause = new Error('account lookup failed');
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });
      accountDocumentQueries.getAllAccountDocuments.mockRejectedValueOnce(cause);

      await expect(documentVaultQueries.listDocuments()).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
    });
  });

  describe('getDocumentById', () => {
    it('returns null without querying when the id is missing', async () => {
      await expect(documentVaultQueries.getDocumentById(null)).resolves.toBeNull();
      await expect(documentVaultQueries.getDocumentById('')).resolves.toBeNull();
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('returns the mapped document for a matching id', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow], rowCount: 1 });

      const doc = await documentVaultQueries.getDocumentById('doc_pg_101');

      expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['doc_pg_101'], { d1: true });
      expect(doc).toEqual(expect.objectContaining({ id: 'doc_pg_101', documentName: 'PG Enterprise Pitch' }));
    });

    it('returns null when no row matches the id', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(documentVaultQueries.getDocumentById('doc_not_found')).resolves.toBeNull();
    });

    it('returns null when the query result carries no rows array', async () => {
      querySpy.mockResolvedValueOnce({});

      await expect(documentVaultQueries.getDocumentById('doc_not_found')).resolves.toBeNull();
    });

    it('throws PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(documentVaultQueries.getDocumentById('doc_buyer_roi')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('throws PERSISTENCE_UNAVAILABLE with the cause when the lookup fails', async () => {
      const cause = new Error('SQL timeout');
      querySpy.mockRejectedValueOnce(cause);

      await expect(documentVaultQueries.getDocumentById('doc_buyer_roi')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
    });
  });

  describe('createDocument', () => {
    const validPayload = { documentName: 'Q2 Rate Card', fileName: 'q2.pdf', category: 'rate_cards' };

    it.each([
      ['a blank document name', { ...validPayload, documentName: '   ' }, 'Document name is required.'],
      ['a non-text document name', { ...validPayload, documentName: 42 }, 'Document name is required.'],
      ['a blank file name', { ...validPayload, fileName: '' }, 'Document file name is required.'],
      ['a missing category', { ...validPayload, category: undefined }, 'Document category is required.'],
    ])('rejects %s with VALIDATION_FAILED', async (_label, payload, message) => {
      await expect(documentVaultQueries.createDocument(payload, 'Admin')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message,
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('rejects a call with no payload with VALIDATION_FAILED', async () => {
      await expect(documentVaultQueries.createDocument()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it.each([
      ['no actor', undefined],
      ['a null actor', null],
      ['a blank text actor', '   '],
      ['an empty actor object', {}],
      ['an actor object with no name or email', { id: 'user-without-name' }],
    ])('rejects %s with ACTOR_REQUIRED and HTTP 401', async (_label, actor) => {
      await expect(documentVaultQueries.createDocument(validPayload, actor)).rejects.toMatchObject({
        code: 'ACTOR_REQUIRED',
        statusCode: 401,
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it.each([
      ['a text actor', 'Staff Member', 'Staff Member'],
      ['an actor with fullName', { fullName: 'Asha Rao', name: 'ignored' }, 'Asha Rao'],
      ['an actor with name', { name: 'Sarah Commercial', email: 'ignored@procucev.com' }, 'Sarah Commercial'],
      ['an actor with corporateEmail', { corporateEmail: 'corp@procucev.com' }, 'corp@procucev.com'],
      ['an actor with email', { email: 'staff@procucev.com' }, 'staff@procucev.com'],
    ])('records the uploader from %s', async (_label, actor, expectedUploader) => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });

      await documentVaultQueries.createDocument(validPayload, actor);

      expect(querySpy.mock.calls[0][1][8]).toBe(expectedUploader);
    });

    it('throws PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(documentVaultQueries.createDocument(validPayload, 'Admin')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('inserts the document with null or empty values for the optional fields', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });

      const doc = await documentVaultQueries.createDocument(validPayload, { fullName: 'Asha Rao' });

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('INSERT INTO document_vault');
      expect(params[0]).toMatch(/^doc_[0-9a-f]{16}$/);
      expect(params.slice(1, 8)).toEqual(['Q2 Rate Card', 'q2.pdf', null, null, 'rate_cards', '', '']);
      expect(params[8]).toBe('Asha Rao');
      expect(params[9]).toBe(1);
      expect(params[10]).toBe(params[11]);
      expect(options).toEqual({ d1: true });
      expect(doc.id).toBe('doc_pg_101');
    });

    it('stores the supplied optional fields and writes isActive false as 0', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });

      await documentVaultQueries.createDocument({
        ...validPayload,
        fileSize: '2048',
        mimeType: 'image/png',
        fileUrl: '/u/q2.png',
        description: 'Rates',
        isActive: false,
      }, 'Admin');

      const params = querySpy.mock.calls[0][1];
      expect(params.slice(3, 8)).toEqual([2048, 'image/png', 'rate_cards', '/u/q2.png', 'Rates']);
      expect(params[9]).toBe(0);
    });

    it('throws PERSISTENCE_UNAVAILABLE with the cause when the insert fails', async () => {
      const cause = new Error('PG insert failed');
      querySpy.mockRejectedValueOnce(cause);

      await expect(documentVaultQueries.createDocument(validPayload, 'Admin')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
    });
  });

  describe('updateDocument', () => {
    it('returns null without querying when the id is missing', async () => {
      await expect(documentVaultQueries.updateDocument(null)).resolves.toBeNull();
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('throws PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(documentVaultQueries.updateDocument('doc_pg_101', { documentName: 'X' })).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('writes only the supplied fields and returns the updated row', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{ ...rawVaultRow, document_name: 'Renamed Pitch', is_active: 0 }] });

      const doc = await documentVaultQueries.updateDocument('doc_pg_101', {
        documentName: 'Renamed Pitch',
        fileName: 'renamed.pdf',
        fileSize: '5000',
        mimeType: 'application/pdf',
        category: 'rate_cards',
        fileUrl: '/uploads/renamed.pdf',
        description: 'New pitch description',
        isActive: false,
      });

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('document_name = $1, file_name = $2, file_size = $3, mime_type = $4');
      expect(sql).toContain('category = $5, file_url = $6, description = $7, is_active = $8');
      expect(sql).toContain('updated_at = $9 WHERE id = $10');
      expect(params).toEqual([
        'Renamed Pitch',
        'renamed.pdf',
        5000,
        'application/pdf',
        'rate_cards',
        '/uploads/renamed.pdf',
        'New pitch description',
        0,
        expect.any(Date),
        'doc_pg_101',
      ]);
      expect(options).toEqual({ d1: true });
      expect(doc.isActive).toBe(false);
    });

    it('clears the stored file size when fileSize is null', async () => {
      querySpy.mockResolvedValueOnce({ rows: [rawVaultRow] });

      await documentVaultQueries.updateDocument('doc_pg_101', { fileSize: null });

      expect(querySpy.mock.calls[0][1]).toEqual([null, expect.any(Date), 'doc_pg_101']);
    });

    it('returns null when no row is updated', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      await expect(documentVaultQueries.updateDocument('doc_missing', { documentName: 'New' })).resolves.toBeNull();
    });

    it('returns null when the query result carries no rows array', async () => {
      querySpy.mockResolvedValueOnce({});

      await expect(documentVaultQueries.updateDocument('doc_missing', { documentName: 'New' })).resolves.toBeNull();
    });

    it('throws PERSISTENCE_UNAVAILABLE with the cause when the update fails', async () => {
      const cause = new Error('PG update error');
      querySpy.mockRejectedValueOnce(cause);

      await expect(documentVaultQueries.updateDocument('doc_pg_101', { documentName: 'Memory Updated ROI' })).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
    });
  });

  describe('deleteDocument', () => {
    it('returns false without querying when the id is missing', async () => {
      await expect(documentVaultQueries.deleteDocument(null)).resolves.toBe(false);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('throws PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(documentVaultQueries.deleteDocument('doc_buyer_roi')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('returns true when the database removes a row', async () => {
      querySpy.mockResolvedValueOnce({ rowCount: 1 });

      await expect(documentVaultQueries.deleteDocument('doc_pg_101')).resolves.toBe(true);
      expect(querySpy).toHaveBeenCalledWith('DELETE FROM document_vault WHERE id = $1', ['doc_pg_101'], { d1: true });
    });

    it('returns false when no row matches the id', async () => {
      querySpy.mockResolvedValueOnce({ rowCount: 0 });

      await expect(documentVaultQueries.deleteDocument('doc_missing')).resolves.toBe(false);
    });

    it('throws PERSISTENCE_UNAVAILABLE with the cause when the delete fails', async () => {
      const cause = new Error('PG delete error');
      querySpy.mockRejectedValueOnce(cause);

      await expect(documentVaultQueries.deleteDocument('doc_buyer_roi')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
        cause,
      });
    });
  });

  describe('getDocumentVaultSummary', () => {
    it('counts documents by source, active state, category, and total size', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [
          rawVaultRow,
          vaultRow({ id: 'doc_inactive', file_size: null, is_active: 0, category: 'rate_cards' }),
        ],
      });
      accountDocumentQueries.getAllAccountDocuments.mockResolvedValueOnce([
        accountDocument({ id: 'adoc_buyer_1', accountType: 'buyer', fileSize: 1000, category: 'GST' }),
        accountDocument({ id: 'adoc_seller_1', accountType: 'seller', fileSize: null, category: 'PAN', accountId: 'seller-1' }),
      ]);

      const summary = await documentVaultQueries.getDocumentVaultSummary();

      expect(summary).toEqual({
        totalDocuments: 4,
        activeDocuments: 3,
        totalSizeBytes: 205800,
        categoriesCount: 4,
        buyerDocuments: 1,
        sellerDocuments: 1,
        vaultDocuments: 2,
      });
    });

    it('throws PERSISTENCE_UNAVAILABLE instead of reporting zero documents when storage is missing', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(documentVaultQueries.getDocumentVaultSummary()).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });
  });

  describe('mapRow', () => {
    it('returns null for null or undefined input', () => {
      expect(documentVaultQueries.mapRow(null)).toBeNull();
      expect(documentVaultQueries.mapRow(undefined)).toBeNull();
    });

    it('maps database column names to the API shape', () => {
      expect(documentVaultQueries.mapRow(rawVaultRow)).toEqual({
        id: 'doc_pg_101',
        documentName: 'PG Enterprise Pitch',
        fileName: 'pg_pitch.pdf',
        fileSize: 204800,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        fileUrl: '/documents/pg_pitch.pdf',
        description: 'SQL stored pitch deck',
        uploadedBy: 'SQL Admin',
        isActive: true,
        createdAt: '2026-02-01T12:00:00.000Z',
        updatedAt: '2026-02-01T12:00:00.000Z',
        accountType: 'vault',
        accountId: null,
      });
    });

    it('maps camelCase fields and an explicit account type', () => {
      const mapped = documentVaultQueries.mapRow({
        documentName: 'Camel Doc',
        fileName: 'camel.pdf',
        fileSize: '100',
        isActive: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        accountType: 'buyer',
        accountId: 'buyer-9',
        fileUrl: '/c.pdf',
        uploadedBy: 'Ops',
      });

      expect(mapped).toEqual(expect.objectContaining({
        documentName: 'Camel Doc',
        fileName: 'camel.pdf',
        fileSize: 100,
        isActive: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        accountType: 'buyer',
        accountId: 'buyer-9',
        fileUrl: '/c.pdf',
        uploadedBy: 'Ops',
      }));
    });

    it('returns null for absent fields instead of substituting defaults', () => {
      expect(documentVaultQueries.mapRow({})).toEqual({
        id: null,
        documentName: null,
        fileName: null,
        fileSize: null,
        mimeType: null,
        category: null,
        fileUrl: null,
        description: null,
        uploadedBy: null,
        isActive: null,
        createdAt: null,
        updatedAt: null,
        accountType: 'vault',
        accountId: null,
      });
    });

    it('stringifies numeric ids and nulls unparseable sizes, dates, and empty URLs', () => {
      const mapped = documentVaultQueries.mapRow({
        id: 123,
        file_size: 'abc',
        created_at: 'not-a-date',
        updated_at: '',
        file_url: '',
      });

      expect(mapped).toEqual(expect.objectContaining({
        id: '123',
        fileSize: null,
        createdAt: null,
        updatedAt: null,
        fileUrl: null,
      }));
    });
  });
});
