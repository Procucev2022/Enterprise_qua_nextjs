const crypto = require('crypto');
const { AES_CONFIG } = require('../config/constants');

/**
 * Resolve 32-byte encryption key
 * @param {string} [customSecret] - Optional secret or hex key
 * @param {Buffer|string} [salt] - Salt for PBKDF2 derivation
 * @returns {{ key: Buffer, salt: Buffer }}
 */
function resolveKey(customSecret, salt) {
  const secret =
    customSecret ||
    process.env.AES_ENCRYPTION_KEY ||
    process.env.AES_SECRET_KEY ||
    'enterprise-qua-ai-default-master-encryption-key-256b';

  let saltBuffer;
  if (salt) {
    saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
  } else {
    saltBuffer = crypto.randomBytes(AES_CONFIG.SALT_LENGTH_BYTES);
  }

  // If secret is already a 64-character hex string representing 32 bytes
  if (typeof secret === 'string' && /^[0-9a-fA-F]{64}$/.test(secret) && !customSecret) {
    return {
      key: Buffer.from(secret, 'hex'),
      salt: saltBuffer,
    };
  }

  // Derive 32-byte key using PBKDF2
  const derivedKey = crypto.pbkdf2Sync(
    secret,
    saltBuffer,
    AES_CONFIG.PBKDF2_ITERATIONS,
    AES_CONFIG.KEY_LENGTH_BYTES,
    AES_CONFIG.PBKDF2_DIGEST
  );

  return {
    key: derivedKey,
    salt: saltBuffer,
  };
}

/**
 * Encrypt arbitrary plaintext using AES-256-GCM
 * @param {string|Buffer|object} plaintext - Data to encrypt
 * @param {object} [options] - Encryption options
 * @param {string} [options.secretKey] - Custom encryption key/passphrase
 * @param {string} [options.additionalData] - Additional Authenticated Data (AAD)
 * @param {string} [options.encoding] - Output encoding ('hex' or 'base64')
 * @returns {object} - Structured encrypted payload with compact encoded representation
 */
function encrypt(plaintext, options = {}) {
  if (plaintext === undefined || plaintext === null) {
    throw new Error('Plaintext data is required for AES encryption.');
  }

  const textToEncrypt = typeof plaintext === 'object' && !Buffer.isBuffer(plaintext)
    ? JSON.stringify(plaintext)
    : String(plaintext);

  const encoding = options.encoding === 'base64' ? 'base64' : 'hex';
  const { key, salt } = resolveKey(options.secretKey);
  const iv = crypto.randomBytes(AES_CONFIG.IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(AES_CONFIG.ALGORITHM, key, iv);

  if (options.additionalData) {
    cipher.setAAD(Buffer.from(String(options.additionalData), 'utf8'));
  }

  const encryptedBuffer = Buffer.concat([
    cipher.update(textToEncrypt, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  const ivStr = iv.toString(encoding);
  const authTagStr = authTag.toString(encoding);
  const saltStr = salt.toString(encoding);
  const ciphertextStr = encryptedBuffer.toString(encoding);

  const compactToken = `${AES_CONFIG.SERIALIZATION_PREFIX}${ivStr}:${authTagStr}:${saltStr}:${ciphertextStr}`;

  return {
    ciphertext: ciphertextStr,
    iv: ivStr,
    authTag: authTagStr,
    salt: saltStr,
    algorithm: AES_CONFIG.ALGORITHM,
    version: AES_CONFIG.VERSION,
    encoding,
    encoded: compactToken,
  };
}

/**
 * Decrypt an AES-256-GCM payload
 * @param {string|object} payload - Encrypted string token or structured payload object
 * @param {object} [options] - Decryption options
 * @param {string} [options.secretKey] - Custom secret key/passphrase
 * @param {string} [options.additionalData] - AAD associated with ciphertext
 * @param {string} [options.encoding] - Encoding ('hex' or 'base64')
 * @returns {string} - Decrypted plaintext string
 */
function decrypt(payload, options = {}) {
  if (!payload) {
    throw new Error('Encrypted payload is required for AES decryption.');
  }

  let ivStr;
  let authTagStr;
  let saltStr;
  let ciphertextStr;
  let encoding = options.encoding || 'hex';

  if (typeof payload === 'string') {
    let cleanStr = payload.trim();
    if (cleanStr.startsWith(AES_CONFIG.SERIALIZATION_PREFIX)) {
      cleanStr = cleanStr.substring(AES_CONFIG.SERIALIZATION_PREFIX.length);
    } else if (cleanStr.startsWith('enc:v1:')) {
      cleanStr = cleanStr.substring(cleanStr.indexOf(':', 7) + 1);
    }

    const parts = cleanStr.split(':');
    if (parts.length === 4) {
      [ivStr, authTagStr, saltStr, ciphertextStr] = parts;
    } else if (parts.length === 3) {
      [ivStr, authTagStr, ciphertextStr] = parts;
      saltStr = '';
    } else {
      throw new Error('Invalid serialized AES encrypted payload format.');
    }
  } else if (typeof payload === 'object') {
    ivStr = payload.iv;
    authTagStr = payload.authTag;
    saltStr = payload.salt || '';
    ciphertextStr = payload.ciphertext;
    if (payload.encoding) {
      encoding = payload.encoding;
    }
  } else {
    throw new Error('Unsupported payload type for AES decryption.');
  }

  if (!ivStr || !authTagStr || !ciphertextStr) {
    throw new Error('Incomplete AES ciphertext payload components (missing IV, Auth Tag, or Ciphertext).');
  }

  const enc = encoding === 'base64' ? 'base64' : 'hex';
  const iv = Buffer.from(ivStr, enc);
  const authTag = Buffer.from(authTagStr, enc);
  const ciphertext = Buffer.from(ciphertextStr, enc);
  const salt = saltStr ? Buffer.from(saltStr, enc) : null;

  const { key } = resolveKey(options.secretKey, salt);

  const decipher = crypto.createDecipheriv(AES_CONFIG.ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  if (options.additionalData) {
    decipher.setAAD(Buffer.from(String(options.additionalData), 'utf8'));
  }

  const decryptedBuffer = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decryptedBuffer.toString('utf8');
}

/**
 * Encrypt structured JSON data
 * @param {object|Array} data
 * @param {object} [options]
 * @returns {object} - Encrypted payload
 */
function encryptJSON(data, options = {}) {
  return encrypt(JSON.stringify(data), options);
}

/**
 * Decrypt structured JSON data
 * @param {string|object} payload
 * @param {object} [options]
 * @returns {any} - Parsed JSON object
 */
function decryptJSON(payload, options = {}) {
  const plaintext = decrypt(payload, options);
  return JSON.parse(plaintext);
}

/**
 * Field-level encryption for database entities
 * @param {string|number} value
 * @param {string} fieldKey - Identifier of the field for context/salt
 * @param {object} [options]
 * @returns {string} - Compact serialized encrypted token
 */
function encryptField(value, fieldKey = 'default_field', options = {}) {
  if (value === undefined || value === null) return value;
  const result = encrypt(String(value), {
    ...options,
    additionalData: fieldKey,
  });
  return result.encoded;
}

/**
 * Field-level decryption for database entities
 * @param {string} encryptedValue
 * @param {string} fieldKey - Identifier of the field for context/salt
 * @param {object} [options]
 * @returns {string} - Decrypted plaintext value
 */
function decryptField(encryptedValue, fieldKey = 'default_field', options = {}) {
  if (!encryptedValue || typeof encryptedValue !== 'string') return encryptedValue;
  if (!encryptedValue.startsWith('enc:v1:')) return encryptedValue;
  return decrypt(encryptedValue, {
    ...options,
    additionalData: fieldKey,
  });
}

/**
 * Generate a deterministic blind index hash (HMAC-SHA256) for searching encrypted columns
 * @param {string} value - Raw search query or field value
 * @param {string} [customSalt] - Optional salt
 * @returns {string} - Hex-encoded HMAC hash
 */
function generateBlindIndex(value, customSalt = 'blind-index-salt') {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim().toLowerCase();
  const hmacKey = process.env.AES_SECRET_KEY || 'blind-index-master-secret-key-256b';
  return crypto.createHmac('sha256', hmacKey).update(`${customSalt}:${normalized}`).digest('hex');
}

/**
 * Rotate encryption key for a given payload
 * @param {string|object} payload - Existing encrypted payload
 * @param {string} oldSecretKey - Old key/passphrase
 * @param {string} newSecretKey - New key/passphrase
 * @param {object} [options]
 * @returns {object} - Re-encrypted payload with new key
 */
function rotateKey(payload, oldSecretKey, newSecretKey, options = {}) {
  const decrypted = decrypt(payload, { ...options, secretKey: oldSecretKey });
  return encrypt(decrypted, { ...options, secretKey: newSecretKey });
}

/**
 * Execute cryptographic health diagnostic self-test
 * @returns {object} - Health verification report
 */
function verifyCryptoHealth() {
  const testPlaintext = `procucev-crypto-test-${Date.now()}`;
  const customSecret = 'diagnostic-test-secret-phrase-key';
  
  let roundtripVerified = false;
  let tamperDetectionVerified = false;

  try {
    // 1. Test standard roundtrip
    const enc = encrypt(testPlaintext, { secretKey: customSecret });
    const dec = decrypt(enc.encoded, { secretKey: customSecret });
    roundtripVerified = dec === testPlaintext;

    // 2. Test tamper detection (tamper with ciphertext)
    try {
      const tamperedPayload = {
        ...enc,
        ciphertext: enc.ciphertext.slice(0, -2) + (enc.ciphertext.endsWith('a') ? 'b' : 'a'),
      };
      decrypt(tamperedPayload, { secretKey: customSecret });
      tamperDetectionVerified = false;
    } catch {
      tamperDetectionVerified = true;
    }
  } catch {
    roundtripVerified = false;
  }

  const isHealthy = roundtripVerified && tamperDetectionVerified;

  return {
    status: isHealthy ? 'HEALTHY' : 'DEGRADED',
    algorithm: AES_CONFIG.ALGORITHM,
    keyLengthBits: AES_CONFIG.KEY_LENGTH_BYTES * 8,
    ivLengthBytes: AES_CONFIG.IV_LENGTH_BYTES,
    authTagLengthBytes: AES_CONFIG.AUTH_TAG_LENGTH_BYTES,
    iterations: AES_CONFIG.PBKDF2_ITERATIONS,
    roundtripVerified,
    tamperDetectionVerified,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  encryptField,
  decryptField,
  generateBlindIndex,
  rotateKey,
  verifyCryptoHealth,
  resolveKey,
};
