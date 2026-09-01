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

function buildOtpEmail(to, code, expiresInSeconds) {
  const minutes = Math.max(1, Math.round((expiresInSeconds || 600) / 60));
  return {
    from: process.env.SMTP_USER,
    to,
    subject: 'Your Procucev Enterprise verification code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; color: white;">
          <h2 style="margin: 0;">PROCUCEV ENTERPRISE</h2>
          <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 14px;">Secure Sign-In Verification</p>
        </div>
        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
          <p>Your one-time verification code is:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; margin: 20px 0; color: #0284c7;">${code}</p>
          <p style="font-size: 13px; color: #64748b; margin: 0;">This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. If you did not request this, you can safely ignore this email.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Sends the OTP code by email. No-ops (does not throw) when SMTP isn't
 * configured or during test runs, so callers can safely fire-and-forget this.
 */
async function sendOtpEmail(to, code, expiresInSeconds) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: false, reason: 'test environment' };
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    logger.warn('SMTP not configured (SMTP_USER/SMTP_PASSWORD unset) — OTP email not sent', { to }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  const info = await activeTransporter.sendMail(buildOtpEmail(to, code, expiresInSeconds));
  logger.info(`OTP email sent to ${to}`, { messageId: info.messageId }, 'MAILER_SERVICE');
  return { sent: true, messageId: info.messageId };
}

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

module.exports = {
  getTransporter,
  sendOtpEmail,
  isConfigured,
};
