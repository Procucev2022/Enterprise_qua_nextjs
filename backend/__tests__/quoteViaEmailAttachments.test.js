const zlib = require('zlib');

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    gmail: jest.fn(),
  },
}));

const { google } = require('googleapis');
const quoteDocumentExtractor = require('../src/services/quoteDocumentExtractor');
const geminiService = require('../src/services/geminiService');
const emailIngestionService = require('../src/services/emailIngestionService');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const quoteAttachmentService = require('../src/services/quoteAttachmentService');
const mailerService = require('../src/services/mailerService');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const { GEMINI_CONFIG, EMAIL_INGESTION_STATUS, QUOTE_DOCUMENT_EXTRACTOR_CONFIG } = require('../src/config/constants');
const { INGESTION_OUTCOME } = emailGatewayQueries;

/** Build a real ZIP Buffer (with Central Directory + optional data-descriptor local headers). */
function buildTestZip(entries, { useDataDescriptor = false, omitCentralDirectory = false } = {}) {
  const localChunks = [];
  const cdChunks = [];
  let offset = 0;

  for (const { name, data, method = 8 } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const comp = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(useDataDescriptor ? 0x0008 : 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(useDataDescriptor ? 0 : comp.length, 18);
    local.writeUInt32LE(useDataDescriptor ? 0 : raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    localChunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(useDataDescriptor ? 0x0008 : 0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);

    cdChunks.push(cd, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }

  if (omitCentralDirectory) {
    return Buffer.concat(localChunks);
  }

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

/** Build a synthetic OLE2 Compound File Binary container holding named regular/mini streams. */
function buildTestOle2(streamDefs) {
  const secSize = 512;
  const header = Buffer.alloc(secSize, 0xff);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(3, 24);
  header.writeUInt16LE(0x003e, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(1, 48);
  header.writeUInt32LE(4096, 56);
  header.writeInt32LE(-2, 60);
  header.writeInt32LE(0, 64);
  header.writeInt32LE(-2, 68);
  header.writeInt32LE(0, 72);

  // Sector 0 = FAT, Sector 1 = Directory, Sectors 2..N = stream payloads (all regular >= 4096 cutoff or padded)
  const dirSec = Buffer.alloc(secSize, 0);
  const dataSectors = [];
  const fatEntries = [-3, -2]; // sector 0 = FATSECT, sector 1 = dir (single sector)
  let nextSec = 2;

  const writeDirEntry = (idx, name, type, startSec, size) => {
    const off = idx * 128;
    const nameBuf = Buffer.from(`${name}\0`, 'utf16le');
    nameBuf.copy(dirSec, off);
    dirSec.writeUInt16LE(nameBuf.length, off + 64);
    dirSec[off + 66] = type;
    dirSec.writeInt32LE(startSec, off + 116);
    dirSec.writeUInt32LE(size, off + 120);
  };

  writeDirEntry(0, 'Root Entry', 5, -2, 0);

  streamDefs.forEach(({ name, data }, idx) => {
    const paddedSize = Math.max(data.length, 4096); // Keep regular FAT path clean
    const totalSecs = Math.ceil(paddedSize / secSize);
    const startSec = nextSec;
    for (let s = 0; s < totalSecs; s += 1) {
      const slice = Buffer.alloc(secSize, 0);
      if (s * secSize < data.length) {
        data.copy(slice, 0, s * secSize, Math.min(data.length, (s + 1) * secSize));
      }
      dataSectors.push(slice);
      fatEntries[nextSec] = s + 1 < totalSecs ? nextSec + 1 : -2;
      nextSec += 1;
    }
    writeDirEntry(idx + 1, name, 2, startSec, data.length);
  });

  const fatSec = Buffer.alloc(secSize, 0xff);
  for (let i = 0; i < fatEntries.length && i < 128; i += 1) {
    fatSec.writeInt32LE(fatEntries[i], i * 4);
  }
  header.writeInt32LE(0, 76); // DIFAT[0] = sector 0

  return Buffer.concat([header, fatSec, dirSec, ...dataSectors]);
}

function makeBiffRecord(id, payload) {
  const hdr = Buffer.alloc(4);
  hdr.writeUInt16LE(id, 0);
  hdr.writeUInt16LE(payload.length, 2);
  return Buffer.concat([hdr, payload]);
}

function makeBiff8String(text, { oneByteLen = false, unicode = false } = {}) {
  const rawText = Buffer.from(text, unicode ? 'utf16le' : 'latin1');
  const hdr = Buffer.alloc(oneByteLen ? 2 : 3);
  if (oneByteLen) {
    hdr[0] = text.length;
    hdr[1] = unicode ? 1 : 0;
  } else {
    hdr.writeUInt16LE(text.length, 0);
    hdr[2] = unicode ? 1 : 0;
  }
  return Buffer.concat([hdr, rawText]);
}

/** Build a BIFF8 Workbook stream containing BOUNDSHEET, SST, LABELSST, NUMBER, RK, MULRK, FORMULA+STRING. */
function buildTestBiff8Workbook() {
  const bofGlobal = makeBiffRecord(0x0809, Buffer.from([0x00, 0x06, 0x05, 0x00, 0x00, 0x00]));
  const sstStr1 = makeBiff8String('Item Description');
  const sstStr2 = makeBiff8String('Centrifugal Pump');
  const sstHdr = Buffer.alloc(8);
  sstHdr.writeUInt32LE(2, 0);
  sstHdr.writeUInt32LE(2, 4);
  const sstRec = makeBiffRecord(0x00fc, Buffer.concat([sstHdr, sstStr1, sstStr2]));

  // Sheet stream starts after global EOF
  const bsNameBuf = makeBiff8String('QuoteSheet', { oneByteLen: true });
  const bsPayload = Buffer.concat([Buffer.alloc(6, 0), bsNameBuf]);

  const sheetRecords = [];
  sheetRecords.push(makeBiffRecord(0x0809, Buffer.from([0x00, 0x06, 0x10, 0x00, 0x00, 0x00])));
  // Row 0 Col 0: SST[0] = Item Description
  const lblSst0 = Buffer.alloc(10);
  lblSst0.writeUInt32LE(0, 6);
  sheetRecords.push(makeBiffRecord(0x00fd, lblSst0));
  // Row 0 Col 1: LABEL = Unit Price
  const lblHdr = Buffer.alloc(6);
  lblHdr.writeUInt16LE(0, 0);
  lblHdr.writeUInt16LE(1, 2);
  sheetRecords.push(makeBiffRecord(0x0204, Buffer.concat([lblHdr, makeBiff8String('Unit Price')])));
  // Row 1 Col 0: SST[1] = Centrifugal Pump
  const lblSst1 = Buffer.alloc(10);
  lblSst1.writeUInt16LE(1, 0);
  lblSst1.writeUInt16LE(0, 2);
  lblSst1.writeUInt32LE(1, 6);
  sheetRecords.push(makeBiffRecord(0x00fd, lblSst1));
  // Row 1 Col 1: NUMBER = 14500
  const numRec = Buffer.alloc(14);
  numRec.writeUInt16LE(1, 0);
  numRec.writeUInt16LE(1, 2);
  numRec.writeDoubleLE(14500, 6);
  sheetRecords.push(makeBiffRecord(0x0203, numRec));
  // Row 1 Col 2: RK integer (10 -> (10 << 2) | 0x02 = 42)
  const rkRec = Buffer.alloc(10);
  rkRec.writeUInt16LE(1, 0);
  rkRec.writeUInt16LE(2, 2);
  rkRec.writeUInt32LE((10 << 2) | 0x02, 6);
  sheetRecords.push(makeBiffRecord(0x027e, rkRec));
  // Row 2 Col 0..1: FORMULA string + STRING record
  const formRec = Buffer.alloc(14);
  formRec.writeUInt16LE(2, 0);
  formRec.writeUInt16LE(0, 2);
  formRec[6] = 0; // cached string marker
  formRec.writeUInt16LE(0xffff, 12);
  sheetRecords.push(makeBiffRecord(0x0006, formRec));
  sheetRecords.push(makeBiffRecord(0x0207, makeBiff8String('Net 30 Days')));
  sheetRecords.push(makeBiffRecord(0x000a, Buffer.alloc(0)));

  const eofRec = makeBiffRecord(0x000a, Buffer.alloc(0));
  const preliminaryGlobalLen = bofGlobal.length + makeBiffRecord(0x0085, bsPayload).length + sstRec.length + eofRec.length;
  bsPayload.writeUInt32LE(preliminaryGlobalLen, 0);
  const bsRec = makeBiffRecord(0x0085, bsPayload);

  return Buffer.concat([bofGlobal, bsRec, sstRec, eofRec, ...sheetRecords]);
}

function buildMimeWithAttachment({
  from = 'vendor@direct-sup.in',
  to = 'gmtrfq@procucev.test.com',
  subject = 'Re: Quotation Submission',
  body = '',
  attachmentName,
  attachmentMime = 'application/octet-stream',
  attachmentContent,
}) {
  const boundary = '----=_Part_QuoteAttachment_001';
  const b64 = (Buffer.isBuffer(attachmentContent) ? attachmentContent : Buffer.from(attachmentContent)).toString('base64');
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: <quote-att-${Date.now()}-${Math.random().toString(36).slice(2)}@mail.test>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
    `--${boundary}`,
    `Content-Type: ${attachmentMime}; name="${attachmentName}"`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

describe('Quotation via Email — PDF, DOC/DOCX & Excel Attachment Support', () => {
  const DIRECT_MAILBOX = 'gmtrfq@procucev.test.com';
  const BUYER_MAILBOX = 'rfq@procucev.com';
  let savedDirectEnv;
  let savedGeminiKey;
  let origFetch;

  beforeEach(() => {
    savedDirectEnv = process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS;
    savedGeminiKey = GEMINI_CONFIG.API_KEY;
    origFetch = global.fetch;
    process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS = DIRECT_MAILBOX;
    GEMINI_CONFIG.API_KEY = 'test-gemini-key';

    storeService.reset();
    emailGatewayService.resetAutoReplyMemory();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue('audit-att-1');
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
    jest.spyOn(mailerService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true, messageId: '<ack-1>' });
    jest.spyOn(mailerService, 'sendQuoteFailureEmail').mockResolvedValue({ sent: true, messageId: '<fail-1>' });
    jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: true, messageId: '<buyer-1>' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = origFetch;
    GEMINI_CONFIG.API_KEY = savedGeminiKey;
    if (savedDirectEnv === undefined) delete process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS;
    else process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS = savedDirectEnv;
  });

  describe('1. quoteDocumentExtractor multi-format extraction', () => {
    test('extracts DOCX paragraphs, tables, headers, and handles octet-stream MIME fallback', () => {
      const docxBuf = buildTestZip(
        [
          {
            name: 'word/header1.xml',
            data: '<w:hdr><w:p><w:t>Vendor Quotation Ref &amp; Terms</w:t></w:p></w:hdr>',
          },
          {
            name: 'word/document.xml',
            data: '<w:document><w:body><w:p><w:t>Quotation for RFQ260001</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Pump 150HP</w:t></w:p></w:tc><w:tc><w:p><w:t>&#8377;22500</w:t></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
          },
        ],
        { useDataDescriptor: true }
      );

      const res = quoteDocumentExtractor.extractVendorQuoteAttachments([
        { fileName: 'logo.png', contentType: 'image/png', role: 'signature', content: Buffer.from('sig') },
        { fileName: 'vendor-quote.docx', contentType: 'application/octet-stream', content: docxBuf },
      ]);

      expect(res.processedAttachments).toHaveLength(1);
      expect(res.processedAttachments[0]).toMatchObject({ fileName: 'vendor-quote.docx', format: 'docx', sentInline: false });
      expect(res.extractedText).toContain('Vendor Quotation Ref & Terms');
      expect(res.extractedText).toContain('Pump 150HP | ₹22500');
      expect(res.inlineParts).toEqual([]);
    });

    test('extracts XLSX workbook sheets, shared strings, inline strings, booleans, and sparse columns', () => {
      const xlsxBuf = buildTestZip(
        [
          {
            name: 'xl/workbook.xml',
            data: '<workbook><sheets><sheet name="Commercial Bid" r:id="rId1"/></sheets></workbook>',
          },
          {
            name: 'xl/_rels/workbook.xml.rels',
            data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
          },
          {
            name: 'xl/sharedStrings.xml',
            data: '<sst><si><t>Gate Valve</t></si><si><r><t>Net 30</t></r><r><t> Days</t></r></si></sst>',
          },
          {
            name: 'xl/worksheets/sheet1.xml',
            data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="n"><v>1850</v></c><c r="D1" t="inlineStr"><is><t>Included</t></is></c><c r="E1" t="b"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>',
          },
        ],
        { omitCentralDirectory: true }
      );

      const res = quoteDocumentExtractor.extractVendorQuoteAttachments([
        { fileName: 'boq-quote.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: xlsxBuf },
      ]);

      expect(res.processedAttachments[0]).toMatchObject({ format: 'xlsx', fileName: 'boq-quote.xlsx' });
      expect(res.extractedText).toContain('SHEET: Commercial Bid');
      expect(res.extractedText).toContain('Gate Valve |  | 1850 | Included | TRUE');
      expect(res.extractedText).toContain('Net 30 Days');
    });

    test('extracts legacy XLS (BIFF8 OLE2, SpreadsheetML XML, HTML table) and legacy DOC (OLE2, RTF, HTML)', () => {
      const biff8Ole2 = buildTestOle2([{ name: 'Workbook', data: buildTestBiff8Workbook() }]);
      const xmlXls = Buffer.from(
        '<Workbook><Worksheet ss:Name="Pricing"><Table><Row><Cell><Data>Motor</Data></Cell><Cell><Data>9200</Data></Cell></Row></Table></Worksheet></Workbook>',
        'utf8'
      );
      const htmlXls = Buffer.from('<html><table><tr><td>Bearing</td><td>450</td></tr></table></html>', 'utf8');

      const docBody = Buffer.alloc(128, 0);
      docBody.writeUInt32LE(0x60, 0x18); // fcMin
      docBody.writeUInt32LE(32, 0x4c); // ccpText
      Buffer.from('Pipe DN100\x07Unit Price 3200\x07\r', 'latin1').copy(docBody, 0x60);
      const ole2Doc = buildTestOle2([{ name: 'WordDocument', data: docBody }]);

      const rtfDoc = Buffer.from(
        '{\\rtf1{\\fonttbl{\\f0 Arial;}}Quotation Total\\tab INR 88000\\par Delivery: 14 days\\line Note: \\\'26\\u8377?}',
        'latin1'
      );

      const res = quoteDocumentExtractor.extractVendorQuoteAttachments([
        { fileName: 'legacy.xls', contentType: 'application/vnd.ms-excel', content: biff8Ole2 },
        { fileName: 'xml-sheet.xls', contentType: 'application/vnd.ms-excel', content: xmlXls },
        { fileName: 'erp-export.xls', contentType: 'application/vnd.ms-excel', content: htmlXls },
        { fileName: 'offer.doc', contentType: 'application/msword', content: ole2Doc },
        { fileName: 'terms.doc', contentType: 'application/msword', content: rtfDoc },
      ]);

      expect(res.extractedText).toContain('SHEET: QuoteSheet');
      expect(res.extractedText).toContain('Centrifugal Pump | 14500 | 10');
      expect(res.extractedText).toContain('Net 30 Days');
      expect(res.extractedText).toContain('SHEET: Pricing');
      expect(res.extractedText).toContain('Motor | 9200');
      expect(res.extractedText).toContain('Bearing | 450');
      expect(res.extractedText).toContain('Pipe DN100 | Unit Price 3200');
      expect(res.extractedText).toContain('Quotation Total | INR 88000');
      expect(res.extractedText).toContain('Delivery: 14 days');
    });

    test('extracts PDF text (uncompressed & FlateDecode) plus inline PDF and image parts, CSV/TSV/TXT, and skips invalid entries', () => {
      const compressedStream = zlib.deflateSync(Buffer.from('BT (Unit Price: 7500) Tj [(Lead Time:) (5 Days)] TJ ET', 'latin1'));
      const pdfBuf = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 20 >>\nstream\n', 'latin1'),
        compressedStream,
        Buffer.from('\nendstream\n', 'latin1'),
      ]);

      const res = quoteDocumentExtractor.extractVendorQuoteAttachments([
        { fileName: 'quote.pdf', contentType: 'application/octet-stream', content: pdfBuf },
        { fileName: 'scan.png', contentType: 'image/png', content: Buffer.from('png-bytes').toString('base64') },
        { fileName: 'rates.csv', contentType: 'text/csv', content: '"Valve, 200mm",5,2400\n' },
        { fileName: 'rates.tsv', contentType: 'text/tab-separated-values', content: 'Gasket\t20\t150\n' },
        { fileName: 'notes.txt', contentType: 'text/plain', content: Buffer.from('Validity: 30 days') },
        { fileName: 'unknown.exe', contentType: 'application/x-msdownload', content: Buffer.from('MZ') },
        { fileName: 'empty.pdf', contentType: 'application/pdf', content: Buffer.alloc(0) },
      ]);

      expect(res.inlineParts).toHaveLength(2);
      expect(res.inlineParts[0]).toMatchObject({ mimeType: 'application/pdf', fileName: 'quote.pdf' });
      expect(res.inlineParts[1]).toMatchObject({ mimeType: 'image/png', fileName: 'scan.png' });
      expect(res.extractedText).toContain('Unit Price: 7500');
      expect(res.extractedText).toContain('Lead Time: 5 Days');
      expect(res.extractedText).toContain('Valve, 200mm | 5 | 2400');
      expect(res.extractedText).toContain('Gasket | 20 | 150');
      expect(res.extractedText).toContain('Validity: 30 days');
      expect(res.skippedAttachments).toEqual(['unknown.exe', 'empty.pdf']);
    });
  });

  describe('2. E2E Direct Mailbox Quotation Creation from Attachments', () => {
    function seedRfqAndVendor(sourcingMode = 'mode_1') {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Acme Plant Ltd',
        corporateEmail: 'buyer@acme.test',
        sourcingMode,
      });
      const vendor = storeService.addVendor({
        id: 'v-quote-att-1',
        name: 'Apex Precision Works',
        email: 'sales@apex-works.in',
        majorCategory: 'Engineering Spares - Mechanical',
        isBuyerUploaded: true,
        source: 'buyer_upload',
        buyerAccountId: buyer.id,
      });
      const rfq = storeService.createRFQ(
        {
          rfqNumber: 'RFQ262611900001',
          title: 'Centrifugal Pumps Procurement',
          category: 'Engineering Spares - Mechanical',
          sourcingMode,
          buyerAccountId: buyer.id,
          buyerEmail: 'buyer@acme.test',
          assignedVendors: [{ id: vendor.id, name: vendor.name, email: vendor.email, isBuyerUploaded: true }],
          extractedEntities: [{ itemName: 'Centrifugal Pump 100HP', quantity: 4, unit: 'Nos' }],
        },
        buyer
      );
      return { buyer, vendor, rfq };
    }

    function stubGeminiJsonCapture(responsePayload) {
      let capturedBody = null;
      global.fetch = jest.fn(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(responsePayload) }] }, finishReason: 'STOP' }],
          }),
        };
      });
      return () => capturedBody;
    }

    test('PDF quote attachment on gmtrfq creates quotation (including multimodal inline_data + text) and persists attachment metadata', async () => {
      const { rfq } = seedRfqAndVendor('mode_1');
      const getCaptured = stubGeminiJsonCapture({
        unitPrice: 18000,
        totalPrice: 72000,
        leadTimeDays: 12,
        paymentTerms: 'Net 30',
        remarks: 'Extracted from attached PDF quote',
        lineItemQuotes: [{ itemName: 'Centrifugal Pump 100HP', quantity: 4, unitPrice: 18000, totalPrice: 72000 }],
      });
      jest.spyOn(quoteAttachmentService, 'saveQuoteAttachment').mockResolvedValue({
        status: 'SAVED',
        attachment: { id: 'qatt-pdf-1', fileName: 'Quote_RFQ262611900001.pdf', mimeType: 'application/pdf', size: 120 },
        error: null,
      });

      const pdfBuf = Buffer.from('%PDF-1.4\nstream\n(Quoted Rate: INR 18000 per unit, Total INR 72000) Tj\nendstream\n', 'latin1');
      const rawEml = buildMimeWithAttachment({
        from: 'sales@apex-works.in',
        to: DIRECT_MAILBOX,
        subject: 'Re: RFQ262611900001',
        body: 'Please find attached our quotation.',
        attachmentName: 'Quote_RFQ262611900001.pdf',
        attachmentMime: 'application/pdf',
        attachmentContent: pdfBuf,
      });

      const directConfig = emailGatewayService.resolveVendorConfig();
      const result = await emailGatewayService.processMessage(rawEml, directConfig);

      expect(result.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      const bodySent = getCaptured();
      const parts = bodySent.contents[0].parts;
      expect(parts[0].text).toContain('ATTACHED QUOTATION DOCUMENTS');
      expect(parts[0].text).toContain('Quoted Rate: INR 18000 per unit');
      expect(parts.some((p) => p.inline_data && p.inline_data.mime_type === 'application/pdf')).toBe(true);

      const updatedRfq = storeService.getRFQById(rfq.id);
      expect(updatedRfq.quotes).toHaveLength(1);
      expect(updatedRfq.quotes[0]).toMatchObject({
        unitPrice: 18000,
        totalPrice: 72000,
        source: 'email',
        attachments: [expect.objectContaining({ id: 'qatt-pdf-1', fileName: 'Quote_RFQ262611900001.pdf' })],
      });
      expect(mailerService.sendQuoteAcknowledgementEmail).toHaveBeenCalled();
    });

    test('Word DOCX attachment-only reply (empty body) creates quotation seamlessly', async () => {
      const { rfq } = seedRfqAndVendor('mode_2');
      const getCaptured = stubGeminiJsonCapture({
        unitPrice: 22000,
        totalPrice: 88000,
        leadTimeDays: 10,
        paymentTerms: '50% Advance',
        lineItemQuotes: [{ itemName: 'Centrifugal Pump 100HP', quantity: 4, unitPrice: 22000, totalPrice: 88000 }],
      });

      const docxBuf = buildTestZip([
        {
          name: 'word/document.xml',
          data: '<w:document><w:body><w:p><w:t>Ref: RFQ262611900001</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Centrifugal Pump 100HP</w:t></w:p></w:tc><w:tc><w:p><w:t>22000</w:t></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
        },
      ]);

      const rawEml = buildMimeWithAttachment({
        from: 'sales@apex-works.in',
        to: DIRECT_MAILBOX,
        subject: 'Offer Attached',
        body: '',
        attachmentName: 'Quotation_Offer.docx',
        attachmentMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        attachmentContent: docxBuf,
      });

      const result = await emailGatewayService.processMessage(rawEml, emailGatewayService.resolveVendorConfig());

      expect(result.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(getCaptured().contents[0].parts[0].text).toContain('Centrifugal Pump 100HP | 22000');
      expect(storeService.getRFQById(rfq.id).quotes[0]).toMatchObject({ unitPrice: 22000, totalPrice: 88000 });
    });

    test('Legacy Word DOC attachment-only reply creates quotation', async () => {
      const { rfq } = seedRfqAndVendor('mode_1');
      const getCaptured = stubGeminiJsonCapture({
        unitPrice: 16500,
        totalPrice: 66000,
        leadTimeDays: 7,
      });

      const rtfDoc = Buffer.from('{\\rtf1 RFQ262611900001\\par Unit Price: 16500\\par Total: 66000}', 'latin1');
      const rawEml = buildMimeWithAttachment({
        from: 'sales@apex-works.in',
        to: DIRECT_MAILBOX,
        subject: 'Quotation in Word',
        body: '',
        attachmentName: 'Offer.doc',
        attachmentMime: 'application/msword',
        attachmentContent: rtfDoc,
      });

      const result = await emailGatewayService.processMessage(rawEml, emailGatewayService.resolveVendorConfig());
      expect(result.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(getCaptured().contents[0].parts[0].text).toContain('Unit Price: 16500');
      expect(storeService.getRFQById(rfq.id).quotes[0]).toMatchObject({ unitPrice: 16500, totalPrice: 66000 });
    });

    test('Excel XLSX & XLS attachment-only reply on Gmail API poll resolves RFQ inside workbook and creates quotation', async () => {
      const { rfq, vendor } = seedRfqAndVendor('mode_0');
      rfq.assignedVendors = [
        { id: vendor.id, name: vendor.name, email: vendor.email, source: 'cm_assigned', inviteOrigin: 'cm_assigned' },
      ];
      storeService.recordRfqVendorInvite(rfq, {
        vendorId: 'v-quote-att-1',
        vendorEmail: 'sales@apex-works.in',
        inviteChannel: 'direct',
        inviteOrigin: 'cm_assigned',
        replyToQuoteAllowed: true,
      });

      const getCaptured = stubGeminiJsonCapture({
        unitPrice: 14500,
        totalPrice: 58000,
        leadTimeDays: 14,
        paymentTerms: 'Net 30 Days',
      });

      const xlsxBuf = buildTestZip([
        { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="Commercial" r:id="rId1"/></sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
        { name: 'xl/sharedStrings.xml', data: '<sst><si><t>RFQ262611900001</t></si><si><t>Centrifugal Pump 100HP</t></si></sst>' },
        {
          name: 'xl/worksheets/sheet1.xml',
          data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="n"><v>14500</v></c></row></sheetData></worksheet>',
        },
      ]);

      const rawEml = buildMimeWithAttachment({
        from: 'sales@apex-works.in',
        to: DIRECT_MAILBOX,
        subject: 'Attached Pricing Sheet',
        body: '',
        attachmentName: 'CommercialQuote.xlsx',
        attachmentMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        attachmentContent: xlsxBuf,
      });

      jest.spyOn(mailerService, 'getVendorGmailOAuthClient').mockReturnValue({});
      const modifyMock = jest.fn().mockResolvedValue({});
      jest.spyOn(google, 'gmail').mockReturnValue({
        users: {
          labels: {
            list: jest.fn().mockResolvedValue({ data: { labels: [{ id: 'lbl-proc', name: 'Processed' }, { id: 'lbl-err', name: 'Error' }] } }),
          },
          messages: {
            list: jest.fn().mockResolvedValue({ data: { messages: [{ id: 'gmail-att-msg-1' }] } }),
            get: jest.fn().mockResolvedValue({ data: { raw: rawEml.toString('base64url') } }),
            modify: modifyMock,
          },
        },
      });

      const pollRes = await emailGatewayService.pollVendorOnce(
        emailGatewayService.resolveVendorConfig({
          VENDOR_DIRECT_RFQ_EMAIL_ADDRESS: DIRECT_MAILBOX,
          VENDOR_DIRECT_RFQ_GATEWAY_ENABLED: 'true',
        })
      );

      expect(pollRes.outcomes[0].status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(getCaptured().contents[0].parts[0].text).toContain('Centrifugal Pump 100HP | 14500');
      expect(storeService.getRFQById(rfq.id).quotes[0]).toMatchObject({ unitPrice: 14500, totalPrice: 58000 });
      expect(modifyMock).toHaveBeenCalled();
    });

    test('preserves buyer spreadsheet refusal rule: buyer emailing empty body + boq.xlsx only is still rejected cleanly', async () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Acme Plant Ltd',
        corporateEmail: 'buyer-only@acme.test',
      });
      expect(buyer.id).toBeDefined();

      const xlsxBuf = buildTestZip([
        { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Pump</t></is></c></row></sheetData></worksheet>' },
      ]);
      const rawBuyerEml = buildMimeWithAttachment({
        from: 'buyer-only@acme.test',
        to: BUYER_MAILBOX,
        subject: 'BOQ',
        body: '',
        attachmentName: 'boq.xlsx',
        attachmentMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        attachmentContent: xlsxBuf,
      });

      const preparedDefault = await emailIngestionService.prepareEmailForExtraction({
        fileName: 'req.eml',
        content: rawBuyerEml.toString('base64'),
      });
      expect(preparedDefault.status).toBe(EMAIL_INGESTION_STATUS.NO_CONTENT);
      expect(preparedDefault.unreadableAttachments).toEqual(['boq.xlsx']);

      const gatewayRes = await emailGatewayService.processMessage(
        rawBuyerEml,
        emailGatewayService.resolveConfig({ EMAIL_GATEWAY_USER: BUYER_MAILBOX })
      );
      expect(gatewayRes.status).toBe(INGESTION_OUTCOME.UNREADABLE);
    });
  });

  describe('3. Comprehensive Format Edge-Cases & Coverage', () => {
    test('handles toAttachmentBuffer, classifyQuoteAttachment, parseZipEntries, and colLettersToIndex edge variants', () => {
      const u8 = new Uint8Array([1, 2, 3]);
      expect(quoteDocumentExtractor.toAttachmentBuffer(u8)).toEqual(Buffer.from([1, 2, 3]));
      expect(quoteDocumentExtractor.toAttachmentBuffer(u8.buffer)).toEqual(Buffer.from([1, 2, 3]));
      expect(quoteDocumentExtractor.toAttachmentBuffer('   ')).toBeNull();
      expect(quoteDocumentExtractor.toAttachmentBuffer(12345)).toBeNull();

      expect(quoteDocumentExtractor.classifyQuoteAttachment(null).format).toBe('unsupported');
      expect(quoteDocumentExtractor.classifyQuoteAttachment({ filename: 'quote.docm' }).format).toBe('docx');
      expect(quoteDocumentExtractor.classifyQuoteAttachment({ filename: 'quote.xlsm' }).format).toBe('xlsx');
      expect(quoteDocumentExtractor.classifyQuoteAttachment({ fileName: 'spec.md' }).format).toBe('text');
      expect(quoteDocumentExtractor.classifyQuoteAttachment({ fileName: 'pic.webp', contentType: 'image/webp' }).format).toBe('image');

      // ZIP stored entry (method=0), unsupported method=9, and bad compressed deflate skipped cleanly
      const storedAndBadZip = buildTestZip([
        { name: 'word/document.xml', data: '<w:document><w:p><w:t>&#x20B9;990</w:t></w:p></w:document>', method: 0 },
        { name: 'word/bad-method.xml', data: 'ignored', method: 9 },
        { name: 'word/corrupt.xml', data: 'not-deflated', method: 0 },
      ]);
      expect(quoteDocumentExtractor.extractDocxText(storedAndBadZip)).toContain('₹990');
      expect(quoteDocumentExtractor.parseZipEntries(Buffer.from('not-a-zip')).size).toBe(0);
      expect(quoteDocumentExtractor.extractDocxText(Buffer.from('not-a-zip'))).toBe('');

      // XLSX with AA column index, inlineStr, str formula, boolean 0/1, missing workbook.xml fallback
      const xlsxEdge = buildTestZip([
        {
          name: 'xl/worksheets/sheet1.xml',
          data: '<worksheet><sheetData><row r="1"><c r="AA1" t="str"><v>FormulaText</v></c><c r="AB1" t="b"><v>0</v></c><c r="AC1" t="inlineStr"><is><t>InlineTxt</t></is></c></row></sheetData></worksheet>',
        },
      ]);
      const xlsxText = quoteDocumentExtractor.extractXlsxText(xlsxEdge);
      expect(xlsxText).toContain('SHEET: Sheet1');
      expect(xlsxText).toContain('FormulaText | FALSE | InlineTxt');
    });

    test('handles OLE2 MiniFAT/DIFAT/corrupt headers, BIFF8 CONTINUE/MULRK/RK float/0x00D6, RTF escapes, Word XML/HTML/wide runs, PDF escapes, and CSV quotes', () => {
      // Corrupt OLE2 header (invalid sectorShift) and short buffer
      const badOle2 = Buffer.alloc(512, 0);
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(badOle2, 0);
      badOle2.writeUInt16LE(2, 30);
      expect(quoteDocumentExtractor.extractOle2Streams(badOle2).size).toBe(0);
      expect(quoteDocumentExtractor.extractOle2Streams(Buffer.from('short')).size).toBe(0);

      // BIFF8 with UTF-16LE BOUNDSHEET, SST + CONTINUE, rich+ext SST string, RK float + /100, MULRK, FORMULA float, RSTRING
      const bof = makeBiffRecord(0x0809, Buffer.from([0x00, 0x06, 0x05, 0x00, 0x00, 0x00]));
      // Rich + ext SST string: cch=4, flags=0x0C (hasRich=8, hasExt=4), rtCount=1 (4 bytes), extSize=2 (2 bytes), text='Rate'
      const richHdr = Buffer.alloc(9);
      richHdr.writeUInt16LE(4, 0);
      richHdr[2] = 0x0c;
      richHdr.writeUInt16LE(1, 3);
      richHdr.writeUInt32LE(2, 5);
      const sstRich = Buffer.concat([richHdr, Buffer.from('Rate', 'latin1'), Buffer.alloc(4), Buffer.alloc(2)]);
      // Second SST entry split across CONTINUE record (flags=0 compressed in SST, then text continued in CONTINUE with leading option byte 0)
      const contStrHdr = Buffer.alloc(3);
      contStrHdr.writeUInt16LE(8, 0);
      contStrHdr[2] = 0; // compressed
      const sstPart1 = Buffer.concat([
        (() => { const h = Buffer.alloc(8); h.writeUInt32LE(2, 0); h.writeUInt32LE(2, 4); return h; })(),
        sstRich,
        contStrHdr,
        Buffer.from('Cont', 'latin1'),
      ]);
      const sstRec = makeBiffRecord(0x00fc, sstPart1);
      const contRec = makeBiffRecord(0x003c, Buffer.from('\x00inue', 'latin1'));

      const bsPayload = Buffer.concat([Buffer.alloc(6, 0), makeBiff8String('WideTab', { oneByteLen: true, unicode: true })]);
      const eof = makeBiffRecord(0x000a, Buffer.alloc(0));
      const sheetOff = bof.length + makeBiffRecord(0x0085, bsPayload).length + sstRec.length + contRec.length + eof.length;
      bsPayload.writeUInt32LE(sheetOff, 0);
      const bsRec = makeBiffRecord(0x0085, bsPayload);

      // Sheet records: RSTRING (0x00D6), MULRK (0x00BD with /100 + IEEE float RK), FORMULA float (0x0006), LABELSST for SST[1]
      const rstringHdr = Buffer.alloc(6);
      rstringHdr.writeUInt16LE(0, 0);
      rstringHdr.writeUInt16LE(0, 2);
      const mulrkPayload = Buffer.alloc(18);
      mulrkPayload.writeUInt16LE(1, 0);
      mulrkPayload.writeUInt16LE(0, 2);
      mulrkPayload.writeUInt32LE((2500 << 2) | 0x03, 6); // 2500 / 100 = 25 (int + /100)
      const ieeeTmp = Buffer.alloc(8);
      ieeeTmp.writeDoubleLE(125.0, 0);
      mulrkPayload.writeUInt32LE(ieeeTmp.readUInt32LE(4) & 0xfffffffc, 12); // IEEE RK float
      mulrkPayload.writeUInt16LE(1, 16);

      const formulaFloat = Buffer.alloc(14);
      formulaFloat.writeUInt16LE(2, 0);
      formulaFloat.writeUInt16LE(0, 2);
      formulaFloat.writeDoubleLE(777.5, 6);

      const lblSst1 = Buffer.alloc(10);
      lblSst1.writeUInt16LE(3, 0);
      lblSst1.writeUInt32LE(1, 6);

      const biffStream = Buffer.concat([
        bof, bsRec, sstRec, contRec, eof,
        makeBiffRecord(0x0809, Buffer.from([0x00, 0x06, 0x10, 0x00, 0x00, 0x00])),
        makeBiffRecord(0x00d6, Buffer.concat([rstringHdr, makeBiff8String('Pump Item')])),
        makeBiffRecord(0x00bd, mulrkPayload),
        makeBiffRecord(0x0006, formulaFloat),
        makeBiffRecord(0x00fd, lblSst1),
        eof,
      ]);

      const xlsOle2 = buildTestOle2([{ name: 'Workbook', data: biffStream }]);
      const xlsParsed = quoteDocumentExtractor.extractXlsText(xlsOle2);
      expect(xlsParsed).toContain('SHEET: WideTab');
      expect(xlsParsed).toContain('Pump Item');
      expect(xlsParsed).toContain('25 | 125');
      expect(xlsParsed).toContain('777.5');
      expect(xlsParsed).toContain('Continue');

      // XLS fallback formats: ZIP .xls and unrecognized binary
      const zipXls = buildTestZip([{ name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row><c t="inlineStr"><is><t>ZipXls</t></is></c></row></sheetData></worksheet>' }]);
      expect(quoteDocumentExtractor.extractXlsText(zipXls)).toContain('ZipXls');
      expect(quoteDocumentExtractor.extractXlsText(Buffer.from('invalid'))).toBe('');
      expect(quoteDocumentExtractor.extractXlsText(null)).toBe('');

      // DOC fallback formats: ZIP .doc, HTML .doc, XML .doc, OLE2 UTF-16LE wide text without valid FIB, RTF special controls
      const htmlDoc = Buffer.from('<html><table><tr><td>Bolt</td><td>120</td></tr></table></html>', 'utf8');
      const xmlDoc = Buffer.from('<?xml version="1.0"?><w:wordDocument><w:p><w:t>XmlWordOffer</w:t></w:p></w:wordDocument>', 'utf8');
      const wideOnlyStream = Buffer.concat([Buffer.alloc(128, 0), Buffer.from('WideWordOffer99\x07', 'utf16le')]);
      const ole2WideDoc = buildTestOle2([{ name: 'WordDocument', data: wideOnlyStream }]);
      const rtfComplex = Buffer.from(
        '{\\rtf1{\\*\\ignored secret}\\b BoldQuote\\row Cell1\\cell Cell2\\~\\{\\}\\\\\n\\\'24}',
        'latin1'
      );

      expect(quoteDocumentExtractor.extractDocText(htmlDoc)).toContain('Bolt | 120');
      expect(quoteDocumentExtractor.extractDocText(xmlDoc)).toContain('XmlWordOffer');
      expect(quoteDocumentExtractor.extractDocText(ole2WideDoc)).toContain('WideWordOffer99');
      expect(quoteDocumentExtractor.extractDocText(zipXls)).toBe('');
      expect(quoteDocumentExtractor.extractDocText(Buffer.from('unknown'))).toBe('');
      const rtfText = quoteDocumentExtractor.extractDocText(rtfComplex);
      expect(rtfText).toContain('BoldQuote');
      expect(rtfText).toContain('Cell1 | Cell2');
      expect(rtfText).not.toContain('secret');

      // PDF octal escape + CSV double quotes + oversize inline limit + corrupt handler
      const pdfOctal = Buffer.from('%PDF-1.4\nstream\n(\\050Rate\\051: 500) Tj\nendstream\n', 'latin1');
      expect(quoteDocumentExtractor.extractPdfTextFromBuffer(pdfOctal)).toContain('(Rate): 500');
      expect(quoteDocumentExtractor.normalizeDelimitedText('"A""B",100\r\n\r\n', 'q.csv')).toContain('A"B | 100');

      // MAX_INLINE_PARTS cap (4 images -> only 3 sent inline)
      const imgList = [1, 2, 3, 4].map((i) => ({
        fileName: `page-${i}.png`,
        contentType: 'image/png',
        content: Buffer.from(`img-${i}`),
      }));
      const inlineCapRes = quoteDocumentExtractor.extractVendorQuoteAttachments(imgList);
      expect(inlineCapRes.inlineParts).toHaveLength(3);
      expect(quoteDocumentExtractor.extractVendorQuoteAttachments([])).toEqual({
        extractedText: '',
        inlineParts: [],
        processedAttachments: [],
        skippedAttachments: [],
      });
    });

    test('handles quoteAttachmentService write exception gracefully in processVendorQuoteMessage and non-throwing extractor error in geminiService', async () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Co', corporateEmail: 'b@co.test', sourcingMode: 'mode_1' });
      const vendor = storeService.addVendor({ id: 'v-err', name: 'Sup Co', email: 'sup@co.test', majorCategory: 'Mechanical', isBuyerUploaded: true });
      const rfq = storeService.createRFQ({
        rfqNumber: 'RFQ262611900002',
        title: 'Valves',
        category: 'Mechanical',
        sourcingMode: 'mode_1',
        buyerAccountId: buyer.id,
        buyerEmail: 'b@co.test',
        assignedVendors: [{ id: vendor.id, name: vendor.name, email: vendor.email }],
        extractedEntities: [{ itemName: 'Ball Valve', quantity: 2, unit: 'Nos' }],
      }, buyer);

      jest.spyOn(quoteAttachmentService, 'saveQuoteAttachment').mockRejectedValue(new Error('R2 temporarily offline'));
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ unitPrice: 3100, totalPrice: 6200 }) }] }, finishReason: 'STOP' }],
        }),
      }));

      // Even if attachment parser fails or R2 fails, valid cover note + non-fatal persistence still creates quotation
      jest.spyOn(quoteDocumentExtractor, 'extractVendorQuoteAttachments').mockImplementationOnce(() => {
        throw new Error('corrupt stream');
      });
      const raw = buildMimeWithAttachment({
        from: 'sup@co.test',
        to: DIRECT_MAILBOX,
        subject: 'Re: RFQ262611900002',
        body: 'Unit Price INR 3100, Total 6200.',
        attachmentName: 'broken.pdf',
        attachmentMime: 'application/pdf',
        attachmentContent: Buffer.from('%PDF-broken'),
      });
      const res = await emailGatewayService.processMessage(raw, emailGatewayService.resolveVendorConfig());
      expect(res.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(storeService.getRFQById(rfq.id).quotes).toHaveLength(1);
      expect(storeService.getRFQById(rfq.id).quotes[0].attachments).toBeUndefined();
    });

    test('covers MiniFAT, DIFAT, multi-sheet DOCX/XLSX order, RTF header skip groups, HTML table edge cases, and oversize stream guards', () => {
      // Build an OLE2 container using MiniFAT (<4096 bytes stream) AND 1 DIFAT sector
      const secSize = 512;
      const hdr = Buffer.alloc(secSize, 0xff);
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hdr, 0);
      hdr.writeUInt16LE(9, 30);
      hdr.writeUInt16LE(6, 32);
      hdr.writeUInt32LE(1, 48); // dir = sec 1
      hdr.writeUInt32LE(4096, 56);
      hdr.writeInt32LE(2, 60); // miniFat = sec 2
      hdr.writeInt32LE(1, 64);
      hdr.writeInt32LE(4, 68); // difat = sec 4
      hdr.writeInt32LE(1, 72);

      // sec 0 = FAT, sec 1 = Dir, sec 2 = MiniFAT, sec 3 = RootMiniStream (WordDocument bytes), sec 4 = DIFAT (empty list + ENDOFCHAIN), sec 5 = second FAT
      const fat0 = Buffer.alloc(secSize, 0xff);
      fat0.writeInt32LE(-3, 0); // sec 0 FAT
      fat0.writeInt32LE(-2, 4); // sec 1 Dir
      fat0.writeInt32LE(-2, 8); // sec 2 MiniFAT
      fat0.writeInt32LE(-2, 12); // sec 3 RootMiniStream
      fat0.writeInt32LE(-4, 16); // sec 4 DIFAT
      fat0.writeInt32LE(-3, 20); // sec 5 extra FAT
      hdr.writeInt32LE(0, 76);

      const dir = Buffer.alloc(secSize, 0);
      const writeDir = (idx, nm, tp, st, sz) => {
        const off = idx * 128;
        const nb = Buffer.from(`${nm}\0`, 'utf16le');
        nb.copy(dir, off);
        dir.writeUInt16LE(nb.length, off + 64);
        dir[off + 66] = tp;
        dir.writeInt32LE(st, off + 116);
        dir.writeUInt32LE(sz, off + 120);
      };
      const miniWord = Buffer.from('MiniFatWordOffer Quote 4900\x07\r', 'latin1');
      writeDir(0, 'Root Entry', 5, 3, miniWord.length);
      writeDir(1, 'WordDocument', 2, 0, miniWord.length);

      const miniFat = Buffer.alloc(secSize, 0xff);
      miniFat.writeInt32LE(-2, 0);

      const rootMini = Buffer.alloc(secSize, 0);
      miniWord.copy(rootMini, 0);

      const difatSec = Buffer.alloc(secSize, 0xff);
      difatSec.writeInt32LE(5, 0);
      difatSec.writeInt32LE(-2, secSize - 4);

      const fat1 = Buffer.alloc(secSize, 0xff);
      const miniOle2 = Buffer.concat([hdr, fat0, dir, miniFat, rootMini, difatSec, fat1]);
      expect(quoteDocumentExtractor.extractDocText(miniOle2)).toContain('MiniFatWordOffer Quote 4900');

      // DOCX multi-sheet + header/footer ordering + oversize stored entry guard + empty folder entries
      const multiDocx = buildTestZip([
        { name: 'word/', data: Buffer.alloc(0), method: 0 },
        { name: 'word/footer1.xml', data: '<w:ftr><w:p><w:t>FooterNote</w:t></w:p></w:ftr>' },
        { name: 'word/document.xml', data: '<w:document><w:p><w:t>MainBodyText</w:t></w:p></w:document>' },
        { name: 'word/header1.xml', data: '<w:hdr><w:p><w:t>HeaderTitle</w:t></w:p></w:hdr>' },
      ]);
      const docxMultiText = quoteDocumentExtractor.extractDocxText(multiDocx);
      expect(docxMultiText.indexOf('MainBodyText')).toBeLessThan(docxMultiText.indexOf('FooterNote'));

      // XLSX multiple worksheets without workbook.xml (natural numeric sort) + empty workbook + bad zip method
      const multiXlsx = buildTestZip([
        { name: 'xl/worksheets/sheet2.xml', data: '<worksheet><sheetData><row><c t="inlineStr"><is><t>SecondSheet</t></is></c></row></sheetData></worksheet>' },
        { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row><c t="inlineStr"><is><t>FirstSheet</t></is></c></row></sheetData></worksheet>' },
      ]);
      const multiXlsxOut = quoteDocumentExtractor.extractXlsxText(multiXlsx);
      expect(multiXlsxOut.indexOf('FirstSheet')).toBeLessThan(multiXlsxOut.indexOf('SecondSheet'));
      expect(quoteDocumentExtractor.extractXlsxText(Buffer.from('bad'))).toBe('');

      // BIFF8 edge records: empty string cch=0 + unnamed BOUNDSHEET + invalid formula/BOF + SpreadsheetML default name
      const xmlDefaultSheet = Buffer.from(
        '<Workbook><Worksheet><Table><Row><Cell><Data>BoltQty</Data></Cell><Cell><Data>50</Data></Cell></Row><Row></Row></Table></Worksheet><Worksheet ss:Name="Empty"></Worksheet></Workbook>',
        'utf8'
      );
      expect(quoteDocumentExtractor.extractXlsText(xmlDefaultSheet)).toContain('SHEET: Sheet1\nBoltQty | 50');

      // HTML table with script + br + empty row
      const htmlEdge = Buffer.from('<html><script>bad()</script><table><tr><td></td></tr><tr><td>ItemX</td><td>550</td></tr></table><br/><p>Tail</p></html>', 'utf8');
      expect(quoteDocumentExtractor.extractXlsText(htmlEdge)).toContain('ItemX | 550');

      // RTF unknown destination + negative unicode \u-40? + unknown control
      const rtfEdge = Buffer.from('{\\rtf1{\\fonttbl Arial;}\\u8377?1200\\unknownword\\xyz}', 'latin1');
      expect(quoteDocumentExtractor.extractDocText(rtfEdge)).toContain('₹1200');
      expect(quoteDocumentExtractor.extractPdfTextFromBuffer(null)).toBe('');
      expect(quoteDocumentExtractor.classifyQuoteAttachment({ contentType: 'text/html', fileName: 'offer.htm' }).format).toBe('text');
    });

    test('covers remaining branch guards across XML entities, Local-Header ZIP limits, XLSX cells, BIFF8 chunks, RTF symbols, DOC, PDF, CSV, and error catch', () => {
      // Entities (&lt; &gt; &quot; &apos; &nbsp; &#0; &#x0; &#65;), oversize stored ZIP entry via Local Header fallback
      const xmlEntitiesDocx = buildTestZip([
        {
          name: 'word/document.xml',
          data: '<w:document><w:p><w:t>&#x0;&#0;&#65;&lt;Spec&gt;&quot;Q&apos;&nbsp;</w:t></w:p></w:document>',
        },
      ]);
      expect(quoteDocumentExtractor.extractDocxText(xmlEntitiesDocx)).toContain('A<Spec>"Q\'');

      // Local-Header fallback (no EOCD) containing empty folder, oversize stored entry (>8MB), and valid file
      const hugeLen = 8 * 1024 * 1024 + 16;
      const makeLocalEntry = (name, dataBuf, method = 0) => {
        const nb = Buffer.from(name, 'utf8');
        const h = Buffer.alloc(30 + nb.length);
        h.writeUInt32LE(0x04034b50, 0);
        h.writeUInt16LE(method, 8);
        h.writeUInt32LE(dataBuf.length, 18);
        h.writeUInt32LE(dataBuf.length, 22);
        h.writeUInt16LE(nb.length, 26);
        nb.copy(h, 30);
        return Buffer.concat([h, dataBuf]);
      };
      const localZip = Buffer.concat([
        makeLocalEntry('word/', Buffer.from('x')),
        makeLocalEntry('word/huge.xml', Buffer.alloc(hugeLen, 65), 0),
        makeLocalEntry('word/document.xml', Buffer.from('<w:document><w:p><w:t>LocalFallbackDoc</w:t></w:p></w:document>'), 0),
      ]);
      expect(quoteDocumentExtractor.extractDocxText(localZip)).toContain('LocalFallbackDoc');

      // XLSX edge branches: /xl/ Target prefix, sheet missing r:id & missing name, sequential col without r=, out-of-range SST, non-0/1 boolean, self-closing cell
      const xlsxRelEdge = buildTestZip([
        {
          name: 'xl/_rels/workbook.xml.rels',
          data: '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
        },
        {
          name: 'xl/workbook.xml',
          data: '<workbook><sheets><sheet name="NoRid"/><sheet r:id="rId1"/></sheets></workbook>',
        },
        {
          name: 'xl/worksheets/sheet1.xml',
          data: '<worksheet><sheetData><row><c r="A1"/><c><v>10</v></c><c t="s"><v>99</v></c><c t="b"><v>2</v></c><c r="E1" t="n"/></row></sheetData></worksheet>',
        },
      ]);
      const xlsxRelText = quoteDocumentExtractor.extractXlsxText(xlsxRelEdge);
      expect(xlsxRelText).toContain('SHEET: xl/worksheets/sheet1.xml');
      expect(xlsxRelText).toContain(' | 10 | 99 | 2');

      // BIFF8 boundary CONTINUE string (offset === chunk[0].length), cch=0 empty string, out-of-range BOUNDSHEET offset, out-of-range SST ref
      const bof = makeBiffRecord(0x0809, Buffer.from([0x00, 0x06, 0x05, 0x00, 0x00, 0x00]));
      const emptyBiffStr = Buffer.from([0x00, 0x00, 0x00]); // cch=0
      const sstHdr = Buffer.alloc(8);
      sstHdr.writeUInt32LE(2, 0);
      sstHdr.writeUInt32LE(2, 4);
      const sstRec = makeBiffRecord(0x00fc, Buffer.concat([sstHdr, emptyBiffStr])); // chunk 0 ends right after empty string
      const contRec = makeBiffRecord(0x003c, makeBiff8String('AcrossChunk')); // starts at chunk 1 offset 0!
      const badBs = makeBiffRecord(0x0085, Buffer.concat([(() => { const b = Buffer.alloc(6); b.writeUInt32LE(999999, 0); return b; })(), Buffer.from([0, 0])]));
      const bsPayload = Buffer.concat([Buffer.alloc(6, 0), Buffer.from([0, 0])]); // unnamed BOUNDSHEET -> Sheet2
      const eof = makeBiffRecord(0x000a, Buffer.alloc(0));
      const sheetStart = bof.length + badBs.length + makeBiffRecord(0x0085, bsPayload).length + sstRec.length + contRec.length + eof.length;
      bsPayload.writeUInt32LE(sheetStart, 0);
      const bsRec = makeBiffRecord(0x0085, bsPayload);
      const lblOutOfRange = Buffer.alloc(10);
      lblOutOfRange.writeUInt16LE(0, 0);
      lblOutOfRange.writeUInt32LE(50, 6);
      const lblCross = Buffer.alloc(10);
      lblCross.writeUInt16LE(1, 0);
      lblCross.writeUInt32LE(1, 6);
      const biffBoundary = Buffer.concat([
        bof, badBs, bsRec, sstRec, contRec, eof,
        makeBiffRecord(0x0809, Buffer.from([0x00, 0x06, 0x10, 0x00, 0x00, 0x00])),
        makeBiffRecord(0x00fd, lblOutOfRange),
        makeBiffRecord(0x00fd, lblCross),
        eof,
      ]);
      const boundaryXls = quoteDocumentExtractor.extractXlsText(buildTestOle2([{ name: 'Workbook', data: biffBoundary }]));
      expect(boundaryXls).toContain('SHEET: Sheet2');
      expect(boundaryXls).toContain('AcrossChunk');

      // RTF unknown non-alpha symbol \_, negative unicode \u-40?, unmatched closing brace }, trailing backslash \
      const rtfSymbols = Buffer.from('{\\rtf1}\\u-40?Item\\_\t\n\\', 'latin1');
      expect(quoteDocumentExtractor.extractDocText(rtfSymbols)).toContain('Item');
      expect(quoteDocumentExtractor.extractDocText(null)).toBe('');

      // OLE2 WordDocument falling back to scanOle2TextRuns with mid-stream non-printable delimiter (\x01)
      const asciiRunOle2 = buildTestOle2([
        { name: 'WordDocument', data: Buffer.concat([Buffer.alloc(100, 1), Buffer.from('ValveOffer990\x01\x02\x03End', 'latin1')]) },
      ]);
      expect(quoteDocumentExtractor.extractDocText(asciiRunOle2)).toContain('ValveOffer990');

      // PDF with array TJ octal + oversized stream skipped + TSV tab normalization
      const hugePdfStream = Buffer.alloc(QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_PDF_STREAM_BYTES + 10, 65).toString('latin1');
      const pdfMulti = Buffer.from(`%PDF-1.4\nstream\n${hugePdfStream}\nendstream\nstream\n[(\\050TJ\\051)] TJ\nendstream\n`, 'latin1');
      expect(quoteDocumentExtractor.extractPdfTextFromBuffer(pdfMulti)).toContain('(TJ)');
      expect(quoteDocumentExtractor.normalizeDelimitedText('A\tB\n', 'quote.tsv')).toBe('SHEET: quote.tsv\nA | B');
      expect(quoteDocumentExtractor.normalizeDelimitedText('', 'empty.csv')).toBe('');

      // extractVendorQuoteAttachments: throwing buffer.toString, null content, unsupported ext, empty image over cap -> skipped cleanly
      const throwingBuf = Buffer.from('boom');
      throwingBuf.toString = () => {
        throw new Error('decode failed');
      };
      const edgeBatch = quoteDocumentExtractor.extractVendorQuoteAttachments([
        null,
        { role: 'signature', fileName: 'sig.png', content: Buffer.from('sig') },
        { fileName: 'empty.txt', content: null },
        { fileName: 'archive.bin', contentType: 'application/octet-stream', content: Buffer.from('raw') },
        { fileName: 'corrupt.txt', contentType: 'text/plain', content: throwingBuf },
        { fileName: 'blank.pdf', contentType: 'application/pdf', content: Buffer.alloc(GEMINI_CONFIG.MAX_DOCUMENT_BYTES + 64, 0) }, // > MAX_DOCUMENT_BYTES & empty text
      ]);
      expect(edgeBatch.skippedAttachments).toEqual(['empty.txt', 'archive.bin', 'corrupt.txt', 'blank.pdf']);
    });

    test('covers emailGatewayService attachment RFQ lookup fallbacks, bodyText document fallback, and storeEmailAttachments variants', async () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Edge Buyer', corporateEmail: 'edge@co.test', sourcingMode: 'mode_1' });
      const vendor = storeService.addVendor({ id: 'v-gw-edge', name: 'Edge Supply', email: 'vendor-edge@co.test', majorCategory: 'Mechanical', isBuyerUploaded: true });
      const rfq = storeService.createRFQ({
        rfqNumber: 'RFQ262611900010',
        title: 'Valves Edge',
        category: 'Mechanical',
        sourcingMode: 'mode_1',
        buyerAccountId: buyer.id,
        buyerEmail: 'edge@co.test',
        assignedVendors: [{ id: vendor.id, name: vendor.name, email: vendor.email }],
        extractedEntities: [{ itemName: 'Check Valve', quantity: 2, unit: 'Nos' }],
      }, buyer);

      // 1. extractRfqReferenceFromEmail: null message, lowercase .filename match, throwing extractor in Priority 2b, and unresolved Priority 2b ref
      expect(await emailGatewayService.extractRfqReferenceFromEmail(null)).toEqual({ targetRfq: null, referencedNumber: null });
      const byFilename = await emailGatewayService.extractRfqReferenceFromEmail({
        subject: 'Quotation attached',
        attachments: [{ filename: 'RFQ262611900010-offer.pdf', content: Buffer.from('%PDF') }],
      });
      expect(byFilename.targetRfq && byFilename.targetRfq.rfqNumber).toBe(rfq.rfqNumber);

      jest.spyOn(quoteDocumentExtractor, 'extractVendorQuoteAttachments').mockImplementationOnce(() => {
        throw new Error('extractor boom');
      });
      const throwFallback = await emailGatewayService.extractRfqReferenceFromEmail({
        subject: 'Offer',
        bodyHtml: '<p>See offer for RFQ262699999999</p>',
        attachments: [{ fileName: 'bad.pdf', content: Buffer.from('%PDF') }],
      });
      expect(throwFallback).toEqual({ targetRfq: null, referencedNumber: 'RFQ262699999999' });

      // 2. processMessage with empty bodyText + .txt attachment (populates message.bodyText from documentText)
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ unitPrice: 1200, totalPrice: 2400 }) }] }, finishReason: 'STOP' }],
        }),
      }));
      const txtQuoteEml = buildMimeWithAttachment({
        from: 'vendor-edge@co.test',
        to: DIRECT_MAILBOX,
        subject: `Re: ${rfq.rfqNumber}`,
        body: '',
        attachmentName: 'offer.txt',
        attachmentMime: 'text/plain',
        attachmentContent: Buffer.from('Check Valve Unit Price 1200 Total 2400', 'utf8'),
      });
      const txtOutcome = await emailGatewayService.processMessage(txtQuoteEml, emailGatewayService.resolveVendorConfig());
      expect(txtOutcome.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);

      // 3. processVendorQuoteMessage exercising storeEmailAttachments non-Buffer content, missing content, unnamed signature, TOO_LARGE & null save outcomes
      const saveSpy = jest.spyOn(quoteAttachmentService, 'saveQuoteAttachment')
        .mockResolvedValueOnce({ status: 'TOO_LARGE' })
        .mockResolvedValueOnce(null);
      const quoteOutcome = await emailGatewayService.processVendorQuoteMessage(
        {
          fromAddress: 'vendor-edge@co.test',
          subject: `Quote ${rfq.rfqNumber}`,
          bodyText: 'Unit Price 1200, Total 2400',
          attachments: [
            null,
            { fileName: 'empty.pdf', content: null },
            { isSignature: true, content: Buffer.from('sig'), contentType: 'image/png' },
            { filename: 'str-one.txt', mimeType: 'text/plain', content: Buffer.from('a').toString('base64') },
            { filename: 'str-two.txt', mimeType: 'text/plain', content: Buffer.from('b').toString('base64') },
          ],
        },
        rfq,
        vendor
      );
      expect(quoteOutcome.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(saveSpy).toHaveBeenCalledTimes(2);
    });
  });
});
