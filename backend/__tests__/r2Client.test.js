const r2Client = require('../src/services/r2Client');

describe('r2Client', () => {
  const originalCfEnv = globalThis.__CF_ENV__;

  afterEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
    globalThis.__CF_ENV__ = originalCfEnv;
  });

  // Same globalThis.__CF_ENV__ pattern as d1Bridge.js's getD1Binding() —
  // worker.mjs is the only file that can `import { env } from
  // 'cloudflare:workers'`, so it stashes the whole env object there.
  describe('getBinding', () => {
    it('returns null when globalThis.__CF_ENV__ was never set (Node/Render)', () => {
      delete globalThis.__CF_ENV__;
      expect(r2Client.getBinding()).toBeNull();
    });

    it('returns env.R2_BUCKET when worker.mjs has stashed the binding on globalThis', () => {
      const fakeBucket = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
      globalThis.__CF_ENV__ = { R2_BUCKET: fakeBucket };
      expect(r2Client.getBinding()).toBe(fakeBucket);
    });

    it('returns null when globalThis.__CF_ENV__ is set but has no R2_BUCKET binding', () => {
      globalThis.__CF_ENV__ = {};
      expect(r2Client.getBinding()).toBeNull();
    });
  });

  describe('getClient', () => {
    test('returns undefined when R2 env vars are not set', () => {
      let freshR2Client;
      jest.isolateModules(() => {
        freshR2Client = require('../src/services/r2Client');
      });
      expect(freshR2Client.getClient()).toBeUndefined();
    });

    test('builds an S3Client from R2_* env vars, deriving the default endpoint, and caches it across calls', () => {
      let freshR2Client;
      let capturedConfig;
      let S3ClientMock;
      jest.isolateModules(() => {
        process.env.R2_ACCOUNT_ID = 'acct-123';
        process.env.R2_ACCESS_KEY_ID = 'key-id';
        process.env.R2_SECRET_ACCESS_KEY = 'secret';
        S3ClientMock = jest.fn().mockImplementation((config) => {
          capturedConfig = config;
          return { __mockS3Client: true };
        });
        jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: S3ClientMock }));
        freshR2Client = require('../src/services/r2Client');
      });

      const client = freshR2Client.getClient();
      expect(client).toEqual({ __mockS3Client: true });
      expect(capturedConfig).toMatchObject({
        region: 'auto',
        endpoint: 'https://acct-123.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'key-id', secretAccessKey: 'secret' },
      });

      // Second call reuses the cached client (getClient's early-return branch).
      freshR2Client.getClient();
      expect(S3ClientMock).toHaveBeenCalledTimes(1);
    });

    test('honours an explicit R2_ENDPOINT override', () => {
      let freshR2Client;
      let capturedConfig;
      jest.isolateModules(() => {
        process.env.R2_ACCOUNT_ID = 'acct-123';
        process.env.R2_ACCESS_KEY_ID = 'key-id';
        process.env.R2_SECRET_ACCESS_KEY = 'secret';
        process.env.R2_ENDPOINT = 'https://custom.endpoint.example.com';
        jest.doMock('@aws-sdk/client-s3', () => ({
          S3Client: jest.fn().mockImplementation((config) => {
            capturedConfig = config;
            return {};
          }),
        }));
        freshR2Client = require('../src/services/r2Client');
      });

      freshR2Client.getClient();
      expect(capturedConfig.endpoint).toBe('https://custom.endpoint.example.com');
    });

    test('does not permanently cache a failed construction attempt', () => {
      // A construction that throws (as the real S3Client does under Workers —
      // see getBinding()'s comment) must not mark clientInitialized true,
      // otherwise every later call in the same isolate would silently return
      // undefined ("R2 isn't configured") instead of surfacing the error again.
      let freshR2Client;
      let callCount = 0;
      jest.isolateModules(() => {
        process.env.R2_ACCOUNT_ID = 'acct-123';
        process.env.R2_ACCESS_KEY_ID = 'key-id';
        process.env.R2_SECRET_ACCESS_KEY = 'secret';
        jest.doMock('@aws-sdk/client-s3', () => ({
          S3Client: jest.fn().mockImplementation(() => {
            callCount += 1;
            if (callCount === 1) throw new Error('emitWarningIfUnsupportedVersion$1 is not a function');
            return { __mockS3Client: true };
          }),
        }));
        freshR2Client = require('../src/services/r2Client');
      });

      expect(() => freshR2Client.getClient()).toThrow('emitWarningIfUnsupportedVersion$1');
      expect(freshR2Client.getClient()).toEqual({ __mockS3Client: true });
      expect(callCount).toBe(2);
    });
  });

  describe('isConfigured', () => {
    test('reflects whether all three required env vars are set', () => {
      expect(r2Client.isConfigured()).toBe(false);

      process.env.R2_ACCOUNT_ID = 'a';
      process.env.R2_ACCESS_KEY_ID = 'b';
      expect(r2Client.isConfigured()).toBe(false);

      process.env.R2_SECRET_ACCESS_KEY = 'c';
      expect(r2Client.isConfigured()).toBe(true);
    });

    test('is also true when a Workers R2 binding is present, regardless of env vars', () => {
      globalThis.__CF_ENV__ = { R2_BUCKET: { put: jest.fn() } };
      expect(r2Client.isConfigured()).toBe(true);
    });
  });

  describe('bucket', () => {
    test('returns the R2_BUCKET env var', () => {
      expect(r2Client.bucket()).toBeUndefined();
      process.env.R2_BUCKET = 'my-bucket';
      expect(r2Client.bucket()).toBe('my-bucket');
    });
  });
});
