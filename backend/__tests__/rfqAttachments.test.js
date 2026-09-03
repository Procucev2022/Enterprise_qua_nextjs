const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { app } = require('../src/server');
const { RFQ_ATTACHMENT_CONFIG } = require('../src/config/constants');
const attachments = require('../src/services/rfqAttachmentService');
const authService = require('../src/services/authService');

const { ATTACHMENT_STATUS } = attachments;

function authHeader(role = 'buyer') {
  const token = authService.generateSessionToken({
    id: 'u1',
    email: `${role}@enterprise.com`,
    role,
    orgId: 'o1',
    orgName: 'L&T',
  });
  return { Authorization: `Bearer ${token}` };
}

const pdfBody = () => Buffer.from('%PDF-1.4 line item annexure').toString('base64');

/** Everything this suite writes lands in the real storage dir, so it is cleared. */
afterAll(() => {
  fs.rmSync(attachments.storageDir(), { recursive: true, force: true });
});

describe('RFQ attachment storage service', () => {
  describe('path safety', () => {
    // An id is only ever generated server-side; refusing anything else is what
    // keeps a traversal attempt out of the storage directory.
    test.each([
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      'a/b',
      'short',
      '',
      'NOT-HEX-@@',
    ])('refuses to resolve a path for %p', (id) => {
      expect(attachments.resolveStoredPath(id, '.bin')).toBeNull();
    });

    test.each([null, undefined, 42, {}])('refuses a non-string id %p', (id) => {
      expect(attachments.resolveStoredPath(id, '.bin')).toBeNull();
    });

    test('resolves a generated id inside the storage directory', () => {
      const resolved = attachments.resolveStoredPath('a1b2c3d4-0000-4000-8000-abcdefabcdef', '.bin');
      expect(resolved).not.toBeNull();
      expect(path.dirname(resolved)).toBe(attachments.storageDir());
    });
  });

  describe('safeFileName', () => {
    // The stored path uses the generated id, but the name is echoed into the RFQ,
    // so it is reduced to a leaf first.
    test.each([
      ['../../evil/report.pdf', 'report.pdf'],
      ['C:\\\\Users\\\\navin\\\\boq.xlsx', 'boq.xlsx'],
      ['plain.pdf', 'plain.pdf'],
    ])('reduces %p to %p', (input, expected) => {
      expect(attachments.safeFileName(input)).toBe(expected);
    });

    test.each(['', '   ', '.', '..', null, undefined])('falls back for %p', (input) => {
      expect(attachments.safeFileName(input)).toBe('attachment');
    });
  });

  describe('decodedByteLength', () => {
    test.each([
      ['', 0],
      ['QQ==', 1],
      ['QUE=', 2],
      ['QUFB', 3],
    ])('reads %p as %i bytes', (input, expected) => {
      expect(attachments.decodedByteLength(input)).toBe(expected);
    });

    test('ignores whitespace a data URL may carry', () => {
      expect(attachments.decodedByteLength('QU\nFB')).toBe(3);
    });

    test.each([null, undefined])('treats %p as empty', (input) => {
      expect(attachments.decodedByteLength(input)).toBe(0);
    });
  });

  describe('isAllowedType', () => {
    test('accepts the document types a buyer attaches', () => {
      expect(attachments.isAllowedType('application/pdf')).toBe(true);
      expect(attachments.isAllowedType('image/png')).toBe(true);
    });

    // An allow-list rather than a block-list, so an executable cannot slip in by
    // simply not having been thought of.
    test.each(['application/x-msdownload', 'application/x-sh', 'text/html', '', undefined])(
      'refuses %p',
      (mimeType) => {
        expect(attachments.isAllowedType(mimeType)).toBe(false);
      }
    );
  });

  describe('saveAttachment and loadAttachment', () => {
    test('stores a document and reads it back byte for byte', () => {
      const saved = attachments.saveAttachment({
        fileName: 'annexure.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });

      expect(saved.status).toBe(ATTACHMENT_STATUS.SAVED);
      expect(saved.attachment.fileName).toBe('annexure.pdf');
      expect(saved.attachment.size).toBeGreaterThan(0);
      expect(saved.attachment.uploadedAt).toBeDefined();

      const loaded = attachments.loadAttachment(saved.attachment.id);
      expect(loaded.content.toString()).toBe('%PDF-1.4 line item annexure');
      expect(loaded.meta.mimeType).toBe('application/pdf');
    });

    test('strips a directory component from the supplied name', () => {
      const saved = attachments.saveAttachment({
        fileName: '../../evil/report.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });
      expect(saved.attachment.fileName).toBe('report.pdf');
    });

    test.each([
      [{ content: '' }, ATTACHMENT_STATUS.NO_CONTENT],
      [{ content: undefined }, ATTACHMENT_STATUS.NO_CONTENT],
    ])('refuses an empty body %p', (overrides, expected) => {
      const result = attachments.saveAttachment({
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        ...overrides,
      });
      expect(result.status).toBe(expected);
      expect(result.attachment).toBeNull();
    });

    test('refuses a body that decodes to nothing', () => {
      const result = attachments.saveAttachment({
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        content: '   ',
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.NO_CONTENT);
    });

    test('refuses a type outside the allow-list', () => {
      const result = attachments.saveAttachment({
        fileName: 'payload.exe',
        mimeType: 'application/x-msdownload',
        content: pdfBody(),
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.UNSUPPORTED_TYPE);
    });

    // Checked before decoding, so an oversized upload is never materialised.
    test('refuses a document over the size ceiling', () => {
      const oversize = 'A'.repeat(RFQ_ATTACHMENT_CONFIG.MAX_BYTES * 2);
      const result = attachments.saveAttachment({
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        content: oversize,
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.TOO_LARGE);
    });

    test('defaults to an empty payload when called with no arguments', () => {
      expect(attachments.saveAttachment().status).toBe(ATTACHMENT_STATUS.NO_CONTENT);
    });

    test('reports a write failure rather than throwing', () => {
      const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });
      try {
        const result = attachments.saveAttachment({
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          content: pdfBody(),
        });
        expect(result.status).toBe(ATTACHMENT_STATUS.WRITE_FAILED);
        expect(result.error).toContain('ENOSPC');
      } finally {
        spy.mockRestore();
      }
    });

    test.each(['a1b2c3d4-0000-4000-8000-ffffffffffff', '../../etc/passwd'])(
      'returns null for the unknown or unsafe id %p',
      (id) => {
        expect(attachments.loadAttachment(id)).toBeNull();
      }
    );

    test('returns null when the content is present but the sidecar is gone', () => {
      const saved = attachments.saveAttachment({
        fileName: 'orphan.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });
      fs.rmSync(attachments.resolveStoredPath(saved.attachment.id, '.json'));

      expect(attachments.loadAttachment(saved.attachment.id)).toBeNull();
    });

    test('returns null rather than throwing when the sidecar is corrupt', () => {
      const saved = attachments.saveAttachment({
        fileName: 'corrupt.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });
      fs.writeFileSync(attachments.resolveStoredPath(saved.attachment.id, '.json'), 'not json', 'utf8');

      expect(attachments.loadAttachment(saved.attachment.id)).toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('RFQ attachment HTTP routes', () => {
  describe('POST /api/rfqs/attachments', () => {
    test('stores a document and returns its metadata', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'annexure.pdf', mimeType: 'application/pdf', content: pdfBody() });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fileName).toBe('annexure.pdf');
      expect(res.body.data.id).toBeDefined();
    });

    // An attachment is commercial-in-confidence, so neither route may be anonymous.
    test('requires a session', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .send({ fileName: 'a.pdf', mimeType: 'application/pdf', content: pdfBody() });

      expect(res.statusCode).toBe(401);
    });

    test('returns 400 when the payload is incomplete', async () => {
      const res = await request(app).post('/api/rfqs/attachments').set(authHeader('buyer')).send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.fileName).toBeDefined();
    });

    test('returns 422 with a reason for a type outside the allow-list', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'payload.exe', mimeType: 'application/x-msdownload', content: pdfBody() });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(ATTACHMENT_STATUS.UNSUPPORTED_TYPE);
      expect(res.body.error).toMatch(/cannot be attached/i);
    });

    test('returns 422 for a document over the size ceiling', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({
          fileName: 'huge.pdf',
          mimeType: 'application/pdf',
          content: 'A'.repeat(RFQ_ATTACHMENT_CONFIG.MAX_BYTES * 2),
        });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(ATTACHMENT_STATUS.TOO_LARGE);
      expect(res.body.error).toMatch(/limit/i);
    });

    // A storage fault is ours, not the buyer's, so it is a 500 rather than a 422.
    test('returns 500 when storage fails', async () => {
      const spy = jest.spyOn(attachments, 'saveAttachment').mockReturnValue({
        status: ATTACHMENT_STATUS.WRITE_FAILED,
        attachment: null,
        error: 'disk full',
      });
      try {
        const res = await request(app)
          .post('/api/rfqs/attachments')
          .set(authHeader('buyer'))
          .send({ fileName: 'a.pdf', mimeType: 'application/pdf', content: pdfBody() });

        expect(res.statusCode).toBe(500);
        expect(res.body.reason).toBe(ATTACHMENT_STATUS.WRITE_FAILED);
      } finally {
        spy.mockRestore();
      }
    });

    test('surfaces an unexpected fault through the error handler', async () => {
      const spy = jest.spyOn(attachments, 'saveAttachment').mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        const res = await request(app)
          .post('/api/rfqs/attachments')
          .set(authHeader('buyer'))
          .send({ fileName: 'a.pdf', mimeType: 'application/pdf', content: pdfBody() });

        expect(res.statusCode).toBe(500);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('GET /api/rfqs/attachments/:attachmentId', () => {
    test('serves the stored bytes with the stored name and type', async () => {
      const upload = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'annexure.pdf', mimeType: 'application/pdf', content: pdfBody() });

      const res = await request(app)
        .get(`/api/rfqs/attachments/${upload.body.data.id}`)
        .set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      // Inline so a PDF or image previews rather than forcing a download.
      expect(res.headers['content-disposition']).toBe('inline; filename="annexure.pdf"');
      expect(res.body.toString()).toBe('%PDF-1.4 line item annexure');
    });

    test('requires a session', async () => {
      const res = await request(app).get('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef');
      expect(res.statusCode).toBe(401);
    });

    test('returns 404 for an unknown document', async () => {
      const res = await request(app)
        .get('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-ffffffffffff')
        .set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/no longer available/i);
    });

    // The route must not be usable to read arbitrary files off the volume.
    test('returns 404 rather than a file for a traversal attempt', async () => {
      const res = await request(app)
        .get('/api/rfqs/attachments/..%2F..%2Fpackage.json')
        .set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
    });

    test('surfaces an unexpected fault through the error handler', async () => {
      const spy = jest.spyOn(attachments, 'loadAttachment').mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        const res = await request(app)
          .get('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef')
          .set(authHeader('buyer'));

        expect(res.statusCode).toBe(500);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('POST /api/rfqs with attachments', () => {
    test('persists attachment metadata against the RFQ', async () => {
      const upload = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'annexure.pdf', mimeType: 'application/pdf', content: pdfBody() });

      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Manually Keyed Spares Requirement',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          attachments: [upload.body.data],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.attachments).toHaveLength(1);
      expect(res.body.data.attachments[0].fileName).toBe('annexure.pdf');
    });

    test('defaults to no attachments when none are supplied', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Requirement With No Documents',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.attachments).toEqual([]);
    });
  });
});
