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
      <div style="background: #ffffff; padding: 24px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #0284c7;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-size: 24px; font-weight: bold; color: #0284c7;">PROCUCEV</div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">ENTERPRISE</div>
            </td>
            <td style="text-align: right; vertical-align: middle;">
              <div style="font-size: 14px; font-weight: 600; color: #0f172a;">${headline}</div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${subline}</div>
            </td>
          </tr>
        </table>
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

// ── Vendor Master & PO ingestion: category mapping + self-mapping ────────────
// Three templates the buyer dispatches at the end of an ingestion run. All of
// them deliberately carry the sign-in link and nothing else about the buyer's
// internals: no spend figures, no PO numbers, no other supplier's name, and no
// temporary password (the platform's existing OTP sign-in handles credentials,
// so mailing a password would add a secret to an inbox for no gain).

/** Where a supplier signs in. Configurable because it differs per deployment. */
function vendorSignInUrl() {
  const base = process.env.APP_PUBLIC_URL || 'http://localhost:3000';
  return `${String(base).replace(/\/+$/, '')}/login`;
}

/** A styled list of the categories a supplier has been mapped to. */
function categoryList(items = []) {
  const real = items.filter((item) => typeof item === 'string' && item.trim() !== '');
  if (real.length === 0) return '';
  return `<ul style="margin: 8px 0 0 0; padding-left: 20px;">${real
    .map((item) => `<li style="margin-bottom: 4px;">${item}</li>`)
    .join('')}</ul>`;
}

/**
 * Template A — the buyer has mapped this supplier's categories from PO history.
 *
 * The categories are stated explicitly so the supplier can tell the buyer if
 * they are wrong, which is the main way a mis-classification gets corrected
 * after dispatch.
 */
function buildVendorCategoryMappingEmail({
  to,
  recipientName,
  buyerOrganizationName,
  vendorCode,
  majorCategory,
  minorCategories = [],
}) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';
  const minorHtml = categoryList(minorCategories);

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p><strong>${buyer}</strong> has added your organisation to their vendor master and mapped your supply categories from your purchase order history with them.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('Buyer', buyer)}
      ${row('Your vendor code', vendorCode)}
      ${row('Primary category', majorCategory)}
    </table>
    ${
      minorHtml
        ? `<p style="margin-bottom: 0;"><strong>Sub-categories you are mapped to:</strong></p>${minorHtml}`
        : ''
    }
    <p style="margin-top: 20px;">You will now receive enquiries in these categories. Sign in to review the mapping, and let the buyer know if anything looks wrong.</p>
    <p style="margin: 20px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Sign in to Procucev</a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0;">Sign in with this email address; a one-time verification code will be sent to it.</p>
  `;

  return {
    from: process.env.SMTP_USER,
    to,
    subject: `${buyer} has mapped your supply categories${majorCategory ? ` — ${majorCategory}` : ''}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Vendor Category Mapping Confirmed', inner),
  };
}

/**
 * Template B — no PO history was found, so the supplier must map itself.
 *
 * The wording states the reason plainly rather than implying the supplier did
 * something wrong: the buyer simply had no purchasing history to categorise them
 * from. Nothing about the buyer's spend or other suppliers is disclosed.
 */
function buildVendorSelfMappingEmail({ to, recipientName, buyerOrganizationName, vendorCode }) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p><strong>${buyer}</strong> has added your organisation to their vendor master on Procucev.</p>
    <p>No historical purchase order data was available for your organisation, so your supply categories could not be mapped automatically. <strong>To become eligible for relevant enquiries, please sign in and select the categories you supply.</strong></p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('Buyer', buyer)}
      ${row('Your vendor code', vendorCode)}
      ${row('Action required', 'Select your supply categories')}
    </table>
    <p style="margin: 20px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Complete your category mapping</a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0;">Sign in with this email address; a one-time verification code will be sent to it. Until your categories are mapped, you will not be matched to enquiries.</p>
  `;

  return {
    from: process.env.SMTP_USER,
    to,
    subject: 'Complete Your Category Mapping to Receive Enquiries',
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Category Mapping Required', inner),
  };
}

/** Template C — a plain onboarding notice, with no category claim either way. */
function buildVendorOnboardingEmail({ to, recipientName, buyerOrganizationName, vendorCode, tempPassword, contactPhone }) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';

  const inner = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p style="font-size: 16px; color: #1e293b; margin-bottom: 20px;">
        ${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}
      </p>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        <strong>${buyer}</strong> has registered your organisation on <strong>Procucev Enterprise</strong>, the platform they use to run sourcing enquiries and manage supplier relationships.
      </p>
      
      <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 1px solid #bae6fd; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="color: #0369a1; font-size: 14px; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">Your Login Credentials</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Email Address</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${to}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Temporary Password</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #cbd5e1;">${tempPassword || 'Set during first login'}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Vendor Code</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${vendorCode}</td>
          </tr>
          ${contactPhone ? `
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Contact Number</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${contactPhone}</td>
          </tr>
          ` : ''}
        </table>
      </div>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        Please sign in to review your profile, confirm your supply categories, and start receiving sourcing enquiries from <strong>${buyer}</strong>.
      </p>
      
      <p style="margin: 28px 0;">
        <a href="${vendorSignInUrl()}" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(2, 132, 199, 0.3);">Sign in to Procucev Portal</a>
      </p>
      
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="font-size: 13px; color: #92400e; margin: 0; line-height: 1.5;">
          <strong>🔐 Security Notice:</strong> For your security, please change your temporary password after your first login. Your password should be at least 8 characters with a mix of letters, numbers, and special characters.
        </p>
      </div>
      
      <p style="font-size: 13px; color: #64748b; margin: 0; line-height: 1.6;">
        If you have any questions or need assistance, please contact our support team at <a href="mailto:support@procucev.ai" style="color: #0284c7;">support@procucev.ai</a>
      </p>
    </div>
  `;

  return {
    from: process.env.SMTP_USER,
    to,
    subject: `[Action Required] Welcome to Procucev - Your Account Credentials from ${buyer}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Supplier Onboarding & Login Credentials', inner),
  };
}

/** Template D — Rating revision notification to vendor */
function buildRatingRevisionEmail({ to, recipientName, vendorName, buyerCompany, buyerName, previousRating, newRating, previousScore, newScore, remarks, qualityScore, costScore, deliveryScore }) {
  const inner = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p style="font-size: 16px; color: #1e293b; margin-bottom: 20px;">
        ${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}
      </p>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        <strong>${buyerCompany}</strong> has updated your performance rating on <strong>Procucev Enterprise</strong>.
      </p>
      
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #86efac; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="color: #166534; font-size: 14px; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">Rating Update Summary</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Previous Rating</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${previousRating.toFixed(1)} / 5.0</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">New Rating</td>
            <td style="padding: 12px 0; color: #166534; font-size: 16px; font-weight: bold;">${newRating.toFixed(1)} / 5.0</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Score Change</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${previousScore.toFixed(1)} → ${newScore.toFixed(1)}</td>
          </tr>
        </table>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="color: #334155; font-size: 14px; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">Performance Breakdown</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Quality Score</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${qualityScore} / 100</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Cost Score</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${costScore} / 100</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Delivery Score</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${deliveryScore} / 100</td>
          </tr>
        </table>
      </div>
      
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="font-size: 13px; color: #1e40af; margin: 0; line-height: 1.5;">
          <strong>📝 Remarks:</strong> ${remarks}
        </p>
      </div>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        Sign in to Procucev to view your complete performance history and track your progress.
      </p>
      
      <p style="margin: 28px 0;">
        <a href="${vendorSignInUrl()}" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(2, 132, 199, 0.3);View Performance Dashboard</a>
      </p>
      
      <p style="font-size: 13px; color: #64748b; margin: 0; line-height: 1.6;">
        If you have any questions about this rating update, please contact <strong>${buyerCompany}</strong> directly or reach out to our support team at <a href="mailto:support@procucev.ai" style="color: #0284c7;">support@procucev.ai</a>
      </p>
    </div>
  `;

  return {
    from: process.env.SMTP_USER,
    to,
    subject: `[Rating Update] Your performance rating has been updated by ${buyerCompany}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Vendor Rating Revision', inner),
  };
}

/**
 * Send one already-built ingestion email.
 *
 * Goes through `deliver`, so it no-ops under test and when SMTP is unconfigured
 * and returns `{ sent: false, reason }` rather than throwing. The ingestion
 * service records that reason against the recipient, which is what makes an
 * unconfigured server show up as retryable failures instead of silent success.
 */
async function sendVendorIngestionEmail(message, template) {
  return deliver(message, `vendor ingestion ${template} email`);
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
  vendorSignInUrl,
  categoryList,
  buildVendorCategoryMappingEmail,
  buildVendorSelfMappingEmail,
  buildVendorOnboardingEmail,
  buildRatingRevisionEmail,
  sendVendorIngestionEmail,
  isConfigured,
};

