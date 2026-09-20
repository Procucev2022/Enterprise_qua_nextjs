const r2Client = require('../src/services/r2Client');

describe('r2Client', () => {
  afterEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
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
  });

  describe('isConfigured', () => {
    test('reflects whether all three required env vars are set', () => {
      expect(r2Client.isConfigured()).toBe(false);

      process.env.R2_ACCOUNT_ID = 'a';
      process.env.R2_ACCESS_KEY_ID = 'b';
      expect(r2Client.isConfigured()).toBe(false);

      process.env.R2_SECRET_ACCESS_KEY = 'c';
      expect(r2Client.isConfigured()).toBe(true);

      expect(r2Client.isConfigured({ R2_BUCKET: { put: jest.fn() } })).toBe(true);
    });

    test('isConfigured returns true when nativeBucket is set', () => {
      r2Client.setNativeBucket({ name: 'native-test-bucket', put: jest.fn() });
      expect(r2Client.getNativeBucket()).toBeTruthy();
      expect(r2Client.isConfigured()).toBe(true);
      expect(r2Client.bucket()).toBe('native-test-bucket');

      // Cleanup
      r2Client.setNativeBucket(null);
      expect(r2Client.getNativeBucket()).toBeNull();
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
