/**
 * WhatsApp agent-bot bridge — only what no existing API offers.
 *
 * Registration, OTP, RFQs, seller credits and unlocks, and payment links all go
 * through the app's existing APIs; the bot converts their responses to its own
 * conversation format. What is left here exists because a WhatsApp caller needs
 * it and no existing route provides it: acting as an account without its
 * password, finding accounts by phone number, WhatsApp-specific account flags,
 * plain email, and the vendor plan list.
 *
 * Every function resolves to `{ status, body }`; routes/botBridge.js forwards them.
 */

const { logger } = require('./loggerService');
const storeService = require('./storeService');
const authService = require('./authService');
const mailerService = require('./mailerService');
const identityQueries = require('../db/identityQueries');
const botBridgeQueries = require('../db/botBridgeQueries');
const { getEnv } = require('./mailTransport');
const { VENDOR_SUBSCRIPTION_PLANS, ZOHO_SUBSCRIPTION_PRICING, computeZohoPlanAmount } = require('../config/constants');
const { BOT_BRIDGE_CONFIG, BOT_BRIDGE_MESSAGES } = require('../config/botBridgeConfig');

const LOG_CONTEXT = 'BOT_BRIDGE';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOT_ROLES = ['buyer', 'vendor'];
const [PENDING, VERIFIED] = BOT_BRIDGE_CONFIG.VERIFICATION_STATES;

function respond(status, body) {
  return { status, body };
}

/** The vendor record behind a vendor account, or null. */
async function vendorForUser(user) {
  if (!user || user.role !== 'vendor' || !user.email) return null;
  const known = storeService.getVendorById(user.email, 'all');
  if (known) return known;
  const vendorId = await botBridgeQueries.findVendorIdByEmail(user.email);
  return vendorId ? (await storeService.getVendorByIdWithDBFallback(vendorId, 'all')) || null : null;
}

/**
 * The buyer or seller account behind any id the bot holds.
 *
 * The bot keeps an account id for buyers and the vendor record id for sellers,
 * and QUA also accepted an organisation id, so each is tried in that order.
 */
async function resolveAccount(id) {
  if (!id) return null;
  const key = String(id).trim();
  const byUuid = await botBridgeQueries.findUserByUuid(key);
  if (byUuid) return byUuid;

  const vendor = await storeService.getVendorByIdWithDBFallback(key, 'all');
  if (vendor && vendor.email) {
    const owner = await identityQueries.findUserByEmail(vendor.email);
    if (owner) return owner;
  }

  const members = await botBridgeQueries.findUsersByOrgUuid(key);
  return members.find((u) => u && u.isActive && BOT_ROLES.includes(u.role)) || null;
}

/**
 * A session token for a buyer or seller, without their password.
 *
 * The web app signs people in with a password or an email OTP; the bot has
 * already identified the person by their WhatsApp number, so it asks for the
 * account by id (or by email + phone, as QUA's /authenticate did). Only active,
 * approved buyer and seller accounts are issued a session.
 */
async function createSession({ id, email, phone } = {}) {
  const user = email && phone ? await identityQueries.findUserByEmailAndPhone(email, phone) : await resolveAccount(id);
  if (!user || !user.isActive || !user.isApproved || !BOT_ROLES.includes(user.role)) {
    return respond(404, { success: false, error: BOT_BRIDGE_MESSAGES.ACCOUNT_NOT_FOUND });
  }
  const vendor = await vendorForUser(user);
  return respond(200, {
    success: true,
    // A temporary password must be changed before a seller's web session can use
    // any page; that gate belongs to the web sign-in, not to the bot acting for them.
    token: authService.generateSessionToken({ ...user, resetPasswordRequired: false }),
    expiresIn: authService.SESSION_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      orgName: user.orgName,
      mobile: user.mobile,
      vendorId: vendor ? vendor.id : null,
    },
  });
}

/** Buyer and seller accounts registered to a WhatsApp number. */
async function findUsersByPhone(phone) {
  const users = (await botBridgeQueries.findUsersByPhone(phone)).filter((u) => BOT_ROLES.includes(u.role));
  const data = [];
  for (const user of users) {
    const vendor = await vendorForUser(user);
    data.push({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      orgName: user.orgName || null,
      mobile: user.mobile,
      uniqueId: user.uniqueId || null,
      verificationStatus: user.verificationStatus || null,
      isApproved: user.isApproved,
      isActive: user.isActive,
      vendorId: vendor ? vendor.id : null,
    });
  }
  return respond(200, { success: true, data });
}

function requiresApproval() {
  return String(getEnv(BOT_BRIDGE_CONFIG.REQUIRE_APPROVAL_ENV) || '').trim().toLowerCase() === 'true';
}

/**
 * Email a WhatsApp-registered account its login credentials.
 *
 * QUA sent login credentials once a WhatsApp registration's email was verified;
 * here the account gets a fresh temporary password (flagged for change on first
 * sign-in) and the same credentials email EQUA's own onboarding sends — the
 * supplier onboarding email for sellers, its buyer counterpart for buyers.
 */
async function issueCredentials(user) {
  const tempPassword = storeService._generateTempPassword();
  if (!(await botBridgeQueries.setTemporaryPassword(user.id, tempPassword))) {
    return { issued: false, emailSent: false };
  }
  let delivery;
  try {
    if (user.role === 'vendor') {
      const vendor = await vendorForUser(user);
      delivery = await mailerService.sendVendorIngestionEmail(
        mailerService.buildVendorOnboardingEmail({
          to: user.email,
          recipientName: user.name,
          buyerOrganizationName: 'Procucev Enterprise',
          vendorCode: vendor ? vendor.id : user.id,
          tempPassword,
          contactPhone: user.mobile,
        }),
        'onboarding'
      );
      if (vendor) storeService.updateVendor(vendor.id, { tempPassword, onboardingEmailStatus: delivery && delivery.sent ? 'sent' : 'failed' });
    } else {
      delivery = await mailerService.sendBuyerCredentialsEmail({
        to: user.email,
        recipientName: user.name,
        tempPassword,
        contactPhone: user.mobile,
      });
    }
  } catch (err) {
    logger.error('WhatsApp registration credentials email failed', err, LOG_CONTEXT);
    delivery = null;
  }
  const emailSent = Boolean(delivery && delivery.sent);
  if (!emailSent) {
    logger.warn('WhatsApp registration credentials were not emailed', { email: user.email, reason: delivery && delivery.reason }, LOG_CONTEXT);
  }
  return { issued: true, emailSent };
}

/**
 * Mark an account registered over WhatsApp and/or record its email verification.
 *
 * /api/auth/register creates the account; the bot then verifies the email with
 * its own OTP step (QUA's order), so the account starts pending and is marked
 * verified once that step succeeds — at which point, the first time only, its
 * login credentials are emailed.
 */
async function setWhatsAppStatus(userId, { registeredViaWhatsApp, verificationStatus } = {}) {
  if (verificationStatus && !BOT_BRIDGE_CONFIG.VERIFICATION_STATES.includes(verificationStatus)) {
    return respond(400, { success: false, error: BOT_BRIDGE_MESSAGES.INVALID_VERIFICATION_STATE });
  }
  const before = verificationStatus === VERIFIED ? await botBridgeQueries.findUserByUuid(userId) : null;
  const updated = await botBridgeQueries.setWhatsAppStatus(userId, {
    registeredViaWhatsApp: registeredViaWhatsApp === true,
    verificationStatus: verificationStatus || null,
    requireApproval: requiresApproval(),
  });
  if (!updated) return respond(404, { success: false, error: BOT_BRIDGE_MESSAGES.ACCOUNT_NOT_FOUND });
  if (before && before.verificationStatus === PENDING) {
    return respond(200, { success: true, credentials: await issueCredentials(before) });
  }
  return respond(200, { success: true });
}

/** Record a seller's WhatsApp notification opt-out on their vendor record. */
async function setVendorOptOut(vendorId, { optedOut } = {}) {
  const vendor = await storeService.getVendorByIdWithDBFallback(String(vendorId || ''), 'all');
  if (!vendor) return respond(404, { success: false, error: BOT_BRIDGE_MESSAGES.SELLER_NOT_FOUND });
  storeService.updateVendor(vendor.id, { whatsappOptOut: optedOut === true });
  return respond(200, { success: true, vendorId: vendor.id, optedOut: optedOut === true });
}

/** Send an email (text or html, optionally with base64 attachments). */
async function sendEmail(payload = {}) {
  const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v).trim()).filter(Boolean);
  const to = asList(payload.to);
  const cc = asList(payload.cc);
  const bcc = asList(payload.bcc);
  if (to.length === 0) return respond(400, { success: false, error: BOT_BRIDGE_MESSAGES.NO_RECIPIENTS });

  const invalid = [...to, ...cc, ...bcc].filter((address) => !EMAIL_PATTERN.test(address));
  if (invalid.length > 0) return respond(400, { success: false, error: BOT_BRIDGE_MESSAGES.INVALID_RECIPIENTS, invalid });

  const attachments = (Array.isArray(payload.attachments) ? payload.attachments : []).map((a) => ({
    filename: a.fileName,
    content: a.fileData,
    contentType: a.contentType,
  }));

  try {
    const result = await mailerService.deliver(
      {
        from: mailerService.fromAddress(),
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: payload.subject || '',
        ...(payload.html ? { html: payload.html } : {}),
        ...(payload.text || !payload.html ? { text: payload.text || '' } : {}),
        attachments,
      },
      'WhatsApp bot email'
    );
    if (result && result.sent) return respond(200, { success: true, sent: true });
    const reason = (result && (result.reason || result.error)) || 'not delivered';
    logger.warn('WhatsApp bot email was not delivered', { reason }, LOG_CONTEXT);
    return respond(502, { success: false, sent: false, error: reason });
  } catch (err) {
    logger.error('WhatsApp bot email failed', err, LOG_CONTEXT);
    return respond(502, { success: false, sent: false, error: err.message });
  }
}

/** The paid vendor plans, with the amount the payment link charges. */
function listVendorPlans() {
  const data = VENDOR_SUBSCRIPTION_PLANS.filter((plan) => BOT_BRIDGE_CONFIG.PLAN_RFQ_BUNDLE[plan.id] !== undefined).map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    features: plan.features,
    price: plan.price,
    billing: plan.billing,
    amount: Number(ZOHO_SUBSCRIPTION_PRICING[plan.id]) || 0,
    amountWithGst: computeZohoPlanAmount(plan.id),
    rfqBundleSize: BOT_BRIDGE_CONFIG.PLAN_RFQ_BUNDLE[plan.id],
    periodMonths: BOT_BRIDGE_CONFIG.PLAN_PERIOD_MONTHS,
  }));
  return respond(200, { success: true, data });
}

module.exports = {
  resolveAccount,
  issueCredentials,
  createSession,
  findUsersByPhone,
  setWhatsAppStatus,
  setVendorOptOut,
  sendEmail,
  listVendorPlans,
};
