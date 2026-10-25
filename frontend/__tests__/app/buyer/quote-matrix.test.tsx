import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuoteMatrix from '../../../app/buyer/quote-matrix';
import { useApp } from '../../../lib/store';
import { formatCurrency, formatIndianDate } from '../../../lib/constants';
import { useRouter, useSearchParams } from 'next/navigation';
import { UI_STRINGS } from '../../../lib/uiStrings';

jest.mock('../../../lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('../../../app/components/Modals', () => ({
  PurchaseOrderModal: ({ isOpen, onClose, onFinalized, vendorName }: any) =>
    isOpen ? (
      <div data-testid="po-modal">
        <span>PO Modal for {vendorName}</span>
        <button onClick={onClose}>Close PO Modal</button>
        <button onClick={() => onFinalized && onFinalized('PO-2026-9999')}>Finalize PO</button>
      </div>
    ) : null,
  RFQFollowUpDeepDiveModal: ({ isOpen, onClose, rfq }: any) =>
    isOpen ? (
      <div data-testid="deep-dive-modal">
        <span>Deep Dive for {rfq?.rfqNumber}</span>
        <button onClick={onClose}>Close Vendor Follow-Up Details</button>
      </div>
    ) : null,
}));

describe('QuoteMatrix Component Tests', () => {
  const mockShowToast = jest.fn();
  const mockSetSelectedRFQForMatrix = jest.fn();
  const mockOpenRFQDeepDive = jest.fn();
  const mockSetDeepDiveModalOpen = jest.fn();
  const mockOnBackToDashboard = jest.fn();
  const mockRefreshRFQs = jest.fn().mockResolvedValue(undefined);
  const mockPush = jest.fn();
  let mockRfqParam: string | null = null;

  const mockRFQs = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'High Pressure Centrifugal Water Pumps 500 GPM',
      category: 'Engineering Spares - Mechanical',
      intakeSource: 'email_gateway',
      creationDate: '2026-02-28',
      targetDeliveryDate: '2026-03-25',
      budget: 85000,
      quotesCount: 2,
      buyerAccountId: 'buyer-own',
      status: 'In Evaluation' as const,
      chasingActive: true,
      followUpData: {
        totalInvited: 5,
        respondedCount: 3,
        callStats: { total: 5, connected: 4, avgDuration: '1m 45s' },
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
          attachments: [],
        },
        {
          vendorId: 'v-2',
          vendorName: 'Kiran Valve Industries',
          vendorCategory: 'Client List',
          unitPrice: 13200,
          totalPrice: 79200,
          leadTimeDays: 21,
          aiMatchScore: 88,
          isBestPrice: false,
          isPreferred: false,
          warrantyYears: 2,
          complianceStatus: 'Minor Exception',
          paymentTerms: 'Net 30 Days',
          remarks: 'Standard mechanical specifications.',
          attachments: [],
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
      buyerAccountId: 'buyer-other',
      status: 'Quotes Pending' as const,
      quotes: [],
      lineItems: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockRfqParam = null;
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useSearchParams as jest.Mock).mockReturnValue({
      get: (key: string) => (key === 'rfq' ? mockRfqParam : null),
    });
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      rfqs: mockRFQs,
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
      refreshRFQs: mockRefreshRFQs,
      buyerVendors: [],
    });
  });

  test('renders QuoteMatrix with RFQ switcher, and vendors comparison matrix', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Apex Supplies Ltd./i)).toBeInTheDocument();
    expect(screen.getByText(/Kiran Valve Industries/i)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(85000))).toBeInTheDocument();
    expect(screen.getByText(/L1 • Best Price/i)).toBeInTheDocument();
    expect(screen.getByText('L2')).toBeInTheDocument();
  });

  test('syncs RFQ from query parameter rfq when present in URL and matches an RFQ', () => {
    mockRfqParam = 'RFQ-2026-00422';
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(mockSetSelectedRFQForMatrix).toHaveBeenCalledWith(mockRFQs[1]);
  });

  test('does not sync RFQ if rfqParam matches already-selected RFQ', () => {
    mockRfqParam = 'RFQ-2026-00421';
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[0],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(mockSetSelectedRFQForMatrix).not.toHaveBeenCalled();
  });

  test('renders a line-item-wise comparison row per RFQ item, highlighting the lowest real price, and downloads an Excel file', () => {
    const itemizedRfq = {
      ...mockRFQs[0],
      id: 'rfq-itemized',
      rfqNumber: 'RFQ-2026-ITEM01',
      extractedEntities: [
        { id: 'li-a', itemName: 'Centrifugal Pump 500 GPM', quantity: 6, unit: 'Units' },
        { id: 'li-b', itemName: 'Mounting Bracket', quantity: 12, unit: 'Units' },
      ],
      quotes: [
        {
          ...mockRFQs[0].quotes[0],
          lineItemQuotes: [
            { lineItemId: 'li-a', itemName: 'Centrifugal Pump 500 GPM', quantity: 6, unitPrice: 12000, totalPrice: 72000 },
            { lineItemId: 'li-b', itemName: 'Mounting Bracket', quantity: 12, unitPrice: 300, totalPrice: 3600 },
          ],
        },
        {
          ...mockRFQs[0].quotes[1],
        },
      ],
    };
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [itemizedRfq],
      selectedRFQForMatrix: itemizedRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    expect(screen.getByText('Line-Item-Wise Bid Comparison')).toBeInTheDocument();
    expect(screen.getByText('Centrifugal Pump 500 GPM')).toBeInTheDocument();
    expect(screen.getByText('Mounting Bracket')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(12000))).toBeInTheDocument();
    expect(screen.getAllByText(/not itemized/i).length).toBeGreaterThan(0);

    const downloadBtn = screen.getByText(/Download Excel/i);
    expect(downloadBtn).toBeInTheDocument();

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();
    fireEvent.click(downloadBtn);
    URL.createObjectURL = originalCreateObjectURL;
  });

  test('allows selecting a different RFQ from dropdown or ignoring non-matching selection', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'rfq-2' } });
    expect(mockSetSelectedRFQForMatrix).toHaveBeenCalledWith(mockRFQs[1]);

    fireEvent.change(select, { target: { value: 'unknown-id' } });
  });

  test('triggers PO generator modal for preferred and non-preferred vendors and closes modal', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    const approveBtn = screen.getByText(/\[ APPROVE & GENERATE PRE-PURCHASE ORDER \]/i);
    fireEvent.click(approveBtn);

    expect(screen.getByTestId('po-modal')).toBeInTheDocument();
    const closeBtn = screen.getByText(/Close PO Modal/i);
    fireEvent.click(closeBtn);

    const selectKiranBtn = screen.getByText(/Select Kiran/i);
    fireEvent.click(selectKiranBtn);
  });

  test('handles PO finalized flow, triggers toast, refreshRFQs, and router push', async () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[0],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
      refreshRFQs: mockRefreshRFQs,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    const approveBtn = screen.getByText(/\[ APPROVE & GENERATE PRE-PURCHASE ORDER \]/i);
    fireEvent.click(approveBtn);

    const finalizeBtn = screen.getByText('Finalize PO');
    fireEvent.click(finalizeBtn);

    expect(mockShowToast).toHaveBeenCalledWith('PPO Finalised', expect.stringContaining('PO-2026-9999'), 'success');
    expect(mockRefreshRFQs).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/buyer/rfq-details?rfq=${encodeURIComponent(mockRFQs[0].rfqNumber)}`);
    });
  });

  test('renders view finalised PO on awarded vendor and bid concluded on other vendors when PO is finalised', () => {
    const poFinalisedRfq = {
      ...mockRFQs[0],
      status: 'PO Generated' as const,
      poFinalised: true,
      poNumber: 'PO-2026-00421',
      awardedVendor: 'Apex Supplies Ltd.',
      awardedAmount: 75000,
      quotes: [
        { ...mockRFQs[0].quotes[0], status: 'Awarded', awarded: true },
        { ...mockRFQs[0].quotes[1], status: 'Submitted', awarded: false },
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [poFinalisedRfq],
      selectedRFQForMatrix: poFinalisedRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    expect(screen.getByText(/\[ VIEW FINALISED PRE-PURCHASE ORDER \]/i)).toBeInTheDocument();
    expect(screen.getByText(/Bid Concluded/i)).toBeInTheDocument();

    const viewDetailsBtn = screen.getByText(/View RFQ Details ↗/i);
    fireEvent.click(viewDetailsBtn);
    expect(mockPush).toHaveBeenCalledWith(`/buyer/rfq-details?rfq=${encodeURIComponent(poFinalisedRfq.rfqNumber)}`);
  });

  test('triggers openRFQDeepDive and closes deep dive modal with selectedRFQForDeepDive fallback to currentRFQ', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: true,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Deep Dive for RFQ-2026-00421/i)).toBeInTheDocument();

    const deepDiveBtn = screen.getByText(/Vendor Follow-Up Details \(.*Responded\)/i);
    fireEvent.click(deepDiveBtn);

    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRFQs[0]);

    const closeDeepDiveBtn = screen.getByText(/Close Vendor Follow-Up Details/i);
    fireEvent.click(closeDeepDiveBtn);
    expect(mockSetDeepDiveModalOpen).toHaveBeenCalledWith(false);
  });

  test('triggers onBackToDashboard when back button is clicked', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    const backBtn = screen.getByText(/Back to Command Center/i);
    fireEvent.click(backBtn);

    expect(mockOnBackToDashboard).toHaveBeenCalled();
  });

  test('renders Direct Email Quotes banner for mode_0, v0, and version_0 sourcing modes in buyer role', () => {
    const v0Rfq = {
      ...mockRFQs[0],
      sourcingMode: 'mode_0',
    };
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      rfqs: [v0Rfq],
      selectedRFQForMatrix: v0Rfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    const { rerender } = render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Direct Email Quotes \(Version 0 Free Starter\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Check your inbox for vendor quotations/i)).toBeInTheDocument();

    const v0Alt = { ...mockRFQs[0], sourcingMode: 'v0' };
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      rfqs: [v0Alt],
      selectedRFQForMatrix: v0Alt,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });
    rerender(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Direct Email Quotes/i)).toBeInTheDocument();

    const v0Alt2 = { ...mockRFQs[0], sourcingMode: 'version_0' };
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      rfqs: [v0Alt2],
      selectedRFQForMatrix: v0Alt2,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });
    rerender(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Direct Email Quotes/i)).toBeInTheDocument();
  });

  test('renders Quotes Sealed banner when buyer role and quotesHidden is true', () => {
    const sealedRfq = {
      ...mockRFQs[0],
      quotesHidden: true,
      quotesHiddenReason: 'Quotes are sealed until bidding deadline.',
      quotesHiddenUntil: '2026-03-10T12:00:00.000Z',
    };
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      rfqs: [sealedRfq],
      selectedRFQForMatrix: sealedRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    const { rerender } = render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Quotes Sealed — 48-Hour Bidding Period Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Quotes are sealed until bidding deadline./i)).toBeInTheDocument();
    expect(screen.getByText(/Unseals on:/i)).toBeInTheDocument();

    const sealedFallback = {
      ...mockRFQs[0],
      quotesHidden: true,
      quotesHiddenReason: undefined,
      quotesHiddenUntil: undefined,
    };
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      rfqs: [sealedFallback],
      selectedRFQForMatrix: sealedFallback,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });
    rerender(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Received quotations remain hidden/i)).toBeInTheDocument();
    expect(screen.getByText(/After 48 hours/i)).toBeInTheDocument();
  });

  test('renders quote attachments, vendor rank ties with lead time, and custom taxes/delivery charges', () => {
    const tieRfq = {
      ...mockRFQs[0],
      targetDeliveryDate: undefined,
      target_delivery_date: '2026-04-15',
      extractedEntities: [
        { id: 'li-1', itemName: 'Piping Spec', quantity: 2, technicalSpecs: 'Custom Heavy Grade', unit: 'Meters' },
        { id: 'li-2', itemName: 'Flange Pair', quantity: 4, technicalSpecs: 'Flange Pair', unit: '' },
        { id: 'li-3', itemName: 'Gasket Set', quantity: 10 },
      ],
      quotes: [
        {
          vendorId: 'v-tie-1',
          vendorName: 'Alpha Supplies',
          vendorCategory: 'Registered Supplier',
          unitPrice: 1000,
          totalPrice: 0,
          leadTimeDays: 10,
          taxes: 150,
          deliveryCharges: 50,
          isPreferred: true,
          attachments: [
            { id: 'att-1', fileName: 'Alpha_Warranty.pdf', sizeBytes: 2048, mimeType: 'application/pdf', uploadedAt: '2026-03-01' },
          ],
          lineItemQuotes: [
            { lineItemId: 'li-1', itemName: 'Piping Spec', unitPrice: 1000, totalPrice: 2000, leadTimeDays: 7 },
            { lineItemId: 'non-matching-id', itemName: 'Flange Pair', unitPrice: 500, totalPrice: 2000 },
            { lineItemId: 'li-3', itemName: 'Gasket Set', unitPrice: 0 },
          ],
          taxRate: 12,
        },
        {
          vendorId: 'v-tie-2',
          vendorName: 'Beta Supplies',
          vendorCategory: 'Verified Supplier',
          unitPrice: 1000,
          totalPrice: 2000,
          leadTimeDays: 5,
          attachments: [],
          lineItemQuotes: [],
        },
        {
          vendorId: 'v-tie-3',
          vendorName: 'Gamma Supplies',
          vendorCategory: 'Standard Supplier',
          unitPrice: 3000,
          totalPrice: 6000,
          leadTimeDays: 20,
          attachments: [],
          lineItemQuotes: [],
        },
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [tieRfq],
      selectedRFQForMatrix: tieRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
      activeBuyerAccount: { id: 'buyer-1', organizationName: 'Buyer Corp' },
      buyerVendors: [
        { id: 'v-tie-1', name: 'Alpha Supplies' },
        { id: 'v-other', name: 'Other Vendor' },
      ],
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    expect(screen.getByText('Alpha_Warranty.pdf')).toBeInTheDocument();
    expect(screen.getByText('Download Full Quotes (Excel)')).toBeInTheDocument();

    const downloadFullBtn = screen.getByText('Download Full Quotes (Excel)');
    fireEvent.click(downloadFullBtn);

    const selectAlphaBtn = screen.getByText(/\[ APPROVE & GENERATE PRE-PURCHASE ORDER \]/i);
    fireEvent.click(selectAlphaBtn);
    expect(screen.getByText(/PO Modal for Alpha Supplies/i)).toBeInTheDocument();
  });

  test('handles awarded vendor matching by awardedVendorId, awardedVendor name, and poFinalised flags', () => {
    const awardedByIdRfq = {
      ...mockRFQs[0],
      status: 'PO Generated' as const,
      poFinalised: true,
      poNumber: undefined,
      awardedVendor: undefined,
      awardedVendorId: 'v-2',
      quotes: [
        { ...mockRFQs[0].quotes[0], status: 'Submitted', awarded: false },
        { ...mockRFQs[0].quotes[1], status: 'Awarded', awarded: true },
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [awardedByIdRfq],
      selectedRFQForMatrix: awardedByIdRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    expect(screen.getByText(/PO Generated was officially finalised and recorded for awarded vendor/i)).toBeInTheDocument();
    const viewPoBtn = screen.getByText(/\[ VIEW FINALISED PRE-PURCHASE ORDER \]/i);
    fireEvent.click(viewPoBtn);
    expect(screen.getByText(/PO Modal for Kiran Valve Industries/i)).toBeInTheDocument();
  });

  test('handles fallback when all delivery dates are unassigned', () => {
    const unassignedDateRfq = {
      ...mockRFQs[0],
      targetDeliveryDate: undefined,
      target_delivery_date: undefined,
      deadline: undefined,
      chasingActive: false,
      followUpData: undefined,
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [unassignedDateRfq],
      selectedRFQForMatrix: unassignedDateRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(UI_STRINGS.rfqDetails.unsetValue)).toBeInTheDocument();
  });

  test('handles deadline date fallback when targetDeliveryDate and target_delivery_date are missing', () => {
    const deadlineRfq = {
      ...mockRFQs[0],
      targetDeliveryDate: undefined,
      target_delivery_date: undefined,
      deadline: '2026-05-20',
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [deadlineRfq],
      selectedRFQForMatrix: deadlineRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(formatIndianDate('2026-05-20'))).toBeInTheDocument();
  });

  test('renders line items with missing real prices and unitemized vendor without item quantity', () => {
    const zeroPriceRfq = {
      ...mockRFQs[0],
      extractedEntities: [
        { id: 'item-null', itemName: 'Mystery Valve', quantity: undefined, technicalSpecs: undefined },
      ],
      quotes: [
        {
          vendorId: 'v-zero-1',
          vendorName: 'Zero Price Vendor',
          vendorCategory: 'Standard',
          unitPrice: 0,
          totalPrice: 0,
          leadTimeDays: 10,
          attachments: undefined,
          lineItemQuotes: [
            { lineItemId: 'item-null', itemName: 'Mystery Valve', unitPrice: 0, totalPrice: 0 },
          ],
        },
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [zeroPriceRfq],
      selectedRFQForMatrix: zeroPriceRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      buyerVendors: [{ id: 'other-id', name: 'Zero Price Vendor' }],
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText('Mystery Valve')).toBeInTheDocument();

    const selectBtn = screen.getByText(/Select Zero/i);
    fireEvent.click(selectBtn);
  });

  test('handles RFQ with undefined quotes and undefined extractedEntities', () => {
    const emptyQuotesRfq = {
      ...mockRFQs[0],
      quotes: undefined,
      extractedEntities: undefined,
    };
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [emptyQuotesRfq],
      selectedRFQForMatrix: emptyQuotesRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Quotes Pending for this RFQ/i)).toBeInTheDocument();
  });

  test('sorts quotes by lead time when total prices are identical, including undefined lead times', () => {
    const tieRfq = {
      ...mockRFQs[0],
      extractedEntities: [],
      quotes: [
        {
          vendorId: 'v-lead-1',
          vendorName: 'Lead 1 Vendor',
          unitPrice: 5000,
          totalPrice: 5000,
          leadTimeDays: undefined,
          isBestPrice: true,
        },
        {
          vendorId: 'v-lead-2',
          vendorName: 'Lead 2 Vendor',
          unitPrice: 5000,
          totalPrice: 5000,
          leadTimeDays: 14,
          isBestPrice: false,
        },
        {
          vendorId: 'v-lead-3',
          vendorName: 'Lead 3 Vendor',
          unitPrice: 5000,
          totalPrice: 5000,
          leadTimeDays: 7,
          isBestPrice: false,
        },
      ],
    };
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [tieRfq],
      selectedRFQForMatrix: tieRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText('Lead 1 Vendor')).toBeInTheDocument();
    expect(screen.getByText('Lead 2 Vendor')).toBeInTheDocument();
    expect(screen.getByText('Lead 3 Vendor')).toBeInTheDocument();
  });

  test('handles dynamic vendorId fallback where vendor is not found in vendorRankMap', () => {
    let idCalls = 0;
    let idCalls2 = 0;
    const trickyRfq = {
      ...mockRFQs[0],
      extractedEntities: [
        { id: '', itemName: 'Unidentified Line', quantity: 1 },
      ],
      quotes: [
        {
          get vendorId() {
            idCalls++;
            return idCalls <= 2 ? 'v-dynamic-1' : 'v-missing-1';
          },
          vendorName: 'Dynamic Vendor 1',
          unitPrice: 2000,
          totalPrice: 2000,
          leadTimeDays: 10,
          isBestPrice: true,
          taxes: 200,
        },
        {
          get vendorId() {
            idCalls2++;
            return idCalls2 <= 2 ? 'v-dynamic-2' : 'v-missing-2';
          },
          vendorName: 'Dynamic Vendor 2',
          unitPrice: 3000,
          totalPrice: 3000,
          leadTimeDays: 12,
          isBestPrice: false,
        },
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [trickyRfq],
      selectedRFQForMatrix: trickyRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getAllByText('Dynamic Vendor 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dynamic Vendor 2').length).toBeGreaterThan(0);
  });

  test('matches line items by item description case-insensitively when lineItemId does not match', () => {
    const nameMatchRfq = {
      ...mockRFQs[0],
      extractedEntities: [
        { id: 'diff-id-1', itemName: 'Industrial Flange 2-Inch', quantity: 5 },
        { id: 'diff-id-2', itemName: '', quantity: 1 },
      ],
      quotes: [
        {
          vendorId: 'v-name-1',
          vendorName: 'Name Match Vendor',
          unitPrice: 400,
          totalPrice: 2000,
          lineItemQuotes: [
            { lineItemId: 'nomatch', itemName: '  industrial flange 2-inch  ', unitPrice: 400, totalPrice: 2000 },
            { lineItemId: 'nomatch2', itemName: '', unitPrice: 100 },
          ],
        },
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [nameMatchRfq],
      selectedRFQForMatrix: nameMatchRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText('Industrial Flange 2-Inch')).toBeInTheDocument();
  });

  test('renders empty quotes state when selected RFQ has zero quotes', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[1],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Quotes Pending for this RFQ/i)).toBeInTheDocument();
  });

  test('renders empty state when no RFQs exist', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/No RFQs Available/i)).toBeInTheDocument();
  });

  describe('scopeToOwnBuyerAccount (the buyer route only — category manager leaves this off)', () => {
    test("renders the buyer's own (already-scoped) RFQ list and default selection", () => {
      (useApp as jest.Mock).mockReturnValue({
        rfqs: [mockRFQs[0]],
        selectedRFQForMatrix: null,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} scopeToOwnBuyerAccount />);

      expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      expect(screen.getByText(/Apex Supplies Ltd./i)).toBeInTheDocument();

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toEqual(['rfq-1']);
    });

    test("ignores a selectedRFQForMatrix left over from another role and falls back to this buyer's own list", () => {
      (useApp as jest.Mock).mockReturnValue({
        rfqs: [mockRFQs[0]],
        selectedRFQForMatrix: mockRFQs[1],
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} scopeToOwnBuyerAccount />);

      expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      expect(screen.queryByText('LV Switchgear Modular Panels')).not.toBeInTheDocument();
    });

    test('without the prop (category manager route), the full cross-buyer list is shown', () => {
      (useApp as jest.Mock).mockReturnValue({
        rfqs: mockRFQs,
        selectedRFQForMatrix: null,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toEqual(['rfq-1', 'rfq-2']);
    });

    test('does not render the AI Quality / Match Score section (removed from vendor comparison)', () => {
      const rfqWithBreakdown = {
        ...mockRFQs[0],
        quotes: [
          {
            ...mockRFQs[0].quotes[0],
            aiMatchScore: 70,
            scoreBreakdown: {
              price: { score: 100, weighted: 45, maxWeight: 45 },
              leadTime: { score: 0, weighted: 0, maxWeight: 30 },
              warranty: { score: 100, weighted: 25, maxWeight: 25 },
            },
          },
        ],
      };

      (useApp as jest.Mock).mockReturnValue({
        rfqs: [rfqWithBreakdown],
        selectedRFQForMatrix: rfqWithBreakdown,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
      expect(screen.queryByText('AI Quality / Match Score')).not.toBeInTheDocument();
      expect(screen.queryByText('P: 45')).not.toBeInTheDocument();
      expect(screen.queryByText('L: 0')).not.toBeInTheDocument();
      expect(screen.queryByText('W: 25')).not.toBeInTheDocument();
    });

    test('renders source badges correctly for both Portal and Email quotes', () => {
      const rfqWithMixedSources = {
        ...mockRFQs[0],
        quotes: [
          {
            ...mockRFQs[0].quotes[0],
            vendorId: 'v-portal-1',
            vendorName: 'Apex Portal Vendor',
            source: 'portal' as const,
          },
          {
            ...mockRFQs[0].quotes[1],
            vendorId: 'v-email-2',
            vendorName: 'Kiran Email Vendor',
            source: 'email' as const,
          },
        ],
      };

      (useApp as jest.Mock).mockReturnValue({
        rfqs: [rfqWithMixedSources],
        selectedRFQForMatrix: rfqWithMixedSources,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

      const portalBadge = screen.getByTestId('quote-source-v-portal-1');
      expect(portalBadge).toBeInTheDocument();
      expect(portalBadge).toHaveTextContent('🌐 Portal');

      const emailBadge = screen.getByTestId('quote-source-v-email-2');
      expect(emailBadge).toBeInTheDocument();
      expect(emailBadge).toHaveTextContent('✉️ Email');
    });
  });
});
