import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmailGatewayPanel from '@/app/buyer/EmailGatewayPanel';
import { useApp } from '@/lib/store';
import { fetchEmailGatewayStatus, pollEmailGateway } from '@/lib/emailGatewayClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { EmailGatewayStatus } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/emailGatewayClient', () => ({
  fetchEmailGatewayStatus: jest.fn(),
  pollEmailGateway: jest.fn(),
}));

// ==============================================================================
// EMAIL GATEWAY PANEL
// ==============================================================================
// This replaced a simulator: three hardcoded sample requisitions, an editable
// From field, and a green "Active & Listening" badge with no connection behind it.
// Everything here now comes from the status endpoint, so the unconfigured and
// failing states matter as much as the healthy one — a panel that looks healthy
// while nothing is watching is the failure mode worth guarding against.
// ==============================================================================

const GATEWAY = UI_STRINGS.emailGateway;
const mockShowToast = jest.fn();
const mockFetchStatus = fetchEmailGatewayStatus as jest.Mock;
const mockPoll = pollEmailGateway as jest.Mock;

function status(overrides: Partial<EmailGatewayStatus> = {}): EmailGatewayStatus {
  return {
    enabled: true,
    configured: true,
    watching: true,
    connectionState: 'ACTIVE_LISTENING',
    // The Procucev intake address buyers send to, distinct from the IMAP login.
    gatewayAddress: 'client@procucev.com',
    watchingSince: '2026-09-07T03:00:00.000Z',
    mailboxUser: 'intake@procucev.com',
    mailbox: 'INBOX',
    host: 'imap.gmail.com',
    pollIntervalMs: 120000,
    allowedSenders: [],
    allowedDomains: [],
    lastPollAt: '2026-09-07T04:00:00.000Z',
    lastPollDurationMs: 820,
    lastConnectedAt: '2026-09-07T04:00:00.000Z',
    lastError: null,
    isPolling: false,
    counts: { INGESTED: 2 },
    recent: [],
    ingestedStatus: 'Parsing',
    ...overrides,
  };
}

const ledgerEntry = (overrides = {}) => ({
  message_id: '<req-1@lt-heavy.com>',
  rfq_id: 'rfq-1',
  rfq_number: 'RFQ-2026-0001',
  from_address: 'project.procurement@lt-heavy.com',
  subject: 'Urgent Requisition - Pumps',
  status: 'INGESTED' as const,
  detail: 'Raised with 2 line item(s), 0 needing category review.',
  processed_at: '2026-09-07T04:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
  mockFetchStatus.mockResolvedValue({ success: true, data: status() });
  mockPoll.mockResolvedValue({ success: true, data: { considered: 2, ingested: 1, pending: 0 } });
});

describe('EmailGatewayPanel loading and failure', () => {
  test('shows a loading state before the status arrives', async () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {}));
    render(<EmailGatewayPanel />);
    expect(screen.getByTestId('gateway-loading')).toBeInTheDocument();
  });

  test('reports a status that could not be read', async () => {
    mockFetchStatus.mockResolvedValue({ success: false, error: 'Backend is starting up.' });
    render(<EmailGatewayPanel />);

    expect(await screen.findByTestId('gateway-error')).toHaveTextContent('Backend is starting up.');
  });
});

describe('EmailGatewayPanel when no mailbox is connected', () => {
  // The most important state to get right: it must not look like it is working.
  test('names the exact environment variables required', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({
        configured: false,
        enabled: false,
        watching: false,
        connectionState: 'NOT_CONFIGURED',
        gatewayAddress: null,
        mailboxUser: null,
      }),
    });
    render(<EmailGatewayPanel />);

    const setup = await screen.findByTestId('gateway-setup');
    expect(setup).toHaveTextContent('EMAIL_GATEWAY_HOST');
    expect(setup).toHaveTextContent('EMAIL_GATEWAY_USER');
    expect(setup).toHaveTextContent('EMAIL_GATEWAY_PASSWORD');
    expect(setup).toHaveTextContent('EMAIL_GATEWAY_ENABLED');
    expect(screen.getByText(GATEWAY.notConfiguredLabel)).toBeInTheDocument();
  });

  test('disables the manual check when nothing is connected', async () => {
    mockFetchStatus.mockResolvedValue({ success: true, data: status({ configured: false }) });
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-setup');
    expect(screen.getByRole('button', { name: new RegExp(GATEWAY.checkNowAction, 'i') })).toBeDisabled();
  });
});

describe('EmailGatewayPanel when connected', () => {
  // The address a buyer sends TO must be the prominent one. Showing the IMAP
  // login here is what made the panel read as "forward requisitions to this
  // personal Gmail".
  test('leads with the Procucev intake address, not the IMAP login', async () => {
    render(<EmailGatewayPanel />);

    const intake = await screen.findByTestId('gateway-intake-address');
    expect(intake).toHaveTextContent(GATEWAY.gatewayAddressLabel);
    expect(intake).toHaveTextContent('client@procucev.com');
    // The collecting account is still shown, but as an operational detail.
    expect(intake).not.toHaveTextContent('intake@procucev.com');
    expect(screen.getByText('intake@procucev.com')).toBeInTheDocument();
  });

  test('shows the interval and where an ingested RFQ is held', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.activeListeningLabel)).toBeInTheDocument();
    expect(screen.getByText('120s')).toBeInTheDocument();
    // Buyers need to know an ingested RFQ is held for review, not circulated.
    expect(screen.getByText('Parsing')).toBeInTheDocument();
  });

  // The buyer page monitors the gateway; it never dispatches to vendors.
  test('states that no vendor is contacted from this screen', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.nextStepNoVendors)).toBeInTheDocument();
    // No action on this page can reach a vendor. The buyer page monitors the
    // gateway; releasing is the Category Manager's step.
    expect(screen.queryByRole('button', { name: /release to vendors/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /circulate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /shortlist/i })).not.toBeInTheDocument();
    // The prototype asserted the gateway also shortlists and circulates. The copy
    // must state the opposite rather than merely avoiding the words.
    expect(screen.getByText(/No vendor is shortlisted or contacted at this stage/i)).toBeInTheDocument();
  });

  test('shows the worked example addressed to the gateway', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.exampleTitle)).toBeInTheDocument();
    expect(screen.getByText(GATEWAY.exampleFromValue)).toBeInTheDocument();
    expect(screen.getAllByText('client@procucev.com').length).toBeGreaterThan(1);
  });

  test.each([
    ['SWITCHED_OFF', GATEWAY.offLabel],
    ['CONNECTION_ERROR', GATEWAY.connectionErrorLabel_state],
    ['ACTIVE_LISTENING', GATEWAY.activeListeningLabel],
  ])('renders the %s badge from the server state', async (state, label) => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table-driven over the state union
      data: status({ connectionState: state as any }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  // An unlisted sender is silently skipped, so the rule has to be discoverable.
  test('states the baseline sender rule when no allow-list is set', async () => {
    render(<EmailGatewayPanel />);

    expect(await screen.findByText(GATEWAY.allowedAnyAccount)).toBeInTheDocument();
  });

  test('lists explicit allowed senders when configured', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({ allowedSenders: ['a@b.com', 'c@d.com'] }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText('a@b.com, c@d.com')).toBeInTheDocument();
  });

  test('lists allowed domains when configured', async () => {
    mockFetchStatus.mockResolvedValue({ success: true, data: status({ allowedDomains: ['lt-heavy.com'] }) });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText('lt-heavy.com')).toBeInTheDocument();
    expect(screen.getByText(`${GATEWAY.allowedDomainsLabel}`)).toBeInTheDocument();
  });

  test('surfaces the last connection error', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({ lastError: 'Invalid credentials (AUTHENTICATIONFAILED)' }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByTestId('gateway-last-error')).toHaveTextContent('AUTHENTICATIONFAILED');
  });

  test('says when nothing has been checked yet', async () => {
    mockFetchStatus.mockResolvedValue({ success: true, data: status({ lastPollAt: null }) });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText(GATEWAY.neverChecked)).toBeInTheDocument();
  });
});

describe('EmailGatewayPanel activity ledger', () => {
  test('says when no message has been processed', async () => {
    render(<EmailGatewayPanel />);
    expect(await screen.findByText(GATEWAY.recentEmpty)).toBeInTheDocument();
  });

  test('shows an ingested message with the RFQ it raised', async () => {
    mockFetchStatus.mockResolvedValue({ success: true, data: status({ recent: [ledgerEntry()] }) });
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText('Urgent Requisition - Pumps')).toBeInTheDocument();
    expect(screen.getByText(`${GATEWAY.outcomeIngested} · RFQ-2026-0001`)).toBeInTheDocument();
  });

  // A skipped requisition has to be explainable without reading the server log.
  test('explains a rejected sender', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({
        recent: [
          ledgerEntry({
            status: 'SENDER_NOT_ALLOWED',
            rfq_number: null,
            detail: 'No buyer account is registered against stranger@example.com.',
          }),
        ],
      }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText(GATEWAY.outcomeSenderNotAllowed)).toBeInTheDocument();
    expect(screen.getByText(/No buyer account is registered/)).toBeInTheDocument();
  });

  test.each([
    ['NO_LINE_ITEMS', GATEWAY.outcomeNoLineItems],
    ['UNREADABLE', GATEWAY.outcomeUnreadable],
    ['FAILED', GATEWAY.outcomeFailed],
  ])('labels a %s outcome', async (outcome, label) => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({ recent: [ledgerEntry({ status: outcome, rfq_number: null, detail: null })] }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  test('falls back to the message id when a message had no subject', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({ recent: [ledgerEntry({ subject: null })] }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText('<req-1@lt-heavy.com>')).toBeInTheDocument();
  });

  test('tolerates an outcome value it does not recognise', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising an unknown server value
      data: status({ recent: [ledgerEntry({ status: 'SOMETHING_NEW' as any })] }),
    });
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(/RFQ-2026-0001/)).toBeInTheDocument();
  });
});

describe('EmailGatewayPanel manual check', () => {
  test('reports the run summary and refreshes the status', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(GATEWAY.checkNowAction, 'i') }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        GATEWAY.checkCompleteTitle,
        formatString(GATEWAY.checkCompleteMessage, { considered: 2, ingested: 1, pending: 0 }),
        'success'
      )
    );
    // Once on mount, once after the check.
    expect(mockFetchStatus).toHaveBeenCalledTimes(2);
  });

  test('surfaces the server reason when a check is refused', async () => {
    mockPoll.mockResolvedValue({ success: false, error: 'A mailbox check is already in progress.' });
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(GATEWAY.checkNowAction, 'i') }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        GATEWAY.checkFailedTitle,
        'A mailbox check is already in progress.',
        'warning'
      )
    );
  });

  test('falls back to local copy when a refusal carries no reason', async () => {
    mockPoll.mockResolvedValue({ success: false });
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(GATEWAY.checkNowAction, 'i') }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(GATEWAY.checkFailedTitle, GATEWAY.pollFailed, 'warning')
    );
  });

  test('shows progress and ignores a second click while in flight', async () => {
    let release: (v: unknown) => void = () => {};
    mockPoll.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(GATEWAY.checkNowAction, 'i') }));

    const busy = await screen.findByRole('button', { name: new RegExp(GATEWAY.checkingLabel, 'i') });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(busy);
    expect(mockPoll).toHaveBeenCalledTimes(1);

    release({ success: true, data: { considered: 0, ingested: 0, pending: 0 } });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
  });
});
