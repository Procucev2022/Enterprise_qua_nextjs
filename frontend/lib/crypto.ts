import { AES_CONFIG } from './constants';
import type {
  EncryptedPayload,
  AESEncryptionOptions,
  DecryptionResult,
  CryptoHealthStatus,
} from './types';

/**
 * Convert Uint8Array buffer to hex string
 */
function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array buffer
 */
function hexToBuffer(hex: string): Uint8Array<ArrayBuffer> {
  const cleanHex = hex.trim();
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Get Web Crypto instance safely in browser, JSDOM, or SSR environments
 */
export function getWebCrypto(): Crypto {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto;
  }
  const nodeCrypto = eval('require')('crypto');
  return (nodeCrypto?.webcrypto ?? globalThis.crypto) as Crypto;
}







/**
 * Derive AES-GCM 256-bit CryptoKey using PBKDF2
 */
async function deriveAESKey(
  secretKey: string,
  // Pinned to ArrayBuffer (rather than the default ArrayBufferLike, which admits
  // SharedArrayBuffer) so the view satisfies the BufferSource contract.
  saltBytes: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const cryptoObj = getWebCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // Pass the TypedArray view itself rather than `.buffer`. Web Crypto accepts any
  // BufferSource, and a view preserves byteOffset/byteLength — `.buffer` would
  // expose the whole backing store and silently use the wrong bytes for any view
  // created via subarray(). It is also the only form that validates correctly when
  // the view originates from a realm other than the Web Crypto implementation's.
  return await cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: AES_CONFIG.PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_CONFIG.KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt arbitrary plaintext string using AES-256-GCM
 */
export async function encryptClientData(
  plaintext: string,
  secretKey?: string,
  options: AESEncryptionOptions = {}
): Promise<EncryptedPayload> {
  if (plaintext === undefined || plaintext === null) {
    throw new Error('Plaintext data is required for AES client encryption.');
  }

  const cryptoObj = getWebCrypto();
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(String(plaintext));

  const saltBytes = new Uint8Array(AES_CONFIG.SALT_LENGTH_BYTES);
  cryptoObj.getRandomValues(saltBytes);

  const ivBytes = new Uint8Array(AES_CONFIG.IV_LENGTH_BYTES);
  cryptoObj.getRandomValues(ivBytes);

  const keyPassphrase = secretKey || options.secretKey || 'enterprise-qua-ai-client-master-secret-key';
  const cryptoKey = await deriveAESKey(keyPassphrase, saltBytes);

  const aesParams: AesGcmParams = {
    name: 'AES-GCM',
    iv: ivBytes,
    tagLength: AES_CONFIG.TAG_LENGTH_BITS,
  };

  if (options.additionalData) {
    aesParams.additionalData = encoder.encode(options.additionalData);
  }

  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    aesParams,
    cryptoKey,
    plaintextBytes
  );


  const encryptedArray = new Uint8Array(encryptedBuffer);
  // Web Crypto AES-GCM appends 16-byte auth tag at the end of the ciphertext
  const tagLengthBytes = AES_CONFIG.TAG_LENGTH_BITS / 8;
  const ciphertextBytes = encryptedArray.subarray(0, encryptedArray.length - tagLengthBytes);
  const tagBytes = encryptedArray.subarray(encryptedArray.length - tagLengthBytes);

  const ivHex = bufferToHex(ivBytes);
  const tagHex = bufferToHex(tagBytes);
  const saltHex = bufferToHex(saltBytes);
  const ciphertextHex = bufferToHex(ciphertextBytes);

  const compactToken = `${AES_CONFIG.SERIALIZATION_PREFIX}${ivHex}:${tagHex}:${saltHex}:${ciphertextHex}`;

  return {
    ciphertext: ciphertextHex,
    iv: ivHex,
    authTag: tagHex,
    salt: saltHex,
    algorithm: AES_CONFIG.ALGORITHM,
    version: AES_CONFIG.VERSION,
    encoded: compactToken,
  };
}

/**
 * Decrypt AES-256-GCM payload and verify integrity
 */
export async function decryptClientData(
  payload: string | EncryptedPayload,
  secretKey?: string,
  options: AESEncryptionOptions = {}
): Promise<string> {
  if (!payload) {
    throw new Error('Encrypted payload is required for AES client decryption.');
  }

  let ivHex: string;
  let tagHex: string;
  let saltHex: string;
  let ciphertextHex: string;

  if (typeof payload === 'string') {
    let cleanStr = payload.trim();
    if (cleanStr.startsWith(AES_CONFIG.SERIALIZATION_PREFIX)) {
      cleanStr = cleanStr.substring(AES_CONFIG.SERIALIZATION_PREFIX.length);
    }
    const parts = cleanStr.split(':');
    if (parts.length === 4) {
      [ivHex, tagHex, saltHex, ciphertextHex] = parts;
    } else if (parts.length === 3) {
      [ivHex, tagHex, ciphertextHex] = parts;
      saltHex = '';
    } else {
      throw new Error('Invalid serialized AES encrypted token format.');
    }
  } else {
    ivHex = payload.iv;
    tagHex = payload.authTag;
    saltHex = payload.salt ?? '';
    ciphertextHex = payload.ciphertext;
  }

  if (!ivHex || !tagHex || !ciphertextHex) {
    throw new Error('Missing AES payload components (IV, Auth Tag, or Ciphertext).');
  }

  const cryptoObj = getWebCrypto();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const ivBytes = hexToBuffer(ivHex);
  const tagBytes = hexToBuffer(tagHex);
  const saltBytes = saltHex ? hexToBuffer(saltHex) : new Uint8Array(AES_CONFIG.SALT_LENGTH_BYTES);
  const ciphertextBytes = hexToBuffer(ciphertextHex);

  // Combine ciphertext and auth tag for Web Crypto SubtleCrypto
  const combinedBuffer = new Uint8Array(ciphertextBytes.length + tagBytes.length);
  combinedBuffer.set(ciphertextBytes, 0);
  combinedBuffer.set(tagBytes, ciphertextBytes.length);

  const keyPassphrase = secretKey || options.secretKey || 'enterprise-qua-ai-client-master-secret-key';
  const cryptoKey = await deriveAESKey(keyPassphrase, saltBytes);

  const aesParams: AesGcmParams = {
    name: 'AES-GCM',
    iv: ivBytes,
    tagLength: AES_CONFIG.TAG_LENGTH_BITS,
  };

  if (options.additionalData) {
    aesParams.additionalData = encoder.encode(options.additionalData);
  }

  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    aesParams,
    cryptoKey,
    combinedBuffer
  );


  return decoder.decode(decryptedBuffer);
}

/**
 * Safely decrypt client data and return structured result without throwing
 */
export async function safeDecryptClientData<T = string>(
  payload: string | EncryptedPayload,
  secretKey?: string,
  options: AESEncryptionOptions = {}
): Promise<DecryptionResult<T>> {
  try {
    const plaintext = await decryptClientData(payload, secretKey, options);
    try {
      const parsed = JSON.parse(plaintext) as T;
      return { success: true, data: parsed };
    } catch {
      return { success: true, data: plaintext as unknown as T };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Decryption error';
    return { success: false, error: errorMsg };
  }
}

/**
 * Encrypt client-side localStorage / sessionStorage value
 */
export async function encryptStorage(
  key: string,
  value: unknown,
  secretKey?: string
): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const jsonString = JSON.stringify(value);
  const encrypted = await encryptClientData(jsonString, secretKey, { additionalData: key });
  window.localStorage.setItem(`enc_${key}`, encrypted.encoded ?? '');
}

/**
 * Decrypt client-side localStorage / sessionStorage value
 */
export async function decryptStorage<T>(
  key: string,
  secretKey?: string
): Promise<T | null> {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const encryptedStr = window.localStorage.getItem(`enc_${key}`);
  if (!encryptedStr) return null;

  const result = await safeDecryptClientData<T>(encryptedStr, secretKey, { additionalData: key });
  return result.success && result.data !== undefined ? result.data : null;
}

/**
 * Encrypt sensitive fields in a form submission payload
 */
export async function encryptSensitiveFormPayload(
  formData: Record<string, string | number | boolean>,
  sensitiveFields: string[] = ['gstin', 'bankAccount', 'phoneNumber', 'unitPrice', 'totalPrice'],
  secretKey?: string
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...formData };

  for (const field of sensitiveFields) {
    if (result[field] !== undefined && result[field] !== null) {
      const rawVal = String(result[field]);
      const enc = await encryptClientData(rawVal, secretKey, { additionalData: field });
      result[`${field}_encrypted`] = enc.encoded;
    }
  }

  return result;
}

/**
 * Run client-side cryptographic self-test and return health status
 */
export async function verifyClientCryptoHealth(): Promise<CryptoHealthStatus> {
  const testPhrase = `client-crypto-test-${Date.now()}`;
  const testSecret = 'client-diagnostic-test-key-32b';

  let roundtripVerified = false;
  let tamperDetectionVerified = false;

  try {
    const enc = await encryptClientData(testPhrase, testSecret);
    const dec = await decryptClientData(enc.encoded ?? '', testSecret);
    roundtripVerified = dec === testPhrase;

    try {
      // Modify tag to test tamper detection
      const lastByte = enc.authTag.slice(-2);
      const newByte = lastByte === '00' ? 'ff' : '00';
      const tamperedTag = enc.authTag.slice(0, -2) + newByte;
      await decryptClientData(
        { ...enc, authTag: tamperedTag },
        testSecret
      );
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
    keyLengthBits: AES_CONFIG.KEY_LENGTH_BITS,
    roundtripVerified,
    tamperDetectionVerified,
    timestamp: new Date().toISOString(),
  };
}
