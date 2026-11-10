import { authClient } from './authClient';
import { logger } from './logger';
import type { AccountDocument } from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface FetchAccountDocumentsParams {
  category?: string;
  type?: string;
  search?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface UploadAccountDocumentPayload {
  documentName: string;
  category: string;
  description?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  fileUrl?: string;
  file?: File;
}

export interface RequestBuyerCreditApprovalPayload {
  amount: number;
  reason?: string;
  approverName: string;
  initiatorName: string;
  idempotencyKey?: string;
}

export interface RequestSellerQuoteCreditApprovalPayload {
  amount: number;
  reason?: string;
  approverName: string;
  initiatorName: string;
  idempotencyKey?: string;
}

export function createCreditApprovalIdempotencyKey(): string {
  const cryptoProvider = globalThis.crypto;
  if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID();
  if (typeof cryptoProvider?.getRandomValues === 'function') {
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const value = character === 'x' ? randomValue : ((randomValue & 0x3) | 0x8);
    return value.toString(16);
  });
}

export interface AddSellerQuoteCreditsPayload {
  amount: number;
  reason?: string;
}

/**
 * Fetch documents associated with a buyer or seller account.
 */
export async function fetchAccountDocuments(
  accountType: 'buyer' | 'seller',
  accountId: string,
  params?: FetchAccountDocumentsParams
): Promise<AccountDocument[]> {
  try {
    const basePath = accountType === 'buyer'
      ? `/api/buyer-accounts/${encodeURIComponent(accountId)}/documents`
      : `/api/vendors/${encodeURIComponent(accountId)}/documents`;

    const query = new URLSearchParams();
    if (params?.category && params.category !== 'all' && params.category !== 'All Categories') {
      query.set('category', params.category);
    }
    if (params?.type && params.type !== 'all' && params.type !== 'All Types') {
      query.set('type', params.type);
    }
    if (params?.search?.trim()) {
      query.set('search', params.search.trim());
    }
    if (params?.sortOrder) {
      query.set('sortOrder', params.sortOrder);
    }

    const url = query.toString() ? `${basePath}?${query.toString()}` : basePath;
    const res = await fetch(url, { headers: authHeaders() });

    if (!res.ok) {
      logger.error('Failed to fetch account documents', { status: res.status, accountType, accountId }, 'ACCOUNT_DOCS_CLIENT');
      return [];
    }

    const json = await res.json();
    return Array.isArray(json?.documents) ? json.documents : [];
  } catch (err) {
    logger.error('fetchAccountDocuments network error', { error: (err as Error).message }, 'ACCOUNT_DOCS_CLIENT');
    return [];
  }
}

/**
 * Upload a document for a buyer or seller account.
 */
export async function uploadAccountDocument(
  accountType: 'buyer' | 'seller',
  accountId: string,
  payload: UploadAccountDocumentPayload
): Promise<{ success: boolean; document?: AccountDocument; error?: string }> {
  try {
    const basePath = accountType === 'buyer'
      ? `/api/buyer-accounts/${encodeURIComponent(accountId)}/documents`
      : `/api/vendors/${encodeURIComponent(accountId)}/documents`;

    const docPayload = {
      documentName: payload.documentName,
      category: payload.category,
      description: payload.description || '',
      fileName: payload.fileName || (payload.file ? payload.file.name : 'document.pdf'),
      fileSize: payload.fileSize || (payload.file ? payload.file.size : 1024),
      mimeType: payload.mimeType || (payload.file ? payload.file.type : 'application/pdf'),
      fileUrl: payload.fileUrl || `/documents/${encodeURIComponent(payload.fileName || (payload.file ? payload.file.name : 'document.pdf'))}`,
    };

    const res = await fetch(basePath, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(docPayload),
    });

    const json = await res.json();
    if (!res.ok || !json?.success) {
      const errorMsg = json?.error || 'Failed to upload document.';
      logger.error('Document upload rejected', { status: res.status, error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
      return { success: false, error: errorMsg };
    }

    logger.info('Document uploaded successfully', { accountType, accountId, docId: json.document?.id }, 'ACCOUNT_DOCS_CLIENT');
    return { success: true, document: json.document };
  } catch (err) {
    const errorMsg = (err as Error).message || 'Network error during upload.';
    logger.error('uploadAccountDocument network error', { error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
    return { success: false, error: errorMsg };
  }
}

/**
 * Delete a document from a buyer or seller account.
 */
export async function deleteAccountDocument(
  accountType: 'buyer' | 'seller',
  accountId: string,
  docId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const basePath = accountType === 'buyer'
      ? `/api/buyer-accounts/${encodeURIComponent(accountId)}/documents/${encodeURIComponent(docId)}`
      : `/api/vendors/${encodeURIComponent(accountId)}/documents/${encodeURIComponent(docId)}`;

    const res = await fetch(basePath, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    const json = await res.json();
    if (!res.ok || !json?.success) {
      const errorMsg = json?.error || 'Failed to delete document.';
      logger.error('Document delete rejected', { status: res.status, error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
      return { success: false, error: errorMsg };
    }

    logger.info('Document deleted successfully', { accountType, accountId, docId }, 'ACCOUNT_DOCS_CLIENT');
    return { success: true };
  } catch (err) {
    const errorMsg = (err as Error).message || 'Network error during delete.';
    logger.error('deleteAccountDocument network error', { error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
    return { success: false, error: errorMsg };
  }
}

/**
 * Request buyer credit addition via the approval workflow.
 * Creates an internal task with status = 'Pending Approval' assigned to Srinu Sir or Sudheer Sir.
 */
export async function requestBuyerCreditApproval(
  buyerId: string,
  payload: RequestBuyerCreditApprovalPayload
): Promise<{ success: boolean; message?: string; task?: unknown; error?: string }> {
  try {
    const url = `/api/buyer-accounts/${encodeURIComponent(buyerId)}/request-credit-approval`;
    const requestPayload = {
      ...payload,
      idempotencyKey: payload.idempotencyKey || createCreditApprovalIdempotencyKey(),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(requestPayload),
    });

    const json = await res.json();
    if (!res.ok || !json?.success) {
      const errorMsg = json?.error || 'Failed to submit credit approval request.';
      logger.error('Credit approval request rejected', { status: res.status, error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
      return { success: false, error: errorMsg };
    }

    logger.info('Credit approval request submitted', { buyerId, taskId: json.task?.id }, 'ACCOUNT_DOCS_CLIENT');
    return { success: true, message: json.message, task: json.task };
  } catch (err) {
    const errorMsg = (err as Error).message || 'Network error during credit request.';
    logger.error('requestBuyerCreditApproval network error', { error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
    return { success: false, error: errorMsg };
  }
}

/**
 * Request seller quote credit addition via the approval workflow.
 * Creates an internal task with status = 'Pending Approval' and links to the approvals module.
 */
export async function requestSellerQuoteCreditApproval(
  sellerId: string,
  payload: RequestSellerQuoteCreditApprovalPayload
): Promise<{ success: boolean; message?: string; task?: unknown; error?: string }> {
  try {
    const url = `/api/vendors/${encodeURIComponent(sellerId)}/request-credit-approval`;
    const requestPayload = {
      ...payload,
      idempotencyKey: payload.idempotencyKey || createCreditApprovalIdempotencyKey(),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(requestPayload),
    });

    const json = await res.json();
    if (!res.ok || !json?.success) {
      const errorMsg = json?.error || 'Failed to submit quote credit approval request.';
      logger.error('Quote credit approval request rejected', { status: res.status, error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
      return { success: false, error: errorMsg };
    }

    logger.info('Quote credit approval request submitted', { sellerId, taskId: json.task?.id }, 'ACCOUNT_DOCS_CLIENT');
    return { success: true, message: json.message, task: json.task };
  } catch (err) {
    const errorMsg = (err as Error).message || 'Network error during quote credit request.';
    logger.error('requestSellerQuoteCreditApproval network error', { error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
    return { success: false, error: errorMsg };
  }
}

/**
 * Add quote credits for a seller account (strictly 1 to 5 credits).
 * Updates available quote credits immediately and records transaction.
 */
export async function addSellerQuoteCredits(
  sellerId: string,
  payload: AddSellerQuoteCreditsPayload
): Promise<{ success: boolean; message?: string; updatedBalance?: number; error?: string }> {
  try {
    const url = `/api/vendors/${encodeURIComponent(sellerId)}/add-quote-credits`;
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok || !json?.success) {
      const errorMsg = json?.error || 'Failed to add quote credits.';
      logger.error('Add quote credits rejected', { status: res.status, error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
      return { success: false, error: errorMsg };
    }

    logger.info('Quote credits added successfully', { sellerId, updatedBalance: json.updatedBalance }, 'ACCOUNT_DOCS_CLIENT');
    return { success: true, message: json.message, updatedBalance: json.updatedBalance };
  } catch (err) {
    const errorMsg = (err as Error).message || 'Network error during quote credits addition.';
    logger.error('addSellerQuoteCredits network error', { error: errorMsg }, 'ACCOUNT_DOCS_CLIENT');
    return { success: false, error: errorMsg };
  }
}

