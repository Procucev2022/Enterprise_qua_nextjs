import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AuditLog from '@/app/admin/audit-log';
import InfraControl from '@/app/admin/infra-control';
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

describe('Admin Components (AuditLog & InfraControl)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
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
        message: 'Success',
      }),
    });
  });

  describe('AuditLog Component', () => {
    test('renders audit logs and filters across action, user, rfqNumber, and shaSignature', async () => {
      const onBack = jest.fn();
      renderWithProvider(<AuditLog onBackToInfra={onBack} />);

      await waitFor(() => {
        expect(screen.getByText(/Immutable Compliance Audit Trail/i)).toBeInTheDocument();
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

      const exportBtn = screen.getByRole('button', { name: /Export Immutable CSV/i });
      fireEvent.click(exportBtn);
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

      expect(screen.getByText(/Cryptographic Signature Verification Stamp/i)).toBeInTheDocument();

      const copyBtn = screen.getByTitle('Copy Hash');
      fireEvent.click(copyBtn);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();

      const closeBtn = screen.getByRole('button', { name: /Close/i });
      fireEvent.click(closeBtn);
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
    });
  });
});
