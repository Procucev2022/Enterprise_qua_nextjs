// ==============================================================================
// EMAIL FIXTURES
// ==============================================================================
// Real RFC822 messages, built as raw text rather than by a library, so the parser
// is exercised against the wire format an exported `.eml` actually contains:
// folded headers, encoded-words in the display name, quoted-printable bodies,
// multipart boundaries and base64 attachment parts.
// ==============================================================================

/** A plain-text requisition with a quoted reply chain beneath it. */
const PLAIN_REQUISITION_EML = [
  'Return-Path: <project.procurement@lt-heavy.com>',
  'Message-ID: <REQ-2026-0914.project.procurement@lt-heavy.com>',
  'Date: Mon, 07 Sep 2026 09:14:22 +0530',
  'From: =?utf-8?Q?Rajesh_Iyer?= <project.procurement@lt-heavy.com>',
  'To: Procucev Intake <client@procucev.com>',
  'Subject: Urgent Requisition - Centrifugal Pumps for Hazira Expansion',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Dear Procucev team,',
  '',
  'Please float an enquiry for the following against project HZ-EXP-04.',
  '',
  '1. Centrifugal Pump, 150 m3/hr, 40m head, CI casing - 4 Nos',
  '2. Gate Valve, 200mm, CI body, flanged - 12 Nos',
  '3. Pressure Gauge, 0-16 bar, 100mm dial - 8 Nos',
  '',
  'Delivery required at Hazira Works, Surat 394270 by 30 October 2026.',
  'Indicative budget is INR 18,50,000.',
  '',
  'Regards,',
  'Rajesh Iyer',
  '',
  '-----Original Message-----',
  'From: Site Engineering',
  'Subject: RE: earlier revision - DO NOT QUOTE',
  '',
  '1. Centrifugal Pump, 90 m3/hr - 2 Nos',
  '2. Butterfly Valve, 100mm - 30 Nos',
].join('\r\n');

/** An HTML-only body holding the line items in a table. */
const HTML_TABLE_EML = [
  'Message-ID: <html-boq@buyer.example.com>',
  'Date: Mon, 07 Sep 2026 11:02:00 +0530',
  'From: "Procurement Desk" <procurement@buyer.example.com>',
  'To: client@procucev.com',
  'Subject: BOQ - Switchgear Package',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><p>Please quote:</p><table>',
  '<tr><td>ACB 630A 4 Pole</td><td>3 Nos</td></tr>',
  '<tr><td>MCCB 250A 3 Pole</td><td>10 Nos</td></tr>',
  '</table><p>Deliver to Pune 411018 &amp; confirm lead time.</p></body></html>',
].join('\r\n');

/**
 * A covering note with a PDF attachment, which is the shape that exercises the
 * inline-data passthrough, plus a workbook the pipeline deliberately will not read.
 */
function multipartWithAttachments({ includePdf = true, includeWorkbook = true, includeCsv = false } = {}) {
  const boundary = '----=_Part_Procucev_001';
  const parts = [
    'Message-ID: <covering-note@buyer.example.com>',
    'Date: Mon, 07 Sep 2026 12:30:00 +0530',
    'From: Site Procurement <site.procurement@buyer.example.com>',
    'To: client@procucev.com',
    'Subject: Requisition attached - Structural Steel',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please find the requisition attached.',
    '',
  ];

  if (includePdf) {
    parts.push(
      `--${boundary}`,
      'Content-Type: application/pdf; name="requisition.pdf"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="requisition.pdf"',
      '',
      Buffer.from('%PDF-1.4 minimal requisition body').toString('base64'),
      ''
    );
  }

  if (includeCsv) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/csv; name="items.csv"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="items.csv"',
      '',
      Buffer.from('Item,Qty,Unit\nTMT Bar 12mm,25,MT\nAngle 50x50,10,MT\n').toString('base64'),
      ''
    );
  }

  if (includeWorkbook) {
    parts.push(
      `--${boundary}`,
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="boq.xlsx"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="boq.xlsx"',
      '',
      Buffer.from('PK\u0003\u0004 fake workbook bytes').toString('base64'),
      ''
    );
  }

  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

/** A structurally valid message carrying no body and no usable attachment. */
const EMPTY_BODY_EML = [
  'Message-ID: <empty@buyer.example.com>',
  'From: someone@buyer.example.com',
  'To: client@procucev.com',
  'Subject: ',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '',
].join('\r\n');

/** Base64 the way the browser sends it up. */
function toBase64(raw) {
  return Buffer.from(raw, 'utf8').toString('base64');
}

module.exports = {
  PLAIN_REQUISITION_EML,
  HTML_TABLE_EML,
  EMPTY_BODY_EML,
  multipartWithAttachments,
  toBase64,
};
