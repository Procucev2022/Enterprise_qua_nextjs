/**
 * Enterprise Email Template & Notification Engine
 */

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

function generateStandardRFQEmail(rfq, vendor) {
  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();
  const vendorName = vendor ? vendor.name : 'Preferred Supplier Partner';
  const contactPerson = vendor ? vendor.contactPerson : 'Procurement Team';
  const vendorEmail = (vendor && vendor.email) || 'navinchaudhary.dev@gmail.com';
  const rfqNumber = rfq.rfqNumber || 'RFQ-2026';
  const deadline = rfq.deadline || 'To be confirmed';
  const category = rfq.category || 'Industrial Equipment & Spares';
  const budget = Number(rfq.budget) || 0;
  const attachments = Array.isArray(rfq.attachments) ? rfq.attachments : [];
  const bidLink = `${frontendUrl}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber)}`;

  const lineItemsList = (rfq.extractedEntities || rfq.lineItems || [])
    .map((item, idx) => {
      const specParts = [item.technicalSpecs, item.minorCategory].filter(Boolean);
      const confidence =
        typeof item.confidence === 'number' ? ` (AI confidence: ${Math.round(item.confidence * 100)}%)` : '';
      const specs = (specParts.join(' — ') || 'Standard Enterprise Specification') + confidence;
      return `<tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 500;">${idx + 1}. ${item.itemName || item.description || 'Item'}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">${item.quantity || 1} ${item.unit || 'Units'}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${specs}</td>
        </tr>`;
    })
    .join('');

  const attachmentsList = attachments
    .map(
      (file) =>
        `<li style="margin-bottom: 4px;">${file.fileName || file.name || 'Attachment'}</li>`
    )
    .join('');

  const subject = `[OFFICIAL RFQ] ${rfqNumber} - Request for Quotation: ${rfq.title}`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <div style="background: linear-gradient(135deg, #1e3a8a, #0284c7); padding: 24px; border-radius: 8px 8px 0 0; color: white;">
        <div style="margin-bottom: 12px;">
          <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
            <img src="${logoUrl}" alt="Procucev Enterprise" height="38" style="height: 38px; max-height: 42px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
          </a>
        </div>
        <h2 style="margin: 0 0 8px 0;">PROCUCEV ENTERPRISE PROCUREMENT</h2>
        <p style="margin: 0; opacity: 0.9; font-size: 14px;">Autonomous Sourcing & SCM Intelligence (Powered by QUA AI 2.0)</p>
      </div>
      
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
        <p>Dear <strong>${contactPerson}</strong> (${vendorName}),</p>
        <p>You have been formally invited to submit a commercial and technical bid for the following RFQ:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; background: #f8fafc;">
          <tr>
            <td style="padding: 8px 12px; font-weight: bold; width: 30%;">RFQ Number:</td>
            <td style="padding: 8px 12px;">${rfqNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: bold;">Title / Requirement:</td>
            <td style="padding: 8px 12px;">${rfq.title}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: bold;">Category:</td>
            <td style="padding: 8px 12px;">${category}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: bold;">Submission Deadline:</td>
            <td style="padding: 8px 12px; color: #dc2626; font-weight: bold;">${deadline} (23:59 IST)</td>
          </tr>
          ${
            budget > 0
              ? `<tr>
            <td style="padding: 8px 12px; font-weight: bold;">Indicative Budget:</td>
            <td style="padding: 8px 12px;">₹${budget.toLocaleString('en-IN')}</td>
          </tr>`
              : ''
          }
        </table>

        <h4 style="margin: 16px 0 8px 0; color: #0f172a;">Requested Bill of Quantities (BOQ):</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left;">
              <th style="padding: 8px 12px; border: 1px solid #cbd5e1;">Item Description</th>
              <th style="padding: 8px 12px; border: 1px solid #cbd5e1; text-align: center;">Quantity</th>
              <th style="padding: 8px 12px; border: 1px solid #cbd5e1;">Specifications</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsList || '<tr><td colspan="3" style="padding: 8px 12px; border: 1px solid #e2e8f0;">See attached procurement specifications document.</td></tr>'}
          </tbody>
        </table>

        ${
          attachmentsList
            ? `<h4 style="margin: 16px 0 8px 0; color: #0f172a;">Supporting Documents:</h4>
        <ul style="margin: 0 0 20px 0; padding-left: 20px; font-size: 13px;">${attachmentsList}</ul>`
            : ''
        }

        <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 20px 0; border-radius: 0 4px 4px 0;">
          <p style="margin: 0; font-size: 13px; color: #1e40af;">
            <strong>Autonomous AI Multi-Channel Follow-up:</strong> Our automated AI sourcing agent will monitor response milestones across WhatsApp and Voice calls.
          </p>
        </div>

        <p style="text-align: center; margin: 30px 0 10px 0;">
          <a href="${bidLink}" style="background: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Submit Quotation in 1-Click
          </a>
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #64748b; margin: 0;">
          Procucev Enterprise Solutions | Secure 256-Bit SHA Encrypted Transmission | DLT Registered
        </p>
      </div>
    </div>
  `;

  return {
    to: vendorEmail,
    recipientName: contactPerson,
    vendorName,
    subject,
    rfqNumber,
    htmlBody,
    sentAt: new Date().toISOString(),
  };
}

function generateVendorOnboardingEmail(vendor, isExisting = false, tempPassword = 'Procucev#2026!Vendor') {
  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();
  const subject = `Welcome to Procucev Enterprise Supplier Network - Onboarding & Credentials`;
  const portalUrl = `${frontendUrl}/login`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <div style="background: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; color: white;">
        <div style="margin-bottom: 12px;">
          <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
            <img src="${logoUrl}" alt="Procucev Enterprise" height="38" style="height: 38px; max-height: 42px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
          </a>
        </div>
        <h2 style="margin: 0;">PROCUCEV ENTERPRISE SUPPLIER PORTAL</h2>
        <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 14px;">Direct Empanelled Sourcing & RFQ Access</p>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
        <p>Dear <strong>${vendor.contactPerson || 'Partner'}</strong>,</p>
        <p>Your enterprise profile for <strong>${vendor.name}</strong> has been registered on the Procucev platform.</p>
        
        <div style="background: #f8fafc; padding: 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin: 20px 0;">
          <h4 style="margin: 0 0 10px 0; color: #0f172a;">Your Access Credentials:</h4>
          <p style="margin: 4px 0;"><strong>Portal URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
          <p style="margin: 4px 0;"><strong>Login Email:</strong> ${vendor.email}</p>
          <p style="margin: 4px 0;"><strong>Temporary Password:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</code></p>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${portalUrl}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Sign in to Supplier Portal</a>
        </div>

        <p>Please log in to complete your 10-category reconciliation and submit your Mode 3 360° qualification survey to unlock direct pre-purchase orders.</p>
      </div>
    </div>
  `;

  return {
    to: vendor.email,
    recipientName: vendor.contactPerson || 'Vendor Partner',
    vendorName: vendor.name,
    subject,
    tempPassword,
    htmlBody,
    sentAt: new Date().toISOString(),
  };
}

module.exports = {
  getPublicFrontendUrl,
  getLogoUrl,
  generateStandardRFQEmail,
  generateVendorOnboardingEmail,
};
