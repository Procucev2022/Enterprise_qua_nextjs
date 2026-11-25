import { installApiFetchPatch } from '@/lib/apiFetchPatch';

describe('apiFetchPatch', () => {
  const originalEnv = process.env;
  const originalFetch = window.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete (window as unknown as { __apiFetchPatched?: boolean }).__apiFetchPatched;
  });

  afterEach(() => {
    process.env = originalEnv;
    window.fetch = originalFetch;
    delete (window as unknown as { __apiFetchPatched?: boolean }).__apiFetchPatched;
  });

  test('rewrites /api/* calls to NEXT_PUBLIC_BACKEND_URL with default cache no-store while respecting explicit cache and non-api URLs', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://api.example.com/';
    const spyFetch = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = spyFetch as unknown as typeof fetch;

    installApiFetchPatch();
    // Second call is idempotent
    installApiFetchPatch();

    await window.fetch('/api/bootstrap', { headers: { Authorization: 'Bearer tok' } });
    expect(spyFetch).toHaveBeenLastCalledWith('https://api.example.com/api/bootstrap', {
      headers: { Authorization: 'Bearer tok' },
      cache: 'no-store',
    });

    await window.fetch('/api/bootstrap', { cache: 'reload' });
    expect(spyFetch).toHaveBeenLastCalledWith('https://api.example.com/api/bootstrap', {
      cache: 'reload',
    });

    await window.fetch('https://other.example.com/data');
    expect(spyFetch).toHaveBeenLastCalledWith('https://other.example.com/data', undefined);
  });

  test('applies cache no-store to relative /api/* requests in non-test runtime even without NEXT_PUBLIC_BACKEND_URL', async () => {
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const spyFetch = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = spyFetch as unknown as typeof fetch;

    installApiFetchPatch();
    await window.fetch('/api/rfqs');
    expect(spyFetch).toHaveBeenCalledWith('/api/rfqs', { cache: 'no-store' });
  });
});
