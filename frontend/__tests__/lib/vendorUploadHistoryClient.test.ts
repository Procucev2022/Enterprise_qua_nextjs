import { authClient } from '@/lib/authClient';
import {
  deleteVendorUploadHistoryBatch,
  fetchVendorUploadHistory,
  saveVendorUploadHistoryBatch,
} from '@/lib/vendorUploadHistoryClient';

describe('vendorUploadHistoryClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authClient.setSession(
      {
        id: 'u-1',
        email: 'buyer@acme.com',
        name: 'Buyer',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'Acme',
      },
      'hist-token-1'
    );
  });

  test('returns empty/null/false when unauthenticated or missing required identifiers', async () => {
    authClient.setSession(null, null);
    expect(await fetchVendorUploadHistory()).toEqual([]);
    expect(await saveVendorUploadHistoryBatch({ fileName: 'a.xlsx' })).toBeNull();
    expect(await deleteVendorUploadHistoryBatch('up-1')).toBe(false);

    authClient.setSession({ id: 'u-1', email: 'buyer@acme.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' }, 'tok');
    expect(await saveVendorUploadHistoryBatch({ fileName: '   ' })).toBeNull();
    expect(await deleteVendorUploadHistoryBatch('', '')).toBe(false);
  });

  test('fetches, saves, and deletes upload history batches via backend API and emits update event', async () => {
    const listener = jest.fn();
    window.addEventListener('vendor_upload_history_updated', listener);

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [{ id: 'up-1', fileName: 'vendors.xlsx', total: 5, imported: 5 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'up-2', fileName: 'new.xlsx', total: 2, imported: 2 } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;

    const batches = await fetchVendorUploadHistory(20);
    expect(batches).toHaveLength(1);
    expect(batches[0].fileName).toBe('vendors.xlsx');

    const saved = await saveVendorUploadHistoryBatch({ fileName: 'new.xlsx', total: 2, imported: 2 });
    expect(saved?.id).toBe('up-2');

    expect(await deleteVendorUploadHistoryBatch('up-2', 'new.xlsx')).toBe(true);
    expect(await deleteVendorUploadHistoryBatch('', 'only-file.xlsx')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);

    window.removeEventListener('vendor_upload_history_updated', listener);
  });

  test('handles HTTP failures, invalid payloads, and network errors cleanly', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('net')) as unknown as typeof fetch;

    expect(await fetchVendorUploadHistory()).toEqual([]);
    expect(await fetchVendorUploadHistory()).toEqual([]);
    expect(await fetchVendorUploadHistory()).toEqual([]);

    expect(await saveVendorUploadHistoryBatch({ fileName: 'x.xlsx' })).toBeNull();
    expect(await saveVendorUploadHistoryBatch({ fileName: 'x.xlsx' })).toBeNull();
    expect(await saveVendorUploadHistoryBatch({ fileName: 'x.xlsx' })).toBeNull();

    expect(await deleteVendorUploadHistoryBatch('up-1')).toBe(false);
    expect(await deleteVendorUploadHistoryBatch('up-1')).toBe(false);
  });
});
