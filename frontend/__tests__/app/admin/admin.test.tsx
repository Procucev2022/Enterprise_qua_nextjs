import React, { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AuditLog from '@/app/admin/audit-log';
import InfraControl from '@/app/admin/infra-control';
import { logger } from '@/lib/logger';
import type { AuditLogEntry, AuditVerificationReport } from '@/lib/types';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { DB_STATUS_POLL_INTERVAL_MS } from '@/lib/constants';
import { formatString, UI_STRINGS } from '@/lib/uiStrings';

// Mock global fetch for API calls
global.fetch = jest.fn();

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
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

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/**
 * A URL-aware fetch double. Each route is matched by a substring of the request
 * URL, so the order of the provider's own mount-time requests does not matter.
 * A route set to an Error rejects, which simulates a network failure.
 */
function routeInfraFetch(routes: Record<string, ReturnType<typeof jsonResponse> | Error>) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    const key = Object.keys(routes).find((route) => String(url).includes(route));
    const route = key ? routes[key] : jsonResponse({ success: true, data: {} });
    return route instanceof Error ? Promise.reject(route) : Promise.resolve(route);
  });
}

/** Records every toast the store shows, so the tests can assert the text the user sees. */
function ToastProbe({ onToast }: { onToast: jest.Mock }) {
  const { toastMessage } = useApp();
  useEffect(() => {
    if (toastMessage) onToast(toastMessage);
  }, [toastMessage, onToast]);
  return null;
}

function renderInfra(onNavigate: () => void = jest.fn()) {
  const onToast = jest.fn();
  render(
    <AppProvider>
      <InfraControl onNavigateToAuditLog={onNavigate} />
      <ToastProbe onToast={onToast} />
    </AppProvider>
  );
  return { onToast };
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
    const strings = UI_STRINGS.infraControl;

    // Shaped like GET /api/db/status: the health fields sit at the top level.
    const CONNECTED_STATUS = {
      success: true,
      isConfigured: true,
      isConnected: true,
      provider: 'cloudflare_d1',
      providerLabel: 'Cloudflare D1',
      poolStatus: 'ACTIVE (D1 binding)',
      database: 'enterprise-qua-d1',
      latencyMs: 12,
      userCount: 3,
      vendorCount: 15,
      rfqCount: 9,
      timestamp: '2026-01-01T00:00:00.000Z',
      loadedRecords: { isLoadedFromDatabase: true, buyerAccounts: 6, vendors: 15, rfqs: 12 },
    };

    // Shaped like GET /api/bootstrap: systemConfig and azureHealth come from the store.
    const SERVER_SYSTEM_CONFIG = { aiModel: 'test-model-a', aiTemperature: 0.2 };
    const SERVER_HEALTH_ROW = {
      service: 'Cloudflare D1 Database',
      status: 'ONLINE',
      latency: '12ms',
      uptime: '—',
      details: '3 active account(s), 15 vendor(s), 9 RFQ(s).',
    };
    const BOOTSTRAP_WITH_CONFIG = jsonResponse({
      success: true,
      data: { systemConfig: SERVER_SYSTEM_CONFIG, azureHealth: [SERVER_HEALTH_ROW] },
    });
    const BOOTSTRAP_EMPTY = jsonResponse({ success: true, data: {} });

    const countStatusReads = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/db/status').length;

    beforeEach(() => {
      routeInfraFetch({
        '/api/db/status': jsonResponse(CONNECTED_STATUS),
        '/api/bootstrap': BOOTSTRAP_WITH_CONFIG,
      });
    });

    test('renders infrastructure health, read-only AI configuration and the database status from the server', async () => {
      renderInfra();

      expect(await screen.findByText(strings.title)).toBeInTheDocument();
      expect(await screen.findByText(formatString(strings.databaseConnected, { latencyMs: 12 }))).toBeInTheDocument();
      expect(screen.getByText('Cloudflare D1')).toBeInTheDocument();
      expect(screen.getByText(SERVER_HEALTH_ROW.service)).toBeInTheDocument();
      expect(screen.getByText(strings.statusOnline)).toBeInTheDocument();
      expect(screen.getByText(SERVER_SYSTEM_CONFIG.aiModel)).toBeInTheDocument();
      expect(screen.getByText('0.2')).toBeInTheDocument();
      expect(screen.getByText(strings.configReadOnlyNote)).toBeInTheDocument();
      expect(screen.getByText(strings.loadedVendors).nextSibling).toHaveTextContent('15');
      expect(global.fetch).toHaveBeenCalledWith('/api/db/status');
    });

    test('offers no editable setting and none of the removed actions', async () => {
      renderInfra();
      await screen.findByText(formatString(strings.databaseConnected, { latencyMs: 12 }));

      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Migrations|Sync Data|Backup|Key Vault|RBAC/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Sub-Procucev|kv-procucev|Llama 3 Active|Multi-Region/i)).not.toBeInTheDocument();
    });

    test('sends no request to the write or migration endpoints that do not exist', async () => {
      renderInfra();
      await screen.findByText(formatString(strings.databaseConnected, { latencyMs: 12 }));
      const readsBeforeClick = countStatusReads();
      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));
      await waitFor(() => expect(countStatusReads()).toBeGreaterThan(readsBeforeClick));

      const requestedUrls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
      expect(requestedUrls.some((url) => url.includes('/api/system-config'))).toBe(false);
      expect(requestedUrls.some((url) => url.includes('/api/db/init'))).toBe(false);
      expect(requestedUrls.some((url) => url.includes('/api/db/sync'))).toBe(false);
    });

    test('marks every value the server did not send as not available', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({
          success: true,
          isConfigured: false,
          isConnected: false,
          provider: 'not_configured',
          errorMessage: 'DATABASE_URL is not set.',
        }),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      renderInfra();

      expect(await screen.findByText(strings.databaseNotConfigured)).toBeInTheDocument();
      expect(screen.getByText('DATABASE_URL is not set.')).toBeInTheDocument();
      expect(screen.getByText(strings.healthEmpty)).toBeInTheDocument();
      expect(screen.getByText(strings.configEmpty)).toBeInTheDocument();
      expect(screen.getByText(strings.configModelLabel).nextSibling).toHaveTextContent(strings.notAvailable);
      expect(screen.getByText(strings.configTemperatureLabel).nextSibling).toHaveTextContent(strings.notAvailable);
      expect(screen.getByText(strings.loadedBuyerAccounts).nextSibling).toHaveTextContent(strings.notAvailable);
      expect(screen.getByText(strings.loadedVendors).nextSibling).toHaveTextContent(strings.notAvailable);
      expect(screen.getByText(strings.loadedRfqs).nextSibling).toHaveTextContent(strings.notAvailable);
    });

    test('shows the server connection error when the database is configured but unreachable', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({
          success: true,
          isConfigured: true,
          isConnected: false,
          providerLabel: 'Test provider',
          errorMessage: 'Connection refused on port 5432',
        }),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      const { onToast } = renderInfra();

      expect(await screen.findByText(strings.databaseConnectionError)).toBeInTheDocument();
      expect(screen.getByText('Connection refused on port 5432')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith({
        title: strings.notConnectedToastTitle,
        description: 'Connection refused on port 5432',
        type: 'warning',
      }));
    });

    test('reports a not-connected database by its provider label when no error message is sent', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({ success: true, isConfigured: false, isConnected: false, providerLabel: 'Test provider' }),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      const { onToast } = renderInfra();

      expect(await screen.findByText(strings.databaseNotConfigured)).toBeInTheDocument();
      expect(screen.getByText('Test provider')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith({
        title: strings.notConnectedToastTitle,
        description: 'Test provider',
        type: 'warning',
      }));
    });

    test('reports a not-connected database as not available when it sends neither a message nor a provider', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({ success: true, isConfigured: false, isConnected: false }),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      const { onToast } = renderInfra();

      expect(await screen.findByText(strings.databaseNotConfigured)).toBeInTheDocument();
      expect(screen.getByText(strings.databaseTitle).nextSibling).toHaveTextContent(strings.notAvailable);

      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith({
        title: strings.notConnectedToastTitle,
        description: strings.notAvailable,
        type: 'warning',
      }));
    });

    test('shows a visible error and no stale values when the status request is rejected by the server', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({ success: false, error: 'Database migration is required.' }, 503),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      renderInfra();

      expect(await screen.findByRole('alert')).toHaveTextContent('Database migration is required.');
      expect(screen.getByText(strings.databaseStatusUnavailable)).toBeInTheDocument();
      expect(screen.queryByText(formatString(strings.databaseConnected, { latencyMs: 12 }))).not.toBeInTheDocument();
      expect(screen.getByText(strings.loadedVendors).nextSibling).toHaveTextContent(strings.notAvailable);
    });

    test('uses the generic status message when a failed response carries no reason', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({ success: false }),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      renderInfra();

      expect(await screen.findByRole('alert')).toHaveTextContent(strings.databaseStatusFailed);
    });

    test('logs the failure and shows the status error when the request throws', async () => {
      routeInfraFetch({
        '/api/db/status': new Error('Fatal DB health error'),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      renderInfra();

      expect(await screen.findByRole('alert')).toHaveTextContent(strings.databaseStatusFailed);
      expect(logger.buffer).toEqual(expect.arrayContaining([
        expect.objectContaining({
          level: 'ERROR',
          category: 'INFRASTRUCTURE',
          message: 'Failed to fetch database status',
          metadata: expect.objectContaining({ error: expect.any(Error) }),
        }),
      ]));
    });

    test('Test Connection clears an earlier error and reports the connected database', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({ success: false, error: 'Database migration is required.' }, 503),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      const { onToast } = renderInfra();
      expect(await screen.findByRole('alert')).toHaveTextContent('Database migration is required.');

      routeInfraFetch({
        '/api/db/status': jsonResponse(CONNECTED_STATUS),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));

      expect(await screen.findByText(formatString(strings.databaseConnected, { latencyMs: 12 }))).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await waitFor(() => expect(onToast).toHaveBeenCalledWith({
        title: strings.connectedToastTitle,
        description: formatString(strings.connectedToastMessage, { provider: 'Cloudflare D1', latencyMs: 12 }),
        type: 'success',
      }));
    });

    test('Test Connection reports a failed re-read in place with a warning', async () => {
      const { onToast } = renderInfra();
      expect(await screen.findByText(formatString(strings.databaseConnected, { latencyMs: 12 }))).toBeInTheDocument();

      routeInfraFetch({
        '/api/db/status': new Error('offline'),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));

      expect(await screen.findByRole('alert')).toHaveTextContent(strings.databaseStatusFailed);
      expect(screen.getByText(strings.databaseStatusUnavailable)).toBeInTheDocument();
      await waitFor(() => expect(onToast).toHaveBeenCalledWith({
        title: strings.statusFailedToastTitle,
        description: strings.databaseStatusFailed,
        type: 'warning',
      }));
    });

    test('shows connected without a latency figure and keeps an unrecognised health status as received', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse({ success: true, isConfigured: true, isConnected: true }),
        '/api/bootstrap': jsonResponse({
          success: true,
          data: {
            azureHealth: [{ service: 'Probe row', status: 'DEGRADED', latency: '—', uptime: '—', details: 'Probe detail' }],
          },
        }),
      });
      const { onToast } = renderInfra();

      expect(await screen.findByText(strings.databaseConnectedNoLatency)).toBeInTheDocument();
      expect(screen.getByText('DEGRADED')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: strings.testConnection }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith({
        title: strings.connectedToastTitle,
        description: formatString(strings.connectedToastMessageNoLatency, { provider: strings.notAvailable }),
        type: 'success',
      }));
    });

    test('shows the infrastructure health empty state and no configuration when the server sends neither', async () => {
      routeInfraFetch({
        '/api/db/status': jsonResponse(CONNECTED_STATUS),
        '/api/bootstrap': BOOTSTRAP_EMPTY,
      });
      renderInfra();

      expect(await screen.findByText(strings.healthEmpty)).toBeInTheDocument();
      expect(screen.getByText(strings.configEmpty)).toBeInTheDocument();
    });

    test('re-reads the database status on the poll interval', async () => {
      jest.useFakeTimers();
      try {
        renderInfra();
        await act(async () => {
          await Promise.resolve();
        });
        const readsBeforePoll = countStatusReads();
        expect(readsBeforePoll).toBeGreaterThanOrEqual(1);

        await act(async () => {
          jest.advanceTimersByTime(DB_STATUS_POLL_INTERVAL_MS);
        });
        expect(countStatusReads()).toBeGreaterThan(readsBeforePoll);
      } finally {
        jest.useRealTimers();
      }
    });

    test('opens the audit trail from the header button', async () => {
      const onAudit = jest.fn();
      renderInfra(onAudit);

      fireEvent.click(screen.getByRole('button', { name: strings.auditTrailButton }));
      expect(onAudit).toHaveBeenCalled();
    });
  });
});
