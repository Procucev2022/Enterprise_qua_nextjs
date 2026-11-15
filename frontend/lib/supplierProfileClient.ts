import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  SupplierCreditSummary,
  SupplierCreditTransaction,
  SupplierCommunicationItem,
  RecordCommunicationPayload,
  SupplierPaymentSummary,
  SupplierPaymentTransaction,
} from './types';

const SUPPLIER_LOG_CATEGORY = 'SUPPLIER_CLIENT';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Reads a supplier endpoint reply. A non-2xx reply is a failure even when its body
 * lacks `success: false`, so a rejected request is never returned as a success.
 */
async function readSupplierResponse<T extends { success: boolean; error?: string }>(res: Response): Promise<T> {
  let body: Partial<T> = {};
  try {
    body = (await res.json()) as Partial<T>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    return { ...body, success: false, error: body.error || formatString(UI_STRINGS.dataLoad.requestFailedWithStatus, { status: res.status }) } as T;
  }
  if (typeof body.success !== 'boolean') {
    return { success: false, error: UI_STRINGS.dataLoad.requestNetworkFailed } as T;
  }
  return body as T;
}

export async function fetchSupplierCreditHistory(vendorId: string): Promise<{
  success: boolean;
  error?: string;
  summary?: SupplierCreditSummary;
  transactions?: SupplierCreditTransaction[];
}> {
  try {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/credit-history`, {
      headers: authHeaders(),
    });
    return await readSupplierResponse(res);
  } catch (err: unknown) {
    logger.error('Supplier credit history load failed', { error: err instanceof Error ? err.message : 'Network error' }, SUPPLIER_LOG_CATEGORY);
    return { success: false, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.supplierDetails }) };
  }
}

export async function fetchSupplierCommunications(
  vendorId: string,
  channel?: string
): Promise<{
  success: boolean;
  error?: string;
  data?: SupplierCommunicationItem[];
}> {
  try {
    const url = `/api/vendors/${encodeURIComponent(vendorId)}/communications${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`;
    const res = await fetch(url, {
      headers: authHeaders(),
    });
    return await readSupplierResponse(res);
  } catch (err: unknown) {
    logger.error('Supplier communications load failed', { error: err instanceof Error ? err.message : 'Network error' }, SUPPLIER_LOG_CATEGORY);
    return { success: false, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.supplierDetails }) };
  }
}

export async function recordSupplierCommunication(
  vendorId: string,
  payload: RecordCommunicationPayload
): Promise<{
  success: boolean;
  error?: string;
  data?: unknown;
  completedTask?: unknown;
  followupTask?: unknown;
}> {
  try {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/communications`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    return await readSupplierResponse(res);
  } catch (err: unknown) {
    logger.error('Supplier communication record failed', { error: err instanceof Error ? err.message : 'Network error' }, SUPPLIER_LOG_CATEGORY);
    return { success: false, error: UI_STRINGS.dataLoad.requestNetworkFailed };
  }
}

export async function fetchSupplierPaymentHistory(vendorId: string): Promise<{
  success: boolean;
  error?: string;
  summary?: SupplierPaymentSummary;
  payments?: SupplierPaymentTransaction[];
}> {
  try {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/payment-history`, {
      headers: authHeaders(),
    });
    return await readSupplierResponse(res);
  } catch (err: unknown) {
    logger.error('Supplier payment history load failed', { error: err instanceof Error ? err.message : 'Network error' }, SUPPLIER_LOG_CATEGORY);
    return { success: false, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.supplierDetails }) };
  }
}

export async function updateSupplierCategories(
  vendorId: string,
  categories: string[]
): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  data?: unknown;
}> {
  try {
    const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/categories`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ categories }),
    });
    return await readSupplierResponse(res);
  } catch (err: unknown) {
    logger.error('Supplier categories update failed', { error: err instanceof Error ? err.message : 'Network error' }, SUPPLIER_LOG_CATEGORY);
    return { success: false, error: UI_STRINGS.dataLoad.requestNetworkFailed };
  }
}

const supplierProfileClient = {
  fetchSupplierCreditHistory,
  fetchSupplierCommunications,
  recordSupplierCommunication,
  fetchSupplierPaymentHistory,
  updateSupplierCategories,
};

export default supplierProfileClient;
