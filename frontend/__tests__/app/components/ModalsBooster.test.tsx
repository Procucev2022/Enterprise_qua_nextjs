import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PurchaseOrderModal,
  MultiChannelChaserModal,
  ActivePipelineModal,
  SupplierQuotesModal,
  RFQFollowUpDeepDiveModal,
  IntakeSourcesModal,
} from '@/app/components/Modals';
import type { RFQItem, QuoteComparison } from '@/lib/types';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('ModalsBooster — branch boost suite for Modals.tsx', () => {
  const mockOnClose = jest.fn();
  const mockTriggerChannelChaser = jest.fn();
  const mockApprovePO = jest.fn().mockResolvedValue({
    success: true,
    poNumber: 'PO-2026-RFQ-PO-ROUTER',
  });
  const mockShowToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      approvePO: mockApprovePO,
      triggerChannelChaser: mockTriggerChannelChaser,
      showToast: mockShowToast,
    });
  });

  describe('MultiChannelChaserModal comprehensive branches', () => {
    it('returns null when isOpen is false', () => {
      const { container } = render(
        <MultiChannelChaserModal
          isOpen={false}
          onClose={mockOnClose}
          rfqNumber="RFQ-MC-001"
          vendorName="Apex Tools"
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('handles channel switching (call, whatsapp, sms), template changes, and dispatch', () => {
      const { rerender } = render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-MC-001"
          vendorName="Apex Tools"
          vendorPhone="+91 98888 77777"
          initialChannel="whatsapp"
        />
      );

      expect(screen.getByText(/Dispatch AI Follow-Up \(WHATSAPP\)/i)).toBeInTheDocument();

      // Switch to AI Voice Call
      const callChannelBtn = screen.getByRole('button', { name: /AI Voice Call/i });
      fireEvent.click(callChannelBtn);
      expect(screen.getByText(/Dispatch AI Follow-Up \(CALL\)/i)).toBeInTheDocument();

      // Edit call script
      const scriptInput = screen.getByDisplayValue(/Hello, this is Procucev Autonomous Voice Bot/i);
      fireEvent.change(scriptInput, { target: { value: 'Custom call script' } });

      // Click Send Call
      const sendCallBtn = screen.getByText(/Initiate AI Voice Call/i);
      fireEvent.click(sendCallBtn);
      expect(mockTriggerChannelChaser).toHaveBeenCalledWith('RFQ-MC-001', 'call', 'Apex Tools', 'Custom call script');
      expect(mockOnClose).toHaveBeenCalled();

      // Rerender with SMS initialChannel
      rerender(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-MC-001"
          vendorName="Apex Tools"
          initialChannel="sms"
        />
      );

      expect(screen.getByText(/Dispatch AI Follow-Up \(SMS\)/i)).toBeInTheDocument();

      // Change chasing template
      const templateSelect = screen.getByRole('combobox');
      fireEvent.change(templateSelect, { target: { value: 'technical_request' } });
      expect(screen.getByText(/Technical Compliance & Specification Clarification/i)).toBeInTheDocument();

      fireEvent.change(templateSelect, { target: { value: 'urgent_reminder' } });
      expect(screen.getByText(/Urgent RFQ Deadline Reminder/i)).toBeInTheDocument();

      // Broadcast SMS
      const broadcastSmsBtn = screen.getByText(/Broadcast SMS Alert/i);
      fireEvent.click(broadcastSmsBtn);
      expect(mockTriggerChannelChaser).toHaveBeenCalled();
    });
  });

  describe('PurchaseOrderModal router fallback and PDF branches', () => {
    it('handles approval completion and redirects via router when onFinalized is omitted', async () => {
      jest.useFakeTimers();

      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-PO-ROUTER"
          vendorId="v-router"
          vendorName="Router Vendor Ltd"
          unitPrice={25000}
          totalAmount={50000}
          leadTime={10}
          deliveryDate="2026-12-15"
          lineItems={[{ description: 'Test Item', quantity: 2, unit: 'Nos' }]}
        />
      );

      const approveBtn = screen.getByText(/APPROVE & GENERATE PRE-PURCHASE ORDER/i);
      await act(async () => {
        fireEvent.click(approveBtn);
      });

      // Advance timers for setTimeout 1500ms
      act(() => {
        jest.advanceTimersByTime(1600);
      });

      expect(mockPush).toHaveBeenCalledWith('/buyer/rfq-details?rfq=RFQ-PO-ROUTER');
      expect(mockOnClose).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('handles handleExportPDF when window.open succeeds and writes HTML document', () => {
      const mockPrintDoc = {
        open: jest.fn(),
        write: jest.fn(),
        close: jest.fn(),
      };
      const mockPrintWin = {
        document: mockPrintDoc,
        focus: jest.fn(),
        print: jest.fn(),
      };
      const origOpen = window.open;
      window.open = jest.fn().mockReturnValue(mockPrintWin as any);

      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-PO-PRINT"
          vendorId="v-print"
          vendorName="Print Vendor Ltd"
          unitPrice={10000}
          totalAmount={20000}
          leadTime={7}
          deliveryDate="2026-10-10"
          lineItems={[{ description: 'Item 1', quantity: 2, unit: 'Sets' }]}
        />
      );

      const exportPdfBtn = screen.getByTitle('Export complete Pre-Purchase Order as PDF document');
      fireEvent.click(exportPdfBtn);

      expect(window.open).toHaveBeenCalled();
      expect(mockPrintDoc.write).toHaveBeenCalled();
      expect(mockPrintDoc.close).toHaveBeenCalled();
      expect(mockPrintWin.focus).toHaveBeenCalled();

      window.open = origOpen;
    });
  });

  describe('ActivePipelineModal source filters and metric card clicks', () => {
    const mixedRfqs: RFQItem[] = [
      {
        id: 'rfq-m1',
        rfqNumber: 'RFQ-M1',
        title: 'Gate Valves',
        category: 'Valves',
        status: 'In Evaluation',
        source: 'email_gateway',
        quotesCount: 2,
      } as any,
      {
        id: 'rfq-m2',
        rfqNumber: 'RFQ-M2',
        title: 'Check Valves',
        category: 'Valves',
        status: 'AI Recommended',
        source: 'web_portal',
        quotesCount: 3,
      } as any,
      {
        id: 'rfq-m3',
        rfqNumber: 'RFQ-M3',
        title: 'Globe Valves',
        category: 'Valves',
        status: 'Quotes Received',
        source: 'manual_entry',
        quotesCount: 1,
      } as any,
    ];

    it('clicks through all metric cards and source filters', () => {
      render(
        <ActivePipelineModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={mixedRfqs}
          onNavigateToMatrix={jest.fn()}
          onOpenDeepDive={jest.fn()}
        />
      );

      // Click "Total Active Requisitions" card
      fireEvent.click(screen.getByText('100% On Schedule'));

      // Click "Quotes Received" card
      fireEvent.click(screen.getByText('Across All Modes'));
      expect(screen.getByText('Globe Valves')).toBeInTheDocument();

      // Source filter: via Email Upload
      fireEvent.click(screen.getByRole('button', { name: 'via Email Upload' }));

      // Source filter: AI RFQ Ingestion
      fireEvent.click(screen.getByRole('button', { name: 'AI RFQ Ingestion' }));

      // Source filter: Manual RFQ
      fireEvent.click(screen.getByRole('button', { name: 'Manual RFQ' }));

      // Source filter: All
      fireEvent.click(screen.getByRole('button', { name: 'All' }));
    });
  });

  describe('RFQFollowUpDeepDiveModal status badges and hybrid modes', () => {
    it('covers all channel status badges and hybrid vendor attribution', () => {
      const complexRfq: RFQItem = {
        id: 'rfq-complex-fu',
        rfqNumber: 'RFQ-COMPLEX-001',
        title: 'Turbine Spares',
        sourcingMode: 'mode_2',
        assignedVendors: [
          { id: 'v-assigned', name: 'Assigned Vendor', contactPerson: 'Raj', email: 'raj@test.com' } as any,
        ],
        followUpData: {
          vendors: [
            {
              vendorId: 'v-assigned',
              vendorName: 'Assigned Vendor',
              call: { status: 'completed', lastAttempt: '1h ago', duration: '60s' },
              whatsapp: { status: 'read', lastAttempt: '1h ago' },
              sms: { status: 'sent', lastAttempt: '1h ago' },
            } as any,
            {
              vendorId: 'v-procucev-net',
              vendorName: 'Procucev Network Partner',
              call: { status: 'voicemail', lastAttempt: '2h ago' },
              whatsapp: { status: 'pending', lastAttempt: '2h ago' },
              sms: { status: 'delivered', lastAttempt: '2h ago' },
            } as any,
            {
              vendorId: 'v-failed-vendor',
              vendorName: 'Failed Vendor',
              call: { status: 'failed', lastAttempt: '3h ago' },
              whatsapp: { status: 'failed', lastAttempt: '3h ago' },
              sms: { status: 'failed', lastAttempt: '3h ago' },
            } as any,
            {
              vendorId: 'v-queued-vendor',
              vendorName: 'Queued Vendor',
              call: { status: 'not_dispatched', lastAttempt: '' },
              whatsapp: { status: 'not_dispatched', lastAttempt: '' },
              sms: { status: 'not_dispatched', lastAttempt: '' },
            } as any,
          ],
          callStats: { total: 4, connected: 1, voicemails: 1, failed: 1 },
          whatsappStats: { total: 4, delivered: 2, read: 1, replied: 0, failed: 1 },
          smsStats: { total: 4, delivered: 2, clicked: 0, failed: 1 },
          emailStats: { total: 4, sent24h: 2, opened: 1, clicked: 1, failed: 0 },
        },
      } as any;

      render(
        <RFQFollowUpDeepDiveModal
          isOpen={true}
          onClose={mockOnClose}
          rfq={complexRfq}
        />
      );

      expect(screen.getByText('Assigned Vendor')).toBeInTheDocument();
      expect(screen.getByText('Procucev Network Partner')).toBeInTheDocument();

      // Check Calls tab with failed filtering
      const callsTab = screen.getByText(/Calls \(/i);
      fireEvent.click(callsTab);

      // Check WhatsApp tab with failed filtering
      const waTab = screen.getByText(/WhatsApp \(/i);
      fireEvent.click(waTab);

      // Check SMS tab with failed filtering
      const smsTab = screen.getByText(/SMS \(/i);
      fireEvent.click(smsTab);
    });

    it('covers nextScheduledChaser branch', () => {
      const rfqWithChaser: RFQItem = {
        id: 'rfq-chaser',
        rfqNumber: 'RFQ-CHASER-1',
        title: 'Chaser RFQ',
        followUpData: {
          nextScheduledChaser: 'Tomorrow at 09:00 AM',
          vendors: [],
          callStats: { total: 0, connected: 0, voicemails: 0, failed: 0 },
          whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
          smsStats: { total: 0, delivered: 0, clicked: 0, failed: 0 },
          emailStats: { total: 0, sent24h: 0, opened: 0, clicked: 0, failed: 0 },
        },
      } as any;

      render(
        <RFQFollowUpDeepDiveModal
          isOpen={true}
          onClose={mockOnClose}
          rfq={rfqWithChaser}
        />
      );

      expect(screen.getByText('Tomorrow at 09:00 AM')).toBeInTheDocument();
    });
  });

  describe('PurchaseOrderModal multi-item and quote fallback branches', () => {
    it('covers multi-item lineItems mapping when lineItemQuotes is absent', () => {
      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-PO-MULTI"
          vendorId="v-multi"
          vendorName="Multi Items Vendor"
          unitPrice={25000}
          totalAmount={50000}
          leadTime={10}
          deliveryDate="2026-11-20"
          lineItems={[
            { description: 'Turbine Blade A', quantity: 2, unit: 'Sets', technicalSpecs: 'Inconel 718' },
            { description: '', quantity: 0, unit: '', technicalSpecs: '' },
          ]}
        />
      );

      expect(screen.getByText('Turbine Blade A')).toBeInTheDocument();
      expect(screen.getByText('Item #2')).toBeInTheDocument();
    });

    it('covers lineItemQuotes with missing fields and quote commercial terms', () => {
      render(
        <PurchaseOrderModal
          {...({
            isOpen: true,
            onClose: mockOnClose,
            rfqNumber: 'RFQ-PO-FALLBACKS',
            vendorId: 'v-fallback',
            vendorName: 'Fallback Vendor',
            unitPrice: 1000,
            totalAmount: 2000,
            leadTime: undefined,
            deliveryDate: undefined,
            quote: {
              paymentTerms: 'Immediate 100% Advance',
              warrantyYears: 3,
              leadTimeDays: 21,
              lineItemQuotes: [
                { lineItemId: '', itemName: '', quantity: 0, unitPrice: 0, totalPrice: 0 },
              ],
            },
            lineItems: [
              { description: '', quantity: 0, unit: '', technicalSpecs: '' },
            ],
          } as any)}
        />
      );

      expect(screen.getByText('Immediate 100% Advance')).toBeInTheDocument();
      expect(screen.getByText('3 Year(s) Manufacturer Warranty')).toBeInTheDocument();
      expect(screen.getByText(/Procurement Item #1/i)).toBeInTheDocument();
    });

    it('handles default empty lineItems parameter', () => {
      render(
        <PurchaseOrderModal
          {...({
            isOpen: true,
            onClose: mockOnClose,
            rfqNumber: 'RFQ-PO-DEFAULTS',
            vendorId: 'v-def',
            vendorName: 'Default Vendor',
            unitPrice: 5000,
            totalAmount: 5000,
            leadTime: 7,
            deliveryDate: '2026-10-10',
            lineItems: undefined,
          } as any)}
        />
      );

      expect(screen.getByText('Default Vendor')).toBeInTheDocument();
    });
  });

  describe('ActivePipelineModal card toggle and search branches', () => {
    const rfqsWithEntities: RFQItem[] = [
      {
        id: 'rfq-e1',
        rfqNumber: 'RFQ-ENT-001',
        title: 'Centrifugal Pump Unit',
        category: 'Pumping Systems',
        status: 'In Evaluation',
        source: 'email_upload',
        sourcingMode: 'mode_1',
        targetDeliveryDate: '2026-12-01',
        budget: 500000,
        quotesCount: 3,
        extractedEntities: [
          { itemName: 'Impeller High-Flow', technicalSpecs: 'Stainless Steel 316', category: 'Pump Spares' } as any,
        ],
        assignedVendors: [
          { id: 'v-e1', name: 'Flowserve India', contactPerson: 'Arun Kumar', email: 'arun@flowserve.com' } as any,
        ],
        followUpData: {
          totalInvited: 5,
          respondedCount: 3,
          callStats: { total: 5, connected: 3, voicemails: 0, failed: 0 },
          whatsappStats: { total: 5, delivered: 4, read: 3, replied: 2, failed: 0 },
          smsStats: { total: 5, delivered: 5, clicked: 1, failed: 0 },
          emailStats: { total: 5, sent24h: 5, opened: 4, clicked: 2, failed: 0 },
        },
      } as any,
      {
        id: 'rfq-e2',
        rfqNumber: 'RFQ-ENT-002',
        title: 'Hydraulic Motor',
        category: 'Hydraulics',
        status: 'AI Recommended',
        source: 'ai_extraction',
        sourcingMode: 'mode_2',
        quotes: [{ id: 'q-1' } as any],
        extractedEntities: [],
        assignedVendors: [],
      } as any,
      {
        id: 'rfq-e3',
        rfqNumber: 'RFQ-ENT-003',
        title: 'Servo Valve',
        category: 'Hydraulics',
        status: 'Quotes Received',
        source: 'manual_entry',
        quotesCount: 0,
        quotes: [],
        budget: 0,
      } as any,
    ];

    it('toggles metric cards on and off, exercises search, and triggers matrix navigation', () => {
      const mockNavigateToMatrix = jest.fn();
      const mockOpenDeepDive = jest.fn();

      render(
        <ActivePipelineModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={rfqsWithEntities}
          onNavigateToMatrix={mockNavigateToMatrix}
          onOpenDeepDive={mockOpenDeepDive}
        />
      );

      // 1. Toggle "In Evaluation" card on then off
      const inEvalText = screen.getByText('Parametric Scoring Active');
      fireEvent.click(inEvalText);
      expect(screen.getByText('Centrifugal Pump Unit')).toBeInTheDocument();
      expect(screen.queryByText('Hydraulic Motor')).not.toBeInTheDocument();
      fireEvent.click(inEvalText); // toggle off
      expect(screen.getByText('Hydraulic Motor')).toBeInTheDocument();

      // 2. Toggle "AI Recommended" card on then off
      const aiRecText = screen.getByText('Ready for PO Approval');
      fireEvent.click(aiRecText);
      expect(screen.getByText('Hydraulic Motor')).toBeInTheDocument();
      expect(screen.queryByText('Centrifugal Pump Unit')).not.toBeInTheDocument();
      fireEvent.click(aiRecText); // toggle off
      expect(screen.getByText('Centrifugal Pump Unit')).toBeInTheDocument();

      // 3. Toggle "Quotes Received" card on then off
      const quotesRecText = screen.getByText('Across All Modes');
      fireEvent.click(quotesRecText);
      fireEvent.click(quotesRecText); // toggle off

      // 4. Search by extracted entity item name
      const searchInput = screen.getByPlaceholderText(/Search by RFQ number, title, category, or status/i);
      fireEvent.change(searchInput, { target: { value: 'Impeller' } });
      expect(screen.getByText('Centrifugal Pump Unit')).toBeInTheDocument();
      expect(screen.queryByText('Hydraulic Motor')).not.toBeInTheDocument();

      // Search by vendor contact person
      fireEvent.change(searchInput, { target: { value: 'Arun Kumar' } });
      expect(screen.getByText('Centrifugal Pump Unit')).toBeInTheDocument();

      // Search by sourcing mode
      fireEvent.change(searchInput, { target: { value: 'mode_2' } });
      expect(screen.getByText('Hydraulic Motor')).toBeInTheDocument();

      // Search with whitespace only
      fireEvent.change(searchInput, { target: { value: '   ' } });
      expect(screen.getByText('Centrifugal Pump Unit')).toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Click "View Quotes"
      const viewQuotesBtns = screen.getAllByTitle('View Quotes');
      if (viewQuotesBtns.length > 0) {
        fireEvent.click(viewQuotesBtns[0]);
        expect(mockNavigateToMatrix).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });

  describe('IntakeSourcesModal tab switching and search branches', () => {
    const intakeRfqs: RFQItem[] = [
      {
        id: 'rfq-in-1',
        rfqNumber: 'RFQ-IN-001',
        title: 'Intake Requisition Email',
        category: 'Spares',
        status: 'Quotes Pending',
        source: 'email_gateway',
        sourceEmail: 'rfq-ops@plant.com',
        sourceFileName: 'rfq-specs.pdf',
        quotesCount: 2,
      } as any,
      {
        id: 'rfq-in-2',
        rfqNumber: 'RFQ-IN-002',
        title: 'Intake Requisition Web',
        category: 'Instrumentation',
        status: 'In Evaluation',
        source: 'web_portal',
        sourceFileName: 'boq.xlsx',
        quotesCount: 1,
      } as any,
      {
        id: 'rfq-in-3',
        rfqNumber: 'RFQ-IN-003',
        title: 'Intake Requisition Manual',
        category: 'Electrical',
        status: 'Draft',
        source: 'manual_entry',
        quotesCount: 0,
      } as any,
    ];

    it('filters by intake source cards and search input', () => {
      render(
        <IntakeSourcesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={intakeRfqs}
          onOpenDeepDive={jest.fn()}
          onNavigateToMatrix={jest.fn()}
        />
      );

      // Email Upload card
      fireEvent.click(screen.getByText('⚡ Autonomous Ingestion · Auto-circulated'));
      expect(screen.getByText('Intake Requisition Email')).toBeInTheDocument();
      expect(screen.queryByText('Intake Requisition Web')).not.toBeInTheDocument();

      // Web Portal card
      fireEvent.click(screen.getByText('AI RFQ Create'));
      expect(screen.getByText('Intake Requisition Web')).toBeInTheDocument();

      // Manual Entry tab button
      fireEvent.click(screen.getByRole('button', { name: /Manual RFQ/i }));
      expect(screen.getByText('Intake Requisition Manual')).toBeInTheDocument();

      // Search inside tab
      const searchInput = screen.getByPlaceholderText(/Filter by origin or title/i);
      fireEvent.change(searchInput, { target: { value: 'Electrical' } });
      expect(screen.getByText('Intake Requisition Manual')).toBeInTheDocument();

      // Search with no match
      fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });
      expect(screen.getByText('No requisitions from this intake source')).toBeInTheDocument();
    });
  });

  describe('SupplierQuotesModal compliance status and filter branches', () => {
    const rfqsWithQuotes: RFQItem[] = [
      {
        id: 'rfq-sq-1',
        rfqNumber: 'RFQ-SQ-001',
        title: 'Turbine Rotor Spares',
        category: 'Turbines',
        status: 'In Evaluation',
        quotes: [
          {
            vendorName: 'Siemens Energy',
            vendorCategory: 'OEM',
            aiMatchScore: 95,
            complianceStatus: 'Fully Compliant',
            unitPrice: 150000,
            leadTimeDays: 14,
          } as any,
          {
            vendorName: 'Bharat Heavy Electricals',
            vendorCategory: 'PSU',
            aiMatchScore: 88,
            complianceStatus: 'Minor Exception',
            unitPrice: 140000,
            leadTimeDays: 28,
          } as any,
          {
            vendorName: 'Generic Supplier',
            vendorCategory: 'Trader',
            aiMatchScore: 70,
            complianceStatus: 'Pending Review' as any,
            unitPrice: 120000,
            leadTimeDays: 30,
          } as any,
        ],
      } as any,
    ];

    it('renders quotes with various compliance badges and filters by search', () => {
      const mockNavigateToMatrix = jest.fn();

      render(
        <SupplierQuotesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={rfqsWithQuotes}
          onNavigateToMatrix={mockNavigateToMatrix}
          onOpenDeepDive={jest.fn()}
        />
      );

      expect(screen.getByText('Siemens Energy')).toBeInTheDocument();
      expect(screen.getByText('Bharat Heavy Electricals')).toBeInTheDocument();
      expect(screen.getByText('✓ Fully Compliant')).toBeInTheDocument();
      expect(screen.getByText('⚠ Minor Exception')).toBeInTheDocument();

      // Search by vendor name
      const searchInput = screen.getByPlaceholderText(/Search by vendor name, item title, or RFQ/i);
      fireEvent.change(searchInput, { target: { value: 'Siemens' } });
      expect(screen.getByText('Siemens Energy')).toBeInTheDocument();
      expect(screen.queryByText('Bharat Heavy Electricals')).not.toBeInTheDocument();

      // Search by compliance status
      fireEvent.change(searchInput, { target: { value: 'Minor Exception' } });
      expect(screen.getByText('Bharat Heavy Electricals')).toBeInTheDocument();

      // Click "View Quotes"
      const viewQuotesBtns = screen.getAllByTitle('View Quotes');
      fireEvent.click(viewQuotesBtns[0]);
      expect(mockNavigateToMatrix).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('renders empty state when no quotes exist', () => {
      render(
        <SupplierQuotesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={[]}
          onNavigateToMatrix={jest.fn()}
          onOpenDeepDive={jest.fn()}
        />
      );

      expect(screen.getByText(/No supplier quotes found/i)).toBeInTheDocument();
    });
  });
});
