import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS } from './uiStrings';
import type { AuditLogEntry, AuditVerificationIssue, AuditVerificationReport } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isVerificationIssue(value: unknown): value is AuditVerificationIssue {
  return isRecord(value) &&
    (typeof value.id === 'string' || value.id === null) &&
    typeof value.index === 'number' &&
    typeof value.reason === 'string';
}

function isVerificationReport(value: unknown): value is AuditVerificationReport {
  return isRecord(value) &&
    (typeof value.valid === 'boolean' || value.valid === null) &&
    typeof value.complete === 'boolean' &&
    (value.source === 'persisted' || value.source === 'in_memory') &&
    (typeof value.expectedCount === 'number' || value.expectedCount === null) &&
    typeof value.verifiedCount === 'number' &&
    Array.isArray(value.compromisedEntries) &&
    value.compromisedEntries.every(isVerificationIssue);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

export async function fetchAuditVerification(): Promise<AuditVerificationReport> {
  const token = authClient.getToken();
  try {
    const response = await fetch('/api/audit/verify', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      logger.error('Audit verification returned a non-JSON response', {
        error,
        status: response.status,
      }, 'AUDIT_VERIFICATION');
      throw new Error(UI_STRINGS.auth.serverErrorFallback);
    }

    if (response.status === 401) throw new Error(UI_STRINGS.screens.auditLogs.sessionExpired);
    if (response.status === 403) throw new Error(UI_STRINGS.screens.auditLogs.permissionDenied);
    if (!response.ok) throw new Error(errorMessage(payload, UI_STRINGS.screens.auditLogs.verificationUnavailable));
    if (!isRecord(payload) || payload.success !== true || !isVerificationReport(payload.report)) {
      logger.error('Audit verification response did not match the expected contract', {
        status: response.status,
      }, 'AUDIT_VERIFICATION');
      throw new Error(UI_STRINGS.auth.serverErrorFallback);
    }

    logger.info('Persisted audit verification completed', {
      source: payload.report.source,
      complete: payload.report.complete,
      valid: payload.report.valid,
      expectedCount: payload.report.expectedCount,
      verifiedCount: payload.report.verifiedCount,
      issueCount: payload.report.compromisedEntries.length,
    }, 'AUDIT_VERIFICATION');
    return payload.report;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : UI_STRINGS.screens.auditLogs.verificationUnavailable;
    logger.error('Could not load persisted audit verification', { error, message }, 'AUDIT_VERIFICATION');
    throw error instanceof Error ? error : new Error(message);
  }
}

function csvField(value: string): string {
  const safeValue = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function buildAuditCsvDataUrl(logs: AuditLogEntry[]): string {
  const columns = ['id', 'timestamp', 'user', 'userEmail', 'action', 'rfqNumber', 'shaSignature', 'previousHash', 'ipAddress'];
  const rows = logs.map((entry) => [
    entry.id,
    entry.timestamp,
    entry.user || '',
    entry.userEmail || '',
    entry.action,
    entry.rfqNumber || '',
    entry.shaSignature,
    entry.previousHash || '',
    entry.ipAddress || '',
  ]);
  const csv = [columns, ...rows].map((row) => row.map((value) => csvField(String(value))).join(',')).join('\r\n');
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}
