import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmailGatewayPanel from '@/app/buyer/EmailGatewayPanel';
import { useApp } from '@/lib/store';
import { fetchEmailGatewayStatus } from '@/lib/emailGatewayClient';
import { createRFQ, extractLineItemsFromDocument } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RFQItem } from '@/lib/types';

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

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({
    showToast: mockShowToast,
    activeBuyerAccount: { corporateEmail: 'buyer.lead@lt-heavy.com' },
    adoptCreatedRFQ: mockAdoptCreatedRFQ,
    setCurrentRole: mockSetCurrentRole,
    setActiveTab: mockSetActiveTab,
  });
  mockFetchStatus.mockResolvedValue({
    success: true,
    data: {
      gatewayAddress: 'navinchaudhary.dev@gmail.com',
    },
  });
  mockExtract.mockResolvedValue({
    success: true,
    data: {
      category: 'Engineering Spares - Mechanical',
      estimatedBudget: 1500000,
      targetDeliveryDate: '2026-09-18',
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

  test('reports fallback status when no error string is provided', async () => {
    mockFetchStatus.mockResolvedValue({ success: false, error: null });
    render(<EmailGatewayPanel />);

    expect(await screen.findByTestId('gateway-error')).toHaveTextContent(GATEWAY.statusUnavailable);
  });

  test('loads status when gatewayAddress is missing from status payload', async () => {
    mockFetchStatus.mockResolvedValue({
      success: true,
      data: { gatewayAddress: null },
    });
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');
    expect(screen.getByDisplayValue('navinchaudhary.dev@gmail.com')).toBeInTheDocument();
  });
});

describe('EmailGatewayPanel Requisition Composer & Submission Flow', () => {
  test('renders composer inputs with default empty subject and body', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByDisplayValue('buyer.lead@lt-heavy.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('navinchaudhary.dev@gmail.com')).toBeInTheDocument();

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    const bodyInput = screen.getByPlaceholderText(/Paste or write line items/i);

    expect(subjectInput).toHaveValue('');
    expect(bodyInput).toHaveValue('');
  });

  test('handles user typing in sender, subject, and body inputs', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const senderInput = screen.getByPlaceholderText('project.procurement@lt-heavy.com');
    fireEvent.change(senderInput, { target: { value: 'custom.buyer@factory.com' } });
    expect(senderInput).toHaveValue('custom.buyer@factory.com');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'URGENT: Generator Order' } });
    expect(subjectInput).toHaveValue('URGENT: Generator Order');

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Generator 500kVA - 2 Units' } });
    expect(bodyTextarea).toHaveValue('Generator 500kVA - 2 Units');
  });

  test('submitting requisition creates RFQ, shows card, allows dismiss/reset and navigation', async () => {
    const mockOnCreated = jest.fn();
    render(<EmailGatewayPanel onRFQCreated={mockOnCreated} />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'URGENT: Water Pumps Requirement' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: '1. Centrifugal Pump 500 GPM - Qty: 12 Units' } });

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

    // Click Send Another Requisition button to reset banner and fields
    const sendAnotherBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.sendAnotherAction, 'i') });
    fireEvent.click(sendAnotherBtn);
    expect(screen.queryByTestId('created-rfq-banner')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste or write line items/i)).toHaveValue('');

    // Trigger submit again and navigate to kanban (without onRFQCreated)
    fireEvent.change(subjectInput, { target: { value: 'Requisition 2' } });
    fireEvent.change(bodyTextarea, { target: { value: '1. Pump - Qty: 10' } });
    fireEvent.click(submitBtn);
    await screen.findByTestId('created-rfq-banner');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(GATEWAY.viewInKanbanAction, 'i') }));
    expect(mockSetCurrentRole).toHaveBeenCalledWith('category_manager');
    expect(mockSetActiveTab).toHaveBeenCalledWith('kanban_board');
  });

  test('submitting requisition when extracted data has partial fields (no category/budget/date)', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: {
        category: null,
        estimatedBudget: null,
        targetDeliveryDate: null,
        extractedEntities: [
          {
            id: 'item-partial',
            itemName: 'Gate Valve',
            quantity: 5,
            unit: 'Units',
          },
        ],
      },
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Gate Valve Request' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Gate Valve 4 inch - 5 Units' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(expect.objectContaining({
        category: 'Engineering Spares - Mechanical',
        budget: 2500000,
        targetDeliveryDate: '2026-09-18',
      }));
    });
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
        title: 'Non-Urgent Valves',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_1',
        status: 'Parsing',
        extractedEntities: [],
      } as unknown as RFQItem,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Non-Urgent Valves' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Fallback spec details' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Non-Urgent Valves',
        status: 'Parsing',
      }));
    });
  });

  test('handles createRFQ returning failure error without specific error message', async () => {
    mockCreateRFQ.mockResolvedValueOnce({
      success: false,
      error: null,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Subject Test' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Some item details' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Ingestion Error',
        'Failed to save RFQ to database.',
        'warning'
      );
    });
  });

  test('handles non-Error exception during requisition submission', async () => {
    mockExtract.mockRejectedValueOnce('String exception message');

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Subject Test' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Some item details' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Ingestion Failed',
        'An unexpected error occurred.',
        'warning'
      );
    });
  });

  test('shows warning toast if email subject is empty when submit is triggered', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Some item specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    expect(mockShowToast).toHaveBeenCalledWith(
      'Missing Subject',
      'Please provide a requisition subject.',
      'warning'
    );
    expect(mockCreateRFQ).not.toHaveBeenCalled();
  });

  test('shows warning toast if email body is empty when submit is triggered', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Valid Subject' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    expect(mockShowToast).toHaveBeenCalledWith(
      'Missing Requirement',
      'Please provide email body and line-item specs.',
      'warning'
    );
    expect(mockCreateRFQ).not.toHaveBeenCalled();
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
});
