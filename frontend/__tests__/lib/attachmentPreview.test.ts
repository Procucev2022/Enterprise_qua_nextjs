import { resolveAttachmentMimeType } from '@/lib/constants';
import {
  decodeRfc2047HeaderValue,
  normalizeAttachmentBlob,
  parseEmlContent,
  readBlobAsText,
  resolveAttachmentPreviewKind,
} from '@/lib/attachmentPreview';

describe('resolveAttachmentMimeType', () => {
  test('prefers explicit non-generic declared MIME type', () => {
    expect(resolveAttachmentMimeType('spec.eml', 'text/plain; charset=utf-8')).toBe('text/plain');
    expect(resolveAttachmentMimeType('doc.pdf', 'application/pdf')).toBe('application/pdf');
  });

  test('infers canonical MIME type from filename when declared MIME is empty or generic', () => {
    expect(resolveAttachmentMimeType('smaple rfq email.eml', '')).toBe('message/rfc822');
    expect(resolveAttachmentMimeType('rfq.msg', 'application/octet-stream')).toBe('application/vnd.ms-outlook');
    expect(resolveAttachmentMimeType('photo.JPG', null)).toBe('image/jpeg');
    expect(resolveAttachmentMimeType('boq.xlsx', 'binary/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  test('falls back cleanly when both declared MIME and extension are unknown', () => {
    expect(resolveAttachmentMimeType('archive.bin', '')).toBe('application/octet-stream');
    expect(resolveAttachmentMimeType('archive.bin', 'application/octet-stream')).toBe('application/octet-stream');
    expect(resolveAttachmentMimeType(null, undefined)).toBe('application/octet-stream');
  });
});

describe('resolveAttachmentPreviewKind', () => {
  test('routes every supported document type to its appropriate renderer', () => {
    expect(resolveAttachmentPreviewKind('smaple rfq email.eml', 'message/rfc822')).toBe('email');
    expect(resolveAttachmentPreviewKind('smaple rfq email.eml', 'application/octet-stream')).toBe('email');
    expect(resolveAttachmentPreviewKind('annexure.pdf', 'application/pdf')).toBe('pdf');
    expect(resolveAttachmentPreviewKind('annexure.pdf', 'application/octet-stream')).toBe('pdf');
    expect(resolveAttachmentPreviewKind('drawing.png', 'image/png')).toBe('image');
    expect(resolveAttachmentPreviewKind('notes.txt', 'text/plain; charset=utf-8')).toBe('text');
    expect(resolveAttachmentPreviewKind('boq.csv', 'text/csv')).toBe('text');
    expect(resolveAttachmentPreviewKind('matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('download');
  });
});

describe('normalizeAttachmentBlob', () => {
  test('re-wraps blobs whose type is missing or generic using response/filename metadata', () => {
    const rawBlob = new Blob(['email-bytes'], { type: 'application/octet-stream' });
    const result = normalizeAttachmentBlob(rawBlob, 'smaple rfq email.eml', null, '');

    expect(result.resolvedMime).toBe('message/rfc822');
    expect(result.previewKind).toBe('email');
    expect(result.blob.type).toBe('message/rfc822');
  });

  test('keeps the original blob when it already has the resolved MIME type', () => {
    const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const result = normalizeAttachmentBlob(pdfBlob, 'spec.pdf', 'application/pdf', 'application/pdf');

    expect(result.blob).toBe(pdfBlob);
    expect(result.resolvedMime).toBe('application/pdf');
    expect(result.previewKind).toBe('pdf');
  });
});

describe('readBlobAsText', () => {
  test('reads text via blob.text when present', async () => {
    const nativeBlob = new Blob(['Subject: RFQ\n\nHello'], { type: 'text/plain' });
    await expect(readBlobAsText(nativeBlob)).resolves.toBe('Subject: RFQ\n\nHello');

    const textFnBlob = { text: jest.fn().mockResolvedValue('via-blob-text') } as unknown as Blob;
    await expect(readBlobAsText(textFnBlob)).resolves.toBe('via-blob-text');
  });

  test('falls back to FileReader when blob.text is unavailable and propagates read errors', async () => {
    const fakeBlob = { size: 5, type: 'text/plain' } as unknown as Blob;
    const origFileReader = global.FileReader;

    class SuccessFileReader {
      public result: string | null = 'via-reader';
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public readAsText(): void {
        this.onload?.();
      }
    }
    global.FileReader = SuccessFileReader as unknown as typeof FileReader;
    await expect(readBlobAsText(fakeBlob)).resolves.toBe('via-reader');

    class NonStringFileReader {
      public result = new ArrayBuffer(0);
      public onload: (() => void) | null = null;
      public readAsText(): void {
        this.onload?.();
      }
    }
    global.FileReader = NonStringFileReader as unknown as typeof FileReader;
    await expect(readBlobAsText(fakeBlob)).resolves.toBe('');

    class FailingFileReader {
      public error: Error | null = new Error('unreadable');
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public readAsText(): void {
        this.onerror?.();
      }
    }
    global.FileReader = FailingFileReader as unknown as typeof FileReader;
    await expect(readBlobAsText(fakeBlob)).rejects.toThrow('unreadable');

    class NullErrorFileReader {
      public error: Error | null = null;
      public onerror: (() => void) | null = null;
      public readAsText(): void {
        this.onerror?.();
      }
    }
    global.FileReader = NullErrorFileReader as unknown as typeof FileReader;
    await expect(readBlobAsText(fakeBlob)).rejects.toThrow('Failed to read blob text.');

    global.FileReader = origFileReader;
  });

  test('falls back to Response or empty string when FileReader is unavailable', async () => {
    const fakeBlob = { size: 3, type: 'text/plain' } as unknown as Blob;
    const origFileReader = global.FileReader;
    const origResponse = global.Response;

    Object.defineProperty(global, 'FileReader', { value: undefined, configurable: true });
    Object.defineProperty(global, 'Response', {
      value: class FakeResponse {
        public text(): Promise<string> {
          return Promise.resolve('via-response');
        }
      },
      configurable: true,
    });
    await expect(readBlobAsText(fakeBlob)).resolves.toBe('via-response');

    Object.defineProperty(global, 'Response', { value: undefined, configurable: true });
    await expect(readBlobAsText(fakeBlob)).resolves.toBe('');

    Object.defineProperty(global, 'FileReader', { value: origFileReader, configurable: true });
    Object.defineProperty(global, 'Response', { value: origResponse, configurable: true });
  });
});

describe('decodeRfc2047HeaderValue and parseEmlContent', () => {
  test('decodes UTF-8 base64 and quoted-printable RFC 2047 header words', () => {
    const b64 = `=?UTF-8?B?${Buffer.from('Business Laptops').toString('base64')}?=`;
    const qp = '=?UTF-8?Q?RFQ_for_Pumps_=E2=82=B9?=';
    expect(decodeRfc2047HeaderValue(`Re: ${b64} - ${qp}`)).toBe('Re: Business Laptops - RFQ for Pumps ₹');
  });

  test('parses unfolded headers and plain-text body from a simple .eml message', () => {
    const raw = [
      'From: buyer@acme.in',
      'To: procurement@procucev.ai',
      'Cc:ops@acme.in',
      'Subject: Procurement of',
      '  20 Business Laptops',
      'Date: Sat, 14 Nov 2026 11:00:00 +0530',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Please quote for 20 Business Laptops=0ABangalore=20delivery=.',
      'Delivery=',
      ' urgent.',
    ].join('\r\n');

    const parsed = parseEmlContent(raw);
    expect(parsed.from).toBe('buyer@acme.in');
    expect(parsed.to).toBe('procurement@procucev.ai');
    expect(parsed.cc).toBe('ops@acme.in');
    expect(parsed.subject).toBe('Procurement of 20 Business Laptops');
    expect(parsed.date).toBe('Sat, 14 Nov 2026 11:00:00 +0530');
    expect(parsed.body).toContain('Please quote for 20 Business Laptops');
    expect(parsed.body).toContain('Delivery urgent.');
  });

  test('parses multipart .eml with base64 body and embedded attachment names', () => {
    const encodedBody = Buffer.from('Intel Core i5, 16GB RAM, 512GB SSD').toString('base64');
    const raw = [
      'From: sender@corp.in',
      'Subject: Multipart Email',
      'Content-Type: multipart/mixed; boundary="BOUNDARY123"',
      '',
      '--BOUNDARY123',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodedBody,
      '--BOUNDARY123',
      'Content-Disposition: attachment; filename="boq.xlsx"',
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Transfer-Encoding: base64',
      '',
      'AAAA',
      '--BOUNDARY123--',
    ].join('\r\n');

    const parsed = parseEmlContent(raw);
    expect(parsed.subject).toBe('Multipart Email');
    expect(parsed.body).toBe('Intel Core i5, 16GB RAM, 512GB SSD');
    expect(parsed.embeddedAttachments).toEqual(['boq.xlsx']);
  });

  test('falls back safely to HTML-stripped text and handles body-only messages', () => {
    const htmlOnly = [
      'Subject: HTML Requisition',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<style>.x{color:red}</style><script>alert(1)</script><p>Need <b>10&nbsp;Units</b> &amp; cables.</p>',
    ].join('\n');

    const parsedHtml = parseEmlContent(htmlOnly);
    expect(parsedHtml.body).toContain('Need 10 Units & cables.');
    expect(parsedHtml.body).not.toContain('alert(1)');
    expect(parsedHtml.body).not.toContain('color:red');

    const singleLineBody = parseEmlContent('Single line body without headers');
    expect(singleLineBody.subject).toBeUndefined();
    expect(singleLineBody.body).toBe('Single line body without headers');

    const plainBodyOnly = parseEmlContent('Just a plain message without headers\n\nSecond paragraph');
    expect(plainBodyOnly.subject).toBeUndefined();
    expect(plainBodyOnly.body).toBe('Just a plain message without headers\n\nSecond paragraph');
  });

  test('covers multipart edge cases: unquoted boundaries, nameless attachments, duplicate headers, and non-text parts', () => {
    const raw = [
      'Subject: First Subject',
      'Subject: Duplicate Ignored',
      'InvalidHeaderLineWithoutColon',
      'Content-Type: multipart/mixed; boundary=PLAIN_BOUNDARY',
      '',
      '--PLAIN_BOUNDARY',
      'Content-Type: text/plain',
      '',
      '   ',
      '--PLAIN_BOUNDARY',
      'Content-Disposition: attachment;',
      'Content-Type: application/pdf',
      '',
      '%PDF-ignored-attachment',
      '--PLAIN_BOUNDARY',
      'Content-Type: image/png',
      '',
      'binary-image-bytes',
      '--PLAIN_BOUNDARY',
      'Content-Type: text/plain',
      '',
      'Final readable line',
      '--PLAIN_BOUNDARY--',
    ].join('\r\n');

    const parsed = parseEmlContent(raw);
    expect(parsed.subject).toBe('First Subject');
    expect(parsed.embeddedAttachments).toEqual(['attachment']);
    expect(parsed.body).toBe('Final readable line');
  });

  test('handles missing blob.type and semicolon parameters in normalizeAttachmentBlob', () => {
    const weirdBlob = { size: 4, type: undefined } as unknown as Blob;
    const origBlob = global.Blob;
    const normalized = normalizeAttachmentBlob(weirdBlob, 'notes.json', 'application/json; charset=utf-8');
    expect(normalized.resolvedMime).toBe('application/json');
    expect(normalized.previewKind).toBe('text');
    expect(origBlob).toBeDefined();
  });

  test('handles malformed base64 and missing atob gracefully', () => {
    const origAtob = global.atob;
    const raw = [
      'Subject: Base64 Edge',
      'Content-Transfer-Encoding: base64',
      '',
      '%%%invalid-base64%%%',
    ].join('\n');

    expect(parseEmlContent(raw).body).toBe('%%%invalid-base64%%%');

    Object.defineProperty(global, 'atob', { value: undefined, configurable: true });
    expect(parseEmlContent(raw).body).toBe('%%%invalid-base64%%%');
    Object.defineProperty(global, 'atob', { value: origAtob, configurable: true });
  });
});
