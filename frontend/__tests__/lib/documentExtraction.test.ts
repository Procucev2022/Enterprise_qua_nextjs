import * as XLSX from 'xlsx';
import {
  isSpreadsheet,
  isEmailFile,
  flattenWorkbook,
  readAsBase64,
  readAsArrayBuffer,
  readAsText,
  extractPdfText,
  buildExtractionRequest,
} from '@/lib/documentExtraction';

// ==============================================================================
// DOCUMENT PREPARATION FOR AI EXTRACTION
// ==============================================================================
// Shared by the ingestion wizard's upload path and the manual RFQ dialog. The
// flattening in particular has to match what the extraction prompt describes:
// if row structure is lost, quantities stop lining up with the item they belong
// to, and the buyer only finds out after vendors have quoted.
// ==============================================================================

/** Build a real workbook so the flattening is exercised, not a mock of it. */
function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const written = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return written;
}

describe('isSpreadsheet', () => {
  test.each(['boq.xlsx', 'BOQ.XLS', 'items.csv', 'items.tsv'])(
    'treats %s as a spreadsheet',
    (name) => {
      expect(isSpreadsheet(name)).toBe(true);
    }
  );

  test.each(['spec.pdf', 'drawing.png', 'notes.txt', 'archive.xlsx.zip', 'noextension'])(
    'does not treat %s as a spreadsheet',
    (name) => {
      expect(isSpreadsheet(name)).toBe(false);
    }
  );
});

describe('isEmailFile', () => {
  test.each(['original_msg.eml', 'Requisition.EML', 'requisition.msg', 'MAIL.MSG'])('treats %s as an email', (name) => {
    expect(isEmailFile(name)).toBe(true);
  });

  test.each(['boq.xlsx', 'spec.pdf', 'notes.txt', 'noextension'])(
    'does not treat %s as an email',
    (name) => {
      expect(isEmailFile(name)).toBe(false);
    }
  );
});

describe('flattenWorkbook', () => {
  test('names the sheet and joins each row with a pipe', () => {
    const text = flattenWorkbook(
      workbook({
        Items: [
          ['Item', 'Qty', 'Unit'],
          ['Centrifugal Pump', 12, 'Nos'],
        ],
      })
    );

    expect(text).toBe('SHEET: Items\nItem | Qty | Unit\nCentrifugal Pump | 12 | Nos');
  });

  // Row structure is what keeps a quantity attached to its item, so each row has
  // to stay on its own line.
  test('keeps one line per row', () => {
    const text = flattenWorkbook(
      workbook({
        Sheet1: [
          ['Pump', 4],
          ['Valve', 9],
        ],
      })
    );

    expect(text.split('\n')).toEqual(['SHEET: Sheet1', 'Pump | 4', 'Valve | 9']);
  });

  test('trims cell values and renders an empty cell as nothing', () => {
    const text = flattenWorkbook(
      workbook({ Sheet1: [['  Pump  ', '', 'Nos']] })
    );

    expect(text).toBe('SHEET: Sheet1\nPump |  | Nos');
  });

  // A row of separators carries no data and would otherwise be read as an item.
  test('drops a row that holds nothing but separators', () => {
    const text = flattenWorkbook(
      workbook({
        Sheet1: [
          ['Item', 'Qty'],
          ['', ''],
          ['Valve', 9],
        ],
      })
    );

    expect(text).toBe('SHEET: Sheet1\nItem | Qty\nValve | 9');
  });

  test('flattens every sheet in the book', () => {
    const text = flattenWorkbook(
      workbook({
        Mechanical: [['Pump', 4]],
        Electrical: [['Cable', 200]],
      })
    );

    expect(text).toBe('SHEET: Mechanical\nPump | 4\n\nSHEET: Electrical\nCable | 200');
  });

  test('reports an empty sheet as a header with no rows', () => {
    const text = flattenWorkbook(workbook({ Sheet1: [[]] }));

    expect(text).toBe('SHEET: Sheet1\n');
  });

  // A sparse row reaches the mapper as a hole rather than as the empty-string
  // default, and "null" or "undefined" must never be sent to the model as a
  // quantity. Driven through the reader because a real workbook cannot produce it.
  test('renders a missing cell as nothing rather than as the word null', () => {
    const sparse = jest
      .spyOn(XLSX.utils, 'sheet_to_json')
      .mockReturnValue([[null, undefined, 'Pump', 4]] as unknown[]);

    const text = flattenWorkbook(workbook({ Sheet1: [['Pump', 4]] }));

    expect(text).toBe('SHEET: Sheet1\n |  | Pump | 4');
    sparse.mockRestore();
  });
});

describe('readAsBase64', () => {
  test('returns the body without the data-URL prefix', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });

    // "hello" base64-encoded.
    await expect(readAsBase64(file)).resolves.toBe('aGVsbG8=');
  });

  test('rejects when the file cannot be read', async () => {
    const failing = jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
      this: FileReader
    ) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });

    await expect(readAsBase64(new File(['x'], 'x.pdf'))).rejects.toThrow('read failed');
    failing.mockRestore();
  });

  test('yields an empty body for an empty file', async () => {
    await expect(readAsBase64(new File([], 'empty.pdf'))).resolves.toBe('');
  });

  // A reader that reports success without a payload must not stringify null into
  // the request body.
  test('yields an empty body when the reader produced no result', async () => {
    const empty = jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
      this: FileReader
    ) {
      const handler = this.onload;
      if (handler) handler.call(this, new ProgressEvent('load') as ProgressEvent<FileReader>);
    });

    await expect(readAsBase64(new File(['x'], 'x.pdf'))).resolves.toBe('');
    empty.mockRestore();
  });
});

describe('readAsArrayBuffer', () => {
  test('returns the raw bytes', async () => {
    const buffer = await readAsArrayBuffer(new File(['AB'], 'x.csv'));

    expect(Array.from(new Uint8Array(buffer))).toEqual([65, 66]);
  });

  test('rejects when the file cannot be read', async () => {
    const failing = jest
      .spyOn(FileReader.prototype, 'readAsArrayBuffer')
      .mockImplementation(function (this: FileReader) {
        this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
      });

    await expect(readAsArrayBuffer(new File(['x'], 'x.csv'))).rejects.toThrow('read failed');
    failing.mockRestore();
  });
});

describe('buildExtractionRequest', () => {
  // Gemini cannot read an xlsx binary, so a workbook is flattened in the browser
  // and sent as text.
  test('sends a spreadsheet as flattened text', async () => {
    const bytes = workbook({ Items: [['Pump', 4]] });
    const file = new File([bytes], 'boq.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const request = await buildExtractionRequest(file);

    expect(request).toEqual({
      fileName: 'boq.xlsx',
      documentText: 'SHEET: Items\nPump | 4',
    });
    expect(request).not.toHaveProperty('inlineData');
  });

  test('sends a CSV as flattened text too', async () => {
    const file = new File(['Item,Qty\nPump,4\n'], 'items.csv', { type: 'text/csv' });

    const request = await buildExtractionRequest(file);

    expect(request.fileName).toBe('items.csv');
    expect(request.documentText).toContain('Pump | 4');
  });

  test('sends any other document inline with its declared type', async () => {
    const file = new File(['hello'], 'spec.pdf', { type: 'application/pdf' });

    await expect(buildExtractionRequest(file)).resolves.toEqual({
      fileName: 'spec.pdf',
      inlineData: 'aGVsbG8=',
      mimeType: 'application/pdf',
    });
  });

  // Browsers leave the type empty for some uploads, and the API needs one.
  test('assumes PDF when the browser declared no type', async () => {
    const file = new File(['hello'], 'spec', { type: '' });

    await expect(buildExtractionRequest(file)).resolves.toMatchObject({
      mimeType: 'application/pdf',
    });
  });

  test('preserves a non-PDF type such as an image', async () => {
    const file = new File(['hello'], 'drawing.png', { type: 'image/png' });

    await expect(buildExtractionRequest(file)).resolves.toMatchObject({
      mimeType: 'image/png',
    });
  });

  // A raw .eml is routed through the backend's emailIngestionService, not
  // Gemini's inline MIME allow-list — sent with an explicit message/rfc822
  // type rather than falling into the generic "assume PDF" default.
  test('sends a .eml file inline as message/rfc822, ignoring the browser type', async () => {
    const file = new File(['From: a@b.com\r\nSubject: RFQ\r\n\r\nBody'], 'original_msg.eml', { type: '' });

    await expect(buildExtractionRequest(file)).resolves.toEqual({
      fileName: 'original_msg.eml',
      inlineData: expect.any(String),
      mimeType: 'message/rfc822',
    });
  });

  test('sends a .msg file inline as application/vnd.ms-outlook', async () => {
    const file = new File(['From: a@b.com\r\nSubject: RFQ\r\n\r\nBody'], 'requisition.msg', { type: '' });

    await expect(buildExtractionRequest(file)).resolves.toEqual({
      fileName: 'requisition.msg',
      inlineData: expect.any(String),
      mimeType: 'application/vnd.ms-outlook',
    });
  });

  test('sends a .txt file as documentText', async () => {
    const file = new File(['1000m Power Cable 4-core'], 'indent.txt', { type: 'text/plain' });

    await expect(buildExtractionRequest(file)).resolves.toEqual({
      fileName: 'indent.txt',
      documentText: '1000m Power Cable 4-core',
    });
  });

  test('sends a .docx file as documentText or inlineData', async () => {
    const file = new File(['mock docx binary content'], 'specification.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const res = await buildExtractionRequest(file);
    expect(res.fileName).toBe('specification.docx');
    expect(res.documentText !== undefined || res.inlineData !== undefined).toBe(true);
  });

  test('sends a .pdf file as documentText or inlineData', async () => {
    const file = new File(['%PDF-1.4 mock pdf binary content stream BT /F1 12 Tf (Centrifugal Pump 500 GPM) Tj ET endstream'], 'drawing.pdf', {
      type: 'application/pdf',
    });

    const res = await buildExtractionRequest(file);
    expect(res.fileName).toBe('drawing.pdf');
    expect(res.documentText !== undefined || res.inlineData !== undefined).toBe(true);
  });
});

describe('isTextFile and isWordDocument', () => {
  test.each(['indent.txt', 'specs.md', 'output.log'])('identifies %s as text file', (name) => {
    expect(require('@/lib/documentExtraction').isTextFile(name)).toBe(true);
  });

  test.each(['requisition.docx', 'tender.doc'])('identifies %s as word document', (name) => {
    expect(require('@/lib/documentExtraction').isWordDocument(name)).toBe(true);
  });

  test('extractDocxText parses uncompressed word document xml', async () => {
    const { extractDocxText } = require('@/lib/documentExtraction');
    const fn = 'word/document.xml';
    const xml = '<w:document><w:body><w:p><w:r><w:t>Centrifugal Pump 500 GPM</w:t></w:r></w:p></w:body></w:document>';
    const enc = new TextEncoder();
    const fnBytes = enc.encode(fn);
    const xmlBytes = enc.encode(xml);
    const header = new Uint8Array(30 + fnBytes.length + xmlBytes.length);
    header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
    header[8] = 0; header[9] = 0; // compMethod = 0
    header[18] = xmlBytes.length & 0xff; header[19] = (xmlBytes.length >> 8) & 0xff;
    header[26] = fnBytes.length & 0xff; header[27] = 0;
    header.set(fnBytes, 30);
    header.set(xmlBytes, 30 + fnBytes.length);

    const extracted = await extractDocxText(header.buffer);
    expect(extracted).toContain('Centrifugal Pump 500 GPM');
  });

  test('extractPdfText handles empty buffer and returns empty string', async () => {
    const { extractPdfText } = require('@/lib/documentExtraction');
    expect(await extractPdfText(new ArrayBuffer(0))).toBe('');
    expect(await extractPdfText(null as any)).toBe('');
  });

  test('extractPdfText handles octal escapes and parenthesis escaping', async () => {
    const { extractPdfText } = require('@/lib/documentExtraction');
    const pdfContent = 'stream\n(\\040Item\\(A\\)\\040) Tj\n[(Part\\(B\\))] TJ\nendstream';
    const enc = new TextEncoder();
    const text = await extractPdfText(enc.encode(pdfContent).buffer);
    expect(text).toContain('Item(A)');
    expect(text).toContain('Part(B)');
  });

  test('extractDocxText returns empty string for non-docx buffer', async () => {
    const { extractDocxText } = require('@/lib/documentExtraction');
    const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    expect(await extractDocxText(buf)).toBe('');
  });

  test('parseDocxXml handles XML entities, tabs, and tables', () => {
    const { parseDocxXml } = require('@/lib/documentExtraction');
    const xml = '<w:p><w:t>Item &amp; Spec &lt;100&gt; &quot;High&quot; &#39;Grade&#39;</w:t></w:p><w:tr><w:tc><w:t>Col1</w:t></w:tc><w:tc><w:t>Col2</w:t></w:tc></w:tr>';
    const result = parseDocxXml(xml);
    expect(result).toContain('Item & Spec <100> "High" \'Grade\'');
    expect(result).toContain('Col1 | Col2');
  });

  test('buildExtractionRequest handles generic file without type falling back to application/pdf', async () => {
    const { buildExtractionRequest } = require('@/lib/documentExtraction');
    const file = new File(['content'], 'custom_scan', { type: '' });
    const req = await buildExtractionRequest(file);
    expect(req.fileName).toBe('custom_scan');
    expect(req.mimeType).toBe('application/pdf');
    expect(req.inlineData).toBeDefined();
  });

  test('buildExtractionRequest extracts docx when text is present and falls back to inlineData when empty or threw', async () => {
    const { buildExtractionRequest } = require('@/lib/documentExtraction');
    const emptyDocx = new File(['not a real zip'], 'empty.docx', { type: '' });
    const req1 = await buildExtractionRequest(emptyDocx);
    expect(req1.fileName).toBe('empty.docx');
    expect(req1.inlineData).toBeDefined();
    expect(req1.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const fn = 'word/document.xml';
    const xml = '<w:p><w:t>Industrial Centrifugal Water Pump 500 GPM</w:t></w:p>';
    const enc = new TextEncoder();
    const fnBytes = enc.encode(fn);
    const xmlBytes = enc.encode(xml);
    const header = new Uint8Array(30 + fnBytes.length + xmlBytes.length);
    header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
    header[8] = 0; header[9] = 0;
    header[18] = xmlBytes.length & 0xff; header[19] = (xmlBytes.length >> 8) & 0xff;
    header[26] = fnBytes.length & 0xff; header[27] = 0;
    header.set(fnBytes, 30);
    header.set(xmlBytes, 30 + fnBytes.length);

    const validDocx = new File([header.buffer], 'valid.docx', { type: '' });
    const req2 = await buildExtractionRequest(validDocx);
    expect(req2.documentText).toContain('Industrial Centrifugal Water Pump 500 GPM');
  });

  test('buildExtractionRequest returns documentText for PDF with extracted text >= 15 chars', async () => {
    const { buildExtractionRequest } = require('@/lib/documentExtraction');
    const pdfWithText = new File([
      '%PDF-1.4\nstream\n(High Pressure Boiler Valve 250 PSI Specification) Tj\nendstream'
    ], 'valve_spec.pdf', { type: 'application/pdf' });
    const req = await buildExtractionRequest(pdfWithText);
    expect(req.fileName).toBe('valve_spec.pdf');
    expect(req.documentText).toContain('High Pressure Boiler Valve 250 PSI Specification');
  });

  test('extractDocxText handles compressed docx with DecompressionStream and fallback', async () => {
    const { extractDocxText } = require('@/lib/documentExtraction');
    const fn = 'word/document.xml';
    const compContent = new Uint8Array([0x78, 0x9c, 0x01, 0x00, 0x00, 0xff, 0xff]);
    const enc = new TextEncoder();
    const fnBytes = enc.encode(fn);
    const header = new Uint8Array(30 + fnBytes.length + compContent.length);
    header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
    header[8] = 8; header[9] = 0; // compMethod = 8
    header[18] = compContent.length & 0xff; header[19] = 0;
    header[26] = fnBytes.length & 0xff; header[27] = 0;
    header.set(fnBytes, 30);
    header.set(compContent, 30 + fnBytes.length);

    const res = await extractDocxText(header.buffer);
    expect(typeof res).toBe('string');
  });

  test('extractDocxText handles TextDecoder failure fallback for filename and content', async () => {
    const { extractDocxText } = require('@/lib/documentExtraction');
    const origTextDecoder = global.TextDecoder;
    (global as any).TextDecoder = class MockFailingDecoder {
      decode() {
        throw new Error('Decoder failed');
      }
    };
    try {
      const fn = 'word/document.xml';
      const xml = '<w:p><w:t>Fallback Text</w:t></w:p>';
      const fnBytes = new Uint8Array(Array.from(fn).map((c) => c.charCodeAt(0)));
      const xmlBytes = new Uint8Array(Array.from(xml).map((c) => c.charCodeAt(0)));
      const header = new Uint8Array(30 + fnBytes.length + xmlBytes.length);
      header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
      header[8] = 0; header[9] = 0;
      header[18] = xmlBytes.length & 0xff; header[19] = (xmlBytes.length >> 8) & 0xff;
      header[26] = fnBytes.length & 0xff; header[27] = 0;
      header.set(fnBytes, 30);
      header.set(xmlBytes, 30 + fnBytes.length);

      const res = await extractDocxText(header.buffer);
      expect(res).toContain('Fallback Text');
    } finally {
      global.TextDecoder = origTextDecoder;
    }
  });

  test('parseDocxXml handles tabs and line breaks', () => {
    const { parseDocxXml } = require('@/lib/documentExtraction');
    const xml = '<w:p><w:t>Header</w:t><w:tab/><w:t>Value</w:t><w:br/><w:t>NextLine</w:t></w:p>';
    const result = parseDocxXml(xml);
    expect(result).toContain('Header Value');
    expect(result).toContain('NextLine');
  });

  test('readAsText reads file contents as string', async () => {
    const file = new File(['sample text content'], 'sample.txt', { type: 'text/plain' });
    const content = await readAsText(file);
    expect(content).toBe('sample text content');
  });

  test('extractPdfText parses plain and array Tj text streams from buffer', async () => {
    const streamContent = 'stream\n(Centrifugal Pump 50HP) Tj\n[(Valve) -20 (Gate)] TJ\nendstream';
    const encoder = new TextEncoder();
    const buffer = encoder.encode(streamContent).buffer;

    const result = await extractPdfText(buffer);
    expect(result).toContain('Centrifugal Pump 50HP');
    expect(result).toContain('Valve Gate');
  });

  test('extractPdfText handles empty or corrupt buffer gracefully', async () => {
    expect(await extractPdfText(new ArrayBuffer(0))).toBe('');
    expect(await extractPdfText(null as any)).toBe('');
  });
});


