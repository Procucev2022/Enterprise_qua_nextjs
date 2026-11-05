/**
 * Document Vault API Client
 * Facilitates listing, searching, uploading, updating, and removing corporate collateral.
 */

import type { DocumentVaultItem, DocumentVaultSummary } from './types';
import { authClient } from './authClient';

function getAuthHeaders(): HeadersInit {
  const token = authClient.getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchDocuments(params: {
  category?: string;
  search?: string;
  activeOnly?: boolean;
  source?: string;
  accountType?: string;
} = {}): Promise<DocumentVaultItem[]> {
  const query = new URLSearchParams();
  if (params.category && params.category !== 'all') {
    query.set('category', params.category);
  }
  if (params.search) {
    query.set('search', params.search);
  }
  if (params.activeOnly) {
    query.set('activeOnly', 'true');
  }
  if (params.source && params.source !== 'all') {
    query.set('source', params.source);
  } else if (params.accountType && params.accountType !== 'all') {
    query.set('source', params.accountType);
  }

  const url = `/api/document-vault${query.toString() ? `?${query.toString()}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `Failed to fetch documents (${res.status})`);
  }

  const data = await res.json();
  return data.documents || [];
}

export async function fetchDocumentVaultSummary(): Promise<DocumentVaultSummary> {
  const res = await fetch('/api/document-vault/summary', {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `Failed to fetch vault summary (${res.status})`);
  }

  const data = await res.json();
  return (
    data.summary || {
      totalDocuments: 0,
      activeDocuments: 0,
      totalSizeBytes: 0,
      categoriesCount: 0,
    }
  );
}

export async function createDocument(payload: {
  documentName: string;
  fileName: string;
  category: string;
  fileSize?: number;
  mimeType?: string;
  fileUrl?: string;
  description?: string;
  isActive?: boolean;
}): Promise<{ success: boolean; document?: DocumentVaultItem; error?: string }> {
  const res = await fetch('/api/document-vault', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      error: data.error || `Failed to create document (${res.status})`,
    };
  }

  return {
    success: true,
    document: data.document,
  };
}

export async function updateDocument(
  id: string,
  updates: {
    documentName?: string;
    category?: string;
    description?: string;
    isActive?: boolean;
  }
): Promise<{ success: boolean; document?: DocumentVaultItem; error?: string }> {
  const res = await fetch(`/api/document-vault/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      error: data.error || `Failed to update document (${res.status})`,
    };
  }

  return {
    success: true,
    document: data.document,
  };
}

export async function deleteDocument(id: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/document-vault/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      error: data.error || `Failed to delete document (${res.status})`,
    };
  }

  return { success: true };
}
