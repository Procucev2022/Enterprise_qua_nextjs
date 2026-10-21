describe('apiFetchPatch', () => {
  const originalFetch = window.fetch;
  const originalEnv = process.env.NEXT_PUBLIC_BACKEND_URL;

  afterEach(() => {
    jest.resetModules();
    window.fetch = originalFetch;
    delete (window as unknown as { __apiFetchPatched?: boolean }).__apiFetchPatched;
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
    } else {
      process.env.NEXT_PUBLIC_BACKEND_URL = originalEnv;
    }
  });

  it('is a no-op when window is undefined (SSR)', () => {
    const originalWindow = global.window;
    // @ts-expect-error test-only deletion
    delete global.window;
    try {
      const { installApiFetchPatch } = require('../lib/apiFetchPatch');
      expect(() => installApiFetchPatch()).not.toThrow();
    } finally {
      global.window = originalWindow;
    }
  });

  it('is a no-op when NEXT_PUBLIC_BACKEND_URL is not set', () => {
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    const mockFetch = jest.fn();
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    expect(window.fetch).toBe(mockFetch);
  });

  it('rewrites a relative /api/* call to the configured backend origin', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch('/api/auth/login', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://backend.example.workers.dev/api/auth/login',
      { method: 'POST' }
    );
  });

  it('leaves a non-API URL untouched', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch('https://fonts.googleapis.com/css');
    expect(mockFetch).toHaveBeenCalledWith('https://fonts.googleapis.com/css', undefined);

    await window.fetch('/static/asset.png');
    expect(mockFetch).toHaveBeenCalledWith('/static/asset.png', undefined);
  });

  it('handles window.fetch being undefined when patching', () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    // @ts-expect-error test-only deletion
    delete window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    expect(() => installApiFetchPatch()).not.toThrow();
  });

  it('only patches window.fetch once even if called again', () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();
    const patchedFetch = window.fetch;
    installApiFetchPatch();

    expect(window.fetch).toBe(patchedFetch);
  });

  it('handles URL instances and passes them through', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch(new URL('https://example.com/other'));
    expect(mockFetch).toHaveBeenCalled();
  });

  it('strips trailing slashes from NEXT_PUBLIC_BACKEND_URL to prevent double slashes', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:4000/';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch('/api/rfqs/extract', { method: 'POST' });
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/rfqs/extract', { method: 'POST' });
  });
});
