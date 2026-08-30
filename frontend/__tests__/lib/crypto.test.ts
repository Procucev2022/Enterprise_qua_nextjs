import {
  encryptClientData,
  decryptClientData,
  safeDecryptClientData,
  encryptStorage,
  decryptStorage,
  encryptSensitiveFormPayload,
  verifyClientCryptoHealth,
  getWebCrypto,
} from '@/lib/crypto';
import { AES_CONFIG } from '@/lib/constants';


describe('Frontend AES-256-GCM Web Crypto Library', () => {
  const samplePlaintext = 'Confidential Vendor Bank Account: AC-9876543210';
  const customSecret = 'my-custom-client-secret-passphrase-32b';

  beforeEach(() => {
    localStorage.clear();
  });

  describe('encryptClientData and decryptClientData', () => {
    test('should encrypt and decrypt plaintext using default client secret', async () => {
      const encrypted = await encryptClientData(samplePlaintext);

      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted).toHaveProperty('salt');
      expect(encrypted.algorithm).toBe(AES_CONFIG.ALGORITHM);
      expect(encrypted.version).toBe(AES_CONFIG.VERSION);
      expect(encrypted.encoded).toMatch(/^enc:v1:aes-256-gcm:/);

      const decrypted = await decryptClientData(encrypted);
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt using compact string token', async () => {
      const encrypted = await encryptClientData(samplePlaintext);
      expect(encrypted.encoded).toBeDefined();

      const decrypted = await decryptClientData(encrypted.encoded ?? '');
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt with custom secret passphrase', async () => {
      const encrypted = await encryptClientData(samplePlaintext, customSecret);
      const decrypted = await decryptClientData(encrypted, customSecret);
      expect(decrypted).toBe(samplePlaintext);
    });

    test('should encrypt and decrypt with Additional Authenticated Data (AAD)', async () => {
      const aad = 'vendor_kyc_verification_context';
      const encrypted = await encryptClientData(samplePlaintext, customSecret, { additionalData: aad });
      const decrypted = await decryptClientData(encrypted, customSecret, { additionalData: aad });
      expect(decrypted).toBe(samplePlaintext);

      // Decryption with mismatched AAD must reject
      await expect(
        decryptClientData(encrypted, customSecret, { additionalData: 'wrong_aad_context' })
      ).rejects.toThrow();
    });
  });

  describe('Error handling & Tamper rejection', () => {
    test('should throw error when encrypting null or undefined plaintext', async () => {
      // @ts-expect-error test invalid argument
      await expect(encryptClientData(null)).rejects.toThrow('Plaintext data is required for AES client encryption.');
      // @ts-expect-error test invalid argument
      await expect(encryptClientData(undefined)).rejects.toThrow('Plaintext data is required for AES client encryption.');
    });

    test('should throw error when payload is empty or invalid in decrypt', async () => {
      await expect(decryptClientData('')).rejects.toThrow('Encrypted payload is required for AES client decryption.');
      await expect(decryptClientData('invalid:serialized:token:with:too:many:parts')).rejects.toThrow(
        'Invalid serialized AES encrypted token format.'
      );
    });

    test('should throw error when payload components are missing', async () => {
      // @ts-expect-error test incomplete payload object
      await expect(decryptClientData({ iv: '123' })).rejects.toThrow('Missing AES payload components');
    });


    test('should reject decryption with wrong secret passphrase', async () => {
      const encrypted = await encryptClientData(samplePlaintext, 'correct-passphrase-alpha');
      await expect(
        decryptClientData(encrypted, 'wrong-passphrase-beta')
      ).rejects.toThrow();
    });

    test('should reject tampered ciphertext or auth tag', async () => {
      const encrypted = await encryptClientData(samplePlaintext);
      const tamperedCiphertext = encrypted.ciphertext.slice(0, -2) + (encrypted.ciphertext.endsWith('0') ? '1' : '0');
      const tamperedPayload = { ...encrypted, ciphertext: tamperedCiphertext };

      await expect(decryptClientData(tamperedPayload)).rejects.toThrow();
    });
  });

  describe('safeDecryptClientData, Storage Encryption & Form Payload', () => {
    test('safeDecryptClientData should return success: true for string and parsed JSON data', async () => {
      const strEnc = await encryptClientData('Hello Secure World');
      const resStr = await safeDecryptClientData(strEnc);
      expect(resStr.success).toBe(true);
      expect(resStr.data).toBe('Hello Secure World');

      const jsonPayload = { taxId: '29ABCDE1234F1Z5', score: 98 };
      const jsonEnc = await encryptClientData(JSON.stringify(jsonPayload));
      const resJson = await safeDecryptClientData<typeof jsonPayload>(jsonEnc);
      expect(resJson.success).toBe(true);
      expect(resJson.data).toEqual(jsonPayload);
    });

    test('safeDecryptClientData should return success: false on tampered data without throwing', async () => {
      const res = await safeDecryptClientData('corrupted_payload_string');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    test('encryptStorage and decryptStorage should store and retrieve encrypted localStorage items', async () => {
      const sensitiveSession = { userId: 'usr-901', token: 'jwt-secure-session-token' };
      await encryptStorage('auth_session', sensitiveSession, customSecret);

      const storedEnc = localStorage.getItem('enc_auth_session');
      expect(storedEnc).toBeDefined();
      expect(storedEnc).toMatch(/^enc:v1:aes-256-gcm:/);

      const retrieved = await decryptStorage<typeof sensitiveSession>('auth_session', customSecret);
      expect(retrieved).toEqual(sensitiveSession);

      // Non-existent key should return null
      const nonExistent = await decryptStorage('missing_key');
      expect(nonExistent).toBeNull();
    });

    test('encryptSensitiveFormPayload should encrypt targeted sensitive form fields and skip undefined/null', async () => {
      const formData = {
        vendorName: 'Apex Industrial',
        gstin: '29ABCDE1234F1Z5',
        phoneNumber: '+91 9876543210',
        contactPerson: 'Alex Taylor',
        bankAccount: undefined,
        unitPrice: null as unknown as string,
      };

      const encryptedForm = await encryptSensitiveFormPayload(
        formData as unknown as Record<string, string | number | boolean>,
        ['gstin', 'phoneNumber', 'bankAccount', 'unitPrice'],
        customSecret
      );
      expect(encryptedForm.vendorName).toBe('Apex Industrial');
      expect(encryptedForm.contactPerson).toBe('Alex Taylor');
      expect(typeof encryptedForm.gstin_encrypted).toBe('string');
      expect(encryptedForm.gstin_encrypted as string).toMatch(/^enc:v1:aes-256-gcm:/);
      expect(typeof encryptedForm.phoneNumber_encrypted).toBe('string');
    });

    test('should encrypt and decrypt using options.secretKey parameter', async () => {
      const encrypted = await encryptClientData('Sample Text', undefined, { secretKey: 'options-secret-key-32b' });
      const decrypted = await decryptClientData(encrypted, undefined, { secretKey: 'options-secret-key-32b' });
      expect(decrypted).toBe('Sample Text');
    });

    test('should handle payload object with undefined salt and 3-part serialized string format', async () => {
      const encrypted = await encryptClientData('Three Part Text');
      const threePartToken = `${encrypted.iv}:${encrypted.authTag}:${encrypted.ciphertext}`;
      
      // Attempting to decrypt 3-part token without correct salt derivation should reject cleanly
      await expect(decryptClientData(threePartToken)).rejects.toThrow();

      // Object with undefined salt
      const noSaltPayload = {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        algorithm: 'AES-GCM',
        version: 'v1',
      };
      await expect(decryptClientData(noSaltPayload)).rejects.toThrow();

      // Missing iv, authTag, or ciphertext individual branches
      // @ts-expect-error test missing iv
      await expect(decryptClientData({ authTag: 'tag', ciphertext: 'cipher' })).rejects.toThrow();
      // @ts-expect-error test missing authTag
      await expect(decryptClientData({ iv: 'iv', ciphertext: 'cipher' })).rejects.toThrow();
      // @ts-expect-error test missing ciphertext
      await expect(decryptClientData({ iv: 'iv', authTag: 'tag' })).rejects.toThrow();
    });

    test('should decrypt serialized token without enc:v1: prefix', async () => {
      const enc = await encryptClientData('Direct token without prefix');
      const tokenWithoutPrefix = `${enc.iv}:${enc.authTag}:${enc.salt}:${enc.ciphertext}`;
      const dec = await decryptClientData(tokenWithoutPrefix);
      expect(dec).toBe('Direct token without prefix');
    });

    test('safeDecryptClientData should catch non-Error thrown values', async () => {
      // Pass a non-string / invalid object that triggers catch
      const res = await safeDecryptClientData(null as unknown as string);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();

      const cryptoSubtle = getWebCrypto().subtle;
      const importSpy = jest.spyOn(cryptoSubtle, 'importKey').mockImplementationOnce(() => {
        throw 'Raw string throw';
      });
      const validPayload = {
        iv: '0123456789abcdef01234567',
        authTag: '0123456789abcdef0123456789abcdef',
        ciphertext: 'abcdef',
        salt: '1234567890abcdef1234567890abcdef',
        algorithm: 'AES-GCM',
        version: 'v1',
      };
      const resStringThrow = await safeDecryptClientData(validPayload);
      expect(resStringThrow.success).toBe(false);
      expect(resStringThrow.error).toBe('Decryption error');
      importSpy.mockRestore();
    });

    test('storage methods handle missing localStorage safely', async () => {
      const origStorage = window.localStorage;
      Object.defineProperty(window, 'localStorage', {
        value: null,
        writable: true,
        configurable: true,
      });

      await expect(encryptStorage('key', 'val')).resolves.toBeUndefined();
      await expect(decryptStorage('key')).resolves.toBeNull();

      Object.defineProperty(window, 'localStorage', {
        value: origStorage,
        writable: true,
        configurable: true,
      });
    });

    test('verifyClientCryptoHealth handles failure gracefully', async () => {
      jest.restoreAllMocks();

      // Standard run
      const health = await verifyClientCryptoHealth();
      expect(health.status).toBe('HEALTHY');
      expect(health.algorithm).toBe(AES_CONFIG.ALGORITHM);
      expect(health.keyLengthBits).toBe(256);
      expect(health.roundtripVerified).toBe(true);
      expect(health.tamperDetectionVerified).toBe(true);

      // Simulated failure in outer catch block
      const cryptoSubtle = getWebCrypto().subtle;
      jest.spyOn(cryptoSubtle, 'importKey').mockImplementationOnce(() => {
        throw new Error('Hardware error');
      });
      const failedHealth = await verifyClientCryptoHealth();
      expect(failedHealth.status).toBe('DEGRADED');
      expect(failedHealth.roundtripVerified).toBe(false);
      jest.restoreAllMocks();
    });

    test('getWebCrypto returns window.crypto when subtle is available', () => {
      const subtleObj = getWebCrypto().subtle;
      Object.defineProperty(window.crypto, 'subtle', {
        value: subtleObj,
        configurable: true,
      });

      const instance = getWebCrypto();
      expect(instance).toBe(window.crypto);

      Object.defineProperty(window.crypto, 'subtle', {
        value: undefined,
        configurable: true,
      });
    });
  });
});





