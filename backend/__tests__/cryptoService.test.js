const cryptoService = require('../src/services/cryptoService');
const { AES_CONFIG } = require('../src/config/constants');
const crypto = require('crypto');

describe('AES-256-GCM Cryptographic Service', () => {
  const samplePlaintext = 'Procucev Enterprise Secret RFQ Budget: $5,000,000 USD';
  const customSecret = 'my-custom-256-bit-passphrase-secure';

  describe('encrypt and decrypt roundtrips', () => {
    test('should encrypt and decrypt plaintext using default master key', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext);
      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted).toHaveProperty('salt');
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.version).toBe('v1');
      expect(encrypted.encoded).toMatch(/^enc:v1:aes-256-gcm:/);

      const decrypted = cryptoService.decrypt(encrypted);
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt using compact string token', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext);
      const decrypted = cryptoService.decrypt(encrypted.encoded);
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt with custom secret key', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext, { secretKey: customSecret });
      const decrypted = cryptoService.decrypt(encrypted, { secretKey: customSecret });
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt with base64 encoding', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext, { encoding: 'base64' });
      expect(encrypted.encoding).toBe('base64');
      const decrypted = cryptoService.decrypt(encrypted, { encoding: 'base64' });
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt with Additional Authenticated Data (AAD)', () => {
      const aad = 'buyer_context_tenant_102';
      const encrypted = cryptoService.encrypt(samplePlaintext, { additionalData: aad });
      const decrypted = cryptoService.decrypt(encrypted, { additionalData: aad });
      expect(decrypted).toBe(samplePlaintext);

      // Decryption with incorrect AAD should fail
      expect(() => {
        cryptoService.decrypt(encrypted, { additionalData: 'wrong_tenant_id' });
      }).toThrow();
    });

    test('should handle objects and buffers as plaintext input', () => {
      const objData = { rfqId: 'rfq-991', budget: 45000 };
      const encObj = cryptoService.encrypt(objData);
      expect(encObj.ciphertext).toBeDefined();

      const bufferData = Buffer.from('binary-buffer-stream-content');
      const encBuf = cryptoService.encrypt(bufferData);
      expect(encBuf.ciphertext).toBeDefined();
    });
  });

  describe('Tamper Resistance & Error Handling', () => {
    test('should throw error when plaintext is missing in encrypt', () => {
      expect(() => cryptoService.encrypt(null)).toThrow('Plaintext data is required for AES encryption.');
      expect(() => cryptoService.encrypt(undefined)).toThrow('Plaintext data is required for AES encryption.');
    });

    test('should throw error when payload is missing in decrypt', () => {
      expect(() => cryptoService.decrypt(null)).toThrow('Encrypted payload is required for AES decryption.');
      expect(() => cryptoService.decrypt('')).toThrow('Encrypted payload is required for AES decryption.');
    });

    test('should throw error on invalid serialized token format', () => {
      expect(() => cryptoService.decrypt('invalid:string:token:too:many:colons')).toThrow(
        'Invalid serialized AES encrypted payload format.'
      );
      expect(() => cryptoService.decrypt('single_token_without_colons')).toThrow(
        'Invalid serialized AES encrypted payload format.'
      );
    });

    test('should throw error when payload type is unsupported', () => {
      expect(() => cryptoService.decrypt(12345)).toThrow('Unsupported payload type for AES decryption.');
    });

    test('should throw error on missing payload components in object', () => {
      expect(() => cryptoService.decrypt({ iv: '123' })).toThrow('Incomplete AES ciphertext payload components');
    });

    test('should fail when decrypting with wrong secret key', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext, { secretKey: 'key-alpha' });
      expect(() => {
        cryptoService.decrypt(encrypted, { secretKey: 'key-beta-incorrect' });
      }).toThrow();
    });

    test('should detect and reject tampered ciphertext', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext);
      const lastByte = encrypted.ciphertext.slice(-2);
      const newByte = lastByte === '00' ? 'ff' : '00';
      const tamperedCiphertext = encrypted.ciphertext.slice(0, -2) + newByte;
      const tamperedPayload = { ...encrypted, ciphertext: tamperedCiphertext };

      expect(() => cryptoService.decrypt(tamperedPayload)).toThrow();
    });

    test('should detect and reject tampered auth tag', () => {
      const encrypted = cryptoService.encrypt(samplePlaintext);
      const lastByte = encrypted.authTag.slice(-2);
      const newByte = lastByte === '00' ? 'ff' : '00';
      const tamperedTag = encrypted.authTag.slice(0, -2) + newByte;
      const tamperedPayload = { ...encrypted, authTag: tamperedTag };

      expect(() => cryptoService.decrypt(tamperedPayload)).toThrow();
    });


    test('should handle 3-part serialized string without salt', () => {
      const iv = crypto.randomBytes(12).toString('hex');
      const authTag = crypto.randomBytes(16).toString('hex');
      const ciphertext = crypto.randomBytes(32).toString('hex');
      const threePart = `enc:v1:aes-256-gcm:${iv}:${authTag}:${ciphertext}`;

      // Will attempt decrypt with 3-part format and fail tag validation
      expect(() => cryptoService.decrypt(threePart)).toThrow();
    });
  });

  describe('JSON, Field-level Encryption & Blind Indexing', () => {
    test('should encrypt and decrypt JSON data structures', () => {
      const payload = { vendorId: 'vnd-101', taxId: '27AAAAA0000A1Z5', rating: 94.5 };
      const enc = cryptoService.encryptJSON(payload);
      const dec = cryptoService.decryptJSON(enc);
      expect(dec).toEqual(payload);
    });

    test('should perform field-level encryption and decryption', () => {
      const sensitiveTax = '27ABCDE1234F1Z5';
      const encToken = cryptoService.encryptField(sensitiveTax, 'vendor_gstin');
      expect(encToken).toMatch(/^enc:v1:aes-256-gcm:/);

      const decrypted = cryptoService.decryptField(encToken, 'vendor_gstin');
      expect(decrypted).toBe(sensitiveTax);

      // Unencrypted or empty inputs should return unchanged
      expect(cryptoService.encryptField(null)).toBeNull();
      expect(cryptoService.encryptField(undefined)).toBeUndefined();
      expect(cryptoService.decryptField(null)).toBeNull();
      expect(cryptoService.decryptField('plain_unencrypted_string')).toBe('plain_unencrypted_string');
    });

    test('should generate deterministic blind index HMACs for searching', () => {
      const tax1 = '27ABCDE1234F1Z5';
      const tax2 = '27abcde1234f1z5'; // case-insensitive
      const hash1 = cryptoService.generateBlindIndex(tax1);
      const hash2 = cryptoService.generateBlindIndex(tax2);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);

      expect(cryptoService.generateBlindIndex(null)).toBe('');
      expect(cryptoService.generateBlindIndex(undefined)).toBe('');

      const customSaltHash = cryptoService.generateBlindIndex(tax1, 'custom-search-salt');
      expect(customSaltHash).not.toBe(hash1);
    });

    test('should rotate key from old secret to new secret', () => {
      const oldSecret = 'old-secret-key-phrase';
      const newSecret = 'new-secret-key-phrase-rotated';
      const original = 'Confidential Supplier Margin: 12.5%';

      const encryptedOld = cryptoService.encrypt(original, { secretKey: oldSecret });
      const reEncrypted = cryptoService.rotateKey(encryptedOld, oldSecret, newSecret);

      expect(reEncrypted.ciphertext).toBeDefined();
      const decryptedNew = cryptoService.decrypt(reEncrypted, { secretKey: newSecret });
      expect(decryptedNew).toBe(original);
    });
  });

  describe('Key Resolution & Health Self-Test', () => {
    test('should resolve key from 64-character hex master key', () => {
      const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const origEnv = process.env.AES_ENCRYPTION_KEY;
      process.env.AES_ENCRYPTION_KEY = hexKey;

      const { key, salt } = cryptoService.resolveKey();
      expect(key.length).toBe(32);
      expect(key.toString('hex')).toBe(hexKey);
      expect(salt.length).toBe(16);

      process.env.AES_ENCRYPTION_KEY = origEnv;
    });

    test('should resolve key with explicit salt as string or Buffer', () => {
      const explicitSaltBuf = crypto.randomBytes(16);
      const resBuf = cryptoService.resolveKey('test-secret', explicitSaltBuf);
      expect(resBuf.salt).toEqual(explicitSaltBuf);

      const explicitSaltHex = explicitSaltBuf.toString('hex');
      const resHex = cryptoService.resolveKey('test-secret', explicitSaltHex);
      expect(resHex.salt).toEqual(explicitSaltBuf);
    });

    test('should verify crypto health self-test', () => {
      const health = cryptoService.verifyCryptoHealth();
      expect(health.status).toBe('HEALTHY');
      expect(health.algorithm).toBe('aes-256-gcm');
      expect(health.keyLengthBits).toBe(256);
      expect(health.roundtripVerified).toBe(true);
      expect(health.tamperDetectionVerified).toBe(true);
      expect(health.timestamp).toBeDefined();
    });
  });
});
