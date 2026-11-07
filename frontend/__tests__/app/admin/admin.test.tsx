import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AuditLog from '@/app/admin/audit-log';
import InfraControl from '@/app/admin/infra-control';
import { logger } from '@/lib/logger';
import type { AuditLogEntry, AuditVerificationReport } from '@/lib/types';
import { AppProvider } from '@/lib/store';
import { authClient } from '@/lib/authClient';

// Mock global fetch for API calls
global.fetch = jest.fn();

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

/**
 * A URL-aware fetch double for the infrastructure actions.
 *
 * These tests used ordered mockResolvedValueOnce chains, which the provider's own
 * mount-time calls (/api/db/status, /api/bootstrap, /api/rfqs) silently consumed —
 * so the response meant for the button click went to a different request. Routing
 * by URL asserts the behaviour under test rather than the call order.
 */
function routeInfraFetch(overrides: Record<string, unknown> = {}) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    const key = Object.keys(overrides).find((k) => String(url).includes(k));
    if (key) return Promise.resolve(overrides[key]);
    // The default reports a connected database: the action buttons are gated on
    // it, so an unconnected default leaves them disabled and nothing to assert.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { isConnected: true },
        health: { isConnected: true, latencyMs: 15, providerLabel: 'Postgres' },
      }),
    });
  });
}

function routeAuditFetch(report: AuditVerificationReport, auditLogs: AuditLogEntry[]) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (String(url).includes('/api/audit/verify')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, report }) });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          isConfigured: true,
          isConnected: true,
          provider: 'local_postgres',
          providerLabel: 'Dedicated / Local PostgreSQL Cluster',
          latencyMs: 12,
          tablesCount: 8,
          totalRecords: {},
          auditLogs,
        },
      }),
    });
  });
}

describe('Admin Components (AuditLog & InfraControl)', () => {
  const originalLoggerRemoteSyncEnabled = logger.isRemoteSyncEnabled;

  afterAll(() => {
    logger.isRemoteSyncEnabled = originalLoggerRemoteSyncEnabled;
    logger.clearLogs();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    logger.isRemoteSyncEnabled = false;
    logger.clearLogs();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          isConfigured: true,
          isConnected: true,
          provider: 'local_postgres',
          providerLabel: 'Dedicated / Local PostgreSQL Cluster',
          latencyMs: 12,
          tablesCount: 8,
          totalRecords: {
            buyerAccounts: 6,
            vendors: 15,
            rfqs: 12,
            evaluations: 7,
            auditLogs: 24,
            aiFeed: 18,
          },
          auditLogs: [
            {
              id: 'audit-001',
              timestamp: '2026-08-29 14:30:22 UTC',
              user: 'VP Procurement Manager',
              userEmail: 'procurement@lt.com',
              userRole: 'buyer',
              action: 'Dispatched RFQ-2026-0881 to 5 Mode 3 Qualified Vendors',
              category: 'RFQ_DISPATCH',
              rfqNumber: 'RFQ-2026-0881',
              ipAddress: '103.21.124.9',
              shaSignature: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
            {
              id: 'audit-002',
              timestamp: '2026-08-29 15:00:00 UTC',
              user: 'System Bot',
              userEmail: 'bot@procucev.com',
              userRole: 'admin',
              action: 'Automated database health probe',
              category: 'SYSTEM',
              ipAddress: '127.0.0.1',
              shaSignature: 'f5a8c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999',
            },
          ],
        },
        report: {
          valid: true,
          complete: true,
          source: 'persisted',
          expectedCount: 24,
          verifiedCount: 24,
          compromisedEntries: [],
        },
        message: 'Success',
      }),
    });
  });

  describe('AuditLog Component', () => {
    test('renders audit logs and filters across action, user, rfqNumber, and shaSignature', async () => {
      const onBack = jest.fn();
      renderWithProvider(<AuditLog onBackToInfra={onBack} />);

      await waitFor(() => {
        expect(screen.getByText(/Enterprise Audit Trail/i)).toBeInTheDocument();
        expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search events, users, RFQs, or SHA signatures/i);

      // Search by user
      fireEvent.change(searchInput, { target: { value: 'Procurement' } });
      expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();

      // Search by rfqNumber
      fireEvent.change(searchInput, { target: { value: 'RFQ-2026-0881' } });
      expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();

      // Search by shaSignature
      fireEvent.change(searchInput, { target: { value: 'e3b0c442' } });
      expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();

      // Search with no results
      fireEvent.change(searchInput, { target: { value: 'nonexistent_pattern_xyz' } });
      expect(screen.queryByText(/Dispatched RFQ-2026-0881/i)).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
      expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();

      const backBtn = screen.getByRole('button', { name: /Back to Infrastructure Control/i });
      fireEvent.click(backBtn);
      expect(onBack).toHaveBeenCalled();

      const exportLink = screen.getByRole('link', { name: /Export Visible CSV/i });
      expect(exportLink).toHaveAttribute('download', 'audit-trail.csv');
      expect(exportLink).toHaveAttribute('href', expect.stringContaining('data:text/csv'));
      expect(screen.getAllByText('VERIFIED').length).toBeGreaterThan(0);
    });

    test('opens detail modal on log row click and copies SHA signature', async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockImplementation(() => Promise.resolve()),
        },
      });

      renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();
      });

      const logText = screen.getByText(/Dispatched RFQ-2026-0881/i);
      fireEvent.click(logText);

      expect(screen.getByText(/Audit Entry Details/i)).toBeInTheDocument();

      const copyBtn = screen.getByRole('button', { name: 'Copy Hash' });
      await act(async () => {
        fireEvent.click(copyBtn);
      });
      expect(navigator.clipboard.writeText).toHaveBeenCalled();

      const closeButtons = screen.getAllByRole('button', { name: /Close/i });
      fireEvent.click(closeButtons[closeButtons.length - 1]);
    });

    test('closes signature modal via X button', async () => {
      renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Dispatched RFQ-2026-0881/i)).toBeInTheDocument();
      });

      const logText = screen.getByText(/Dispatched RFQ-2026-0881/i);
      fireEvent.click(logText);

      const xBtn = screen.getByText('✕');
      fireEvent.click(xBtn);
    });

    test('does not label cached rows verified when persisted verification is unavailable', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (String(url).includes('/api/audit/verify')) {
          return Promise.resolve({ ok: false, status: 503, json: async () => ({ success: false, error: 'Database migration is required.' }) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { isConfigured: true, isConnected: true, totalRecords: {}, auditLogs: [
            { id: 'audit-001', timestamp: '2026-08-29 14:30:22 UTC', user: 'VP Procurement Manager', action: 'Persisted check pending', shaSignature: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
          ] } }),
        });
      });

      renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('NOT VERIFIED')).toBeInTheDocument();
        expect(screen.getByText('Database migration is required.')).toBeInTheDocument();
      });
      expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument();
    });

    test('shows persisted integrity issues, missing audit fields, and clipboard recovery', async () => {
      const issueReport: AuditVerificationReport = {
        valid: false,
        complete: true,
        source: 'persisted',
        expectedCount: null,
        verifiedCount: 1,
        compromisedEntries: [{ id: 'audit-damaged', index: 0, reason: 'Hash mismatch' }],
      };
      const issueEntry: AuditLogEntry = {
        id: 'audit-damaged',
        timestamp: '2026-11-05 00:00:00 UTC',
        action: 'Damaged audit record',
        shaSignature: 'broken-signature',
      };
      routeAuditFetch(issueReport, [issueEntry]);
      const clipboardErrorSpy = jest.spyOn(logger, 'error');
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockRejectedValue(new Error('clipboard blocked')) },
      });

      renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('INTEGRITY ISSUE')).toBeInTheDocument();
        expect(screen.getByText(/1 integrity issue\(s\)/i)).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
        expect(screen.getByText('identity')).toBeInTheDocument();
      });
      expect(screen.getByText(/Total Recorded Events:/).parentElement).toHaveTextContent('1');

      fireEvent.click(screen.getByText('Damaged audit record'));
      expect(screen.getByText('Not available')).toBeInTheDocument();
      expect(screen.getByText(/failed verification/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Copy Hash' }));
      await waitFor(() => expect(clipboardErrorSpy).toHaveBeenCalledWith(
        'Clipboard access failed while copying an audit signature',
        expect.any(Object),
        'AUDIT_VERIFICATION'
      ));
      clipboardErrorSpy.mockRestore();

      fireEvent.click(screen.getByRole('button', { name: 'Verify Again' }));
      await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/api/audit/verify')).length).toBeGreaterThan(1));
    });

    test('shows an incomplete in-memory report without claiming rows are verified', async () => {
      const incompleteReport: AuditVerificationReport = {
        valid: null,
        complete: false,
        source: 'in_memory',
        expectedCount: null,
        verifiedCount: 0,
        compromisedEntries: [{ id: null, index: 0, reason: 'Only process cache is available.' }],
      };
      routeAuditFetch(incompleteReport, [{
        id: 'audit-local',
        timestamp: '2026-11-05 00:00:00 UTC',
        userEmail: 'buyer@example.test',
        action: 'Cached audit record',
        shaSignature: 'cached-signature',
      }]);

      renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Verification is incomplete: The full persisted audit chain has not been verified/i)).toBeInTheDocument();
        expect(screen.getByText('NOT VERIFIED')).toBeInTheDocument();
        expect(screen.getByText('buyer@example.test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Cached audit record'));
      expect(screen.getByText(/has not been confirmed by a complete persisted hash-chain verification/i)).toBeInTheDocument();
    });

    test('ignores late verification success and failure after the page unmounts', async () => {
      let resolveSuccess: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | undefined;
      (global.fetch as jest.Mock).mockImplementation((url: string) => String(url).includes('/api/audit/verify')
        ? new Promise((resolve) => { resolveSuccess = resolve; })
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { auditLogs: [] } }) }));
      const successView = renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);
      await waitFor(() => expect(resolveSuccess).toBeDefined());
      successView.unmount();
      await act(async () => {
        resolveSuccess?.({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            report: {
              valid: true,
              complete: true,
              source: 'persisted',
              expectedCount: 0,
              verifiedCount: 0,
              compromisedEntries: [],
            },
          }),
        });
      });

      let rejectFailure: ((error: Error) => void) | undefined;
      (global.fetch as jest.Mock).mockImplementation((url: string) => String(url).includes('/api/audit/verify')
        ? new Promise((_resolve, reject) => { rejectFailure = reject; })
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { auditLogs: [] } }) }));
      const failureView = renderWithProvider(<AuditLog onBackToInfra={jest.fn()} />);
      await waitFor(() => expect(rejectFailure).toBeDefined());
      failureView.unmount();
      await act(async () => {
        rejectFailure?.(new Error('late verification failure'));
      });
    });
  });

  describe('InfraControl Component', () => {
    test('renders Azure cloud health, DB telemetry, and test connection action', async () => {
      const onAudit = jest.fn();
      renderWithProvider(<InfraControl onNavigateToAuditLog={onAudit} />);

      expect(screen.getByText(/Security, Azure Infrastructure & System Settings/i)).toBeInTheDocument();
      expect(screen.getByText(/AZURE CLOUD INFRASTRUCTURE HEALTH/i)).toBeInTheDocument();

      const auditBtn = screen.getByRole('button', { name: /Immutable Audit Trail/i });
      fireEvent.click(auditBtn);
      expect(onAudit).toHaveBeenCalled();

      // Test connection action (notifies)
      const testConnBtn = screen.getByRole('button', { name: /Test Connection/i });
      fireEvent.click(testConnBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/db/status');
      });
    });

    test('handles disconnected database status and fallback states', async () => {
      // Disconnected with config
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            isConfigured: true,
            isConnected: false,
            providerLabel: 'Local PostgreSQL',
            errorMessage: 'Connection refused on port 5432',
          },
        }),
      });

      renderWithProvider(<InfraControl onNavigateToAuditLog={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Connection Error/i)).toBeInTheDocument();
      });

      // Disconnected without config (fallback)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            isConfigured: false,
            isConnected: false,
            providerLabel: 'In-Memory State Engine',
          },
        }),
      });

      const testConnBtn = screen.getByRole('button', { name: /Test Connection/i });
      fireEvent.click(testConnBtn);

      await waitFor(() => {
        expect(screen.getByText(/In-Memory Fallback Active/i)).toBeInTheDocument();
      });
    });

    test('updates AI Engine parameters: model selection, OCR slider, WhatsApp toggle, and escalation interval', async () => {
      renderWithProvider(<InfraControl onNavigateToAuditLog={jest.fn()} />);

      // Ollama Model select
      const modelSelect = screen.getByDisplayValue(/Llama 3 \(8B Instruct - Ultra Fast\)/i);
      fireEvent.change(modelSelect, { target: { value: 'Llama 3.1 (70B Quantized)' } });

      // OCR Threshold slider
      const slider = screen.getByRole('slider');
      fireEvent.change(slider, { target: { value: '95' } });

      // WhatsApp Auto-Chaser toggle button
      const whatsappBtn = screen.getByRole('button', { name: /Enabled \(Active\)|Disabled/i });
      fireEvent.click(whatsappBtn);
      fireEvent.click(whatsappBtn);

      // Escalation Interval select
      const intervalSelect = screen.getByDisplayValue(/24 Hours \(Standard\)/i);
      fireEvent.change(intervalSelect, { target: { value: '12' } });
    });

    test('executes run migrations and sync data actions (success & error branches)', async () => {
      routeInfraFetch({
        '/api/db/init': {
          json: async () => ({
            success: true,
            health: { isConnected: true, latencyMs: 15, providerLabel: 'Postgres' },
            tablesCreated: ['rfqs', 'vendors'],
            message: 'Schema Initialized',
          }),
        },
        '/api/db/sync': {
          json: async () => ({
            success: true,
            health: { isConnected: true, latencyMs: 15, providerLabel: 'Postgres' },
            message: 'Data Synchronized',
          }),
        },
      });

      renderWithProvider(<InfraControl onNavigateToAuditLog={jest.fn()} />);

      const migrateBtn = screen.getByRole('button', { name: /Run Schema Migrations/i });
      fireEvent.click(migrateBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/db/init',
          expect.objectContaining({ method: 'POST' })
        );
      });

      const syncBtn = screen.getByRole('button', { name: /Sync Data to Postgres/i });
      fireEvent.click(syncBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/db/sync',
          expect.objectContaining({ method: 'POST' })
        );
      });

      // 2. Failure responses (data.success === false)
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          json: async () => ({ success: false, message: 'Schema initialization failed' }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: false, message: 'Sync failed: network timeout' }),
        });

      fireEvent.click(migrateBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      fireEvent.click(syncBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // 3. Exception thrown (catch branch)
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error on migrate'))
        .mockRejectedValueOnce(new Error('Network error on sync'));

      fireEvent.click(migrateBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      fireEvent.click(syncBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    test('attaches Authorization header to migrate/sync requests when a session token is present', async () => {
      const getTokenSpy = jest.spyOn(authClient, 'getToken').mockReturnValue('test-session-token');

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          json: async () => ({
            success: true,
            health: { isConnected: true, latencyMs: 15, providerLabel: 'Postgres' },
            tablesCreated: ['rfqs', 'vendors'],
            message: 'Schema Initialized',
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            success: true,
            health: { isConnected: true, latencyMs: 15, providerLabel: 'Postgres' },
            message: 'Data Synchronized',
          }),
        });

      renderWithProvider(<InfraControl onNavigateToAuditLog={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Run Schema Migrations/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/db/init', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-session-token' },
        });
      });

      fireEvent.click(screen.getByRole('button', { name: /Sync Data to Postgres/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/db/sync', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-session-token' },
        });
      });

      getTokenSpy.mockRestore();
    });

    test('opens and closes RBAC modal, Azure Key Vault secrets modal, and triggers database backup snapshot', async () => {
      jest.useFakeTimers();
      renderWithProvider(<InfraControl onNavigateToAuditLog={jest.fn()} />);

      // Open RBAC Modal
      const rbacBtn = screen.getByRole('button', { name: /Manage RBAC Permissions/i });
      fireEvent.click(rbacBtn);
      expect(screen.getByText(/Azure Active Directory & RBAC Matrix/i)).toBeInTheDocument();
      // Sync Azure AD Roles
      const syncAdBtn = screen.getByRole('button', { name: /Sync Azure AD Roles/i });
      fireEvent.click(syncAdBtn);

      // Open Key Vault Secrets Modal
      const secretsBtn = screen.getByRole('button', { name: /Azure Key Vault Secrets/i });
      fireEvent.click(secretsBtn);
      expect(screen.getByText(/Azure Key Vault Secrets \(kv-procucev-prod\)/i)).toBeInTheDocument();
      // Close via X button
      const closeSecretsX = screen.getByText('✕');
      fireEvent.click(closeSecretsX);

      // Open Key Vault Secrets Modal again and close via Close button
      fireEvent.click(secretsBtn);
      const closeSecretsBtn = screen.getByRole('button', { name: /Close/i });
      fireEvent.click(closeSecretsBtn);

      // Trigger Database Backup Snapshot
      const backupBtn = screen.getByRole('button', { name: /Database Backup/i });
      fireEvent.click(backupBtn);

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      jest.useRealTimers();
    });

    test('handles fetchDbHealth catch branch when fetch fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Fatal DB health error'));
      renderWithProvider(<InfraControl onNavigateToAuditLog={jest.fn()} />);
      await waitFor(() => {
        expect(logger.buffer).toEqual(expect.arrayContaining([
          expect.objectContaining({
            level: 'ERROR',
            category: 'INFRASTRUCTURE',
            message: 'Failed to fetch database status',
            metadata: expect.objectContaining({ error: expect.any(Error) }),
          }),
        ]));
      });
    });
  });
});
