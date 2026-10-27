/**
 * Qua AI: Transactional Email Templates Engine
 * Implements 13 standardized transactional email templates with rich HTML and plain-text fallbacks,
 * metadata cataloging, and dispatch integration for buyers and suppliers.
 */

const { QUA_AI_EMAIL_TEMPLATES, QUA_AI_EMAIL_SUPPORT } = require('../config/constants');
const { logger } = require('./loggerService');

/**
 * Resolves the public frontend URL across all deployment environments.
 */
function getPublicFrontendUrl() {
  const envVal =
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.PUBLIC_FRONTEND_URL);
  if (envVal && typeof envVal === 'string' && envVal.trim()) {
    const trimmed = envVal.trim().replace(/\/+$/, '');
    if (trimmed.includes('srinivas-mukku.workers.dev')) {
      const isProd =
        process.env.NODE_ENV === 'production' ||
        (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && (globalThis.__CF_ENV__.NODE_ENV === 'production' || globalThis.__CF_ENV__.ENVIRONMENT === 'prod' || globalThis.__CF_ENV__.ENVIRONMENT === 'production'));
      if (isProd) {
        return 'https://equa.procucev.com';
      }
    }
    return trimmed;
  }
  if (process.env.NODE_ENV === 'production' || (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__.NODE_ENV === 'production')) {
    return 'https://equa.procucev.com';
  }
  return 'http://localhost:3000';
}

/**
 * Returns the hosted Procucev logo URL for emails.
 */
function getLogoUrl() {
  const base = getPublicFrontendUrl();
  if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
    return 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/procucev-logo.png';
  }
  return `${base}/procucev-logo.png`;
}


/**
 * Escapes unsafe HTML characters to prevent XSS and template injection.
 * @param {unknown} val
 * @returns {string}
 */
function escapeHtml(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes user salutation.
 * If first_name is provided, returns first_name, otherwise falls back to fallback.
 */
function resolveSalutation(firstName, fallback = 'there') {
  const clean = firstName ? String(firstName).trim() : '';
  return clean || fallback;
}

/**
 * Wraps body content in a modern, responsive Qua AI responsive email shell.
 */
function wrapQuaAiEmail({
  title = 'QUA AI Autonomous Procurement',
  subtitle = 'Enterprise Transactional Intelligence',
  innerHtml,
  supportPhone = QUA_AI_EMAIL_SUPPORT.PHONE,
  supportEmail = QUA_AI_EMAIL_SUPPORT.EMAIL,
}) {
  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(title)}</title>
  <style type="text/css">
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      max-width: 100%;
    }
    table {
      border-collapse: collapse !important;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
    }
    @media only screen and (max-width: 640px) {
      .email-wrapper {
        width: 100% !important;
      }
      .email-wrapper-cell {
        padding: 12px 6px !important;
      }
      .email-container {
        width: 100% !important;
        max-width: 100% !important;
        border-radius: 6px !important;
      }
      .email-header {
        padding: 16px 18px !important;
      }
      .email-content {
        padding: 20px 16px !important;
      }
      .email-footer {
        padding: 12px 16px !important;
      }
      .stack-cell {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        text-align: left !important;
        box-sizing: border-box !important;
      }
      .responsive-table {
        width: 100% !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6; -webkit-font-smoothing: antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="email-wrapper" style="width: 100%; min-width: 100%; margin: 0; padding: 0; background-color: #ffffff; border-collapse: collapse;">
    <tr>
      <td align="left" class="email-wrapper-cell" style="padding: 16px 20px; background-color: #ffffff;">
        <!--[if (gte mso 9)|(IE)]>
        <table align="left" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%;">
        <tr>
        <td align="left" valign="top" width="100%" style="width:100%;">
        <![endif]-->
        <div class="email-container" style="width: 100%; max-width: 100%; margin: 0; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; box-sizing: border-box; text-align: left;">
          
          <!-- Header -->
          <div class="email-header" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 20px 24px; border-bottom: 3px solid #0284c7; box-sizing: border-box; width: 100%;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td class="logo-cell" style="vertical-align: middle; padding-right: 12px;">
                  <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                    <img src="${logoUrl}" alt="Procucev Enterprise" height="34" style="height: 34px; max-height: 38px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
                  </a>
                </td>
                <td class="badge-cell" style="text-align: right; vertical-align: middle;">
                  <div style="display: inline-block; background: rgba(2, 132, 199, 0.25); border: 1px solid rgba(56, 189, 248, 0.4); padding: 4px 10px; border-radius: 4px;">
                    <span style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.8px;">QUA AI 2.0</span>
                  </div>
                  <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Autonomous SCM Intelligence</div>
                </td>
              </tr>
            </table>
          </div>

          <!-- Main Content Area -->
          <div class="email-content" style="padding: 24px 24px 20px 24px; background-color: #ffffff; box-sizing: border-box; word-break: break-word; width: 100%;">
            ${innerHtml}

            <!-- Support and Clarifications Section -->
            <div style="margin-top: 28px; padding-top: 18px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #475569; box-sizing: border-box;">
              <p style="margin: 0 0 14px 0;">
                For any further questions or clarifications, please reach out to <strong>${escapeHtml(supportPhone)}</strong> / email to <a href="mailto:${escapeHtml(supportEmail)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(supportEmail)}</a>
              </p>
              <p style="margin: 0; font-weight: 700; color: #0f172a;">
                ${escapeHtml(QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE)}<br/>
                <span style="font-weight: 500; color: #64748b;">${escapeHtml(QUA_AI_EMAIL_SUPPORT.COMPANY_NAME)}</span>
              </p>
            </div>
          </div>

          <!-- Footer Notice -->
          <div class="email-footer" style="background-color: #ffffff; padding: 14px 24px; border-top: 1px solid #e2e8f0; text-align: center; box-sizing: border-box; width: 100%;">
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">
              This is an automated transactional notification sent by Qua AI Autonomous Procurement System.
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
</body>
</html>`;
}

/**
 * Standard CTA Button renderer with resilient inline styles.
 */
function renderCtaButton(label, url) {
  const targetUrl = url || getPublicFrontendUrl();
  return `
    <div style="text-align: center; margin: 26px 0;">
      <a href="${escapeHtml(targetUrl)}" style="background-color: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.25); max-width: 100%; box-sizing: border-box; word-break: break-word;">
        ${escapeHtml(label)}
      </a>
    </div>
  `;
}

// ==============================================================================
// 13 INDIVIDUAL EMAIL BUILDERS
// ==============================================================================

/**
 * Email 1 : RFQ created from email, account auto-created
 * Who: Unregistered buyer
 * Trigger: An unknown email address writes to RFQ@procucev.com.
 */
function buildEmail1_RfqCreatedAccountAutoCreated(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const email = params.email || 'buyer@example.com';
  const mobileNumber = params.mobile_number || params.mobileNumber || '9999999999';
  const tempPassword = params.temp_password || 'QuaAI#2026Auto';
  const loginUrl = params.login_url || `${getPublicFrontendUrl()}/login`;
  const reviewUrl = params.review_url || `${loginUrl}?redirect=/buyer/rfq-summary`;

  const subject = `Congratulations, your RFQ ${rfqId} is live on Qua AI`;

  const text = `Hi ${firstName},

Congratulations! We received your requirement and Qua AI has already turned it into a structured RFQ: ${rfqId} : ${rfqTitle}. Matching suppliers are being lined up now.

To save you time, we created a free Qua AI account for you with this email address.

Your login details
Login ID: ${email}
Registered Mobile: ${mobileNumber}
Temporary password: ${tempPassword} (valid for 48 hours)
Login page: ${loginUrl}

Three quick steps to finish
1. Log in and set your own password.
2. Complete your profile: company name, GSTIN, delivery address and phone number. We've used placeholder details for now; suppliers quote more accurately once these are real.
3. Go to RFQ Summary to review ${rfqId}.

[ Log in & review my RFQ ]: ${reviewUrl}

Suppliers start quoting within about 24 hours. Qua AI follows up with them and sends you the quotations side by side.

Next time, just email your requirement to RFQ@procucev.com again.

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      Congratulations! We received your requirement and Qua AI has already turned it into a structured RFQ: <strong><span style="color: #0284c7; font-family: monospace;">${escapeHtml(rfqId)}</span> : ${escapeHtml(rfqTitle)}</strong>. Matching suppliers are being lined up now.
    </p>
    <p style="font-size: 15px; margin: 0 0 18px 0; color: #334155;">
      To save you time, we created a free Qua AI account for you with this email address.
    </p>

    <!-- Login Details Box -->
    <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Your login details</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; width: 38%; font-weight: 600;">Login ID:</td>
          <td style="padding: 6px 0; color: #0f172a; font-family: monospace;">${escapeHtml(email)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Registered Mobile:</td>
          <td style="padding: 6px 0; color: #0f172a; font-family: monospace; font-weight: 700;">${escapeHtml(mobileNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Temporary password:</td>
          <td style="padding: 6px 0; color: #0f172a;"><code style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${escapeHtml(tempPassword)}</code> <span style="font-size: 12px; color: #e11d48; margin-left: 6px;">(valid for 48 hours)</span></td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Login page:</td>
          <td style="padding: 6px 0;"><a href="${escapeHtml(loginUrl)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(loginUrl)}</a></td>
        </tr>
      </table>
    </div>

    <!-- Steps Box -->
    <div style="margin: 22px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #0f172a;">Three quick steps to finish</h3>
      <ol style="margin: 0; padding-left: 20px; font-size: 14px; color: #334155;">
        <li style="margin-bottom: 8px;">Log in and set your own password.</li>
        <li style="margin-bottom: 8px;">Complete your profile: company name, GSTIN, delivery address and phone number. We've used placeholder details for now; suppliers quote more accurately once these are real.</li>
        <li style="margin-bottom: 8px;">Go to RFQ Summary to review <strong>${escapeHtml(rfqId)}</strong>.</li>
      </ol>
    </div>

    ${renderCtaButton('Log in & review my RFQ', reviewUrl)}

    <p style="font-size: 14px; color: #334155; margin: 18px 0;">
      Suppliers start quoting within about 24 hours. Qua AI follows up with them and sends you the quotations side by side.
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0; background-color: #eff6ff; padding: 10px 14px; border-radius: 6px; border-left: 3px solid #0284c7;">
      Next time, just email your requirement to <a href="mailto:RFQ@procucev.com" style="color: #0284c7; font-weight: 600;">RFQ@procucev.com</a> again.
    </p>
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 2 : RFQ created
 * Who: Registered buyer
 * Trigger: Logged-in buyer creates an RFQ or registered buyer's email is converted.
 */
function buildEmail2_RfqCreated(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_2_RFQ_CREATED;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const category = params.category || 'Industrial Supplies';
  const itemCount = params.item_count !== undefined ? params.item_count : (params.items ? params.items.length : 1);
  const deliveryLocation = params.delivery_location || 'As per RFQ Specification';
  const requiredBy = params.required_by || 'To be scheduled';
  const quoteDeadline = params.quote_deadline || 'Within 72 hours';
  const suppliersInvited = params.suppliers_invited !== undefined ? params.suppliers_invited : 5;
  const items = Array.isArray(params.items) ? params.items : [];
  const rfqSummaryUrl = params.rfq_summary_url || `${getPublicFrontendUrl()}/buyer/rfq-summary`;

  const subject = `Congratulations, RFQ ${rfqId} is live. Qua AI is on it`;

  const itemsText = items.length > 0
    ? items.map((it, idx) => `${idx + 1}. ${it.item_name || 'Item'} | ${it.item_spec || '-'} | Qty: ${it.qty || 1} ${it.uom || 'Nos'}`).join('\n')
    : `1. ${rfqTitle} | Standard Spec | Qty: 1 Lot`;

  const text = `Hi ${firstName},

Congratulations! Your RFQ is live and has gone out to ${suppliersInvited} matched suppliers.

Now sit back and relax. Qua AI follows up with every supplier by email, SMS and WhatsApp, so you don't have to. As soon as quotations come in, we'll share them with you in a side-by-side comparison.

RFQ Summary
Field: Details
RFQ ID: ${rfqId}
Title: ${rfqTitle}
Category: ${category}
Line items: ${itemCount}
Delivery location: ${deliveryLocation}
Required by: ${requiredBy}
Quotes due: ${quoteDeadline}
Suppliers invited: ${suppliersInvited}

Items requested:
${itemsText}

Spotted something to change? You can edit the RFQ until the first quote arrives.

[ View RFQ Summary ]: ${rfqSummaryUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const itemsRows = items.length > 0
    ? items.map((it, idx) => `
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">${idx + 1}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">${escapeHtml(it.item_name || 'Item')}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-size: 13px;">${escapeHtml(it.item_spec || '-')}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">${escapeHtml(it.qty || 1)}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">${escapeHtml(it.uom || 'Nos')}</td>
        </tr>
      `).join('')
    : `
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">1</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">${escapeHtml(rfqTitle)}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-size: 13px;">Standard Specification</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">1</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">Lot</td>
        </tr>
      `;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      Congratulations! Your RFQ is live and has gone out to <strong>${escapeHtml(suppliersInvited)} matched suppliers</strong>.
    </p>
    <p style="font-size: 14px; margin: 0 0 20px 0; color: #475569;">
      Now sit back and relax. Qua AI follows up with every supplier by email, SMS and WhatsApp, so you don't have to. As soon as quotations come in, we'll share them with you in a side-by-side comparison.
    </p>

    <!-- RFQ Summary Table -->
    <h3 style="margin: 20px 0 10px 0; font-size: 15px; color: #0f172a;">RFQ Summary</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 22px; background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; width: 35%; color: #64748b;">RFQ ID</td>
        <td style="padding: 8px 14px; font-weight: 700; color: #0284c7; font-family: monospace;">${escapeHtml(rfqId)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Title</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(rfqTitle)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Category</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(category)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Line items</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(itemCount)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Delivery location</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(deliveryLocation)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Required by</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(requiredBy)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Quotes due</td>
        <td style="padding: 8px 14px; color: #e11d48; font-weight: 600;">${escapeHtml(quoteDeadline)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Suppliers invited</td>
        <td style="padding: 8px 14px; color: #0f172a; font-weight: 600;">${escapeHtml(suppliersInvited)}</td>
      </tr>
    </table>

    <!-- Items Requested Table -->
    <h3 style="margin: 20px 0 10px 0; font-size: 15px; color: #0f172a;">Items requested</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 22px;">
      <thead>
        <tr style="background-color: #f1f5f9; text-align: left; color: #475569;">
          <th style="padding: 8px 12px; border: 1px solid #cbd5e1; width: 8%; text-align: center;">#</th>
          <th style="padding: 8px 12px; border: 1px solid #cbd5e1; width: 32%;">Item</th>
          <th style="padding: 8px 12px; border: 1px solid #cbd5e1;">Specification</th>
          <th style="padding: 8px 12px; border: 1px solid #cbd5e1; width: 12%; text-align: center;">Qty</th>
          <th style="padding: 8px 12px; border: 1px solid #cbd5e1; width: 12%; text-align: center;">Unit</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <p style="font-size: 13px; color: #64748b; margin: 16px 0;">
      Spotted something to change? You can edit the RFQ until the first quote arrives.
    </p>

    ${renderCtaButton('View RFQ Summary', rfqSummaryUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 3 : New RFQ intimation
 * Who: Unregistered vendor
 * Trigger: Qua AI matches an RFQ to a supplier in the Procucev network who has no account yet.
 */
function buildEmail3_NewRfqIntimation(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_3_NEW_RFQ_INTIMATION;
  const firstName = resolveSalutation(params.first_name, 'there');
  const category = params.category || 'Industrial Supplies';
  const quoteDeadline = params.quote_deadline || 'within 48 hours';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const buyerIndustry = params.buyer_industry || 'Heavy Industrial';
  const buyerCity = params.buyer_city || 'India';
  const itemCount = params.item_count !== undefined ? params.item_count : 1;
  const deliveryLocation = params.delivery_location || 'As specified in RFQ';
  const requiredBy = params.required_by || 'To be scheduled';
  const rfqId = params.rfq_id || 'RFQ-2026';
  const ctaUrl = params.cta_url || `${getPublicFrontendUrl()}/vendor/register?rfq=${encodeURIComponent(rfqId)}`;

  const subject = `New buyer enquiry for ${category}: quote by ${quoteDeadline}`;

  const text = `Hi ${firstName},

A verified buyer is looking for suppliers in ${category}, and Qua AI has matched your business to the requirement.

RFQ at a glance
Requirement: ${rfqTitle}
Buyer: ${buyerIndustry} company, ${buyerCity}
Line items: ${itemCount}
Delivery to: ${deliveryLocation}
Required by: ${requiredBy}
Quotes close: ${quoteDeadline}

To see the full specifications and submit your quotation:
1. Click the button below. Your account is already set up with this email.
2. Complete your company profile: name, GSTIN, product categories and contact details. It takes about 3 minutes.
3. Go to RFQs → Recent RFQs, open ${rfqId} and submit your quote.

[ Complete profile & quote now ]: ${ctaUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 18px 0; color: #334155;">
      A verified buyer is looking for suppliers in <strong>${escapeHtml(category)}</strong>, and Qua AI has matched your business to the requirement.
    </p>

    <!-- RFQ at a Glance Table -->
    <h3 style="margin: 20px 0 10px 0; font-size: 15px; color: #0f172a;">RFQ at a glance</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 22px; background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; width: 35%; color: #64748b;">Requirement</td>
        <td style="padding: 8px 14px; font-weight: 600; color: #0f172a;">${escapeHtml(rfqTitle)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Buyer</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(buyerIndustry)} company, ${escapeHtml(buyerCity)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Line items</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(itemCount)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Delivery to</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(deliveryLocation)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Required by</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(requiredBy)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Quotes close</td>
        <td style="padding: 8px 14px; color: #e11d48; font-weight: 700;">${escapeHtml(quoteDeadline)}</td>
      </tr>
    </table>

    <div style="margin: 20px 0;">
      <p style="font-size: 14px; font-weight: 600; margin: 0 0 10px 0; color: #0f172a;">To see the full specifications and submit your quotation:</p>
      <ol style="margin: 0; padding-left: 20px; font-size: 14px; color: #334155;">
        <li style="margin-bottom: 8px;">Click the button below. Your account is already set up with this email.</li>
        <li style="margin-bottom: 8px;">Complete your company profile: name, GSTIN, product categories and contact details. It takes about 3 minutes.</li>
        <li style="margin-bottom: 8px;">Go to RFQs → Recent RFQs, open <strong>${escapeHtml(rfqId)}</strong> and submit your quote.</li>
      </ol>
    </div>

    ${renderCtaButton('Complete profile & quote now', ctaUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 4 : New RFQ to quote
 * Who: Registered vendor
 * Trigger: A new RFQ matches the categories on a registered vendor's profile.
 */
function buildEmail4_NewRfqToQuote(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_4_NEW_RFQ_TO_QUOTE;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const quoteDeadline = params.quote_deadline || 'within 48 hours';
  const buyerIndustry = params.buyer_industry || 'Enterprise Buyer';
  const buyerCity = params.buyer_city || 'India';
  const itemCount = params.item_count !== undefined ? params.item_count : 1;
  const deliveryLocation = params.delivery_location || 'As specified in RFQ';
  const requiredBy = params.required_by || 'To be scheduled';
  const creditBalance = params.credit_balance !== undefined ? params.credit_balance : 5;
  const quoteUrl = params.quote_url || `${getPublicFrontendUrl()}/vendor/rfqs/${encodeURIComponent(rfqId)}`;

  const subject = `New RFQ ${rfqId}: ${rfqTitle}, quotes close ${quoteDeadline}`;

  const text = `Hi ${firstName},

A new RFQ matching your categories just came in. Buyers usually shortlist from the first few quotes, so submitting early improves your chances.

RFQ at a glance
RFQ ID: ${rfqId}
Requirement: ${rfqTitle}
Buyer: ${buyerIndustry} company, ${buyerCity}
Line items: ${itemCount}
Delivery to: ${deliveryLocation}
Required by: ${requiredBy}
Quotes close: ${quoteDeadline}

[ Submit my quote ]: ${quoteUrl}

Your credit balance: ${creditBalance} credits.

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 18px 0; color: #334155;">
      A new RFQ matching your categories just came in. Buyers usually shortlist from the first few quotes, so submitting early improves your chances.
    </p>

    <!-- RFQ at a Glance Table -->
    <h3 style="margin: 20px 0 10px 0; font-size: 15px; color: #0f172a;">RFQ at a glance</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 22px; background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; width: 35%; color: #64748b;">RFQ ID</td>
        <td style="padding: 8px 14px; font-weight: 700; color: #0284c7; font-family: monospace;">${escapeHtml(rfqId)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Requirement</td>
        <td style="padding: 8px 14px; font-weight: 600; color: #0f172a;">${escapeHtml(rfqTitle)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Buyer</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(buyerIndustry)} company, ${escapeHtml(buyerCity)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Line items</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(itemCount)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Delivery to</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(deliveryLocation)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Required by</td>
        <td style="padding: 8px 14px; color: #0f172a;">${escapeHtml(requiredBy)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 14px; font-weight: 600; color: #64748b;">Quotes close</td>
        <td style="padding: 8px 14px; color: #e11d48; font-weight: 700;">${escapeHtml(quoteDeadline)}</td>
      </tr>
    </table>

    ${renderCtaButton('Submit my quote', quoteUrl)}

    <div style="background-color: #f1f5f9; padding: 10px 16px; border-radius: 6px; font-size: 13px; color: #334155; text-align: center; margin: 18px 0;">
      Your credit balance: <strong>${escapeHtml(creditBalance)} credits</strong>.
    </div>
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 5 : Quotations ready to compare
 * Who: Buyer (registered or auto-created)
 * Trigger: First quotation received on an RFQ, then a final digest when the quote deadline passes.
 */
function buildEmail5_QuotationsReadyToCompare(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_5_QUOTATIONS_READY_TO_COMPARE;
  const firstName = resolveSalutation(params.first_name, 'there');
  const quoteCount = params.quote_count !== undefined ? params.quote_count : 3;
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const lowestPrice = params.lowest_price || '₹1,25,000';
  const fastestDelivery = params.fastest_delivery || '4 days';
  const compareUrl = params.compare_url || `${getPublicFrontendUrl()}/buyer/rfq-summary`;

  const subject = `${quoteCount} quotes in for RFQ ${rfqId}: compare now`;

  const text = `Hi ${firstName},

Good news. ${quoteCount} suppliers have quoted on ${rfqTitle}. The lowest landed price is ${lowestPrice}, and the fastest delivery is ${fastestDelivery}.

Qua AI has laid them out side by side: price, delivery, payment terms and supplier rating.

[ View & compare quotes ]: ${compareUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 18px 0; color: #334155;">
      Good news. <strong>${escapeHtml(quoteCount)} suppliers</strong> have quoted on <strong>${escapeHtml(rfqTitle)}</strong>. The lowest landed price is <strong><span style="color: #16a34a;">${escapeHtml(lowestPrice)}</span></strong>, and the fastest delivery is <strong>${escapeHtml(fastestDelivery)}</strong>.
    </p>

    <!-- Metrics Callout -->
    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #86efac; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 50%; border-right: 1px solid #bbf7d0; padding-right: 12px;">
            <div style="font-size: 12px; color: #166534; font-weight: 600; text-transform: uppercase;">Lowest Landed Price</div>
            <div style="font-size: 20px; font-weight: 700; color: #15803d; margin-top: 4px;">${escapeHtml(lowestPrice)}</div>
          </td>
          <td style="padding-left: 18px;">
            <div style="font-size: 12px; color: #166534; font-weight: 600; text-transform: uppercase;">Fastest Delivery</div>
            <div style="font-size: 20px; font-weight: 700; color: #15803d; margin-top: 4px;">${escapeHtml(fastestDelivery)}</div>
          </td>
        </tr>
      </table>
    </div>

    <p style="font-size: 14px; color: #475569; margin: 18px 0;">
      Qua AI has laid them out side by side: price, delivery, payment terms and supplier rating.
    </p>

    ${renderCtaButton('View & compare quotes', compareUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 6 : Activate your account
 * Who: Unregistered buyer (account auto-created in Email 1)
 * Trigger: No login 24 hours after Email 1; repeat once at 72 hours.
 */
function buildEmail6_ActivateYourAccount(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_6_ACTIVATE_YOUR_ACCOUNT;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'your requirement';
  const reviewUrl = params.review_url || `${getPublicFrontendUrl()}/login?redirect=/buyer/rfq-summary`;

  const subject = `Suppliers are waiting on RFQ ${rfqId}`;

  const text = `Hi ${firstName},

Your RFQ ${rfqTitle} is live, but your profile still has placeholder details. Suppliers quote faster and more accurately when they see the right company details.

It takes 2 minutes: log in, complete your profile, then check RFQ Summary.

[ Log in & review my RFQ ]: ${reviewUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      Your RFQ <strong>${escapeHtml(rfqTitle)}</strong> is live, but your profile still has placeholder details. Suppliers quote faster and more accurately when they see the right company details.
    </p>

    <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
      <p style="font-size: 14px; color: #92400e; margin: 0; line-height: 1.5;">
        <strong>Action Needed:</strong> It takes 2 minutes: log in, complete your profile, then check RFQ Summary.
      </p>
    </div>

    ${renderCtaButton('Log in & review my RFQ', reviewUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 7 : RFQ needs more information
 * Who: Buyer (registered or unregistered)
 * Trigger: Qua AI can't confirm a quantity, specification, delivery location or attachment.
 */
function buildEmail7_RfqNeedsMoreInformation(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_7_RFQ_NEEDS_MORE_INFORMATION;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const missingFields = Array.isArray(params.missing_fields) && params.missing_fields.length > 0
    ? params.missing_fields
    : [params.missing_field_1 || 'Line item quantity specification', params.missing_field_2 || 'Delivery pincode or site location'].filter(Boolean);
  const addDetailsUrl = params.add_details_url || `${getPublicFrontendUrl()}/buyer/rfq-summary`;

  const subject = `One detail needed to send RFQ ${rfqId} to suppliers`;

  const missingText = missingFields.map((f) => `• ${f}`).join('\n');

  const text = `Hi ${firstName},

We've structured most of your requirement, but couldn't confirm the following:
${missingText}

Add these and we'll send the RFQ to suppliers straight away. You can also simply reply to this email with the details.

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

[ Add missing details ]: ${addDetailsUrl}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const missingListHtml = missingFields.map((f) => `<li style="margin-bottom: 8px; font-weight: 600; color: #b91c1c;">${escapeHtml(f)}</li>`).join('');

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      We've structured most of your requirement, but couldn't confirm the following:
    </p>

    <!-- Missing fields box -->
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px 20px; margin: 18px 0;">
      <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
        ${missingListHtml}
      </ul>
    </div>

    <p style="font-size: 14px; color: #334155; margin: 16px 0;">
      Add these and we'll send the RFQ to suppliers straight away. You can also simply reply to this email with the details.
    </p>

    ${renderCtaButton('Add missing details', addDetailsUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 8 : No quotes yet
 * Who: Buyer
 * Trigger: Zero quotes received 48 hours before the quote deadline.
 */
function buildEmail8_NoQuotesYet(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_8_NO_QUOTES_YET;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'your RFQ';
  const extendUrl = params.extend_url || `${getPublicFrontendUrl()}/buyer/rfq-summary`;

  const subject = `RFQ ${rfqId}: let's get you more quotes`;

  const text = `Hi ${firstName},

Suppliers are still reviewing ${rfqTitle}, but no quotes have come in yet. Qua AI is following up with them now.

To widen the response, you can extend the deadline or let us invite more suppliers from the Procucev network.

[ Extend deadline / invite more suppliers ]: ${extendUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      Suppliers are still reviewing <strong>${escapeHtml(rfqTitle)}</strong>, but no quotes have come in yet. Qua AI is following up with them now.
    </p>
    <p style="font-size: 14px; margin: 0 0 20px 0; color: #475569;">
      To widen the response, you can extend the deadline or let us invite more suppliers from the Procucev network.
    </p>

    ${renderCtaButton('Extend deadline / invite more suppliers', extendUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 9 : Quote deadline reminder
 * Who: Vendor (registered or unregistered)
 * Trigger: 24 hours before the quote deadline, to vendors who haven't quoted.
 */
function buildEmail9_QuoteDeadlineReminder(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_9_QUOTE_DEADLINE_REMINDER;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const quoteDeadline = params.quote_deadline || 'Tomorrow at 18:00 IST';
  const quoteCount = params.quote_count !== undefined ? params.quote_count : 2;
  const quoteUrl = params.quote_url || `${getPublicFrontendUrl()}/vendor/rfqs/${encodeURIComponent(rfqId)}`;

  const subject = `24 hours left to quote on ${rfqTitle}`;

  const text = `Hi ${firstName},

RFQ ${rfqId} closes on ${quoteDeadline}. ${quoteCount} suppliers have already quoted. Submit yours to stay in the running.

[ Submit my quote ]: ${quoteUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      RFQ <strong>${escapeHtml(rfqId)}</strong> closes on <strong><span style="color: #e11d48;">${escapeHtml(quoteDeadline)}</span></strong>. <strong>${escapeHtml(quoteCount)} suppliers</strong> have already quoted. Submit yours to stay in the running.
    </p>

    ${renderCtaButton('Submit my quote', quoteUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 10 : Low or zero credits
 * Who: Registered vendor
 * Trigger: Credit balance falls below 2, or vendor tries to open RFQ with zero credits.
 */
function buildEmail10_LowOrZeroCredits(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_10_LOW_OR_ZERO_CREDITS;
  const firstName = resolveSalutation(params.first_name, 'there');
  const creditBalance = params.credit_balance !== undefined ? params.credit_balance : 0;
  const matchedRfqCount = params.matched_rfq_count !== undefined ? params.matched_rfq_count : 14;
  const buyCreditsUrl = params.buy_credits_url || `${getPublicFrontendUrl()}/vendor/subscription`;

  const subject = `You have ${creditBalance} credits left: don't miss the next RFQ`;

  const text = `Hi ${firstName},

Your Qua AI credit balance is down to ${creditBalance}. In the last 30 days, ${matchedRfqCount} RFQs matched your categories. Without credits, you can't open new RFQs or quote on them.

A package of 50 credits costs ₹7,500 (₹150 per RFQ).

[ Buy 50 credits ] → ${buyCreditsUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      Your Qua AI credit balance is down to <strong><span style="color: #e11d48;">${escapeHtml(creditBalance)}</span></strong>. In the last 30 days, <strong>${escapeHtml(matchedRfqCount)} RFQs</strong> matched your categories. Without credits, you can't open new RFQs or quote on them.
    </p>

    <!-- Pricing Box -->
    <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; margin: 20px 0; text-align: center;">
      <div style="font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase;">Standard Credit Pack</div>
      <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 6px 0;">50 Credits · ₹7,500</div>
      <div style="font-size: 12px; color: #16a34a; font-weight: 600;">(Only ₹150 per RFQ bid)</div>
    </div>

    ${renderCtaButton('Buy 50 credits', buyCreditsUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 11 : Quote submitted
 * Who: Vendor
 * Trigger: Vendor submits a quotation on an RFQ.
 */
function buildEmail11_QuoteSubmitted(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_11_QUOTE_SUBMITTED;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const quoteValue = params.quote_value || '₹1,50,000';
  const quoteDeadline = params.quote_deadline || '2026-11-15 18:00 IST';
  const viewQuoteUrl = params.view_quote_url || `${getPublicFrontendUrl()}/vendor/rfqs/${encodeURIComponent(rfqId)}`;

  const subject = `Your quote for RFQ ${rfqId} has been received`;

  const text = `Hi ${firstName},

Thank you. Your quote of ${quoteValue} for ${rfqTitle} has reached the buyer.

The buyer will review all quotes after ${quoteDeadline}. You can revise your quote any time before then.

[ View my quote ]: ${viewQuoteUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      Thank you. Your quote of <strong><span style="color: #16a34a;">${escapeHtml(quoteValue)}</span></strong> for <strong>${escapeHtml(rfqTitle)}</strong> has reached the buyer.
    </p>
    <p style="font-size: 14px; margin: 0 0 20px 0; color: #475569;">
      The buyer will review all quotes after <strong>${escapeHtml(quoteDeadline)}</strong>. You can revise your quote any time before then.
    </p>

    ${renderCtaButton('View my quote', viewQuoteUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 12 : RFQ revised / buyer question
 * Who: Vendor (notified on or quoted on the RFQ)
 * Trigger: Buyer edits the RFQ or posts a clarification question.
 */
function buildEmail12_RfqRevisedBuyerQuestion(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_12_RFQ_REVISED_BUYER_QUESTION;
  const firstName = resolveSalutation(params.first_name, 'there');
  const rfqId = params.rfq_id || 'RFQ-2026';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const changeSummary = params.change_summary || 'Quantity updated from 100 to 150 units, and technical specification sheet v2 attached.';
  const quoteDeadline = params.quote_deadline || '2026-11-20 18:00 IST';
  const reviewChangesUrl = params.review_changes_url || `${getPublicFrontendUrl()}/vendor/rfqs/${encodeURIComponent(rfqId)}`;

  const subject = `Update on RFQ ${rfqId}: please review`;

  const text = `Hi ${firstName},

The buyer has updated ${rfqTitle}:
${changeSummary}

If you've already quoted, please check whether your quote still applies and revise it if needed. The deadline is now ${quoteDeadline}.

[ Review changes ]: ${reviewChangesUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 14px 0; color: #334155;">
      The buyer has updated <strong>${escapeHtml(rfqTitle)}</strong>:
    </p>

    <!-- Change Summary Box -->
    <div style="background-color: #f1f5f9; border-left: 4px solid #0284c7; padding: 14px 18px; margin: 16px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 14px; color: #0f172a; font-weight: 500;">
        ${escapeHtml(changeSummary)}
      </p>
    </div>

    <p style="font-size: 14px; margin: 16px 0; color: #475569;">
      If you've already quoted, please check whether your quote still applies and revise it if needed. The deadline is now <strong><span style="color: #e11d48;">${escapeHtml(quoteDeadline)}</span></strong>.
    </p>

    ${renderCtaButton('Review changes', reviewChangesUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

/**
 * Email 13 : Complete your profile
 * Who: Unregistered vendor (received Email 3)
 * Trigger: Profile not completed 48 hours after Email 3.
 */
function buildEmail13_CompleteYourProfile(params = {}) {
  const meta = QUA_AI_EMAIL_TEMPLATES.EMAIL_13_COMPLETE_YOUR_PROFILE;
  const firstName = resolveSalutation(params.first_name, 'there');
  const category = params.category || 'Industrial Supplies';
  const quoteDeadline = params.quote_deadline || 'within 24 hours';
  const buyerCity = params.buyer_city || 'India';
  const rfqTitle = params.rfq_title || 'Procurement Requirement';
  const completeProfileUrl = params.complete_profile_url || `${getPublicFrontendUrl()}/vendor/profile`;

  const subject = `Your RFQ for ${category} closes ${quoteDeadline}`;

  const text = `Hi ${firstName},

A buyer in ${buyerCity} is still waiting for quotes on ${rfqTitle}. Finish your profile in 3 minutes to see the full specifications and submit your quote.

[ Complete profile & quote ]: ${completeProfileUrl}

For any further questions or clarifications, please reach out to ${QUA_AI_EMAIL_SUPPORT.PHONE}/email to ${QUA_AI_EMAIL_SUPPORT.EMAIL}

${QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE}
${QUA_AI_EMAIL_SUPPORT.COMPANY_NAME}`;

  const innerHtml = `
    <p style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">
      Hi <strong>${escapeHtml(firstName)}</strong>,
    </p>
    <p style="font-size: 15px; margin: 0 0 16px 0; color: #334155;">
      A buyer in <strong>${escapeHtml(buyerCity)}</strong> is still waiting for quotes on <strong>${escapeHtml(rfqTitle)}</strong>. Finish your profile in 3 minutes to see the full specifications and submit your quote.
    </p>

    ${renderCtaButton('Complete profile & quote', completeProfileUrl)}
  `;

  return {
    templateId: meta.id,
    templateNumber: meta.number,
    name: meta.name,
    who: meta.who,
    trigger: meta.trigger,
    subject,
    text,
    html: wrapQuaAiEmail({ title: subject, innerHtml }),
  };
}

// Map template identifiers to builder functions
const TEMPLATE_REGISTRY = {
  EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED: buildEmail1_RfqCreatedAccountAutoCreated,
  EMAIL_2_RFQ_CREATED: buildEmail2_RfqCreated,
  EMAIL_3_NEW_RFQ_INTIMATION: buildEmail3_NewRfqIntimation,
  EMAIL_4_NEW_RFQ_TO_QUOTE: buildEmail4_NewRfqToQuote,
  EMAIL_5_QUOTATIONS_READY_TO_COMPARE: buildEmail5_QuotationsReadyToCompare,
  EMAIL_6_ACTIVATE_YOUR_ACCOUNT: buildEmail6_ActivateYourAccount,
  EMAIL_7_RFQ_NEEDS_MORE_INFORMATION: buildEmail7_RfqNeedsMoreInformation,
  EMAIL_8_NO_QUOTES_YET: buildEmail8_NoQuotesYet,
  EMAIL_9_QUOTE_DEADLINE_REMINDER: buildEmail9_QuoteDeadlineReminder,
  EMAIL_10_LOW_OR_ZERO_CREDITS: buildEmail10_LowOrZeroCredits,
  EMAIL_11_QUOTE_SUBMITTED: buildEmail11_QuoteSubmitted,
  EMAIL_12_RFQ_REVISED_BUYER_QUESTION: buildEmail12_RfqRevisedBuyerQuestion,
  EMAIL_13_COMPLETE_YOUR_PROFILE: buildEmail13_CompleteYourProfile,
};

// Aliases mapping (e.g. 1, 'email_1', 'rfq_created', etc.)
const TEMPLATE_ALIASES = {
  1: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
  '1': 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
  email_1: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
  rfq_created_account_auto_created: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',

  2: 'EMAIL_2_RFQ_CREATED',
  '2': 'EMAIL_2_RFQ_CREATED',
  email_2: 'EMAIL_2_RFQ_CREATED',
  rfq_created: 'EMAIL_2_RFQ_CREATED',

  3: 'EMAIL_3_NEW_RFQ_INTIMATION',
  '3': 'EMAIL_3_NEW_RFQ_INTIMATION',
  email_3: 'EMAIL_3_NEW_RFQ_INTIMATION',
  new_rfq_intimation: 'EMAIL_3_NEW_RFQ_INTIMATION',

  4: 'EMAIL_4_NEW_RFQ_TO_QUOTE',
  '4': 'EMAIL_4_NEW_RFQ_TO_QUOTE',
  email_4: 'EMAIL_4_NEW_RFQ_TO_QUOTE',
  new_rfq_to_quote: 'EMAIL_4_NEW_RFQ_TO_QUOTE',

  5: 'EMAIL_5_QUOTATIONS_READY_TO_COMPARE',
  '5': 'EMAIL_5_QUOTATIONS_READY_TO_COMPARE',
  email_5: 'EMAIL_5_QUOTATIONS_READY_TO_COMPARE',
  quotations_ready_to_compare: 'EMAIL_5_QUOTATIONS_READY_TO_COMPARE',

  6: 'EMAIL_6_ACTIVATE_YOUR_ACCOUNT',
  '6': 'EMAIL_6_ACTIVATE_YOUR_ACCOUNT',
  email_6: 'EMAIL_6_ACTIVATE_YOUR_ACCOUNT',
  activate_your_account: 'EMAIL_6_ACTIVATE_YOUR_ACCOUNT',

  7: 'EMAIL_7_RFQ_NEEDS_MORE_INFORMATION',
  '7': 'EMAIL_7_RFQ_NEEDS_MORE_INFORMATION',
  email_7: 'EMAIL_7_RFQ_NEEDS_MORE_INFORMATION',
  rfq_needs_more_information: 'EMAIL_7_RFQ_NEEDS_MORE_INFORMATION',

  8: 'EMAIL_8_NO_QUOTES_YET',
  '8': 'EMAIL_8_NO_QUOTES_YET',
  email_8: 'EMAIL_8_NO_QUOTES_YET',
  no_quotes_yet: 'EMAIL_8_NO_QUOTES_YET',

  9: 'EMAIL_9_QUOTE_DEADLINE_REMINDER',
  '9': 'EMAIL_9_QUOTE_DEADLINE_REMINDER',
  email_9: 'EMAIL_9_QUOTE_DEADLINE_REMINDER',
  quote_deadline_reminder: 'EMAIL_9_QUOTE_DEADLINE_REMINDER',

  10: 'EMAIL_10_LOW_OR_ZERO_CREDITS',
  '10': 'EMAIL_10_LOW_OR_ZERO_CREDITS',
  email_10: 'EMAIL_10_LOW_OR_ZERO_CREDITS',
  low_or_zero_credits: 'EMAIL_10_LOW_OR_ZERO_CREDITS',

  11: 'EMAIL_11_QUOTE_SUBMITTED',
  '11': 'EMAIL_11_QUOTE_SUBMITTED',
  email_11: 'EMAIL_11_QUOTE_SUBMITTED',
  quote_submitted: 'EMAIL_11_QUOTE_SUBMITTED',

  12: 'EMAIL_12_RFQ_REVISED_BUYER_QUESTION',
  '12': 'EMAIL_12_RFQ_REVISED_BUYER_QUESTION',
  email_12: 'EMAIL_12_RFQ_REVISED_BUYER_QUESTION',
  rfq_revised_buyer_question: 'EMAIL_12_RFQ_REVISED_BUYER_QUESTION',

  13: 'EMAIL_13_COMPLETE_YOUR_PROFILE',
  '13': 'EMAIL_13_COMPLETE_YOUR_PROFILE',
  email_13: 'EMAIL_13_COMPLETE_YOUR_PROFILE',
  complete_your_profile: 'EMAIL_13_COMPLETE_YOUR_PROFILE',
};

/**
 * Resolves a template key or identifier to its canonical enum key.
 */
function resolveTemplateKey(identifier) {
  if (!identifier) return null;
  const str = String(identifier).trim();
  if (TEMPLATE_REGISTRY[str]) return str;
  const upper = str.toUpperCase();
  if (TEMPLATE_REGISTRY[upper]) return upper;
  const lower = str.toLowerCase();
  if (TEMPLATE_ALIASES[lower]) return TEMPLATE_ALIASES[lower];
  if (TEMPLATE_ALIASES[str]) return TEMPLATE_ALIASES[str];
  return null;
}

/**
 * Main dispatcher to render any of the 13 Transactional Email Templates.
 */
function renderTransactionalEmail(identifier, params = {}) {
  const canonicalKey = resolveTemplateKey(identifier);
  if (!canonicalKey || !TEMPLATE_REGISTRY[canonicalKey]) {
    throw new Error(`Unknown Transactional Email Template: '${identifier}'. Valid options: 1-13 or ${Object.keys(TEMPLATE_REGISTRY).join(', ')}`);
  }
  const builder = TEMPLATE_REGISTRY[canonicalKey];
  return builder(params);
}

/**
 * Returns metadata and sample parameters for all 13 Qua AI Transactional Email Templates.
 */
function getAllTransactionalEmailTemplates() {
  return Object.keys(QUA_AI_EMAIL_TEMPLATES).map((key) => {
    const meta = QUA_AI_EMAIL_TEMPLATES[key];
    return {
      templateId: meta.id,
      number: meta.number,
      name: meta.name,
      who: meta.who,
      trigger: meta.trigger,
      subjectPattern: meta.subject,
    };
  });
}

/**
 * Delivers a transactional email via mailerService.
 */
async function sendTransactionalEmail(identifier, recipientEmail, params = {}, options = {}) {
  const mailerService = require('./mailerService');
  const rendered = renderTransactionalEmail(identifier, params);

  const message = {
    to: recipientEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };

  // Determine channel (buyer vs vendor)
  const isVendorTarget = String(rendered.who).toLowerCase().includes('vendor') || String(rendered.who).toLowerCase().includes('supplier');
  if (isVendorTarget) {
    message.from = mailerService.vendorFromAddress();
    return mailerService.deliverVendor(message, `Transactional Email: ${rendered.name}`, options);
  } else {
    message.from = mailerService.fromAddress();
    return mailerService.deliver(message, `Transactional Email: ${rendered.name}`, options);
  }
}

module.exports = {
  escapeHtml,
  resolveSalutation,
  wrapQuaAiEmail,
  renderCtaButton,
  buildEmail1_RfqCreatedAccountAutoCreated,
  buildEmail2_RfqCreated,
  buildEmail3_NewRfqIntimation,
  buildEmail4_NewRfqToQuote,
  buildEmail5_QuotationsReadyToCompare,
  buildEmail6_ActivateYourAccount,
  buildEmail7_RfqNeedsMoreInformation,
  buildEmail8_NoQuotesYet,
  buildEmail9_QuoteDeadlineReminder,
  buildEmail10_LowOrZeroCredits,
  buildEmail11_QuoteSubmitted,
  buildEmail12_RfqRevisedBuyerQuestion,
  buildEmail13_CompleteYourProfile,
  renderTransactionalEmail,
  getAllTransactionalEmailTemplates,
  sendTransactionalEmail,
  resolveTemplateKey,
  getPublicFrontendUrl,
  getLogoUrl,
  TEMPLATE_REGISTRY,
  TEMPLATE_ALIASES,
};

