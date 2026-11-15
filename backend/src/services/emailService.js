/**
 * Enterprise Email Template & Notification Engine
 */

// Labels and messages stay in this module until they move to backend/src/config/constants.js.
const EMAIL_MESSAGES = Object.freeze({
  NOT_SPECIFIED: 'Not specified',
  RFQ_NUMBER_REQUIRED: 'An RFQ number is required to generate the RFQ invitation email.',
  VENDOR_EMAIL_REQUIRED: 'The vendor has no email address on record. Add one before this email can be sent.',
});

/**
 * Resolves the public frontend URL across all deployment environments
 * (Cloudflare Workers, Vercel, Node, Docker). Configurable via
 * PUBLIC_FRONTEND_URL, APP_PUBLIC_URL, FRONTEND_URL, or globalThis.__CF_ENV__.
 */
function getPublicFrontendUrl() {
  const envVal =
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.PUBLIC_FRONTEND_URL);
  if (envVal && typeof envVal === 'string' && envVal.trim()) {
    return envVal.trim().replace(/\/+$/, '');
  }
  if (process.env.NODE_ENV === 'production' || (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.NODE_ENV === 'production')) {
    return 'https://equa.procucev.com';
  }
  return 'http://localhost:3000';
}

/**
 * Returns the hosted Procucev logo URL.
 * Email clients cannot fetch images from localhost/127.0.0.1, so in local
 * dev or test environments, it falls back to the public Cloudflare Workers asset.
 */
function getLogoUrl() {
  const base = getPublicFrontendUrl();
  if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
    return 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/procucev-logo.png';
  }
  return `${base}/procucev-logo.png`;
}

/**
 * Builds the RFQ invitation email for one vendor.
 * Throws when the RFQ number is missing. When the vendor has no email, `to` is null
 * and `error` explains why: the caller must not send the message.
 */
function generateStandardRFQEmail(rfq, vendor) {
  if (!rfq || !rfq.rfqNumber) {
    throw new Error(EMAIL_MESSAGES.RFQ_NUMBER_REQUIRED);
  }

  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();
  const vendorName = (vendor && vendor.name) || EMAIL_MESSAGES.NOT_SPECIFIED;
  const contactPerson = (vendor && vendor.contactPerson) || EMAIL_MESSAGES.NOT_SPECIFIED;
  const vendorEmail = (vendor && vendor.email) || null;
  const rfqNumber = rfq.rfqNumber;
  const title = rfq.title || EMAIL_MESSAGES.NOT_SPECIFIED;
  const deadlineText = rfq.deadline ? `${rfq.deadline} (23:59 IST)` : EMAIL_MESSAGES.NOT_SPECIFIED;
  const category = rfq.category || EMAIL_MESSAGES.NOT_SPECIFIED;
  const budgetAmount = Number(rfq.budget);
  const budgetText =
    Number.isFinite(budgetAmount) && budgetAmount > 0
      ? `₹${budgetAmount.toLocaleString('en-IN')}`
      : EMAIL_MESSAGES.NOT_SPECIFIED;
  const attachments = Array.isArray(rfq.attachments) ? rfq.attachments : [];
  const bidLink = `${frontendUrl}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber)}`;

  const lineItemsList = (rfq.extractedEntities || rfq.lineItems || [])
    .map((item, idx) => {
      const specParts = [item.technicalSpecs, item.minorCategory].filter(Boolean);
      const confidence =
        typeof item.confidence === 'number' ? ` (AI confidence: ${Math.round(item.confidence * 100)}%)` : '';
      const specs = (specParts.join(' — ') || EMAIL_MESSAGES.NOT_SPECIFIED) + confidence;
      const quantity = item.quantity != null && item.quantity !== '' ? String(item.quantity) : EMAIL_MESSAGES.NOT_SPECIFIED;
      const quantityWithUnit = item.unit ? `${quantity} ${item.unit}` : quantity;
      return `<tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 500;">${idx + 1}. ${item.itemName || item.description || EMAIL_MESSAGES.NOT_SPECIFIED}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">${quantityWithUnit}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${specs}</td>
        </tr>`;
    })
    .join('');

  const attachmentsList = attachments
    .map(
      (file) =>
        `<li style="margin-bottom: 4px;">${file.fileName || file.name || EMAIL_MESSAGES.NOT_SPECIFIED}</li>`
    )
    .join('');

  const subject = `[OFFICIAL RFQ] ${rfqNumber} - Request for Quotation: ${title}`;

  const isBuyerVendor = Boolean(
    vendor && (
      vendor.isBuyerUploaded === true ||
      vendor.addedByBuyerCompany ||
      vendor.buyerAccountId ||
      vendor.buyerId ||
      (vendor.source && String(vendor.source).toLowerCase().includes('buyer')) ||
      (vendor.id && (
        String(vendor.id).startsWith('v-hist-') ||
        String(vendor.id).startsWith('vm-') ||
        String(vendor.id).startsWith('v-ingest-') ||
        String(vendor.id).startsWith('v-buyer-')
      ))
    )
  );

  const htmlBody = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="email-wrapper" style="width: 100%; min-width: 100%; margin: 0; padding: 0; background-color: #ffffff; border-collapse: collapse;">
      <tr>
        <td align="left" class="email-wrapper-cell" style="padding: 16px 20px; background-color: #ffffff;">
          <!--[if (gte mso 9)|(IE)]>
          <table align="left" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%;">
          <tr>
          <td align="left" valign="top" width="100%" style="width:100%;">
          <![endif]-->
          <div class="email-container" style="font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif; width: 100%; max-width: 100%; margin: 0; color: #1e293b; line-height: 1.6; box-sizing: border-box; text-align: left;">
            <div class="email-header" style="background: linear-gradient(135deg, #1e3a8a, #0284c7); padding: 20px 24px; border-radius: 8px 8px 0 0; color: white; box-sizing: border-box; width: 100%;">
              <div style="margin-bottom: 12px;">
                <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                  <img src="${logoUrl}" alt="Procucev Enterprise" height="38" style="height: 38px; max-height: 42px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
                </a>
              </div>
              <h2 style="margin: 0 0 8px 0;">PROCUCEV ENTERPRISE PROCUREMENT</h2>
              <p style="margin: 0; opacity: 0.9; font-size: 14px;">Autonomous Sourcing & SCM Intelligence (Powered by QUA AI 2.0)</p>
            </div>
            
            <div class="email-content" style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px; box-sizing: border-box; word-break: break-word;">
              <p>Dear <strong>${contactPerson}</strong> (${vendorName}),</p>
              <p>You have been formally invited to submit a commercial and technical bid for the following RFQ:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; background: #f8fafc; word-break: break-word;">
                <tr>
                  <td style="padding: 8px 12px; font-weight: bold; width: 30%;">RFQ Number:</td>
                  <td style="padding: 8px 12px;">${rfqNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 12px; font-weight: bold;">Title / Requirement:</td>
                  <td style="padding: 8px 12px;">${title}</td>
                </tr>
                ${
                  isBuyerVendor && rfq.buyerAccountName
                    ? `<tr>
                  <td style="padding: 8px 12px; font-weight: bold;">Buyer:</td>
                  <td style="padding: 8px 12px;">${rfq.buyerAccountName}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding: 8px 12px; font-weight: bold;">Category:</td>
                  <td style="padding: 8px 12px;">${category}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 12px; font-weight: bold;">Submission Deadline:</td>
                  <td style="padding: 8px 12px; color: #dc2626; font-weight: bold;">${deadlineText}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 12px; font-weight: bold;">Indicative Budget:</td>
                  <td style="padding: 8px 12px;">${budgetText}</td>
                </tr>
              </table>

              <h4 style="margin: 16px 0 8px 0; color: #0f172a;">Requested Bill of Quantities (BOQ):</h4>
              <div style="overflow-x: auto; width: 100%; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; word-break: break-word;">
                  <thead>
                    <tr style="background: #f1f5f9; text-align: left;">
                      <th style="padding: 8px 12px; border: 1px solid #cbd5e1;">Item Description</th>
                      <th style="padding: 8px 12px; border: 1px solid #cbd5e1; text-align: center;">Quantity</th>
                      <th style="padding: 8px 12px; border: 1px solid #cbd5e1;">Specifications</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${lineItemsList || '<tr><td colspan="3" style="padding: 8px 12px; border: 1px solid #e2e8f0;">No line items are recorded for this RFQ.</td></tr>'}
                  </tbody>
                </table>
              </div>

              ${
                attachmentsList
                  ? `<h4 style="margin: 16px 0 8px 0; color: #0f172a;">Supporting Documents:</h4>
              <ul style="margin: 0 0 20px 0; padding-left: 20px; font-size: 13px;">${attachmentsList}</ul>`
                  : ''
              }

              <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 20px 0; border-radius: 0 4px 4px 0; box-sizing: border-box;">
                <p style="margin: 0; font-size: 13px; color: #1e40af;">
                  <strong>Follow-up:</strong> Reminders about this RFQ can reach you on WhatsApp, SMS and email.
                </p>
              </div>

              <p style="text-align: center; margin: 30px 0 10px 0;">
                <a href="${bidLink}" style="background: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; max-width: 100%; box-sizing: border-box;">
                  Submit Quotation in 1-Click
                </a>
              </p>

              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 12px; color: #64748b; margin: 0;">
                Procucev Enterprise Solutions | DLT Registered
              </p>
            </div>
          </div>
          <!--[if (gte mso 9)|(IE)]>
          </td>
          </tr>
          </table>
          <![endif]-->
        </td>
      </tr>
    </table>
  `;

  return {
    to: vendorEmail,
    recipientName: contactPerson,
    vendorName,
    subject,
    rfqNumber,
    htmlBody,
    sentAt: new Date().toISOString(),
    ...(vendorEmail ? {} : { error: EMAIL_MESSAGES.VENDOR_EMAIL_REQUIRED }),
  };
}

/**
 * Builds the portal onboarding email for a vendor.
 * When the vendor has no email, `to` is null and `error` explains why.
 */
function generateVendorOnboardingEmail(vendor) {
  const safeVendor = vendor || {};
  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();
  const subject = `Welcome to Procucev Enterprise Supplier Network - Onboarding Instructions`;
  const portalUrl = `${frontendUrl}/login`;
  const contactPerson = safeVendor.contactPerson || EMAIL_MESSAGES.NOT_SPECIFIED;
  const vendorName = safeVendor.name || EMAIL_MESSAGES.NOT_SPECIFIED;
  const vendorEmail = safeVendor.email || null;

  const htmlBody = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="email-wrapper" style="width: 100%; min-width: 100%; margin: 0; padding: 0; background-color: #ffffff; border-collapse: collapse;">
      <tr>
        <td align="left" class="email-wrapper-cell" style="padding: 16px 20px; background-color: #ffffff;">
          <!--[if (gte mso 9)|(IE)]>
          <table align="left" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%;">
          <tr>
          <td align="left" valign="top" width="100%" style="width:100%;">
          <![endif]-->
          <div class="email-container" style="font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif; width: 100%; max-width: 100%; margin: 0; color: #1e293b; line-height: 1.6; box-sizing: border-box; text-align: left;">
            <div class="email-header" style="background: #0f172a; padding: 20px 24px; border-radius: 8px 8px 0 0; color: white; box-sizing: border-box; width: 100%;">
              <div style="margin-bottom: 12px;">
                <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                  <img src="${logoUrl}" alt="Procucev Enterprise" height="38" style="height: 38px; max-height: 42px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
                </a>
              </div>
              <h2 style="margin: 0;">PROCUCEV ENTERPRISE SUPPLIER PORTAL</h2>
              <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 14px;">Direct Empanelled Sourcing & RFQ Access</p>
            </div>
            <div class="email-content" style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px; box-sizing: border-box; word-break: break-word;">
              <p>Dear <strong>${contactPerson}</strong>,</p>
              <p>Your enterprise profile for <strong>${vendorName}</strong> has been registered on the Procucev platform.</p>
              
              <div style="background: #f8fafc; padding: 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin: 20px 0; box-sizing: border-box;">
                <h4 style="margin: 0 0 10px 0; color: #0f172a;">Portal Access:</h4>
                <p style="margin: 4px 0;"><strong>Portal URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
                <p style="margin: 4px 0;"><strong>Login Email:</strong> ${vendorEmail || EMAIL_MESSAGES.NOT_SPECIFIED}</p>
                <p style="margin: 4px 0;"><strong>Sign-in:</strong> Use your registered email and follow the verification steps shown on the portal.</p>
              </div>

              <div style="text-align: center; margin: 24px 0;">
                <a href="${portalUrl}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; max-width: 100%; box-sizing: border-box;">Sign in to Supplier Portal</a>
              </div>

              <p>Please log in to complete your 10-category reconciliation and submit your Mode 3 360° qualification survey to unlock direct pre-purchase orders.</p>
            </div>
          </div>
          <!--[if (gte mso 9)|(IE)]>
          </td>
          </tr>
          </table>
          <![endif]-->
        </td>
      </tr>
    </table>
  `;

  return {
    to: vendorEmail,
    recipientName: safeVendor.contactPerson || EMAIL_MESSAGES.NOT_SPECIFIED,
    vendorName: safeVendor.name,
    subject,
    htmlBody,
    sentAt: new Date().toISOString(),
    ...(vendorEmail ? {} : { error: EMAIL_MESSAGES.VENDOR_EMAIL_REQUIRED }),
  };
}

const transactionalEmailTemplates = require('./transactionalEmailTemplates');

module.exports = {
  getPublicFrontendUrl,
  getLogoUrl,
  generateStandardRFQEmail,
  generateVendorOnboardingEmail,
  transactionalEmailTemplates,
  renderTransactionalEmail: transactionalEmailTemplates.renderTransactionalEmail,
  sendTransactionalEmail: transactionalEmailTemplates.sendTransactionalEmail,
};
