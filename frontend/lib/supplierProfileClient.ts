import { authClient } from './authClient';
import { logger } from './logger';
import type {
  SupplierCreditSummary,
  SupplierCreditTransaction,
  SupplierCommunicationItem,
  RecordCommunicationPayload,
  SupplierPaymentSummary,
  SupplierPaymentTransaction,
} from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
    const body = await res.json();
    return body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch credit history';
    logger.error('Supplier credit history load failed', { error: message }, 'SUPPLIER_CLIENT');
    return { success: false, error: message };
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
    const body = await res.json();
    return body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch communications';
    logger.error('Supplier communications load failed', { error: message }, 'SUPPLIER_CLIENT');
    return { success: false, error: message };
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
    const body = await res.json();
    return body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to record communication';
    logger.error('Supplier communication record failed', { error: message }, 'SUPPLIER_CLIENT');
    return { success: false, error: message };
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
    const body = await res.json();
    return body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch payment history';
    logger.error('Supplier payment history load failed', { error: message }, 'SUPPLIER_CLIENT');
    return { success: false, error: message };
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
    const body = await res.json();
    return body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update categories';
    logger.error('Supplier categories update failed', { error: message }, 'SUPPLIER_CLIENT');
    return { success: false, error: message };
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

