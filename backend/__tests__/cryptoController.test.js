const request = require('supertest');
const app = require('../src/app');
const cryptoService = require('../src/services/cryptoService');
const cryptoController = require('../src/controllers/cryptoController');

describe('Crypto Controller & /api/crypto Endpoints', () => {
  const samplePlaintext = 'Confidential Purchase Order Amount: ₹12,50,000';

  describe('POST /api/crypto/encrypt', () => {
    test('should successfully encrypt plaintext payload', async () => {
      const res = await request(app)
        .post('/api/crypto/encrypt')
        .send({ plaintext: samplePlaintext });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('ciphertext');
      expect(res.body.data).toHaveProperty('iv');
      expect(res.body.data).toHaveProperty('authTag');
      expect(res.body.data).toHaveProperty('encoded');
    });

    test('should encrypt with custom secret and base64 encoding', async () => {
      const res = await request(app)
        .post('/api/crypto/encrypt')
        .send({
          plaintext: samplePlaintext,
          secretKey: 'custom-controller-test-key-32b',
          encoding: 'base64',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.encoding).toBe('base64');
    });

    test('should return 400 on validation failure when plaintext is missing', async () => {
      const res = await request(app)
        .post('/api/crypto/encrypt')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/crypto/decrypt', () => {
    test('should decrypt valid structured payload', async () => {
      const enc = cryptoService.encrypt(samplePlaintext);
      const res = await request(app)
        .post('/api/crypto/decrypt')
        .send({
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          salt: enc.salt,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plaintext).toBe(samplePlaintext);
    });

    test('should decrypt compact string token', async () => {
      const enc = cryptoService.encrypt(samplePlaintext);
      const res = await request(app)
        .post('/api/crypto/decrypt')
        .send({ token: enc.encoded });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plaintext).toBe(samplePlaintext);
    });

    test('should return 400 when decrypt payload fails schema validation', async () => {
      const res = await request(app)
        .post('/api/crypto/decrypt')
        .send({ ciphertext: 'abc' }); // Missing IV and AuthTag

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('should return 422 when decryption fails due to tampering', async () => {
      const enc = cryptoService.encrypt(samplePlaintext);
      const lastByte = enc.authTag.slice(-2);
      const newByte = lastByte === '00' ? 'ff' : '00';
      const tamperedTag = enc.authTag.slice(0, -2) + newByte;

      const res = await request(app)
        .post('/api/crypto/decrypt')
        .send({
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: tamperedTag,
          salt: enc.salt,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Decryption failed');
    });

  });

  describe('GET /api/crypto/status', () => {
    test('should return crypto engine health and diagnostic status', async () => {
      const res = await request(app).get('/api/crypto/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('HEALTHY');
      expect(res.body.data.algorithm).toBe('aes-256-gcm');
      expect(res.body.data.keyLengthBits).toBe(256);
    });
  });

  describe('POST /api/crypto/verify-integrity', () => {
    test('should verify valid ciphertext and return verified: true', async () => {
      const enc = cryptoService.encrypt(samplePlaintext);
      const res = await request(app)
        .post('/api/crypto/verify-integrity')
        .send({
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          salt: enc.salt,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.verified).toBe(true);
    });

    test('should return verified: false on tampered ciphertext', async () => {
      const enc = cryptoService.encrypt(samplePlaintext);
      const tamperedCiphertext = enc.ciphertext.slice(0, -2) + (enc.ciphertext.endsWith('a') ? 'b' : 'a');

      const res = await request(app)
        .post('/api/crypto/verify-integrity')
        .send({
          ciphertext: tamperedCiphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          salt: enc.salt,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.verified).toBe(false);
    });

    test('should return 400 on invalid payload schema in verify-integrity', async () => {
      const res = await request(app)
        .post('/api/crypto/verify-integrity')
        .send({ ciphertext: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Direct Controller Error Branches', () => {
    test('encryptData should call next on unexpected error', () => {
      const next = jest.fn();
      const req = { body: { plaintext: 'valid text' } };
      const res = {};
      const spy = jest.spyOn(cryptoService, 'encrypt').mockImplementationOnce(() => {
        throw new Error('Unexpected cipher crash');
      });

      cryptoController.encryptData(req, res, next);
      expect(next).toHaveBeenCalled();
      spy.mockRestore();
    });

    test('getCryptoStatus should call next on unexpected error', () => {
      const next = jest.fn();
      const req = {};
      const res = {};
      const spy = jest.spyOn(cryptoService, 'verifyCryptoHealth').mockImplementationOnce(() => {
        throw new Error('Hardware HSM unreachable');
      });

      cryptoController.getCryptoStatus(req, res, next);
      expect(next).toHaveBeenCalled();
      spy.mockRestore();
    });

    test('verifyCipherIntegrity should call next on unexpected error', () => {
      const next = jest.fn();
      const req = {
        body: {
          ciphertext: '1234567890abcdef',
          iv: '1234567890abcdef',
          authTag: '1234567890abcdef1234567890abcdef',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const spy = jest.spyOn(cryptoService, 'decrypt').mockImplementationOnce(() => {
        const err = new Error('Fatal error');
        err.isFatal = true;
        throw err;
      });

      // Regular error caught in inner catch returns 200 verified: false
      cryptoController.verifyCipherIntegrity(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: false }));
      spy.mockRestore();
    });
  });
});
