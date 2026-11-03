const documentVaultQueries = require('../src/db/documentVaultQueries');
const pool = require('../src/db/pool');

describe('Document Vault Queries', () => {
  beforeEach(() => {
    documentVaultQueries.resetInMemoryStore();
    jest.clearAllMocks();
  });

  describe('listDocuments (in-memory mode)', () => {
    it('returns default seeded documents when no filters provided', async () => {
      const docs = await documentVaultQueries.listDocuments();
      expect(Array.isArray(docs)).toBe(true);
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0]).toHaveProperty('id');
      expect(docs[0]).toHaveProperty('documentName');
      expect(docs[0]).toHaveProperty('category');
    });

    it('filters documents by category', async () => {
      const docs = await documentVaultQueries.listDocuments({ category: 'marketing_overview' });
      expect(docs.every((d) => d.category === 'marketing_overview')).toBe(true);
    });

    it('filters documents by activeOnly flag', async () => {
      const docs = await documentVaultQueries.listDocuments({ activeOnly: true });
      expect(docs.every((d) => d.isActive === true)).toBe(true);
    });

    it('filters documents by search term across title, filename, and description', async () => {
      const docs = await documentVaultQueries.listDocuments({ search: 'Procurement' });
      expect(docs.length).toBeGreaterThan(0);
      const matches = docs.some(
        (d) =>
          d.documentName.toLowerCase().includes('procurement') ||
          d.fileName.toLowerCase().includes('procurement') ||
          (d.description && d.description.toLowerCase().includes('procurement'))
      );
      expect(matches).toBe(true);
    });

    it('returns empty array when search finds no matches', async () => {
      const docs = await documentVaultQueries.listDocuments({ search: 'NonExistentDoc123456' });
      expect(docs).toEqual([]);
    });

    it('handles category "all" as no category filter', async () => {
      const docsAll = await documentVaultQueries.listDocuments({ category: 'all' });
      const docsNone = await documentVaultQueries.listDocuments();
      expect(docsAll.length).toBe(docsNone.length);
    });
  });

  describe('getDocumentById (in-memory mode)', () => {
    it('returns null for missing or invalid id', async () => {
      expect(await documentVaultQueries.getDocumentById(null)).toBeNull();
      expect(await documentVaultQueries.getDocumentById('')).toBeNull();
      expect(await documentVaultQueries.getDocumentById('unknown_id')).toBeNull();
    });

    it('retrieves an existing document by its ID', async () => {
      const doc = await documentVaultQueries.getDocumentById('doc_buyer_roi');
      expect(doc).not.toBeNull();
      expect(doc.id).toBe('doc_buyer_roi');
      expect(doc.documentName).toContain('ROI');
    });
  });

  describe('createDocument (in-memory mode)', () => {
    it('creates and returns a new document with default values', async () => {
      const newDoc = await documentVaultQueries.createDocument({
        documentName: 'Q2 Special Sourcing Rate Card',
        fileName: 'Q2_Special_Rate_Card.pdf',
        fileSize: 420000,
        mimeType: 'application/pdf',
        category: 'rate_cards',
        description: 'Special Q2 wholesale rates',
      });

      expect(newDoc).toBeDefined();
      expect(newDoc.id).toMatch(/^doc_/);
      expect(newDoc.documentName).toBe('Q2 Special Sourcing Rate Card');
      expect(newDoc.isActive).toBe(true);

      const fetched = await documentVaultQueries.getDocumentById(newDoc.id);
      expect(fetched).not.toBeNull();
      expect(fetched.documentName).toBe('Q2 Special Sourcing Rate Card');
    });

    it('handles custom actor and inactive status', async () => {
      const doc = await documentVaultQueries.createDocument(
        {
          documentName: 'Archived Terms',
          fileName: 'terms_old.pdf',
          category: 'other',
          isActive: false,
        },
        { name: 'Admin Alice' }
      );

      expect(doc.uploadedBy).toBe('Admin Alice');
      expect(doc.isActive).toBe(false);
    });
  });

  describe('updateDocument (in-memory mode)', () => {
    it('returns null if document does not exist', async () => {
      const res = await documentVaultQueries.updateDocument('non_existent', { documentName: 'New' });
      expect(res).toBeNull();
    });

    it('updates document fields correctly', async () => {
      const updated = await documentVaultQueries.updateDocument('doc_buyer_roi', {
        documentName: 'Updated ROI Brochure 2026',
        fileName: 'new_roi.pdf',
        fileSize: 9999,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        fileUrl: '/docs/new_roi.pdf',
        description: 'Updated descriptions',
        isActive: false,
      });

      expect(updated).not.toBeNull();
      expect(updated.documentName).toBe('Updated ROI Brochure 2026');
      expect(updated.fileName).toBe('new_roi.pdf');
      expect(updated.fileSize).toBe(9999);
      expect(updated.fileUrl).toBe('/docs/new_roi.pdf');
      expect(updated.isActive).toBe(false);

      const fetched = await documentVaultQueries.getDocumentById('doc_buyer_roi');
      expect(fetched.documentName).toBe('Updated ROI Brochure 2026');
      expect(fetched.isActive).toBe(false);
    });
  });

  describe('deleteDocument (in-memory mode)', () => {
    it('returns false when id is missing', async () => {
      expect(await documentVaultQueries.deleteDocument(null)).toBe(false);
    });

    it('deletes an existing document from vault', async () => {
      const res = await documentVaultQueries.deleteDocument('doc_buyer_roi');
      expect(res).toBe(true);

      const fetched = await documentVaultQueries.getDocumentById('doc_buyer_roi');
      expect(fetched).toBeNull();
    });
  });

  describe('getDocumentVaultSummary', () => {
    it('aggregates metrics correctly', async () => {
      const summary = await documentVaultQueries.getDocumentVaultSummary();
      expect(summary).toBeDefined();
      expect(summary.totalDocuments).toBeGreaterThan(0);
      expect(summary.activeDocuments).toBeGreaterThan(0);
      expect(summary.totalSizeBytes).toBeGreaterThan(0);
      expect(summary.categoriesCount).toBeGreaterThan(0);
    });
  });

  describe('mapRow helper', () => {
    it('returns null when input is falsy', () => {
      expect(documentVaultQueries.mapRow(null)).toBeNull();
      expect(documentVaultQueries.mapRow(undefined)).toBeNull();
    });

    it('safely maps raw row fields with fallback defaults', () => {
      const mapped = documentVaultQueries.mapRow({
        id: 123,
        document_name: 'Test Doc',
        file_name: 'test.pdf',
        file_size: null,
        mime_type: null,
        category: null,
        created_at: null,
        updated_at: null,
      });

      expect(mapped.id).toBe('123');
      expect(mapped.fileSize).toBe(0);
      expect(mapped.mimeType).toBe('application/pdf');
      expect(mapped.category).toBe('other');

      const mappedCamel = documentVaultQueries.mapRow({
        documentName: 'Camel Doc',
        fileName: 'camel.pdf',
        fileSize: 100,
        isActive: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      expect(mappedCamel.documentName).toBe('Camel Doc');
      expect(mappedCamel.fileName).toBe('camel.pdf');
      expect(mappedCamel.isActive).toBe(false);

      const mappedEmpty = documentVaultQueries.mapRow({});
      expect(mappedEmpty.id).toBe('');
      expect(mappedEmpty.documentName).toBe('');
      expect(mappedEmpty.fileName).toBe('');
      expect(mappedEmpty.isActive).toBe(true);
    });
  });

  describe('PostgreSQL Engine (pool.hasStorage() = true)', () => {
    const rawSqlRow = {
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

    beforeEach(() => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    });

    test('listDocuments executes SQL query with filters and returns mapped rows', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [rawSqlRow],
        rowCount: 1,
      });

      const docs = await documentVaultQueries.listDocuments({
        category: 'marketing_overview',
        search: 'Enterprise',
        activeOnly: true,
      });

      expect(querySpy).toHaveBeenCalled();
      const sql = querySpy.mock.calls[0][0];
      expect(sql).toContain('category = $1');
      expect(sql).toContain('is_active = 1');
      expect(sql).toContain('ILIKE');
      expect(docs.length).toBe(1);
      expect(docs[0].id).toBe('doc_pg_101');
      expect(docs[0].documentName).toBe('PG Enterprise Pitch');
    });

    test('listDocuments falls back to in-memory store when SQL query throws', async () => {
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Connection terminated'));

      const docs = await documentVaultQueries.listDocuments();
      expect(Array.isArray(docs)).toBe(true);
      expect(docs.length).toBeGreaterThan(0);
    });

    test('getDocumentById fetches from database when found', async () => {
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [rawSqlRow],
        rowCount: 1,
      });

      const doc = await documentVaultQueries.getDocumentById('doc_pg_101');
      expect(doc).not.toBeNull();
      expect(doc.id).toBe('doc_pg_101');
    });

    test('getDocumentById falls back to in-memory store when SQL throws', async () => {
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('SQL timeout'));

      const doc = await documentVaultQueries.getDocumentById('doc_buyer_roi');
      expect(doc).not.toBeNull();
      expect(doc.id).toBe('doc_buyer_roi');
    });

    test('createDocument executes SQL insert and returns mapped row', async () => {
      const insertSpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [rawSqlRow],
        rowCount: 1,
      });

      const doc = await documentVaultQueries.createDocument({
        documentName: 'PG Enterprise Pitch',
        fileName: 'pg_pitch.pdf',
        category: 'marketing_overview',
      });

      expect(insertSpy).toHaveBeenCalled();
      expect(doc.documentName).toBe('PG Enterprise Pitch');
    });

    test('createDocument falls back to in-memory creation when SQL insert throws', async () => {
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('PG insert failed'));

      const doc = await documentVaultQueries.createDocument({
        documentName: 'Fallback Created Doc',
        fileName: 'fallback.pdf',
        category: 'templates',
      });

      expect(doc).toBeDefined();
      expect(doc.documentName).toBe('Fallback Created Doc');
    });

    test('updateDocument executes SQL update and returns mapped row', async () => {
      const updatedRow = { ...rawSqlRow, document_name: 'Renamed Pitch' };
      const updateSpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [updatedRow],
        rowCount: 1,
      });

      const doc = await documentVaultQueries.updateDocument('doc_pg_101', {
        documentName: 'Renamed Pitch',
        category: 'rate_cards',
        description: 'New pitch description',
        isActive: false,
      });

      expect(updateSpy).toHaveBeenCalled();
      expect(doc.documentName).toBe('Renamed Pitch');
    });

    test('updateDocument falls back to in-memory when SQL update throws', async () => {
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('PG update error'));

      const doc = await documentVaultQueries.updateDocument('doc_buyer_roi', {
        documentName: 'Memory Updated ROI',
      });

      expect(doc).not.toBeNull();
      expect(doc.documentName).toBe('Memory Updated ROI');
    });

    test('deleteDocument executes SQL delete and returns true on rowCount > 0', async () => {
      const deleteSpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rowCount: 1,
      });

      const res = await documentVaultQueries.deleteDocument('doc_pg_101');
      expect(deleteSpy).toHaveBeenCalled();
      expect(res).toBe(true);
    });

    test('deleteDocument falls back to in-memory delete when SQL delete throws', async () => {
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('PG delete error'));

      const res = await documentVaultQueries.deleteDocument('doc_buyer_roi');
      expect(res).toBe(true);
    });

    test('getDocumentById returns null when SQL returns 0 rows', async () => {
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const doc = await documentVaultQueries.getDocumentById('doc_not_found');
      expect(doc).toBeNull();
    });

    test('updateDocument updates all supported fields in SQL mode', async () => {
      const fullUpdateRow = {
        ...rawSqlRow,
        file_name: 'updated.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
        file_url: '/uploads/updated.pdf',
      };
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [fullUpdateRow],
        rowCount: 1,
      });

      const doc = await documentVaultQueries.updateDocument('doc_pg_101', {
        fileName: 'updated.pdf',
        fileSize: 5000,
        mimeType: 'application/pdf',
        fileUrl: '/uploads/updated.pdf',
      });

      expect(doc).not.toBeNull();
      expect(doc.fileName).toBe('updated.pdf');
    });

    test('updateDocument returns null when SQL returns 0 rows', async () => {
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const doc = await documentVaultQueries.updateDocument('doc_pg_101', {
        documentName: 'No match',
      });
      expect(doc).toBeNull();
    });

    test('updateDocument returns null when id is missing', async () => {
      expect(await documentVaultQueries.updateDocument(null)).toBeNull();
    });

    test('createDocument handles fallback defaults and actors', async () => {
      const docWithEmail = await documentVaultQueries.createDocument({}, { email: 'staff@example.com' });
      expect(docWithEmail.uploadedBy).toBe('staff@example.com');
      expect(docWithEmail.documentName).toBe('Untitled Document');

      const docWithStringActor = await documentVaultQueries.createDocument({}, 'Staff Member');
      expect(docWithStringActor.uploadedBy).toBe('Staff Member');

      const docNoActor = await documentVaultQueries.createDocument({});
      expect(docNoActor.uploadedBy).toBe('System Admin');
    });
  });
});
