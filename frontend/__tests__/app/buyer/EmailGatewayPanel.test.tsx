import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmailGatewayPanel from '@/app/buyer/EmailGatewayPanel';
import { useApp } from '@/lib/store';
import { createRFQ, extractLineItemsFromDocument } from '@/lib/rfqClient';
import { fetchEmailGatewayStatus } from '@/lib/emailGatewayClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/rfqClient', () => ({
  createRFQ: jest.fn(),
  extractLineItemsFromDocument: jest.fn(),
}));
jest.mock('@/lib/emailGatewayClient', () => ({
  fetchEmailGatewayStatus: jest.fn(),
}));

const GATEWAY = UI_STRINGS.emailGateway;
const BUYER_EMAIL = 'buyer.lead@example.com';
const INTAKE_ADDRESS = 'rfq-intake@example.com';
const PLANT_LOCATION = 'Plant 7, Chakan Industrial Area';
const PINCODE = '410501';
const mockShowToast = jest.fn();
const mockAdoptCreatedRFQ = jest.fn();
const mockCreateRFQ = createRFQ as jest.Mock;
const mockExtract = extractLineItemsFromDocument as jest.Mock;
const mockFetchGatewayStatus = fetchEmailGatewayStatus as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({
    showToast: mockShowToast,
    activeBuyerAccount: {
      corporateEmail: BUYER_EMAIL,
      primaryPlantLocation: PLANT_LOCATION,
      pincode: PINCODE,
    },
    adoptCreatedRFQ: mockAdoptCreatedRFQ,
  });
  mockFetchGatewayStatus.mockResolvedValue({ success: true, data: { gatewayAddress: INTAKE_ADDRESS } });
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

describe('EmailGatewayPanel Requisition Composer & Submission Flow', () => {
  test('renders the sender from the buyer account and the intake address from the gateway status', async () => {
    render(<EmailGatewayPanel />);

    await screen.findByTestId('gateway-panel');
    expect(screen.getByDisplayValue(BUYER_EMAIL)).toBeInTheDocument();
    expect(await screen.findByDisplayValue(INTAKE_ADDRESS)).toBeInTheDocument();

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    const bodyInput = screen.getByPlaceholderText(/Paste or write line items/i);

    expect(subjectInput).toHaveValue('');
    expect(bodyInput).toHaveValue('');
  });

  test('handles user typing in sender, subject, and body inputs', async () => {
    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const senderInput = screen.getByDisplayValue(BUYER_EMAIL);
    fireEvent.change(senderInput, { target: { value: 'custom.buyer@factory.com' } });
    expect(senderInput).toHaveValue('custom.buyer@factory.com');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'URGENT: Generator Order' } });
    expect(subjectInput).toHaveValue('URGENT: Generator Order');

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Generator 500kVA - 2 Units' } });
    expect(bodyTextarea).toHaveValue('Generator 500kVA - 2 Units');
  });

  test('submitting requisition creates RFQ from the account and gateway values, calls adoptCreatedRFQ, and resets fields', async () => {
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
      expect(mockCreateRFQ).toHaveBeenCalledWith(expect.objectContaining({
        sourceEmail: BUYER_EMAIL,
        targetGatewayEmail: INTAKE_ADDRESS,
        deliveryLocation: PLANT_LOCATION,
        deliveryPincode: PINCODE,
        budget: 1500000,
        targetDeliveryDate: '2026-09-18',
      }));
      expect(mockAdoptCreatedRFQ).toHaveBeenCalled();
      expect(mockOnCreated).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        'Requisition Ingested Successfully',
        expect.stringContaining('RFQ-2026-0912'),
        'success'
      );
    });

    expect(subjectInput).toHaveValue('');
    expect(bodyTextarea).toHaveValue('');
  });

  test('submits only what the requisition states when category, budget and date are missing', async () => {
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
        category: null,
        budget: 0,
        targetDeliveryDate: null,
      }));
    });
  });

  test('creates nothing and reports the extraction reason when AI extraction fails', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      reason: 'NOT_CONFIGURED',
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Non-Urgent Valves' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Valve specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Ingestion Failed',
        UI_STRINGS.rfqExtraction.reasonMessages.NOT_CONFIGURED,
        'warning'
      );
    });
    expect(mockCreateRFQ).not.toHaveBeenCalled();
    expect(mockAdoptCreatedRFQ).not.toHaveBeenCalled();
  });

  test('creates nothing when extraction succeeds but finds no line items', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: {
        category: '',
        estimatedBudget: null,
        targetDeliveryDate: '',
        extractedEntities: [],
      },
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Unreadable Requisition' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Thanks, regards' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Ingestion Failed',
        UI_STRINGS.rfqExtraction.unreadableResponse,
        'warning'
      );
    });
    expect(mockCreateRFQ).not.toHaveBeenCalled();
  });

  test('shows the gateway status error and leaves the intake field empty when the status cannot be read', async () => {
    mockFetchGatewayStatus.mockResolvedValueOnce({ success: false });

    render(<EmailGatewayPanel />);

    expect(await screen.findByText(GATEWAY.statusUnavailable)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(GATEWAY.notConfiguredLabel)).toHaveValue('');
  });

  test('creates the RFQ without a gateway address when the status reports none', async () => {
    mockFetchGatewayStatus.mockResolvedValueOnce({ success: true, data: { gatewayAddress: null } });

    render(<EmailGatewayPanel />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(GATEWAY.notConfiguredLabel)).toBeInTheDocument();
    });

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'No Gateway Requisition' } });

    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Pump 2 Units' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateRFQ.mock.calls[0][0].targetGatewayEmail).toBeUndefined();
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

  test('leaves the sender blank when there is no active buyer account', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: null,
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');
    expect(screen.getByPlaceholderText('name@company.com')).toHaveValue('');
  });

  test('submits RFQ with mode_1 when buyer has version_1 subscription', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: { corporateEmail: 'v1.buyer@company.com', subscriptionPlan: 'version_1' },
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Subject for Version 1' } });
    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Item Specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(
        expect.objectContaining({ sourcingMode: 'mode_1' })
      );
    });
  });

  test('submits RFQ with mode_3 when buyer has version_3 subscription', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: { corporateEmail: 'v3.buyer@company.com', subscriptionPlan: 'version_3' },
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Subject for Version 3' } });
    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Item Specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(
        expect.objectContaining({ sourcingMode: 'mode_3' })
      );
    });
  });

  test('submits RFQ with mode_0 (V0) by default when buyer is on free_trial plan', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: { corporateEmail: 'trial.buyer@company.com', subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 },
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Trial Requisition' } });
    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Item Specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(
        expect.objectContaining({ sourcingMode: 'mode_0' })
      );
    });
  });

  test('submits RFQ with mode_2 when buyer has active version_2 subscription', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: { corporateEmail: 'v2.buyer@company.com', subscriptionPlan: 'version_2' },
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Subject for Version 2' } });
    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Item Specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(
        expect.objectContaining({ sourcingMode: 'mode_2' })
      );
    });
  });

  test('submits RFQ with mode_0 (V0) when buyer subscription is expired or inactive', async () => {
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      activeBuyerAccount: {
        corporateEmail: 'expired.buyer@company.com',
        subscriptionPlan: 'version_2',
        subscriptionStatus: 'expired',
      },
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
    });

    render(<EmailGatewayPanel />);
    await screen.findByTestId('gateway-panel');

    const subjectInput = screen.getByPlaceholderText(/e\.g\. URGENT: Requisition/i);
    fireEvent.change(subjectInput, { target: { value: 'Expired Sub Requisition' } });
    const bodyTextarea = screen.getByPlaceholderText(/Paste or write line items/i);
    fireEvent.change(bodyTextarea, { target: { value: 'Item Specs' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(GATEWAY.submitAction, 'i') });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateRFQ).toHaveBeenCalledWith(
        expect.objectContaining({ sourcingMode: 'mode_0' })
      );
    });
  });
});
