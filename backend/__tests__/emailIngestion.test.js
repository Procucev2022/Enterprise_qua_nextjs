const request = require('supertest');
const app = require('../src/app');
const emailIngestionService = require('../src/services/emailIngestionService');
const geminiService = require('../src/services/geminiService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const {
  EMAIL_INGESTION_STATUS,
  EMAIL_INGESTION_MESSAGES,
  EXTRACTION_REASON_MESSAGES,
} = require('../src/config/constants');
const { authHeader } = require('./testHelpers');
const fixtures = require('./fixtures/sampleRequisitionEmail');
const taxonomyFixture = require('./fixtures/categoryTaxonomy');

// ==============================================================================
// EMAIL-TO-RFQ INGESTION
// ==============================================================================
// Exercised against real RFC822 text rather than a hand-built object graph, so the
// wire format an exported `.eml` actually contains is what gets parsed: folded
// headers, encoded-words, quoted-printable bodies, multipart boundaries and base64
// attachment parts.
//
// The pipeline's job is to produce the same extractor input a web-portal upload
// would, and to record provenance read from the message rather than from the
// request body.
// ==============================================================================

const b64 = fixtures.toBase64;

describe('emailIngestionService file recognition', () => {
  test.each([
    ['requisition.eml', true],
    ['REQUISITION.EML', true],
    ['  spaced.eml  ', true],
    ['requisition.msg', false],
    ['boq.xlsx', false],
    ['drawing.pdf', false],
    ['', false],
    [undefined, false],
  ])('isEmailFileName(%p) is %p', (name, expected) => {
    expect(emailIngestionService.isEmailFileName(name)).toBe(expected);
  });

  test.each([
    ['message.msg', true],
    ['MESSAGE.MSG', true],
    ['message.eml', false],
    [undefined, false],
  ])('isOutlookMsgFileName(%p) is %p', (name, expected) => {
    expect(emailIngestionService.isOutlookMsgFileName(name)).toBe(expected);
  });
});

describe('emailIngestionService.stripQuotedReplies', () => {
  // A forwarded requisition carries the whole thread beneath it. Extracting from
  // that pulls items out of superseded revisions of the same enquiry.
  test.each([
    ['-----Original Message-----', 'Original Message separator'],
    ['-----Forwarded message-----', 'Forwarded message separator'],
    ['______________', 'Outlook horizontal rule'],
    ['On Tue, 2 Sep 2026 at 10:04, Site Eng wrote:', 'inline attribution line'],
    ['> quoted line', 'angle-bracket quoting'],
  ])('cuts the body at a %s', (marker) => {
    const body = ['Please quote item A - 4 Nos', marker, 'Superseded item B - 99 Nos'].join('\n');
    const result = emailIngestionService.stripQuotedReplies(body);
    expect(result).toContain('item A');
    expect(result).not.toContain('Superseded');
  });

  test('leaves a body with no quoted chain intact', () => {
    expect(emailIngestionService.stripQuotedReplies('Item A - 1 No')).toBe('Item A - 1 No');
  });

  test('tolerates an absent body', () => {
    expect(emailIngestionService.stripQuotedReplies(undefined)).toBe('');
  });
});

describe('emailIngestionService.flattenHtmlBody', () => {
  // Cell boundaries are the point: a BOQ arrives as a table and the quantity is
  // what gets lost when the cells run together.
  test('keeps table cells separated and rows on their own lines', () => {
    const flattened = emailIngestionService.flattenHtmlBody(
      '<table><tr><td>ACB 630A</td><td>3 Nos</td></tr><tr><td>MCCB 250A</td><td>10 Nos</td></tr></table>'
    );
    expect(flattened).toContain('ACB 630A | 3 Nos');
    expect(flattened).toContain('MCCB 250A | 10 Nos');
  });

  test('decodes entities and drops script and style blocks', () => {
    const flattened = emailIngestionService.flattenHtmlBody(
      '<style>td{color:red}</style><script>alert(1)</script><p>Steel &amp; Pipes &lt;spec&gt; &quot;A&quot; &#39;B&#39;&nbsp;end</p>'
    );
    expect(flattened).toBe('Steel & Pipes <spec> "A" \'B\' end');
    expect(flattened).not.toContain('alert');
    expect(flattened).not.toContain('color:red');
  });

  test('tolerates an absent body', () => {
    expect(emailIngestionService.flattenHtmlBody(undefined)).toBe('');
  });
});

describe('emailIngestionService.resolveBodyText', () => {
  test('prefers the authored text part when the HTML holds no table', () => {
    expect(
      emailIngestionService.resolveBodyText({ text: 'authored text', html: '<p>markup</p>' })
    ).toBe('authored text');
  });

  // mailparser synthesises `text` from HTML when there is no text part, but its
  // conversion collapses table cells — so a table in the HTML has to win.
  test('prefers the HTML when it contains a table', () => {
    const resolved = emailIngestionService.resolveBodyText({
      text: 'ACB 630A3 Nos',
      html: '<table><tr><td>ACB 630A</td><td>3 Nos</td></tr></table>',
    });
    expect(resolved).toContain('ACB 630A | 3 Nos');
  });

  test('falls back to the HTML when there is no text part', () => {
    expect(emailIngestionService.resolveBodyText({ html: '<p>only markup</p>' })).toBe('only markup');
  });

  test('returns an empty string when the message has neither part', () => {
    expect(emailIngestionService.resolveBodyText({})).toBe('');
  });
});

describe('emailIngestionService.classifyAttachment', () => {
  test.each([
    ['text/csv', 'text'],
    ['text/plain', 'text'],
    ['TEXT/CSV', 'text'],
    ['application/pdf', 'inline'],
    ['image/png', 'inline'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'manual'],
    ['application/zip', 'manual'],
    [undefined, 'manual'],
  ])('classifies %p as %p', (contentType, expected) => {
    expect(emailIngestionService.classifyAttachment({ contentType })).toBe(expected);
  });
});

describe('emailIngestionService.parseEmailMessage', () => {
  test('reads headers, decodes the encoded-word display name and strips the thread', async () => {
    const message = await emailIngestionService.parseEmailMessage(
      Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8')
    );

    expect(message.messageId).toBe('<REQ-2026-0914.project.procurement@lt-heavy.com>');
    expect(message.fromAddress).toBe('project.procurement@lt-heavy.com');
    expect(message.fromName).toBe('Rajesh Iyer');
    expect(message.toAddress).toBe('client@procucev.com');
    expect(message.subject).toContain('Centrifugal Pumps');
    expect(message.sentAt).toBe('2026-09-07T03:44:22.000Z');
    expect(message.bodyText).toContain('Centrifugal Pump, 150 m3/hr');
    expect(message.bodyText).not.toContain('DO NOT QUOTE');
  });

  test('describes each attachment with the role it can play in extraction', async () => {
    const message = await emailIngestionService.parseEmailMessage(
      Buffer.from(fixtures.multipartWithAttachments({ includeCsv: true }), 'utf8')
    );

    expect(message.attachments.map((a) => [a.fileName, a.role])).toEqual([
      ['requisition.pdf', 'inline'],
      ['items.csv', 'text'],
      ['boq.xlsx', 'manual'],
    ]);
    expect(message.attachments[0].size).toBeGreaterThan(0);
  });

  test('falls back to the address local part when no display name is given', async () => {
    const message = await emailIngestionService.parseEmailMessage(
      Buffer.from(fixtures.HTML_TABLE_EML, 'utf8')
    );
    expect(message.fromName).toBe('Procurement Desk');

    const bare = await emailIngestionService.parseEmailMessage(
      Buffer.from(fixtures.EMPTY_BODY_EML, 'utf8')
    );
    expect(bare.fromName).toBe('someone');
    expect(bare.sentAt).toBeNull();
  });
});

describe('emailIngestionService.prepareEmailForExtraction', () => {
  test('produces document text carrying the subject, sender and body', async () => {
    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'requisition.eml',
      content: b64(fixtures.PLAIN_REQUISITION_EML),
    });

    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.READY);
    expect(prepared.extractionInput.fileName).toBe('requisition.eml');
    expect(prepared.extractionInput.documentText).toContain('SUBJECT: Urgent Requisition');
    expect(prepared.extractionInput.documentText).toContain('FROM: Rajesh Iyer');
    expect(prepared.extractionInput.documentText).toContain('Gate Valve, 200mm');
    expect(prepared.extractionInput.inlineData).toBeUndefined();
    expect(prepared.unreadableAttachments).toEqual([]);
  });

  test('passes the first natively readable attachment through as inline data', async () => {
    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'note.eml',
      content: b64(fixtures.multipartWithAttachments({ includeCsv: true })),
    });

    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.READY);
    expect(prepared.extractionInput.mimeType).toBe('application/pdf');
    expect(Buffer.from(prepared.extractionInput.inlineData, 'base64').toString('utf8')).toContain(
      '%PDF-1.4'
    );
    // A CSV is decoded and appended rather than sent as inline data.
    expect(prepared.extractionInput.documentText).toContain('TMT Bar 12mm');
  });

  // Reported rather than silently dropped, so the buyer is not left wondering why
  // the line-item list is short.
  test('names a workbook attachment it will not parse', async () => {
    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'note.eml',
      content: b64(fixtures.multipartWithAttachments({})),
    });
    expect(prepared.unreadableAttachments).toEqual(['boq.xlsx']);
  });

  test.each([
    ['an Outlook .msg', 'message.msg', 'AAAA', EMAIL_INGESTION_STATUS.OUTLOOK_MSG_UNSUPPORTED],
    ['a non-email file', 'boq.xlsx', 'AAAA', EMAIL_INGESTION_STATUS.NOT_AN_EMAIL],
    ['an empty upload', 'requisition.eml', '', EMAIL_INGESTION_STATUS.NO_CONTENT],
  ])('refuses %s', async (_label, fileName, content, expected) => {
    const prepared = await emailIngestionService.prepareEmailForExtraction({ fileName, content });
    expect(prepared.status).toBe(expected);
  });

  // Headers alone cannot yield line items, and documentText always carries the
  // subject and sender, so emptiness of that string is not the right test.
  test('refuses a message with no body and no usable attachment', async () => {
    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'requisition.eml',
      content: b64(fixtures.EMPTY_BODY_EML),
    });
    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.NO_CONTENT);
  });

  test('refuses a message beyond the size ceiling', async () => {
    const oversized = `${fixtures.PLAIN_REQUISITION_EML}\r\n${'x'.repeat(16 * 1024 * 1024)}`;
    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'requisition.eml',
      content: b64(oversized),
    });
    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.TOO_LARGE);
  });

  test('reports an unparseable message rather than throwing', async () => {
    jest
      .spyOn(emailIngestionService, 'parseEmailMessage')
      .mockRejectedValueOnce(new Error('boundary not closed'));

    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'requisition.eml',
      content: b64(fixtures.PLAIN_REQUISITION_EML),
    });

    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.UNREADABLE);
    jest.restoreAllMocks();
  });

  // Content can come from an attachment alone: a bare covering note with a CSV
  // still has line items to extract even though the body itself carries none.
  test('accepts a message whose only content is a text attachment', async () => {
    jest.spyOn(emailIngestionService, 'parseEmailMessage').mockResolvedValueOnce({
      messageId: '<csv-only@buyer.example.com>',
      subject: 'BOQ attached',
      fromAddress: 'buyer@example.com',
      fromName: 'Buyer',
      toAddress: 'client@procucev.com',
      sentAt: null,
      bodyText: '',
      attachments: [
        {
          fileName: 'items.csv',
          contentType: 'text/csv',
          size: 20,
          role: 'text',
          content: Buffer.from('Item,Qty\nAngle 50x50,10\n'),
        },
      ],
    });

    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'note.eml',
      content: b64(fixtures.PLAIN_REQUISITION_EML),
    });

    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.READY);
    expect(prepared.extractionInput.documentText).toContain('Angle 50x50');
    expect(prepared.extractionInput.inlineData).toBeUndefined();
    jest.restoreAllMocks();
  });

  // A malformed base64 body decodes to bytes that are not a message at all.
  test('refuses content that does not decode to a message', async () => {
    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'requisition.eml',
      content: '!!!!not base64 at all!!!!',
    });
    expect([EMAIL_INGESTION_STATUS.NO_CONTENT, EMAIL_INGESTION_STATUS.UNREADABLE]).toContain(
      prepared.status
    );
  });

  test('drops an empty text attachment rather than adding a blank section', async () => {
    jest.spyOn(emailIngestionService, 'parseEmailMessage').mockResolvedValueOnce({
      messageId: '',
      subject: 'Req',
      fromAddress: 'buyer@example.com',
      fromName: '',
      toAddress: '',
      sentAt: null,
      bodyText: 'Please quote the attached.',
      attachments: [
        { fileName: 'blank.csv', contentType: 'text/csv', size: 0, role: 'text', content: Buffer.from('   ') },
      ],
    });

    const prepared = await emailIngestionService.prepareEmailForExtraction({
      fileName: 'note.eml',
      content: b64(fixtures.PLAIN_REQUISITION_EML),
    });

    expect(prepared.status).toBe(EMAIL_INGESTION_STATUS.READY);
    expect(prepared.extractionInput.documentText).not.toContain('ATTACHMENT: blank.csv');
    jest.restoreAllMocks();
  });
});

describe('emailIngestionService.buildDocumentText', () => {
  // A message with no From header at all still has to produce usable text.
  test('omits header lines the message does not carry', () => {
    const text = emailIngestionService.buildDocumentText({
      subject: '',
      fromAddress: '',
      fromName: '',
      sentAt: null,
      bodyText: 'Pump - 4 Nos',
      attachments: [],
    });
    expect(text).toBe('BODY:\nPump - 4 Nos');
  });

  test('uses the bare address when no display name was parsed', () => {
    const text = emailIngestionService.buildDocumentText({
      subject: 'Req',
      fromAddress: 'buyer@example.com',
      fromName: '',
      sentAt: '2026-09-07T03:44:22.000Z',
      bodyText: 'Pump - 4 Nos',
      attachments: [],
    });
    expect(text).toContain('FROM: buyer@example.com');
    expect(text).not.toContain('<');
  });
});

describe('emailIngestionService.extractCcAddresses and resolveBodyText edge cases', () => {
  test('extractCcAddresses handles null, value array with edge cases, text fallback and empty objects', () => {
    expect(emailIngestionService.extractCcAddresses(null)).toEqual([]);
    expect(emailIngestionService.extractCcAddresses(undefined)).toEqual([]);
    expect(emailIngestionService.extractCcAddresses({})).toEqual([]);
    expect(
      emailIngestionService.extractCcAddresses({
        value: [
          { address: ' Buyer@example.com ' },
          { address: null },
          null,
          { address: '' },
          { address: 'cc2@example.com' },
        ],
      })
    ).toEqual(['buyer@example.com', 'cc2@example.com']);
    expect(
      emailIngestionService.extractCcAddresses({
        text: 'Buyer@Example.com, Manager@example.com, ,',
      })
    ).toEqual(['buyer@example.com', 'manager@example.com']);
  });

  test('resolveBodyText returns empty string when text is not a string and html is missing', () => {
    expect(emailIngestionService.resolveBodyText({})).toBe('');
    expect(emailIngestionService.resolveBodyText({ text: null })).toBe('');
  });
});


// Fallback copy for a status the message table does not name, so a new refusal
// reason can never surface as an empty error string.
