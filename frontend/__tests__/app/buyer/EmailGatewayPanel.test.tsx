import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmailGatewayPanel from '@/app/buyer/EmailGatewayPanel';
import { useApp } from '@/lib/store';
import { fetchEmailGatewayStatus } from '@/lib/emailGatewayClient';
import { createRFQ, extractLineItemsFromDocument } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { EmailGatewayStatus, RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/emailGatewayClient', () => ({
  fetchEmailGatewayStatus: jest.fn(),
  pollEmailGateway: jest.fn(),
}));
jest.mock('@/lib/rfqClient', () => ({
  createRFQ: jest.fn(),
  extractLineItemsFromDocument: jest.fn(),
}));

const GATEWAY = UI_STRINGS.emailGateway;
const mockShowToast = jest.fn();
const mockAdoptCreatedRFQ = jest.fn();
const mockSetCurrentRole = jest.fn();
const mockSetActiveTab = jest.fn();
const mockFetchStatus = fetchEmailGatewayStatus as jest.Mock;
const mockCreateRFQ = createRFQ as jest.Mock;
const mockExtract = extractLineItemsFromDocument as jest.Mock;

function status(overrides: Partial<EmailGatewayStatus> = {}): EmailGatewayStatus {
  return {
    enabled: true,
    configured: true,
    watching: true,
    connectionState: 'ACTIVE_LISTENING',
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
  (useApp as jest.Mock).mockReturnValue({
    showToast: mockShowToast,
    activeBuyerAccount: { corporateEmail: 'buyer.lead@lt-heavy.com' },
    adoptCreatedRFQ: mockAdoptCreatedRFQ,
    setCurrentRole: mockSetCurrentRole,
    setActiveTab: mockSetActiveTab,
  });
  mockFetchStatus.mockResolvedValue({ success: true, data: status() });
  mockExtract.mockResolvedValue({
    success: true,
    data: {
      extractedEntities: [
        {
          id: 'item-1',
          itemName: 'Centrifugal Water Pump 500 GPM',
          quantity: 12,
          unit: 'Units',
          category: 'Engineering Spares - Mechanical',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategory: 'Centrifugal Pumps & Spares',
          technicalSpecs: '15 HP Motor, SS316 Impeller',
          targetDate: '2026-09-15',
          confidence: 0.98,
        },
      ],
    },
  });
  mockCreateRFQ.mockResolvedValue({
    success: true,
    rfq: {
      id: 'rfq-new-1',
      rfqNumber: 'RFQ-2026-0912',
      title: 'URGENT: Requisition for Centrifugal Water Pumps & Industrial Valves',
      category: 'Engineering Spares - Mechanical',
      sourcingMode: 'mode_1',
      status: 'Parsing',
      extractedEntities: [{ id: 'item-1', itemName: 'Centrifugal Water Pump 500 GPM' }],
    } as unknown as RFQItem,
  });
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
});

describe('EmailGatewayPanel when connected', () => {
  test('leads with the Procucev intake address, not the IMAP login', async () => {
    render(<EmailGatewayPanel />);

    const intake = await screen.findByTestId('gateway-intake-address');
    expect(intake).toHaveTextContent(GATEWAY.gatewayAddressLabel);
    expect(intake).toHaveTextContent('client@procucev.com');
    expect(intake).not.toHaveTextContent('intake@procucev.com');
    expect(screen.getByText('intake@procucev.com')).toBeInTheDocument();
  });

  test('shows the interval and where an ingested RFQ is held', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.activeListeningLabel)).toBeInTheDocument();
    expect(screen.getByText('120s')).toBeInTheDocument();
    expect(screen.getByText('Parsing')).toBeInTheDocument();
  });

  test('states that no vendor is contacted from this screen', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.nextStepNoVendors)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release to vendors/i })).not.toBeInTheDocument();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: status({ connectionState: state as any }),
    });
    render(<EmailGatewayPanel />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

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
});

describe('EmailGatewayPanel Requisition Composer & Submission Flow', () => {
  test('renders composer inputs and sample preset buttons', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.sampleSelectorTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GATEWAY.samplePumps })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GATEWAY.sampleElectrical })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GATEWAY.sampleSteel })).toBeInTheDocument();
    expect(screen.getByDisplayValue('buyer.lead@lt-heavy.com')).toBeInTheDocument();
  });

  test('switching sample presets populates subject and email body', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    fireEvent.click(screen.getByRole('button', { name: GATEWAY.samplePumps }));
    expect(screen.getByDisplayValue(/Centrifugal Water Pumps/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: GATEWAY.sampleElectrical }));
    expect(screen.getByDisplayValue(/HT Switchgear Panels/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: GATEWAY.sampleSteel }));
    expect(screen.getByDisplayValue(/Structural Steel PEB/i)).toBeInTheDocument();
  });

  test('handles user typing in sender, subject, and body inputs', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const senderInput = screen.getByPlaceholderText('project.procurement@lt-heavy.com');
    fireEvent.change(senderInput, { target: { value: 'custom.buyer@factory.com' } });
    expect(senderInput).toHaveValue('custom.buyer@factory.com');

    const subjectInput = screen.getByPlaceholderText(/URGENT: Requisition Requirement/i);
    fireEvent.change(subjectInput, { target: { value: 'URGENT: Generator Order' } });
    expect(subjectInput).toHaveValue('URGENT: Generator Order');

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Generator 500kVA - 2 Units' } });
    expect(bodyTextarea).toHaveValue('Generator 500kVA - 2 Units');
  });

  test('submitting requisition creates RFQ, shows card, allows dismiss/reset', async () => {
    const mockOnCreated = jest.fn();
    render(<EmailGatewayPanel onRFQCreated={mockOnCreated} />);
    await screen.findByTestId('gateway-panel');

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalled();
      expect(mockAdoptCreatedRFQ).toHaveBeenCalled();
      expect(mockOnCreated).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        'Requisition Ingested Successfully',
        expect.stringContaining('RFQ-2026-0912'),
        'success'
      );
    });

    const successBanner = await screen.findByTestId('created-rfq-banner');
    expect(successBanner).toHaveTextContent('RFQ-2026-0912');
    expect(screen.getByRole('button', { name: new RegExp(GATEWAY.viewInKanbanAction, 'i') })).toBeInTheDocument();

    // Click Send Another Requisition button to reset banner
    const sendAnotherBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.sendAnotherAction, 'i') });
    fireEvent.click(sendAnotherBtn);
    expect(screen.queryByTestId('created-rfq-banner')).not.toBeInTheDocument();

    // Trigger navigation to kanban
    fireEvent.click(submitBtn);
    await screen.findByTestId('created-rfq-banner');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(GATEWAY.viewInKanbanAction, 'i') }));
    expect(mockSetCurrentRole).toHaveBeenCalledWith('category_manager');
    expect(mockSetActiveTab).toHaveBeenCalledWith('kanban_board');
  });

  test('submitting fallback requisition when AI extraction returns empty or fails', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      data: null,
    });
    mockCreateRFQ.mockResolvedValueOnce({
      success: true,
      rfq: {
        id: 'rfq-fallback-1',
        rfqNumber: 'RFQ-2026-0999',
        title: 'Inbound Email Requisition',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_1',
        status: 'Parsing',
        extractedEntities: [],
      } as unknown as RFQItem,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/URGENT: Requisition Requirement/i);
    fireEvent.change(subjectInput, { target: { value: '' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Inbound Email Requisition',
        status: 'Parsing',
      }));
    });
  });

  test('handles createRFQ returning failure error', async () => {
    mockCreateRFQ.mockResolvedValueOnce({
      success: false,
      error: 'Database constraint violation',
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Ingestion Error',
        'Database constraint violation',
        'warning'
      );
    });
  });

  test('handles exception during requisition submission', async () => {
    mockExtract.mockRejectedValueOnce(new Error('Network timeout during AI extraction'));

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Ingestion Failed',
        'Network timeout during AI extraction',
        'warning'
      );
    });
  });

  test('shows warning toast if email body is empty when submit is triggered', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: '' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    expect(submitBtn).toBeDisabled();
  });

  test('handles activeBuyerAccount being undefined gracefully', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: null,
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
      setCurrentRole: mockSetCurrentRole,
      setActiveTab: mockSetActiveTab,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');
    expect(screen.getByDisplayValue('project.procurement@lt-heavy.com')).toBeInTheDocument();
  });

  test('renders with fallback unknown badge and ledger status', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: status({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectionState: 'UNKNOWN_STATE' as any,
        gatewayAddress: null,
        recent: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ledgerEntry({ status: 'UNKNOWN_STATUS' as any, rfq_number: null, detail: null }),
        ],
      }),
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');
    expect(screen.getByText(GATEWAY.notConfiguredLabel)).toBeInTheDocument();
    expect(screen.getByText(GATEWAY.outcomeFailed)).toBeInTheDocument();
  });
});
