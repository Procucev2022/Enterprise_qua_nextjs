// ==============================================================================
// WHATSAPP AGENT-BOT BRIDGE (/api/bot)
// ==============================================================================
// The WhatsApp agent bot (ai-proc-agent-bot) does its work through this app's
// existing APIs (/api/auth, /api/rfqs, /api/vendors, ...), converting their
// responses to its own conversation format on the bot side. /api/bot holds only
// what no existing API offers a WhatsApp caller:
//
//   POST /session                       act as an account without its password
//   GET  /users?phone=                  accounts registered to a WhatsApp number
//   PUT  /users/:id/whatsapp            mark a WhatsApp registration / verification
//   PUT  /vendors/:id/whatsapp-opt-out  a seller's WhatsApp notification opt-out
//   POST /email                         plain email (support alerts, reports)
//   GET  /vendor-plans                  the vendor subscription plans
//
// Nothing here calls or reads QUA, so it keeps working after QUA is retired.
//
// The bridge is off until BOT_API_KEY is set (wrangler secret / backend/.env):
// every request must carry that key, and without one configured the routes
// answer 503 instead of exposing passwordless, phone-based sign-in.
// ==============================================================================

const BOT_BRIDGE_CONFIG = {
  API_KEY_ENV: 'BOT_API_KEY',
  API_KEY_HEADER: 'x-bot-api-key',

  // QUA's self-registration left buyers unapproved until an admin (or the bot's
  // corporate-domain check) accepted them. This app approves every new account,
  // and has no approval screen, so the QUA behaviour is opt-in.
  REQUIRE_APPROVAL_ENV: 'BOT_REGISTRATION_REQUIRES_APPROVAL',

  // Provenance written on accounts that registered over WhatsApp. Not 'W': that is
  // already IDENTITY_MASTER_DATA.SOURCE_TYPE_WEB here.
  ACCOUNT_SOURCE_TYPE: 'WHATSAPP',
  // last_modified_by / audit actor for writes the bridge makes.
  ACTOR: 'whatsapp-bot',

  // Verification states the bot may set: a WhatsApp registration starts pending
  // (the bot then runs its own email OTP step) and becomes verified on success.
  VERIFICATION_STATES: ['PENDING_EMAIL_VERIFICATION', 'EMAIL_VERIFIED'],

  // Download allowance and period behind each paid vendor plan, as promised by
  // the plan descriptions in VENDOR_SUBSCRIPTION_PLANS.
  PLAN_RFQ_BUNDLE: { connect: 50, select: 100 },
  PLAN_PERIOD_MONTHS: 3,
};

const BOT_BRIDGE_MESSAGES = {
  BRIDGE_DISABLED: 'The WhatsApp bot bridge is not configured on this server.',
  BRIDGE_UNAUTHORIZED: 'Missing or invalid bot API key.',
  ACCOUNT_NOT_FOUND: 'No active account found.',
  SELLER_NOT_FOUND: 'Seller not found.',
  INVALID_VERIFICATION_STATE: 'verificationStatus must be PENDING_EMAIL_VERIFICATION or EMAIL_VERIFIED.',
  INVALID_RECIPIENTS: 'Invalid email addresses found.',
  NO_RECIPIENTS: 'At least one recipient is required.',
};

module.exports = {
  BOT_BRIDGE_CONFIG,
  BOT_BRIDGE_MESSAGES,
};
