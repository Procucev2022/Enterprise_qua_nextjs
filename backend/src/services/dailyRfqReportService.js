/**
 * Enterprise Qua AI: Daily RFQ Inflow & Sourcing Mode Report Service
 *
 * Compiles and sends daily reports summarizing:
 *   - Total RFQs received on a specific date (defaulting to yesterday)
 *   - Sourcing Mode classification (Mode 0, Mode 1, Mode 2, Mode 3)
 *   - Ingestion Channel classification (Web Portal, Email Gateway, Manual Entry, etc.)
 *   - Itemized RFQ numbers, requirements, categories, buyer accounts, and timestamps
 *
 * Dispatches automatically at 06:00 AM IST daily to the recipients in DAILY_RFQ_REPORT_EMAILS.
 * Nothing is sent when no recipient is configured.
 */

const storeService = require('./storeService');
const mailerService = require('./mailerService');
const eventOutboxService = require('./eventOutboxService');
const pool = require('../db/pool');
const { logger } = require('./loggerService');
const {
  DAILY_RFQ_REPORT_CONFIG,
  EVENT_OUTBOX_TYPES,
  RFQ_MODE_LABELS,
  RFQ_MODES,
} = require('../config/constants');

const LOG_CATEGORY = 'DAILY_RFQ_REPORT';

const runtimeState = {
  timer: null,
  lastHandledDateStr: null,
};

/**
 * Returns date and time components in the target timezone.
 * Uses en-CA locale for ISO-style YYYY-MM-DD formatting.
 */
// Messages and labels stay in this module until they move to backend/src/config/constants.js.
const DAILY_REPORT_MESSAGES = Object.freeze({
  NOT_SPECIFIED: 'Not specified',
  NO_RECIPIENTS: 'No recipients are configured. Set DAILY_RFQ_REPORT_EMAILS to a comma-separated list of addresses, then retry.',
});

function getTzDateParts(date = new Date(), timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE) {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const safeTz = timezone || DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const formatted = formatter.format(safeDate);
  const [datePart, timePart = '00:00:00'] = formatted.split(', ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);

  return { year, month, day, hour, minute, second, dateStr: datePart };
}

/**
 * Determines the calendar date string (YYYY-MM-DD) for "yesterday" in the target timezone.
 */
function getYesterdayDateStr(referenceDate = new Date(), timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE) {
  const parts = getTzDateParts(referenceDate, timezone);
  const ref = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  ref.setUTCDate(ref.getUTCDate() - 1);

  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ref.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converts a createdAt timestamp into the local date string (YYYY-MM-DD).
 */
function getRfqDateStr(createdAt, timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  const safeTz = timezone || DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/**
 * Formats a timestamp into a human-readable local time (e.g. 14:30:15 IST).
 */
function formatRfqTime(createdAt, timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE) {
  if (!createdAt) return '-';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '-';
  const safeTz = timezone || DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE;

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Formats a YYYY-MM-DD string into a friendly date header.
 */
function formatDateLabel(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return String(dateStr || '');
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(dateObj);
}

/**
 * Resolves the recipient list from the explicit override or DAILY_RFQ_REPORT_EMAILS only.
 * Returns an empty list when neither provides an address, so no report is sent.
 */
function resolveRecipients(overrideRecipients) {
  if (Array.isArray(overrideRecipients) && overrideRecipients.length > 0) {
    const list = overrideRecipients.map((e) => String(e || '').trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  if (typeof overrideRecipients === 'string' && overrideRecipients.trim()) {
    const list = overrideRecipients.split(',').map((e) => e.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }

  // An unset or blank DAILY_RFQ_REPORT_EMAILS yields [], so the report is not sent.
  return (process.env.DAILY_RFQ_REPORT_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Fetches and aggregates RFQ inflow data for a target date.
 */
async function getDailyRfqReportData({
  targetDate = null,
  fromDate = null,
  toDate = null,
  timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE,
} = {}) {
  const safeTz = timezone || DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE;
  const reportDateStr = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate).trim())
    ? String(targetDate).trim()
    : getYesterdayDateStr(new Date(), safeTz);

  // Sync latest RFQs from database / store
  if (typeof storeService.syncRFQsFromDB === 'function') {
    await storeService.syncRFQsFromDB().catch((err) => {
      logger.warn('Failed to sync RFQs before daily report generation', { error: err.message }, LOG_CATEGORY);
    });
  }

  const allRfqs = Array.isArray(storeService.getRFQs()) ? storeService.getRFQs() : [];

  const matchedRfqs = allRfqs.filter((rfq) => {
    if (!rfq || !rfq.createdAt) return false;
    if (fromDate && toDate) {
      const d = new Date(rfq.createdAt);
      return !isNaN(d.getTime()) && d >= fromDate && d <= toDate;
    }
    const rfqDate = getRfqDateStr(rfq.createdAt, safeTz);
    return rfqDate === reportDateStr;
  });

  // Sort chronologically (oldest to newest for the day)
  matchedRfqs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Aggregate by sourcing mode
  const bySourcingMode = {
    [RFQ_MODES.MODE_0]: 0,
    [RFQ_MODES.MODE_1]: 0,
    [RFQ_MODES.MODE_2]: 0,
    [RFQ_MODES.MODE_3]: 0,
  };

  // Aggregate by ingestion channel
  const bySource = {
    web_portal: 0,
    email_gateway: 0,
    manual_entry: 0,
    email_upload: 0,
    ai_extraction: 0,
  };

  const byCategory = {};

  const mappedRfqs = matchedRfqs.map((rfq, idx) => {
    const rawMode = rfq.sourcingMode || RFQ_MODES.MODE_0;
    const modeKey = bySourcingMode[rawMode] !== undefined ? rawMode : RFQ_MODES.MODE_0;
    bySourcingMode[modeKey] = (bySourcingMode[modeKey] || 0) + 1;

    const rawSource = rfq.source || 'web_portal';
    const sourceKey = bySource[rawSource] !== undefined ? rawSource : 'web_portal';
    bySource[sourceKey] = (bySource[sourceKey] || 0) + 1;

    const category = rfq.category || DAILY_REPORT_MESSAGES.NOT_SPECIFIED;
    byCategory[category] = (byCategory[category] || 0) + 1;

    const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];

    return {
      index: idx + 1,
      id: rfq.id || '',
      rfqNumber: rfq.rfqNumber || rfq.id || DAILY_REPORT_MESSAGES.NOT_SPECIFIED,
      title: rfq.title || DAILY_REPORT_MESSAGES.NOT_SPECIFIED,
      sourcingMode: rawMode,
      sourcingModeLabel: RFQ_MODE_LABELS[rawMode] || rawMode,
      source: rawSource,
      sourceLabel: DAILY_RFQ_REPORT_CONFIG.INGESTION_CHANNEL_LABELS[rawSource] || rawSource,
      category,
      buyerAccountName: rfq.buyerAccountName || rfq.buyerName || DAILY_REPORT_MESSAGES.NOT_SPECIFIED,
      deliveryLocation: rfq.deliveryLocation || DAILY_REPORT_MESSAGES.NOT_SPECIFIED,
      status: rfq.status || DAILY_REPORT_MESSAGES.NOT_SPECIFIED,
      budget: rfq.budget ? `₹${Number(rfq.budget).toLocaleString('en-IN')}` : 'Unstated',
      quotesCount: quotes.length || rfq.quotesCount || 0,
      createdAt: rfq.createdAt,
      createdAtFormatted: formatRfqTime(rfq.createdAt, safeTz),
    };
  });

  return {
    reportDate: reportDateStr,
    reportDateFormatted: formatDateLabel(reportDateStr),
    timezone: safeTz,
    summary: {
      totalRFQs: mappedRfqs.length,
      bySourcingMode,
      bySource,
      byCategory,
    },
    rfqs: mappedRfqs,
  };
}

/**
 * Builds a styled, modern responsive HTML email body.
 */
function buildDailyRfqEmailHtml({ reportDateFormatted, reportDate, summary, rfqs, recipients }) {
  const frontendUrl = mailerService.getPublicFrontendUrl ? mailerService.getPublicFrontendUrl() : 'https://equa.procucev.com';
  const logoUrl = mailerService.getLogoUrl ? mailerService.getLogoUrl() : `${frontendUrl}/procucev-logo.png`;

  const total = summary.totalRFQs;
  const modes = summary.bySourcingMode || {};
  const sources = summary.bySource || {};

  const modeBadges = [
    { label: 'Mode 0 (Starter Trial)', count: modes[RFQ_MODES.MODE_0] || 0, color: '#f59e0b', bg: '#fef3c7' },
    { label: 'Mode 1 (Client Roster)', count: modes[RFQ_MODES.MODE_1] || 0, color: '#2563eb', bg: '#dbeafe' },
    { label: 'Mode 2 (Hybrid)', count: modes[RFQ_MODES.MODE_2] || 0, color: '#059669', bg: '#d1fae5' },
    { label: 'Mode 3 (AI Autonomous)', count: modes[RFQ_MODES.MODE_3] || 0, color: '#7c3aed', bg: '#ede9fe' },
  ];

  const sourcePills = Object.entries(DAILY_RFQ_REPORT_CONFIG.INGESTION_CHANNEL_LABELS).map(([key, label]) => {
    return { label, count: sources[key] || 0 };
  });

  const rowsHtml = rfqs.length > 0
    ? rfqs
        .map(
          (r) => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
          <td style="padding: 10px 12px; font-weight: bold; text-align: center; color: #64748b;">${r.index}</td>
          <td style="padding: 10px 12px; font-weight: bold; color: #0284c7; font-family: monospace;">${r.rfqNumber}</td>
          <td style="padding: 10px 12px; color: #1e293b; max-width: 220px; word-break: break-word;">${r.title}</td>
          <td style="padding: 10px 12px; text-align: center;">
            <span style="display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;">
              ${r.sourcingModeLabel}
            </span>
          </td>
          <td style="padding: 10px 12px; text-align: center;">
            <span style="display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">
              ${r.sourceLabel}
            </span>
          </td>
          <td style="padding: 10px 12px; color: #334155;">${r.category}</td>
          <td style="padding: 10px 12px; color: #334155;">${r.buyerAccountName}</td>
          <td style="padding: 10px 12px; text-align: center; color: #64748b; font-size: 12px;">${r.createdAtFormatted}</td>
          <td style="padding: 10px 12px; text-align: center;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; background: #fef9c3; color: #854d0e;">
              ${r.status}
            </span>
          </td>
        </tr>`
        )
        .join('')
    : `
      <tr>
        <td colspan="9" style="padding: 32px 16px; text-align: center; color: #64748b; background: #f8fafc;">
          <p style="margin: 0; font-size: 14px; font-weight: 600; color: #475569;">No new RFQs arrived yesterday (${reportDate}).</p>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">All ingestion channels were active. Total inbound count: 0.</p>
        </td>
      </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Daily RFQ Inflow Report - ${reportDate}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif; color: #1e293b;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f1f5f9; padding: 20px 10px;">
    <tr>
      <td align="center">
        <div style="max-width: 900px; width: 100%; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); border: 1px solid #e2e8f0;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 24px 28px; color: #ffffff;">
            <div style="margin-bottom: 12px;">
              <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                <img src="${logoUrl}" alt="Procucev Enterprise" height="36" style="height: 36px; max-height: 40px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
              </a>
            </div>
            <h1 style="margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 0.5px;">PROCUCEV ENTERPRISE PROCUREMENT</h1>
            <p style="margin: 4px 0 0 0; opacity: 0.85; font-size: 14px;">Daily RFQ Inflow & Sourcing Mode Intelligence</p>
          </div>

          <!-- Metadata Banner -->
          <div style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 14px 28px; font-size: 13px; color: #475569;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left">
                  <strong>Reporting Window:</strong> Yesterday, ${reportDateFormatted} (00:00 - 23:59 IST)
                </td>
                <td align="right">
                  <strong>Recipient:</strong> ${recipients.join(', ')}
                </td>
              </tr>
            </table>
          </div>

          <!-- Content Body -->
          <div style="padding: 24px 28px;">
            
            <!-- Summary KPI Cards -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
              <tr>
                <!-- Total Inflow Card -->
                <td width="26%" valign="top" style="padding-right: 12px;">
                  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; text-align: center;">
                    <span style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #1e40af; letter-spacing: 0.5px;">Yesterday's RFQs</span>
                    <div style="font-size: 32px; font-weight: 800; color: #1d4ed8; margin: 8px 0 4px 0;">${total}</div>
                    <span style="font-size: 11px; color: #60a5fa;">Total Inbound Requisitions</span>
                  </div>
                </td>

                <!-- Sourcing Mode Breakdown -->
                <td width="37%" valign="top" style="padding: 0 6px;">
                  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px;">
                    <span style="font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; display: block; margin-bottom: 10px;">By Sourcing Mode</span>
                    ${modeBadges
                      .map(
                        (b) => `
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span style="color: #334155; font-weight: 500;">${b.label}</span>
                        <span style="font-weight: 700; color: ${b.color}; background: ${b.bg}; padding: 1px 7px; border-radius: 4px;">${b.count}</span>
                      </div>`
                      )
                      .join('')}
                  </div>
                </td>

                <!-- Ingestion Channel Breakdown -->
                <td width="37%" valign="top" style="padding-left: 12px;">
                  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px;">
                    <span style="font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; display: block; margin-bottom: 10px;">By Ingestion Channel</span>
                    ${sourcePills
                      .map(
                        (p) => `
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;">
                        <span style="color: #334155; font-weight: 500;">${p.label}</span>
                        <span style="font-weight: 700; color: #0f172a; background: #f1f5f9; padding: 1px 7px; border-radius: 4px;">${p.count}</span>
                      </div>`
                      )
                      .join('')}
                  </div>
                </td>
              </tr>
            </table>

            <!-- Itemized RFQ Table Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h3 style="margin: 0; font-size: 15px; color: #0f172a;">Itemized Requisition Manifest (${total} Records)</h3>
              <span style="font-size: 12px; color: #64748b;">Generated at 06:00 IST</span>
            </div>

            <!-- Table -->
            <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; text-align: left;">
                <thead>
                  <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
                    <th style="padding: 10px 12px; text-align: center;">#</th>
                    <th style="padding: 10px 12px;">RFQ Number</th>
                    <th style="padding: 10px 12px;">Requirement</th>
                    <th style="padding: 10px 12px; text-align: center;">Sourcing Mode</th>
                    <th style="padding: 10px 12px; text-align: center;">Ingestion Channel</th>
                    <th style="padding: 10px 12px;">Category</th>
                    <th style="padding: 10px 12px;">Buyer Account</th>
                    <th style="padding: 10px 12px; text-align: center;">Time (IST)</th>
                    <th style="padding: 10px 12px; text-align: center;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 28px 0 16px 0;">
              <a href="${frontendUrl}/category-manager/daily-reports" style="background: #0284c7; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 13px; display: inline-block;">
                Open Category Manager Reports &amp; Download Excel (.xlsx)
              </a>
            </div>

          </div>

          <!-- Footer -->
          <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 28px; text-align: center; font-size: 11px; color: #94a3b8;">
            <p style="margin: 0 0 4px 0;">Procucev Enterprise Solutions | Autonomous SCM &amp; Category Governance Intelligence</p>
            <p style="margin: 0;">Automated Daily Dispatch Schedule (06:00 IST) | Confidential Internal Category Report</p>
          </div>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Builds a clean plain-text fallback for non-HTML mail user agents.
 */
function buildDailyRfqEmailText({ reportDateFormatted, reportDate, summary, rfqs, recipients }) {
  const lines = [
    '================================================================================',
    '       PROCUCEV ENTERPRISE PROCUREMENT - DAILY RFQ INFLOW & SOURCING REPORT     ',
    '================================================================================',
    `Reporting Window: Yesterday, ${reportDateFormatted} (${reportDate}) (00:00 - 23:59 IST)`,
    `Delivered to:     ${recipients.join(', ')}`,
    '',
    '1. SUMMARY METRICS',
    '------------------',
    `Total RFQs Received Yesterday: ${summary.totalRFQs}`,
    '',
    'By Sourcing Mode:',
    `  - Mode 0 (Starter Trial):     ${summary.bySourcingMode?.[RFQ_MODES.MODE_0] || 0}`,
    `  - Mode 1 (Client Roster):      ${summary.bySourcingMode?.[RFQ_MODES.MODE_1] || 0}`,
    `  - Mode 2 (Hybrid):             ${summary.bySourcingMode?.[RFQ_MODES.MODE_2] || 0}`,
    `  - Mode 3 (AI Autonomous):      ${summary.bySourcingMode?.[RFQ_MODES.MODE_3] || 0}`,
    '',
    'By Ingestion Channel:',
    `  - Web Portal:                  ${summary.bySource?.web_portal || 0}`,
    `  - Email Gateway:               ${summary.bySource?.email_gateway || 0}`,
    `  - Manual Entry:                ${summary.bySource?.manual_entry || 0}`,
    `  - Email Upload:                ${summary.bySource?.email_upload || 0}`,
    `  - AI Extraction:               ${summary.bySource?.ai_extraction || 0}`,
    '',
    '2. ITEMIZED REQUISITIONS',
    '-----------------------',
  ];

  if (rfqs.length === 0) {
    lines.push(`No RFQs were ingested yesterday (${reportDate}).`);
  } else {
    rfqs.forEach((r) => {
      lines.push(
        `${r.index}. [${r.rfqNumber}] ${r.title} | Mode: ${r.sourcingModeLabel} | Channel: ${r.sourceLabel} | Category: ${r.category} | Buyer: ${r.buyerAccountName} | Time: ${r.createdAtFormatted} IST`
      );
    });
  }

  lines.push('', '---', 'Procucev Enterprise Solutions | Automated Daily Report at 06:00 IST');
  return lines.join('\n');
}

/**
 * Compiles the report and dispatches the daily email.
 */
async function sendDailyRfqReport(options = {}) {
  const {
    date = null,
    recipients = null,
    dryRun = false,
    timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE,
  } = options;

  const resolvedRecipients = resolveRecipients(recipients);
  if (!dryRun && resolvedRecipients.length === 0) {
    logger.warn('Daily RFQ report not sent: no recipients configured', {}, LOG_CATEGORY);
    return { sent: false, success: false, status: 'not_configured', reason: DAILY_REPORT_MESSAGES.NO_RECIPIENTS };
  }
  const data = await getDailyRfqReportData({ targetDate: date, timezone });

  const subject = `[Procucev Daily Report] RFQ Summary for Yesterday (${data.reportDate}) - ${data.summary.totalRFQs} RFQ${data.summary.totalRFQs === 1 ? '' : 's'}`;
  const html = buildDailyRfqEmailHtml({
    reportDateFormatted: data.reportDateFormatted,
    reportDate: data.reportDate,
    summary: data.summary,
    rfqs: data.rfqs,
    recipients: resolvedRecipients,
  });
  const text = buildDailyRfqEmailText({
    reportDateFormatted: data.reportDateFormatted,
    reportDate: data.reportDate,
    summary: data.summary,
    rfqs: data.rfqs,
    recipients: resolvedRecipients,
  });

  if (dryRun) {
    logger.info('Daily RFQ report dry-run generated (not sent)', {
      reportDate: data.reportDate,
      totalRFQs: data.summary.totalRFQs,
      recipients: resolvedRecipients,
    }, LOG_CATEGORY);

    return {
      success: true,
      dryRun: true,
      reportDate: data.reportDate,
      totalRFQs: data.summary.totalRFQs,
      summary: data.summary,
      recipients: resolvedRecipients,
      subject,
    };
  }

  const fromAddress = mailerService.fromAddress
    ? mailerService.fromAddress()
    : '"Procucev Enterprise" <rfq@procucev.com>';

  const message = {
    from: fromAddress,
    to: resolvedRecipients.join(', '),
    subject,
    text,
    html,
  };

  logger.info(`Dispatching Daily RFQ Report for ${data.reportDate} to ${resolvedRecipients.join(', ')}`, {
    reportDate: data.reportDate,
    totalRFQs: data.summary.totalRFQs,
    recipients: resolvedRecipients,
  }, LOG_CATEGORY);

  const deliverResult = await mailerService.deliver(message, `Daily RFQ Report (${data.reportDate})`);
  const deliveryConfirmed = deliverResult?.sent === true;

  if (!deliveryConfirmed) {
    logger.warn('Daily RFQ report delivery was not confirmed', {
      reportDate: data.reportDate,
      totalRFQs: data.summary.totalRFQs,
      reason: deliverResult?.reason || 'Mailer returned no successful delivery result',
    }, LOG_CATEGORY);
  }

  return {
    success: deliveryConfirmed,
    reportDate: data.reportDate,
    totalRFQs: data.summary.totalRFQs,
    summary: data.summary,
    recipients: resolvedRecipients,
    subject,
    messageId: deliverResult ? deliverResult.messageId : undefined,
  };
}

/**
 * Synchronously checks if the current time matches 06:00 AM in target timezone,
 * and if so, triggers the daily email (once per day).
 */
async function checkAndTriggerScheduledReport(
  currentTime = new Date(),
  timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE,
  targetHour = DAILY_RFQ_REPORT_CONFIG.DEFAULT_SCHEDULE_HOUR,
  targetMinute = DAILY_RFQ_REPORT_CONFIG.DEFAULT_SCHEDULE_MINUTE
) {
  const parts = getTzDateParts(currentTime, timezone);

  const currentMinuteOfDay = parts.hour * 60 + parts.minute;
  const scheduledMinuteOfDay = targetHour * 60 + targetMinute;
  const isWithinScheduleWindow = currentMinuteOfDay >= scheduledMinuteOfDay
    && currentMinuteOfDay < scheduledMinuteOfDay + DAILY_RFQ_REPORT_CONFIG.SCHEDULE_GRACE_MINUTES;
  if (!isWithinScheduleWindow) {
    return { triggered: false, reason: `Not scheduled time (Current: ${parts.hour}:${parts.minute}, Target: ${targetHour}:${targetMinute})` };
  }

  return runScheduledDailyRfqReport(currentTime, timezone);
}

async function runScheduledDailyRfqReport(
  scheduledTime = new Date(),
  timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE
) {
  const scheduledDate = getTzDateParts(scheduledTime, timezone).dateStr;
  if (runtimeState.lastHandledDateStr === scheduledDate) {
    return { triggered: false, reason: `Report already scheduled or dispatched today (${scheduledDate})` };
  }

  if (pool.hasStorage()) {
    const reportDate = getYesterdayDateStr(scheduledTime, timezone);
    const queued = await eventOutboxService.enqueueEventOutbox(
      EVENT_OUTBOX_TYPES.DAILY_RFQ_REPORT_EMAIL,
      `scheduled:${scheduledDate}`,
      { reportDate, timezone, recipients: resolveRecipients() }
    );
    if (!queued?.id) {
      throw new Error('Daily RFQ report was not confirmed in the durable event outbox.');
    }
    runtimeState.lastHandledDateStr = scheduledDate;
    logger.info('Daily RFQ report durably queued for delivery', {
      scheduledDate,
      reportDate,
      outboxId: queued.id,
    }, LOG_CATEGORY);
    return {
      triggered: true,
      dispatchResult: { success: true, queued: true, reportDate, outboxId: queued.id },
    };
  }

  const dispatchResult = await sendDailyRfqReport({ date: getYesterdayDateStr(scheduledTime, timezone), timezone });
  if (dispatchResult.success) {
    runtimeState.lastHandledDateStr = scheduledDate;
  } else {
    logger.warn('Daily RFQ report remains eligible for a later delivery attempt', {
      scheduledDate,
      reportDate: dispatchResult.reportDate,
    }, LOG_CATEGORY);
  }
  return { triggered: true, dispatchResult };
}

/**
 * Starts the continuous 6:00 AM daily scheduler (Node.js runtime).
 */
function startDailyReportScheduler({
  pollIntervalMs = 60000,
  timezone = DAILY_RFQ_REPORT_CONFIG.DEFAULT_TIMEZONE,
  hour = DAILY_RFQ_REPORT_CONFIG.DEFAULT_SCHEDULE_HOUR,
  minute = DAILY_RFQ_REPORT_CONFIG.DEFAULT_SCHEDULE_MINUTE,
  checkFn = checkAndTriggerScheduledReport,
} = {}) {
  const isEnabled = process.env.DAILY_RFQ_REPORT_ENABLED !== 'false';
  if (!isEnabled) {
    logger.info('Daily RFQ report scheduler is disabled via DAILY_RFQ_REPORT_ENABLED=false', {}, LOG_CATEGORY);
    return { started: false, reason: 'Disabled' };
  }

  if (runtimeState.timer) {
    return { started: false, reason: 'Already running' };
  }

  logger.info(
    `Starting Daily RFQ Report Scheduler (Target: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${timezone}, cadence: ${Math.round(pollIntervalMs / 1000)}s)`,
    {},
    LOG_CATEGORY
  );

  runtimeState.timer = setInterval(() => {
    checkFn(new Date(), timezone, hour, minute).catch((err) => {
      logger.error('Error during scheduled daily RFQ report check', err, LOG_CATEGORY);
    });
  }, pollIntervalMs);

  if (typeof runtimeState.timer.unref === 'function') {
    runtimeState.timer.unref();
  }

  return { started: true, hour, minute, timezone };
}

/**
 * Stops the continuous scheduler.
 */
function stopDailyReportScheduler() {
  if (runtimeState.timer) {
    clearInterval(runtimeState.timer);
    runtimeState.timer = null;
    return true;
  }
  return false;
}

/**
 * Reports whether the background scheduler is currently active.
 */
function isSchedulerRunning() {
  return runtimeState.timer !== null;
}

/**
 * Resets the runtime tracker (used primarily by unit tests).
 */
function resetRuntimeState() {
  stopDailyReportScheduler();
  runtimeState.lastHandledDateStr = null;
}

module.exports = {
  getTzDateParts,
  getYesterdayDateStr,
  getRfqDateStr,
  formatRfqTime,
  formatDateLabel,
  resolveRecipients,
  getDailyRfqReportData,
  buildDailyRfqEmailHtml,
  buildDailyRfqEmailText,
  sendDailyRfqReport,
  checkAndTriggerScheduledReport,
  runScheduledDailyRfqReport,
  startDailyReportScheduler,
  stopDailyReportScheduler,
  isSchedulerRunning,
  resetRuntimeState,
};
