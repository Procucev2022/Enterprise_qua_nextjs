import { authClient } from './authClient';
import type { VendorUploadHistoryBatch } from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function notifyUploadHistoryChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('vendor_upload_history_updated'));
  }
}

export async function fetchVendorUploadHistory(limit = 30): Promise<VendorUploadHistoryBatch[]> {
  if (!authClient.getToken()) return [];
  try {
    const res = await fetch(`/api/vendors/upload-history?limit=${encodeURIComponent(String(limit))}`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      success?: boolean;
      data?: VendorUploadHistoryBatch[];
    } | null;
    return json?.success && Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

export async function saveVendorUploadHistoryBatch(
  batch: Partial<VendorUploadHistoryBatch> & { fileName: string }
): Promise<VendorUploadHistoryBatch | null> {
  if (!authClient.getToken() || !batch.fileName?.trim()) return null;
  try {
    const res = await fetch('/api/vendors/upload-history', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(batch),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      success?: boolean;
      data?: VendorUploadHistoryBatch;
    } | null;
    if (json?.success && json.data) {
      notifyUploadHistoryChanged();
      return json.data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function deleteVendorUploadHistoryBatch(id: string, fileName?: string): Promise<boolean> {
  if (!authClient.getToken() || (!id?.trim() && !fileName?.trim())) return false;
  const targetId = id?.trim() || 'by-filename';
  const query = fileName?.trim() ? `?fileName=${encodeURIComponent(fileName.trim())}` : '';
  try {
    const res = await fetch(`/api/vendors/upload-history/${encodeURIComponent(targetId)}${query}`, {
      method: 'DELETE',
      headers: authHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      notifyUploadHistoryChanged();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
