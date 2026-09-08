const nodemailer = require('nodemailer');
const { logger } = require('./loggerService');

let transporter;
let transporterInitialized = false;

/**
 * Lazily builds a Gmail SMTP transporter from SMTP_USER/SMTP_PASSWORD.
 * Returns undefined if either is unset, so callers can no-op gracefully
 * instead of throwing when SMTP isn't configured.
 */
function getTransporter() {
  if (transporterInitialized) return transporter;
  transporterInitialized = true;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) return undefined;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return transporter;
}

// ── Autonomous email-gateway: buyer requisition inbound notification ─────────

function buildRequisitionEmail(to, rfq = {}, fromEmail = '') {
  const safeRfq = rfq || {};
  const lineItems = Array.isArray(safeRfq.extractedEntities)
    ? safeRfq.extractedEntities
    : Array.isArray(safeRfq.items)
      ? safeRfq.items
      : [];
  const lineItemsHtml = lineItems.length > 0
    ? lineItems.map((item, index) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold;">${index + 1}. ${item.itemName || item.name || 'Line Item'}</td>
          <td style="padding: 10px; text-align: center;">${item.quantity || 1} ${item.unit || item.uom || 'Units'}</td>
          <td style="padding: 10px; font-size: 12px; color: #475569;">${item.technicalSpecs || item.specs || item.description || '-'}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding: 10px; color: #64748b;">No specific line items itemized.</td></tr>`;

  return {
    from: process.env.SMTP_USER || 'no-reply@procucev.com',
    to: to || 'navinchaudhary.dev@gmail.com',
    replyTo: fromEmail || safeRfq.sourceEmail || undefined,
    subject: `[Procucev Requisition] ${safeRfq.title || 'New Inbound Requisition'} (${safeRfq.rfqNumber || 'Draft'})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; color: white;">
          <h2 style="margin: 0; font-size: 18px; letter-spacing: 0.5px;">PROCUCEV ENTERPRISE</h2>
          <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 13px;">Autonomous Requisition Ingestion Notification</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
          <div style="background: #f8fafc; padding: 14px; border-radius: 6px; margin-bottom: 18px; border-left: 4px solid #0284c7;">
            <p style="margin: 0; font-size: 13px;"><strong>From (Buyer / Plant Engineer):</strong> ${fromEmail || rfq.sourceEmail || 'Buyer'}</p>
            <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>RFQ Number:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: bold;">${rfq.rfqNumber}</span></p>
            <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>Category:</strong> ${rfq.category || 'General Procurement'}</p>
            <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>Target Delivery Date:</strong> ${rfq.targetDeliveryDate || 'Immediate'}</p>
          </div>

          <h3 style="font-size: 14px; margin: 0 0 10px 0; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Extracted Line Items</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b;">
                <th style="padding: 8px 10px;">Item Description</th>
                <th style="padding: 8px 10px; text-align: center;">Qty</th>
                <th style="padding: 8px 10px;">Technical Specs</th>
              </tr>
            </thead>
            <tbody>
              ${lineItemsHtml}
            </tbody>
          </table>

          <div style="padding: 12px; background: #eff6ff; border-radius: 6px; font-size: 12px; color: #1e40af;">
            ⚡ <strong>Status: Parsing / Held for Category Manager Review.</strong> No vendors have been released yet.
          </div>
        </div>
      </div>
    `,
  };
}

/**
 * Send one message through the shared transporter.
 *
 * No-ops (without throwing) during test runs and when SMTP isn't configured,
 * so every caller can fire-and-forget. A genuine transport failure is
 * propagated to the caller — it is real and worth logging/retrying.
 */
async function deliver(message, label) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: false, reason: 'test environment' };
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    logger.warn(`SMTP not configured (SMTP_USER/SMTP_PASSWORD unset) — ${label} not sent`, { to: message.to }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  const info = await activeTransporter.sendMail(message);
  logger.info(`${label} sent to ${message.to}`, { messageId: info.messageId }, 'MAILER_SERVICE');
  return { sent: true, messageId: info.messageId };
}

/** Shared frame so every Procucev email reads consistently. No invented data. */
function wrapEmail(headline, subline, innerHtml) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <div style="background: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; color: white;">
        <h2 style="margin: 0;">${headline}</h2>
        <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 14px;">${subline}</p>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
        ${innerHtml}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #64748b; margin: 0;">Procucev Enterprise · You are receiving this because your organisation is registered on the platform.</p>
      </div>
    </div>
  `;
}

/** One "field: value" row, only when the value is real. */
function row(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<tr><td style="padding: 6px 10px; font-weight: bold; width: 40%;">${label}</td><td style="padding: 6px 10px;">${value}</td></tr>`;
}

// ── OTP ──────────────────────────────────────────────────────────────────────

function buildOtpEmail(to, code, expiresInSeconds) {
  const minutes = Math.max(1, Math.round((expiresInSeconds || 600) / 60));
  return {
    from: process.env.SMTP_USER,
    to,
    subject: 'Your Procucev Enterprise verification code',
    html: wrapEmail(
      'PROCUCEV ENTERPRISE',
      'Secure Sign-In Verification',
      `<p>Your one-time verification code is:</p>
       <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; margin: 20px 0; color: #0284c7;">${code}</p>
       <p style="font-size: 13px; color: #64748b; margin: 0;">This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. If you did not request this, you can safely ignore this email.</p>`
    ),
  };
}

async function sendOtpEmail(to, code, expiresInSeconds) {
  return deliver(buildOtpEmail(to, code, expiresInSeconds), 'OTP email');
}

// ── New RFQ → matched vendors (buyer raised an enquiry in their category) ─────

function buildRfqInviteEmail(to, { rfq, recipientName }) {
  const items = Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : [];
  const itemRows = items
    .slice(0, 20)
    .map(
      (it, idx) =>
        `<tr>
          <td style="padding: 6px 10px; border: 1px solid #e2e8f0;">${idx + 1}. ${it.itemName || 'Line item'}</td>
          <td style="padding: 6px 10px; border: 1px solid #e2e8f0; text-align: center;">${it.quantity != null ? it.quantity : ''} ${it.unit || ''}</td>
        </tr>`
    )
    .join('');

  const category = rfq.category || null;
  const subject = category
    ? `New RFQ ${rfq.rfqNumber} in ${category}`
    : `New RFQ ${rfq.rfqNumber}`;

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p>${rfq.buyerAccountName ? `<strong>${rfq.buyerAccountName}</strong> has` : 'A buyer has'} raised a request for quotation your organisation is matched to.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('RFQ Number', rfq.rfqNumber)}
      ${row('Requirement', rfq.title)}
      ${row('Category', category)}
      ${row('Target delivery', rfq.targetDeliveryDate || rfq.deadline)}
      ${row('Delivery location', rfq.deliveryLocation)}
    </table>
    ${
      itemRows
        ? `<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
             <thead><tr style="background: #f1f5f9; text-align: left;">
               <th style="padding: 6px 10px; border: 1px solid #cbd5e1;">Item</th>
               <th style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: center;">Quantity</th>
             </tr></thead>
             <tbody>${itemRows}</tbody>
           </table>`
        : ''
    }
    <p style="font-size: 13px; color: #64748b;">Sign in to your Procucev vendor account to review the full enquiry and submit a quotation.</p>
  `;

  return {
    from: process.env.SMTP_USER,
    to,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'New Sourcing Enquiry', inner),
  };
}

async function sendRfqInviteEmail(to, context) {
  return deliver(buildRfqInviteEmail(to, context), 'RFQ invite email');
}

// ── Vendor quote → owning buyer ─────────────────────────────────────────────

function buildQuoteReceivedEmail(to, { rfq, quote, recipientName }) {
  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p>${quote.vendorName ? `<strong>${quote.vendorName}</strong> has` : 'A vendor has'} submitted a quotation against your RFQ.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('RFQ Number', rfq.rfqNumber)}
      ${row('Requirement', rfq.title)}
      ${row('Vendor', quote.vendorName)}
      ${row('Unit price', quote.unitPrice != null ? quote.unitPrice : null)}
      ${row('Total price', quote.totalPrice != null ? quote.totalPrice : null)}
      ${row('Lead time (days)', quote.leadTimeDays ? quote.leadTimeDays : null)}
      ${row('Payment terms', quote.paymentTerms)}
      ${row('Warranty (years)', quote.warrantyYears ? quote.warrantyYears : null)}
    </table>
    <p style="font-size: 13px; color: #64748b;">Sign in to your Procucev account to open the comparative quote matrix for this RFQ.</p>
  `;

  return {
    from: process.env.SMTP_USER,
    to,
    subject: `New quote on ${rfq.rfqNumber}${quote.vendorName ? ` from ${quote.vendorName}` : ''}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Quotation Received', inner),
  };
}

async function sendQuoteReceivedEmail(to, context) {
  return deliver(buildQuoteReceivedEmail(to, context), 'quote-received email');
}

/**
 * Sends a requisition notification email when a buyer creates/ingests an RFQ.
 */
async function sendRequisitionNotificationEmail(to, rfq, fromEmail) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: false, reason: 'test environment' };
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    logger.warn('SMTP not configured — requisition notification email not sent', { to, rfqNumber: rfq && rfq.rfqNumber }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  try {
    const safeRfq = rfq || {};
    const emailData = buildRequisitionEmail(to, safeRfq, fromEmail);
    const info = await activeTransporter.sendMail(emailData);
    logger.info(`Requisition notification email sent to ${to}`, { messageId: info.messageId, rfqNumber: safeRfq.rfqNumber }, 'MAILER_SERVICE');
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Failed to send requisition email to ${to}`, err, 'MAILER_SERVICE');
    return { sent: false, error: err.message };
  }
}

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

module.exports = {
  getTransporter,
  sendOtpEmail,
  sendRfqInviteEmail,
  sendQuoteReceivedEmail,
  buildRfqInviteEmail,
  buildQuoteReceivedEmail,
  sendRequisitionNotificationEmail,
  buildRequisitionEmail,
  isConfigured,
};

