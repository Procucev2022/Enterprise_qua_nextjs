const authService = require('../src/services/authService');

describe('resolveAuthSecret', () => {
  const originalEnv = { ...process.env };
  const originalCfEnv = globalThis.__CF_ENV__;

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.__CF_ENV__ = originalCfEnv;
  });

  test('returns configured AUTH_SECRET from process.env', () => {
    process.env.AUTH_SECRET = 'my-secret-123';
    expect(authService.resolveAuthSecret()).toBe('my-secret-123');
  });

  test('returns configured JWT_SECRET when AUTH_SECRET is not set', () => {
    delete process.env.AUTH_SECRET;
    process.env.JWT_SECRET = 'jwt-secret-456';
    expect(authService.resolveAuthSecret()).toBe('jwt-secret-456');
  });

  test('returns AUTH_SECRET from globalThis.__CF_ENV__ when process.env lacks it', () => {
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
    globalThis.__CF_ENV__ = { AUTH_SECRET: 'cf-secret-789' };
    expect(authService.resolveAuthSecret()).toBe('cf-secret-789');
  });

  test('throws in production when no secret is configured', () => {
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    delete globalThis.__CF_ENV__;

    expect(() => authService.resolveAuthSecret()).toThrow(
      'AUTH_SECRET (or JWT_SECRET) must be set in production. Refusing to start without a session-signing key.'
    );
  });

  test('generates an ephemeral secret in non-production when none is set', () => {
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'development';
    delete globalThis.__CF_ENV__;

    const secret1 = authService.resolveAuthSecret();
    expect(typeof secret1).toBe('string');
    expect(secret1.length).toBeGreaterThan(20);

    // Subsequent calls return the same cached ephemeral secret
    const secret2 = authService.resolveAuthSecret();
    expect(secret2).toBe(secret1);
  });

  test('respects custom env passed explicitly', () => {
    const custom = authService.resolveAuthSecret({ AUTH_SECRET: 'custom-secret' });
    expect(custom).toBe('custom-secret');

    expect(() => authService.resolveAuthSecret({ NODE_ENV: 'production' })).toThrow(
      'AUTH_SECRET (or JWT_SECRET) must be set in production'
    );

    const customDev = authService.resolveAuthSecret({ NODE_ENV: 'development' });
    expect(typeof customDev).toBe('string');
    expect(customDev.length).toBeGreaterThan(20);
  });

  test('AUTH_SECRET getter on module.exports resolves lazily', () => {
    process.env.AUTH_SECRET = 'getter-secret-999';
    expect(authService.AUTH_SECRET).toBe('getter-secret-999');
  });
});
