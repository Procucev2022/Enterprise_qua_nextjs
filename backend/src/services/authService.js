const crypto = require('crypto');
const { logger } = require('./loggerService');
const storeService = require('./storeService');
const poolModule = require('../db/pool');
const { AUTH_MESSAGES } = require('../config/constants');
const {
  getUsersFromDB,
  upsertUserInDB,
  upsertOtpInDB,
  deleteOtpInDB,
  getRevokedSessionsFromDB,
  insertRevokedSessionInDB,
} = require('../db/queries');

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
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory OTP storage: email -> { code, expiresAt, attempts }
const otpStore = new Map();

// In-memory revoked-token set (holds each token's signature segment)
const revokedTokens = new Set();

// Default seed users (login credentials for the 4 roles used in Phase-4 testing)
const DEFAULT_USER_SEEDS = [
  {
    id: 'usr-buyer-001',
    email: 'buyer@procucev.com',
    name: 'Procucev Buyer Desk',
    role: 'buyer',
    orgId: 'org-procucev-01',
    orgName: 'Procucev Heavy Engineering',
    password: 'password123',
    mobile: '+91 98201 44820',
  },
  {
    id: 'usr-client-001',
    email: 'client@procucev.com',
    name: 'L&T Infrastructure Buyer',
    role: 'buyer',
    orgId: 'org-lt-01',
    orgName: 'Larsen & Toubro EPC Division',
    password: 'password123',
    mobile: '+91 98201 44821',
  },
  {
    id: 'usr-catman-001',
    email: 'catmanager@procucev.com',
    name: 'Sourcing Lead & Category Manager',
    role: 'category_manager',
    orgId: 'org-procucev-01',
    orgName: 'Procucev Procurement Directorate',
    password: 'password123',
    mobile: '+91 98201 44822',
  },
  {
    id: 'usr-vendor-001',
    email: 'vendor@apexsupplies.com',
    name: 'Apex Industrial Supplies Desk',
    role: 'vendor',
    orgId: 'org-apex-01',
    orgName: 'Apex Industrial Supplies Pvt Ltd',
    password: 'password123',
    mobile: '+91 98450 67890',
  },
  {
    id: 'usr-vendor-002',
    email: 'amit@kiranvalves.com',
    name: 'Kiran Valves & Actuators',
    role: 'vendor',
    orgId: 'org-kiran-02',
    orgName: 'Kiran Precision Valves Mfg',
    password: 'Kiran@Temp8821#',
    mobile: '+91 98110 54321',
  },
  {
    id: 'usr-admin-001',
    email: 'admin@procucev.com',
    name: 'Platform Administrator & Compliance Auditor',
    role: 'admin',
    orgId: 'org-platform-root',
    orgName: 'Procucev Enterprise Governance',
    password: 'adminpassword123',
    mobile: '+91 98000 00001',
  },
  {
    id: 'usr-auditor-001',
    email: 'auditor@procucev.com',
    name: 'Lead Compliance Auditor',
    role: 'admin',
    orgId: 'org-platform-root',
    orgName: 'Procucev Audit & Regulatory Commission',
    password: 'adminpassword123',
    mobile: '+91 98000 00002',
  },
];

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

// User repository: email -> User
const userRegistry = new Map();

function buildUserRecord(seed) {
  const { hash, salt } = hashPassword(seed.password, generateSalt());
  return {
    id: seed.id,
    email: seed.email,
    name: seed.name,
    role: seed.role,
    orgId: seed.orgId,
    orgName: seed.orgName,
    passwordHash: hash,
    passwordSalt: salt,
    mobile: seed.mobile,
    status: 'ACTIVE',
  };
}

DEFAULT_USER_SEEDS.forEach((seed) => {
  userRegistry.set(seed.email.toLowerCase(), buildUserRecord(seed));
});

/**
 * Hydrate the in-memory user registry and revoked-session set from Postgres.
 * If the DB has no users yet, push the current in-memory seed users into it
 * so registrations made after a restart don't disappear. Mirrors the
 * storeService hydrate-on-boot pattern used for the rest of the app.
 */
async function hydrateFromDB() {
  if (!poolModule.pool) return;
  try {
    const dbUsers = await getUsersFromDB();
    if (dbUsers && dbUsers.length > 0) {
      dbUsers.forEach((u) => userRegistry.set(u.email.toLowerCase(), u));
    } else {
      await Promise.all(
        Array.from(userRegistry.values()).map((u) =>
          upsertUserInDB(u).catch((e) => logger.error('DB user seed error', e, 'AUTH_SERVICE'))
        )
      );
    }

    const dbRevoked = await getRevokedSessionsFromDB();
    (dbRevoked || []).forEach((r) => revokedTokens.add(r.tokenSignature));
  } catch (err) {
    logger.warn(
      'Auth hydration from PostgreSQL failed, continuing with in-memory seed users',
      { error: err.message },
      'AUTH_SERVICE'
    );
  }
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

  if (poolModule.pool) {
    insertRevokedSessionInDB(signature, expiresAt).catch((e) =>
      logger.error('DB revoke save error', e, 'AUTH_SERVICE')
    );
  }

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
 * Authenticate with Email and Password. Does not auto-create accounts —
 * an unknown email is rejected with the same generic error as a wrong
 * password, to avoid leaking which emails are registered.
 */
function authenticateWithPassword(email, password, ipAddress) {
  if (!email || !password) {
    throw new Error(AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = userRegistry.get(normalizedEmail);

  if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    logger.warn(`Failed password authentication for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_CREDENTIALS);
  }

  const token = generateSessionToken(user);
  logger.audit(`User logged in via Password: ${user.email} (${user.role})`, user.email, { role: user.role, ipAddress });
  storeService.addAuditLog({
    userEmail: user.email,
    action: `User authenticated via Email + Password [Role: ${user.role}]`,
    ipAddress,
  });

  return {
    success: true,
    token,
    user: toPublicUser(user),
  };
}

/**
 * Generate and dispatch a 4-digit OTP for Email. Only for an email that
 * already has an account — use `register` to create one first.
 */
function requestOtp(email, roleHint, ipAddress) {
  if (!email) {
    throw new Error(AUTH_MESSAGES.OTP_EMAIL_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = userRegistry.get(normalizedEmail);
  if (!user) {
    logger.warn(`OTP requested for unregistered email: ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.ACCOUNT_NOT_FOUND);
  }

  // Generate 4-digit code
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;
  otpStore.set(normalizedEmail, { code, expiresAt, attempts: 0 });

  if (poolModule.pool) {
    upsertOtpInDB(normalizedEmail, code, expiresAt).catch((e) =>
      logger.error('DB OTP save error', e, 'AUTH_SERVICE')
    );
  }

  logger.info(`OTP generated for ${normalizedEmail}: ${code}`, { ipAddress }, 'AUTH_SERVICE');
  storeService.addAuditLog({
    userEmail: normalizedEmail,
    action: `Instant 4-digit OTP dispatched to corporate email (${normalizedEmail})`,
    ipAddress,
  });

  return {
    success: true,
    message: `Verification OTP dispatched to ${normalizedEmail}`,
    email: normalizedEmail,
    // Returned in response for testing/demo environments
    demoCode: code,
    expiresInSeconds: 600,
  };
}

/**
 * Verify 4-digit OTP and issue a session. No master/bypass codes — only the
 * code actually issued via requestOtp for a real, registered account verifies.
 */
function verifyOtp(email, code, ipAddress) {
  if (!email || !code) {
    throw new Error(AUTH_MESSAGES.OTP_CODE_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = userRegistry.get(normalizedEmail);
  const storedOtp = otpStore.get(normalizedEmail);

  const isValidCode = !!user && !!storedOtp && storedOtp.code === code && Date.now() <= storedOtp.expiresAt;

  if (!isValidCode) {
    if (storedOtp) storedOtp.attempts = (storedOtp.attempts || 0) + 1;
    logger.warn(`Invalid OTP submitted for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_OTP);
  }

  // Clear OTP on successful verification
  otpStore.delete(normalizedEmail);
  if (poolModule.pool) {
    deleteOtpInDB(normalizedEmail).catch((e) => logger.error('DB OTP delete error', e, 'AUTH_SERVICE'));
  }

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
function registerUser(payload, ipAddress) {
  const { name, email, password, mobile, role, orgName } = payload;
  if (!email) throw new Error(AUTH_MESSAGES.REGISTRATION_EMAIL_REQUIRED);

  const normalizedEmail = email.trim().toLowerCase();
  if (userRegistry.has(normalizedEmail)) {
    const existing = userRegistry.get(normalizedEmail);
    const token = generateSessionToken(existing);
    return {
      success: true,
      message: AUTH_MESSAGES.ACCOUNT_EXISTS_LOGIN,
      token,
      user: toPublicUser(existing),
    };
  }

  const { hash, salt } = hashPassword(password || 'password123', generateSalt());
  const newUser = {
    id: `usr-${Date.now()}`,
    email: normalizedEmail,
    name: name || normalizedEmail.split('@')[0],
    role: role || 'buyer',
    orgId: `org-${Date.now()}`,
    orgName: orgName || `${name || 'Enterprise'} Entity`,
    passwordHash: hash,
    passwordSalt: salt,
    mobile: mobile || '+91 98201 44820',
    status: 'ACTIVE',
  };

  userRegistry.set(normalizedEmail, newUser);
  if (poolModule.pool) {
    upsertUserInDB(newUser).catch((e) => logger.error('DB user save error', e, 'AUTH_SERVICE'));
  }

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
function getAllUsers() {
  return Array.from(userRegistry.values()).map((u) => ({
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
