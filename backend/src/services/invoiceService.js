// ==============================================================================
// PAYMENT RECEIPT PDF
// ==============================================================================
// Generates a minimal, on-demand PDF receipt for a completed Zoho subscription
// payment — plan, amount paid, date, payment id, payer. Deliberately not a
// formal GST invoice (no invoice numbering sequence, no tax breakup) per
// explicit scope: a receipt confirming a real payment happened, not a
// compliance document.
// ==============================================================================

const PDFDocument = require('pdfkit');

/**
 * Render a payment-link record as a receipt PDF, returned as a Buffer.
 *
 * `link` is a storeService payment-link record (id, zohoPaymentLinkId,
 * planId, amount, status, createdAt, updatedAt). `payer` carries whatever
 * display name/email the caller already resolved (vendor or buyer account) —
 * this module has no opinion on which.
 */
function generateReceiptPdf({ link, payerName, payerEmail, planLabel }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text('Procucev', { continued: false });
    doc.fontSize(11).font('Helvetica').fillColor('#555555').text('Payment Receipt').moveDown(1.5);
    doc.fillColor('#000000');

    doc.fontSize(10).font('Helvetica-Bold').text('Receipt for');
    doc.font('Helvetica').text(payerName || '—');
    if (payerEmail) doc.text(payerEmail);
    doc.moveDown(1);

    const rows = [
      ['Payment ID', link.id],
      ['Zoho Payment Reference', link.zohoPaymentLinkId || '—'],
      ['Plan', planLabel || link.planId],
      ['Amount Paid', `Rs. ${Number(link.amount || 0).toFixed(2)}`],
      ['Status', link.status || '—'],
      ['Date', link.updatedAt ? new Date(link.updatedAt).toLocaleString('en-IN') : '—'],
    ];

    const labelX = 50;
    const valueX = 220;
    doc.font('Helvetica-Bold');
    rows.forEach(([label, value]) => {
      const y = doc.y;
      doc.font('Helvetica-Bold').text(label, labelX, y, { width: 160 });
      doc.font('Helvetica').text(String(value), valueX, y, { width: 300 });
      doc.moveDown(0.6);
    });

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor('#888888')
      .text(
        'This is a system-generated receipt confirming a payment recorded against the Procucev platform. It is not a formal tax invoice.',
        { width: 495 }
      );

    doc.end();
  });
}

module.exports = { generateReceiptPdf };
