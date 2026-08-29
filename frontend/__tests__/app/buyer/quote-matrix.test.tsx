import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import QuoteMatrix from '@/app/buyer/quote-matrix';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/quote-matrix.tsx', () => {
  const mockSetSelectedRFQForMatrix = jest.fn();
  const mockOpenRFQDeepDive = jest.fn();
  const mockSetDeepDiveModalOpen = jest.fn();
  const mockShowToast = jest.fn();
  const mockOnBackToDashboard = jest.fn();

  const mockRFQs: RFQItem[] = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'High Pressure Centrifugal Water Pumps 500 GPM',
      category: 'Engineering Spares - Mechanical',
      intakeSource: 'email_gateway',
      creationDate: '2026-02-28',
      targetDeliveryDate: '2026-03-25',
      budget: 85000,
      quotesCount: 3,
      status: 'Quotes Received',
      chasingActive: true,
      followUpData: {
        totalInvited: 5,
        respondedCount: 3,
        callStats: { total: 5, connected: 4, voicemail: 1, failed: 0, avgDuration: '1m 45s' },
        whatsappStats: { total: 5, delivered: 5, read: 4, replied: 3 },
        smsStats: { total: 5, delivered: 5, clicked: 4 },
        channels: [],
      },
      quotes: [
        {
          vendorId: 'v-1',
          vendorName: 'Apex Supplies Ltd.',
          vendorCategory: 'Procucev - AI Rec',
          unitPrice: 12500,
          totalPrice: 75000,
          leadTimeDays: 14,
          aiMatchScore: 98,
          isBestPrice: true,
          isPreferred: true,
          warrantyYears: 3,
          complianceStatus: 'Fully Compliant',
          paymentTerms: 'Net 45 Days',
          remarks: 'OEM certified warranty with plant dispatch.',
        },
        {
          vendorId: 'v-2',
          vendorName: 'Kiran Valve Industries',
          vendorCategory: 'Client List',
          unitPrice: 13200,
          totalPrice: 79200,
          leadTimeDays: 21,
          aiMatchScore: 88,
          warrantyYears: 2,
          complianceStatus: 'Minor Exception',
          paymentTerms: 'Net 30 Days',
          remarks: 'Standard mechanical specifications.',
        },
      ],
      lineItems: [
        {
          id: 'li-1',
          itemName: 'Centrifugal Pump 500 GPM',
          quantity: 6,
          unit: 'Units',
          targetDate: '2026-03-25',
          technicalSpecs: '15 HP Motor, 500 GPM',
          confidence: 0.95,
          category: 'Pumps & Accessories',
        },
      ],
    },
    {
      id: 'rfq-2',
      rfqNumber: 'RFQ-2026-00422',
      title: 'LV Switchgear Modular Panels',
      category: 'Engineering Spares - Electrical',
      intakeSource: 'web_portal',
      creationDate: '2026-02-28',
      targetDeliveryDate: '2026-03-30',
      budget: 120000,
      quotesCount: 0,
      status: 'In Sourcing',
      quotes: [],
      lineItems: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[0],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
      showToast: mockShowToast,
      approvePO: jest.fn(),
    });
  });

  it('renders comparative quote matrix with RFQ header, telemetry, and quotes table', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    expect(screen.getByText('Comparative Quote Evaluation Matrix')).toBeInTheDocument();
    expect(screen.getByText('High Pressure Centrifugal Water Pumps 500 GPM')).toBeInTheDocument();
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Kiran Valve Industries')).toBeInTheDocument();

    // Back to dashboard link
    fireEvent.click(screen.getByText(/Back to Command Center/i));
    expect(mockOnBackToDashboard).toHaveBeenCalled();
  });

  it('handles RFQ switcher dropdown and deep dive modal trigger', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    // Switch RFQ
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'rfq-2' } });
    expect(mockSetSelectedRFQForMatrix).toHaveBeenCalledWith(mockRFQs[1]);

    // Click Deep Dive telemetry button
    fireEvent.click(screen.getByText(/Deep Dive Telemetry/i));
    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRFQs[0]);
  });

  it('handles awarding / selecting vendor and PO modal workflow', () => {
    const { container } = render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    // Click Approve & Generate PO for preferred quote
    fireEvent.click(screen.getByText(/APPROVE & GENERATE PO/i));

    // PO Modal should be open
    expect(screen.getByText(/Purchase Order Generation & Dispatch/i)).toBeInTheDocument();

    // Close PO Modal via X button
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);

    // Select second non-preferred quote
    fireEvent.click(screen.getByText(/Select Kiran/i));
    expect(screen.getByText(/Purchase Order Generation & Dispatch/i)).toBeInTheDocument();
  });

  it('renders deep dive modal when deepDiveModalOpen is true and closes it', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[0],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: true,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: mockRFQs[0],
      showToast: mockShowToast,
      approvePO: jest.fn(),
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/RFQ AI Follow-Up Telemetry & Deep Dive/i)).toBeInTheDocument();

    // Close deep dive modal via top right X button
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(mockSetDeepDiveModalOpen).toHaveBeenCalledWith(false);
  });

  it('renders empty quotes fallback state when selected RFQ has no quotes', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
      showToast: mockShowToast,
      approvePO: jest.fn(),
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    // With selectedRFQForMatrix null, defaults to rfqs[0]
    expect(screen.getByText('High Pressure Centrifugal Water Pumps 500 GPM')).toBeInTheDocument();

    // Now test with rfqs[1] (0 quotes)
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[1],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
      showToast: mockShowToast,
      approvePO: jest.fn(),
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText('Quotes Pending for this RFQ')).toBeInTheDocument();
  });
});
