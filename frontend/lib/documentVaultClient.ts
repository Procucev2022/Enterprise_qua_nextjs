/**
 * Document Vault API Client
 * Facilitates listing, searching, uploading, updating, and removing corporate collateral.
 */

import type { DocumentVaultItem, DocumentVaultSummary } from './types';
import { authClient } from './authClient';
import { logger } from './logger';

const DOCUMENT_VAULT_LOG_CATEGORY = 'DOCUMENT_VAULT_CLIENT';

function logDocumentVaultFailure(
  operation: string,
  error: unknown,
  metadata: Record<string, unknown> = {}
): void {
  const errorDetails = error instanceof Error
    ? { error, errorName: error.name, errorMessage: error.message }
    : {
        errorName: 'UnknownError',
        errorMessage: typeof error === 'string' ? error : 'Unknown document vault failure',
      };
  logger.error(`Document vault ${operation} failed`, { ...metadata, ...errorDetails }, DOCUMENT_VAULT_LOG_CATEGORY);
}

async function requestDocumentVault(
  operation: string,
  input: RequestInfo | URL,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error: unknown) {
    logDocumentVaultFailure(operation, error, { method: init.method ?? 'GET' });
    throw error;
  }
}

async function readDocumentVaultJson<T>(operation: string, response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch (error: unknown) {
    logDocumentVaultFailure(operation, error, { status: response.status });
    throw error;
  }
}

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
  const res = await requestDocumentVault('fetch documents', url, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const errorBody = await readDocumentVaultJson<{ error?: string }>('fetch documents error response', res)
      .catch((): { error?: string } => ({}));
    logDocumentVaultFailure('fetch documents', errorBody.error || `HTTP ${res.status}`, { status: res.status });
    throw new Error(errorBody.error || `Failed to fetch documents (${res.status})`);
  }

  const data = await readDocumentVaultJson<{ documents?: DocumentVaultItem[] }>('fetch documents response', res);
  return data.documents || [];
}

export async function fetchDocumentVaultSummary(): Promise<DocumentVaultSummary> {
  const res = await requestDocumentVault('fetch summary', '/api/document-vault/summary', {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const errorBody = await readDocumentVaultJson<{ error?: string }>('fetch summary error response', res)
      .catch((): { error?: string } => ({}));
    logDocumentVaultFailure('fetch summary', errorBody.error || `HTTP ${res.status}`, { status: res.status });
    throw new Error(errorBody.error || `Failed to fetch vault summary (${res.status})`);
  }

  const data = await readDocumentVaultJson<{ summary?: DocumentVaultSummary }>('fetch summary response', res);
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
  const res = await requestDocumentVault('create document', '/api/document-vault', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await readDocumentVaultJson<{ error?: string; document?: DocumentVaultItem }>('create document response', res)
    .catch((): { error?: string; document?: DocumentVaultItem } => ({}));
  if (!res.ok) {
    logDocumentVaultFailure('create document', data.error || `HTTP ${res.status}`, { status: res.status });
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
  const res = await requestDocumentVault('update document', `/api/document-vault/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates),
  });

  const data = await readDocumentVaultJson<{ error?: string; document?: DocumentVaultItem }>('update document response', res)
    .catch((): { error?: string; document?: DocumentVaultItem } => ({}));
  if (!res.ok) {
    logDocumentVaultFailure('update document', data.error || `HTTP ${res.status}`, { status: res.status });
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
  const res = await requestDocumentVault('delete document', `/api/document-vault/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const data = await readDocumentVaultJson<{ error?: string }>('delete document response', res)
    .catch((): { error?: string } => ({}));
  if (!res.ok) {
    logDocumentVaultFailure('delete document', data.error || `HTTP ${res.status}`, { status: res.status });
    return {
      success: false,
      error: data.error || `Failed to delete document (${res.status})`,
    };
  }

  return { success: true };
}
