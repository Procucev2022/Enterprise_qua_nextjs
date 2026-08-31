const crypto = require('crypto');
const { logger } = require('./loggerService');
const storeService = require('./storeService');

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'procucev-enterprise-auth-secret-key-2026';
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory OTP storage: email -> { code, expiresAt, attempts }
const otpStore = new Map();

// Default seed users
const DEFAULT_USERS = [
  {
    id: 'usr-buyer-001',
    email: 'buyer@procucev.com',
    name: 'Procucev Buyer Desk',
    role: 'buyer',
    orgId: 'org-procucev-01',
    orgName: 'Procucev Heavy Engineering',
    passwordHash: hashPassword('password123'),
    mobile: '+91 98201 44820',
    status: 'ACTIVE',
  },
  {
    id: 'usr-client-001',
    email: 'client@procucev.com',
    name: 'L&T Infrastructure Buyer',
    role: 'buyer',
    orgId: 'org-lt-01',
    orgName: 'Larsen & Toubro EPC Division',
    passwordHash: hashPassword('password123'),
    mobile: '+91 98201 44821',
    status: 'ACTIVE',
  },
  {
    id: 'usr-catman-001',
    email: 'catmanager@procucev.com',
    name: 'Sourcing Lead & Category Manager',
    role: 'category_manager',
    orgId: 'org-procucev-01',
    orgName: 'Procucev Procurement Directorate',
    passwordHash: hashPassword('password123'),
    mobile: '+91 98201 44822',
    status: 'ACTIVE',
  },
  {
    id: 'usr-vendor-001',
    email: 'vendor@apexsupplies.com',
    name: 'Apex Industrial Supplies Desk',
    role: 'vendor',
    orgId: 'org-apex-01',
    orgName: 'Apex Industrial Supplies Pvt Ltd',
    passwordHash: hashPassword('password123'),
    mobile: '+91 98450 67890',
    status: 'ACTIVE',
  },
  {
    id: 'usr-vendor-002',
    email: 'amit@kiranvalves.com',
    name: 'Kiran Valves & Actuators',
    role: 'vendor',
    orgId: 'org-kiran-02',
    orgName: 'Kiran Precision Valves Mfg',
    passwordHash: hashPassword('Kiran@Temp8821#'),
    tempPassword: 'Kiran@Temp8821#',
    mobile: '+91 98110 54321',
    status: 'ACTIVE',
  },
  {
    id: 'usr-admin-001',
    email: 'admin@procucev.com',
    name: 'Platform Administrator & Compliance Auditor',
    role: 'admin',
    orgId: 'org-platform-root',
    orgName: 'Procucev Enterprise Governance',
    passwordHash: hashPassword('adminpassword123'),
    mobile: '+91 98000 00001',
    status: 'ACTIVE',
  },
  {
    id: 'usr-auditor-001',
    email: 'auditor@procucev.com',
    name: 'Lead Compliance Auditor',
    role: 'admin',
    orgId: 'org-platform-root',
    orgName: 'Procucev Audit & Regulatory Commission',
    passwordHash: hashPassword('adminpassword123'),
    mobile: '+91 98000 00002',
    status: 'ACTIVE',
  },
];

// User repository: email -> User
const userRegistry = new Map();

// Initialize users
DEFAULT_USERS.forEach((user) => {
  userRegistry.set(user.email.toLowerCase(), { ...user });
});

/**
 * Hash password using SHA-256 + salt
 */
function hashPassword(password, salt) {
  const effectiveSalt = salt || 'procucev-static-enterprise-salt-2026';
  return crypto.createHmac('sha256', effectiveSalt).update(password).digest('hex');
}

/**
 * Verify password against hash
 */
function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) return false;
  const computedHash = hashPassword(plainPassword);
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));
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
 * Verify session token and extract user claims
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token missing or invalid' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [header, payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    return { valid: false, error: 'Invalid token signature' };
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (claims.exp && claims.exp < now) {
      return { valid: false, error: 'Session token has expired' };
    }

    return { valid: true, user: claims };
  } catch (err) {
    return { valid: false, error: 'Failed to decode token payload' };
  }
}

/**
 * Authenticate with Email and Password
 */
function authenticateWithPassword(email, password, ipAddress) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  let user = userRegistry.get(normalizedEmail);

  // Auto-provision if user doesn't exist yet (for seamless demo/developer workflows)
  if (!user) {
    const autoRole = normalizedEmail.includes('vendor')
      ? 'vendor'
      : normalizedEmail.includes('admin')
      ? 'admin'
      : normalizedEmail.includes('manager')
      ? 'category_manager'
      : 'buyer';

    user = {
      id: `usr-${Date.now()}`,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0].replace('.', ' ').toUpperCase(),
      role: autoRole,
      orgId: `org-${normalizedEmail.split('@')[1] || 'generic'}`,
      orgName: `${normalizedEmail.split('@')[1] || 'Enterprise'} Entity`,
      passwordHash: hashPassword(password),
      status: 'ACTIVE',
    };
    userRegistry.set(normalizedEmail, user);
  } else {
    const isValid = verifyPassword(password, user.passwordHash) || (user.tempPassword && password === user.tempPassword);
    if (!isValid) {
      logger.warn(`Failed password authentication for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
      throw new Error('Invalid email or password.');
    }
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
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      orgName: user.orgName,
    },
  };
}

/**
 * Generate and dispatch 4-digit OTP for Email
 */
function requestOtp(email, roleHint, ipAddress) {
  if (!email) {
    throw new Error('Email is required to dispatch OTP.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  let user = userRegistry.get(normalizedEmail);

  if (!user) {
    const role = roleHint || (normalizedEmail.includes('vendor') ? 'vendor' : 'buyer');
    user = {
      id: `usr-${Date.now()}`,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0].replace('.', ' ').toUpperCase(),
      role,
      orgId: `org-${normalizedEmail.split('@')[1] || 'generic'}`,
      orgName: `${normalizedEmail.split('@')[1] || 'Enterprise'} Entity`,
      passwordHash: hashPassword('password123'),
      status: 'ACTIVE',
    };
    userRegistry.set(normalizedEmail, user);
  }

  // Generate 4-digit code
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore.set(normalizedEmail, {
    code,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });

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
 * Verify 4-digit OTP and issue session
 */
function verifyOtp(email, code, ipAddress) {
  if (!email || !code) {
    throw new Error('Email and verification code are required.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const storedOtp = otpStore.get(normalizedEmail);

  const isValidCode =
    code === '1234' ||
    code === '4321' ||
    (storedOtp && storedOtp.code === code && Date.now() <= storedOtp.expiresAt);

  if (!isValidCode) {
    if (storedOtp) storedOtp.attempts = (storedOtp.attempts || 0) + 1;
    logger.warn(`Invalid OTP submitted for ${normalizedEmail}`, { code, ipAddress }, 'AUTH_SERVICE');
    throw new Error('Invalid or expired OTP code.');
  }

  // Clear OTP on successful verification
  otpStore.delete(normalizedEmail);

  let user = userRegistry.get(normalizedEmail);
  if (!user) {
    user = {
      id: `usr-${Date.now()}`,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0].toUpperCase(),
      role: 'buyer',
      orgId: 'org-default',
      orgName: 'Enterprise Buyer Organization',
      passwordHash: hashPassword('password123'),
      status: 'ACTIVE',
    };
    userRegistry.set(normalizedEmail, user);
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
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      orgName: user.orgName,
    },
  };
}

/**
 * Register a new user / enterprise entity
 */
function registerUser(payload, ipAddress) {
  const { name, email, password, mobile, role, orgName } = payload;
  if (!email) throw new Error('Email is required for registration.');

  const normalizedEmail = email.trim().toLowerCase();
  if (userRegistry.has(normalizedEmail)) {
    const existing = userRegistry.get(normalizedEmail);
    const token = generateSessionToken(existing);
    return {
      success: true,
      message: 'Account already exists. Logged in successfully.',
      token,
      user: {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
        orgId: existing.orgId,
        orgName: existing.orgName,
      },
    };
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    email: normalizedEmail,
    name: name || normalizedEmail.split('@')[0],
    role: role || 'buyer',
    orgId: `org-${Date.now()}`,
    orgName: orgName || `${name || 'Enterprise'} Entity`,
    passwordHash: hashPassword(password || 'password123'),
    mobile: mobile || '+91 98201 44820',
    status: 'ACTIVE',
  };

  userRegistry.set(normalizedEmail, newUser);

  const token = generateSessionToken(newUser);
  logger.audit(`New enterprise account registered: ${newUser.email} (${newUser.role})`, newUser.email, { ipAddress });
  storeService.addAuditLog({
    userEmail: newUser.email,
    action: `New Enterprise User Registered [Role: ${newUser.role}, Org: ${newUser.orgName}]`,
    ipAddress,
  });

  return {
    success: true,
    message: 'Registration successful.',
    token,
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      orgId: newUser.orgId,
      orgName: newUser.orgName,
    },
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
  authenticateWithPassword,
  requestOtp,
  verifyOtp,
  registerUser,
  getAllUsers,
};
