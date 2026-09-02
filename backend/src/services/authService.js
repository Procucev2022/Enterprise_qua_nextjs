const crypto = require('crypto');
const { logger } = require('./loggerService');
const storeService = require('./storeService');
const mailerService = require('./mailerService');
const { AUTH_MESSAGES, IDENTITY_OTP_CONFIG } = require('../config/constants');
const identityPoolModule = require('../db/identityPool');
const identityQueries = require('../db/identityQueries');

const DEV_FALLBACK_AUTH_SECRET = 'procucev-enterprise-auth-secret-key-2026';
const CONFIGURED_AUTH_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || '';

if (!CONFIGURED_AUTH_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET (or JWT_SECRET) must be set in production. Refusing to start with an insecure default session-signing key.'
    );
  }
  logger.warn(
    'AUTH_SECRET/JWT_SECRET not set — using an insecure development-only fallback signing key. Set one before deploying.',
    {},
    'AUTH_SERVICE'
  );
}

const AUTH_SECRET = CONFIGURED_AUTH_SECRET || DEV_FALLBACK_AUTH_SECRET;

// OTP shape and lifetime are fixed by the Java p2pservices app, which writes the
// same codes into the shared `otp_store` table: 6 digits, valid for 15 minutes.
const { OTP_LENGTH, OTP_EXPIRY_MS, OTP_KEY_SEPARATOR } = IDENTITY_OTP_CONFIG;

// In-memory OTP storage: `<+91phone>_EMAIL_<email>` -> { code, expiresAt, attempts }
const otpStore = new Map();

/**
 * Build the OTP store key the Java service uses:
 * `normalisedPhone + "_EMAIL_" + lowercased email`. Keying on the pair rather
 * than the email alone means a code issued for one registered mobile number
 * cannot be replayed against a different one.
 */
function buildOtpKey(normalizedEmail, mobile) {
  return `${identityQueries.normalizePhone(mobile)}${OTP_KEY_SEPARATOR}${normalizedEmail}`;
}

/**
 * Generate a zero-padded numeric OTP of the configured length using a
 * cryptographically secure source rather than Math.random.
 */
function generateOtpCode() {
  const ceiling = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, ceiling)).padStart(OTP_LENGTH, '0');
}

// In-memory revoked-token set (holds each token's signature segment)
const revokedTokens = new Set();

/**
 * Generate a random per-user salt
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash password using SHA-256 + salt. Generates a random salt when none is supplied.
 */
function hashPassword(password, salt) {
  const effectiveSalt = salt || generateSalt();
  const hash = crypto.createHmac('sha256', effectiveSalt).update(password).digest('hex');
  return { hash, salt: effectiveSalt };
}

/**
 * Verify password against a stored hash + the salt that hash was created with
 */
function verifyPassword(plainPassword, storedHash, storedSalt) {
  if (!plainPassword || !storedHash || !storedSalt) return false;
  const { hash: computedHash } = hashPassword(plainPassword, storedSalt);
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));
}

/**
 * Load an account from the shared identity database (MySQL `user` table).
 *
 * This is the single source of truth for authentication: there is no in-memory
 * user registry and no seeded demo credentials. If the identity database is
 * unreachable, authentication fails closed with a descriptive error rather than
 * silently accepting anything.
 *
 * When a mobile number is supplied the lookup is narrowed to email + phone,
 * matching the Java `/authenticate` contract. That matters because the shared
 * schema has no unique index on `user.username`, so email alone can match more
 * than one row.
 */
async function loadIdentityUser(normalizedEmail, mobile) {
  if (!identityPoolModule.pool) {
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
  }
  try {
    return mobile
      ? await identityQueries.findUserByEmailAndPhone(normalizedEmail, mobile)
      : await identityQueries.findUserByEmail(normalizedEmail);
  } catch (err) {
    logger.error('Identity database lookup failed', err, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE);
  }
}

/**
 * Reject accounts that exist but are not permitted to sign in, with a message
 * that explains which gate failed and how to clear it.
 */
function assertUserCanSignIn(user, normalizedEmail, ipAddress) {
  if (!user.isActive) {
    logger.warn(`Sign-in blocked, inactive account: ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.ACCOUNT_INACTIVE);
  }
  // Self-registered accounts in the shared schema require admin approval, the
  // same gate the Java service enforces on its own login path.
  if (user.isSelfClient && !user.isApproved) {
    logger.warn(`Sign-in blocked, pending approval: ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.ACCOUNT_PENDING_APPROVAL);
  }
  if (!user.role) {
    logger.warn(
      `Sign-in blocked, unmapped role "${user.rawRoleName}" for ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.INVALID_CREDENTIALS);
  }
}

/**
 * Confirm the identity database is reachable at boot.
 *
 * Issued OTP codes and revoked session tokens are deliberately kept in process
 * memory: both are short-lived session state, so a restart simply invalidates
 * them, which fails safe. Durable data (accounts) lives in the identity schema.
 */
async function hydrateFromDB() {
  const health = await identityPoolModule.checkIdentityHealth();
  if (!health.isConnected) {
    logger.error(
      `Identity database unreachable at startup: ${health.errorMessage}. Sign-in will be rejected until it recovers.`,
      null,
      'AUTH_SERVICE'
    );
  }
  return health;
}

/**
 * Generate a cryptographically secure session token (JWT structure)
 */
function generateSessionToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 24 * 60 * 60; // 24 hours

  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      orgName: user.orgName,
      iat: issuedAt,
      exp: expiresAt,
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify session token, extract user claims, and reject revoked/logged-out sessions
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: AUTH_MESSAGES.SESSION_TOKEN_MISSING };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: AUTH_MESSAGES.MALFORMED_TOKEN };
  }

  const [header, payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    return { valid: false, error: AUTH_MESSAGES.INVALID_TOKEN_SIGNATURE };
  }

  if (revokedTokens.has(signature)) {
    return { valid: false, error: AUTH_MESSAGES.SESSION_LOGGED_OUT };
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (claims.exp && claims.exp < now) {
      return { valid: false, error: AUTH_MESSAGES.SESSION_EXPIRED };
    }

    return { valid: true, user: claims };
  } catch (err) {
    return { valid: false, error: AUTH_MESSAGES.TOKEN_DECODE_FAILED };
  }
}

/**
 * Revoke a session token so it no longer verifies, even before its natural expiry (logout)
 */
function revokeSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [, payload, signature] = parts;
  revokedTokens.add(signature);

  let expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp) expiresAt = claims.exp;
  } catch {
    // keep default expiry
  }

  logger.info(`Session token revoked, expiring at ${expiresAt}`, {}, 'AUTH_SERVICE');

  return true;
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    orgName: user.orgName,
  };
}

/**
 * Authenticate with Email + registered Mobile + Password.
 *
 * Staged to match POST /authenticate in the Java p2pservices app, which is the
 * contract every other Procucev client already speaks:
 *   1. the email + mobile pair must resolve to an account
 *   2. that account must be active and approved
 *   3. only then is the password compared
 *
 * Does not auto-create accounts.
 */
async function authenticateWithPassword(email, password, ipAddress, mobile) {
  if (!email || !password || !mobile) {
    throw new Error(AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedMobile = String(mobile).trim();

  // Stage 1 — identity. The Java service calls validateUser(username, phone)
  // before looking at any credential, and reports the pair as wrong rather than
  // blaming the password, so a visitor who mistyped their mobile number is told
  // exactly that instead of doubting a password that was correct.
  const user = await loadIdentityUser(normalizedEmail, submittedMobile);
  if (!user) {
    logger.warn(
      `Sign-in blocked, no account for this email + mobile pair: ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
  }

  // Stage 2 — the active / approval gates, again ahead of the credential check,
  // mirroring validateUserApproval on the Java path.
  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  // Stage 3 — the credential itself.
  if (!identityQueries.verifyStoredPassword(password, user.password)) {
    logger.warn(`Failed password authentication for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_LOGIN_CREDENTIALS);
  }

  const token = generateSessionToken(user);
  logger.audit(`User logged in via Password: ${user.email} (${user.role})`, user.email, {
    role: user.role,
    ipAddress,
    mobileVerified: true,
  });
  storeService.addAuditLog({
    userEmail: user.email,
    action: `User authenticated via Email + Mobile + Password [Role: ${user.role}]`,
    ipAddress,
  });

  return {
    success: true,
    token,
    user: toPublicUser(user),
  };
}

/**
 * Generate and dispatch a 6-digit email OTP.
 *
 * Follows the Java `/authenticate` OTP branch: the email + mobile pair is
 * validated and the approval gates are applied first, and only then is a code
 * issued, stored against `<+91phone>_EMAIL_<email>` and emailed. Only for an
 * account that already exists — use `register` to create one first.
 */
async function requestOtp(email, mobile, roleHint, ipAddress) {
  if (!email) {
    throw new Error(AUTH_MESSAGES.OTP_EMAIL_REQUIRED);
  }
  if (!mobile) {
    throw new Error(AUTH_MESSAGES.MOBILE_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedMobile = String(mobile).trim();

  const user = await loadIdentityUser(normalizedEmail, submittedMobile);
  if (!user) {
    logger.warn(
      `OTP requested for an unrecognised email + mobile pair: ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
  }

  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  const code = generateOtpCode();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;
  otpStore.set(buildOtpKey(normalizedEmail, submittedMobile), { code, expiresAt, attempts: 0 });

  mailerService.sendOtpEmail(normalizedEmail, code, OTP_EXPIRY_MS / 1000).catch((e) =>
    logger.error('OTP email dispatch error', e, 'AUTH_SERVICE')
  );

  logger.info(`OTP generated for ${normalizedEmail}: ${code}`, { ipAddress }, 'AUTH_SERVICE');
  storeService.addAuditLog({
    userEmail: normalizedEmail,
    action: `Instant ${OTP_LENGTH}-digit OTP dispatched to corporate email (${normalizedEmail})`,
    ipAddress,
  });

  return {
    success: true,
    message: `Verification OTP dispatched to ${normalizedEmail}`,
    email: normalizedEmail,
    // Only echoed back in tests or when SMTP isn't configured, so local/dev/test
    // runs without real email delivery can still complete the OTP flow; once
    // SMTP is live, the real code is never exposed in the API response.
    ...(process.env.NODE_ENV === 'test' || !mailerService.isConfigured() ? { demoCode: code } : {}),
    expiresInSeconds: OTP_EXPIRY_MS / 1000,
  };
}

/**
 * Verify a 6-digit email OTP and issue a session. No master/bypass codes — only
 * the code actually issued via requestOtp, for the same email + mobile pair,
 * verifies. An expired entry is deleted on inspection, matching the Java
 * validateEmailOtp behaviour.
 */
async function verifyOtp(email, code, ipAddress, mobile) {
  if (!email || !code) {
    throw new Error(AUTH_MESSAGES.OTP_CODE_REQUIRED);
  }
  if (!mobile) {
    throw new Error(AUTH_MESSAGES.MOBILE_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedMobile = String(mobile).trim();
  const otpKey = buildOtpKey(normalizedEmail, submittedMobile);

  const user = await loadIdentityUser(normalizedEmail, submittedMobile);
  const storedOtp = otpStore.get(otpKey);

  if (storedOtp && Date.now() > storedOtp.expiresAt) {
    otpStore.delete(otpKey);
    logger.warn(`Expired OTP submitted for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_OTP);
  }

  const isValidCode = !!user && !!storedOtp && storedOtp.code === code;

  if (!isValidCode) {
    if (storedOtp) storedOtp.attempts = (storedOtp.attempts || 0) + 1;
    logger.warn(`Invalid OTP submitted for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_OTP);
  }

  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  // Clear OTP on successful verification
  otpStore.delete(otpKey);

  const token = generateSessionToken(user);
  logger.audit(`User logged in via Instant OTP: ${user.email} (${user.role})`, user.email, { role: user.role, ipAddress });
  storeService.addAuditLog({
    userEmail: user.email,
    action: `User authenticated via Instant Email OTP [Role: ${user.role}]`,
    ipAddress,
  });

  return {
    success: true,
    token,
    user: toPublicUser(user),
  };
}

/**
 * Register a new user / enterprise entity. The only path that creates an account.
 */
async function registerUser(payload, ipAddress) {
  const { name, email, password, mobile, orgName } = payload;
  if (!email) throw new Error(AUTH_MESSAGES.REGISTRATION_EMAIL_REQUIRED);
  if (!password) throw new Error(AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED);
  if (!mobile) throw new Error(AUTH_MESSAGES.MOBILE_REQUIRED);

  if (!identityPoolModule.pool) {
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Accounts are created in the shared identity database so they are usable by
  // every Procucev application, not just this workspace.
  const result = await identityQueries.insertBuyerAccount({
    email: normalizedEmail,
    password,
    phone: mobile,
    fullName: name,
    organizationName: orgName,
  });

  if (!result.created) {
    throw new Error(AUTH_MESSAGES.ACCOUNT_ALREADY_EXISTS);
  }

  const newUser = result.user;
  const token = generateSessionToken(newUser);
  logger.audit(`New enterprise account registered: ${newUser.email} (${newUser.role})`, newUser.email, { ipAddress });
  storeService.addAuditLog({
    userEmail: newUser.email,
    action: `New Enterprise User Registered [Role: ${newUser.role}, Org: ${newUser.orgName}]`,
    ipAddress,
  });

  return {
    success: true,
    message: AUTH_MESSAGES.REGISTRATION_SUCCESS,
    token,
    user: toPublicUser(newUser),
  };
}

/**
 * Get all registered users (for admin inspection)
 */
async function getAllUsers() {
  if (!identityPoolModule.pool) {
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
  }
  const users = await identityQueries.listUsers();
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    orgId: u.orgId,
    orgName: u.orgName,
    mobile: u.mobile,
    status: u.status,
  }));
}

module.exports = {
  hashPassword,
  verifyPassword,
  loadIdentityUser,
  assertUserCanSignIn,
  generateSessionToken,
  verifySessionToken,
  revokeSessionToken,
  authenticateWithPassword,
  requestOtp,
  verifyOtp,
  registerUser,
  getAllUsers,
  hydrateFromDB,
};
