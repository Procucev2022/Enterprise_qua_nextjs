import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PurchaseOrderModal,
  MultiChannelChaserModal,
  WhatsAppChaserModal,
  RFQFollowUpDeepDiveModal,
  VendorSurveyModal,
  VendorEvaluationSummaryModal,
  ActivePipelineModal,
  IntakeSourcesModal,
  SupplierQuotesModal,
  SubscriptionPaymentModal,
} from '@/app/components/Modals';
import * as storeModule from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { VENDOR_QUOTATION_ROUTE } from '@/lib/constants';
import { QuoteComparison, RFQItem, VendorEvaluationRecord } from '@/lib/types';

jest.mock('@/lib/store');

describe('Modals.tsx', () => {
  const mockApprovePO = jest.fn().mockResolvedValue({
    success: true,
    poNumber: 'PO-2026-001',
    issueDate: '2026-09-02',
    shaSignature: 'a'.repeat(64),
    lineItems: [{ description: 'Test Item', quantity: 5, unit: 'Nos' }],
  });
  const mockShowToast = jest.fn();
  const mockTriggerEscalation = jest.fn();
  const mockTriggerChannelChaser = jest.fn();
  const mockTriggerBatchChannelChaser = jest.fn();
  const mockAddAuditLog = jest.fn();

  beforeEach(() => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      approvePO: mockApprovePO,
      showToast: mockShowToast,
      triggerEscalation: mockTriggerEscalation,
      triggerChannelChaser: mockTriggerChannelChaser,
      triggerBatchChannelChaser: mockTriggerBatchChannelChaser,
      addAuditLog: mockAddAuditLog,
      vendorOpportunities: [],
      selectedVendorEvaluation: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('PurchaseOrderModal', () => {
    const mockOnClose = jest.fn();
    // A quote that records only a tax amount, which is the input GST and the grand total are computed from.
    const taxOnly = (taxes: number) => ({ taxes } as Partial<QuoteComparison>) as QuoteComparison;

    const baseLineItems = [{ description: 'Centrifugal Water Pump', quantity: 12, unit: 'Nos' }];

    it('returns null when closed', () => {
      const { container } = render(
        <PurchaseOrderModal
          isOpen={false}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-001"
          vendorId="v-001"
          vendorName="Apex Industrial"
          totalAmount={150000}
          unitPrice={37500}
          leadTime={14}
          deliveryDate="2026-09-20"
          lineItems={baseLineItems}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders and handles PO approval, export PDF, print, cancel and close', async () => {
      jest.useFakeTimers();
      window.print = jest.fn();

      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-001"
          vendorId="v-001"
          vendorName="Apex Industrial"
          totalAmount={150000}
          unitPrice={37500}
          leadTime={14}
          deliveryDate="2026-09-20"
          lineItems={baseLineItems}
        />
      );

      expect(screen.getByText('Pre-Purchase Order Generation & Dispatch')).toBeInTheDocument();
      // Before approval the server has issued no number, so the preview says so instead of showing a built number.
      expect(screen.getByText(`PRE-PURCHASE ORDER: ${UI_STRINGS.modals.purchaseOrder.notIssuedYet}`)).toBeInTheDocument();
      expect(screen.queryByText(/PO-2026-/)).not.toBeInTheDocument();

      // Export PDF button — now just triggers the browser print dialog
      const exportBtn = screen.getByText(/Export PDF/);
      fireEvent.click(exportBtn);
      expect(window.print).toHaveBeenCalled();

      // Print button
      const printBtn = screen.getByText(/Print/);
      fireEvent.click(printBtn);
      expect(window.print).toHaveBeenCalledTimes(2);

      // Cancel button
      const cancelBtn = screen.getByText('Cancel');
      fireEvent.click(cancelBtn);
      expect(mockOnClose).toHaveBeenCalled();

      // Notes input starts empty. No sign-off note is supplied unless the approver types one.
      const notesInput = screen.getByRole('textbox');
      expect(notesInput).toHaveValue('');
      fireEvent.change(notesInput, { target: { value: 'Custom approver note' } });

      // Approve button — approvePO is now async and only resolves via the
      // real backend response
      const approveBtn = screen.getByText(/APPROVE & GENERATE PRE-PURCHASE ORDER/);
      await act(async () => {
        fireEvent.click(approveBtn);
        await Promise.resolve();
      });

      expect(mockApprovePO).toHaveBeenCalledWith('RFQ-2026-001', 'v-001', 'Apex Industrial', 150000, 'Custom approver note');

      act(() => {
        jest.advanceTimersByTime(1900);
      });
      expect(mockOnClose).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('handles onFinalized callback, lineItemQuotes, vendor/buyer mapping, and validation errors', async () => {
      jest.useFakeTimers();
      const mockOnFinalized = jest.fn();
      const mockPrintOpen = jest.fn();
      const mockPrintWrite = jest.fn();
      const mockPrintClose = jest.fn();
      const mockPrintFocus = jest.fn();
      const mockPrintPrint = jest.fn();
      window.open = jest.fn().mockReturnValue({
        document: { open: mockPrintOpen, write: mockPrintWrite, close: mockPrintClose },
        focus: mockPrintFocus,
        print: mockPrintPrint,
      });

      const { rerender } = render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-002"
          vendorId=""
          vendorName=""
          totalAmount={0}
          unitPrice={0}
          leadTime={10}
          deliveryDate="2026-10-15"
          lineItems={[]}
        />
      );

      // Validation error when vendorName or totalAmount missing
      const approveBtn = screen.getByText(/APPROVE & GENERATE PRE-PURCHASE ORDER/);
      fireEvent.click(approveBtn);
      expect(mockShowToast).toHaveBeenCalledWith('Validation Error', expect.any(String), 'warning');

      // Now render with rich props
      const quoteWithLines = {
        vendorName: 'Global Valves Ltd',
        vendorEmail: 'sales@globalvalves.com',
        paymentTerms: 'Net 45 Days',
        warrantyYears: 2,
        leadTimeDays: 20,
        lineItemQuotes: [
          { lineItemId: 'li-1', itemName: 'Gate Valve 100mm', quantity: 10, unitPrice: 2500, totalPrice: 25000 },
        ],
      } as any;

      const buyerAccount = {
        name: 'ACME Corp',
        address: 'Sector 5, Airoli',
        city: 'Navi Mumbai',
        state: 'Maharashtra',
        pincode: '400708',
        taxId: '27ACME1234F1Z1',
      } as any;

      const vendorRecord = {
        name: 'Global Valves Ltd',
        contactPerson: 'Suresh Patel',
        email: 'suresh@globalvalves.com',
        phone: '+91 91234 56789',
        address: 'MIDC Rabale',
        city: 'Thane',
        state: 'Maharashtra',
        pincode: '400701',
        gstin: '27AABCG9876K1Z9',
      } as any;

      const rfqItem: RFQItem = {
        id: 'rfq-2',
        rfqNumber: 'RFQ-2026-002',
        title: 'High Pressure Valves',
        category: 'Mechanical',
        sourcingMode: 'mode_2',
        status: 'Quotes Received',
        quotesCount: 3,
        targetDeliveryDate: '2026-11-01',
        deliveryLocation: 'Warehouse 4B',
        deliveryPincode: '400708',
        budget: 50000,
        createdAt: '2026-09-01T00:00:00.000Z',
        extractedEntities: [],
        quotes: [],
        chasingActive: false,
      };

      rerender(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-002"
          vendorId="v-002"
          vendorName="Global Valves Ltd"
          totalAmount={25000}
          unitPrice={2500}
          leadTime={20}
          deliveryDate="2026-10-15"
          lineItems={baseLineItems}
          quote={quoteWithLines}
          rfq={rfqItem}
          buyerAccount={buyerAccount}
          vendorRecord={vendorRecord}
          onFinalized={mockOnFinalized}
        />
      );

      expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();
      expect(screen.getByText(/Gate Valve 100mm/)).toBeInTheDocument();

      // Export PDF with window.open
      const exportPdfBtn = screen.getByText(/Export PDF/);
      fireEvent.click(exportPdfBtn);
      expect(window.open).toHaveBeenCalled();
      expect(mockPrintWrite).toHaveBeenCalled();

      // Approve PO
      const validApproveBtn = screen.getByText(/APPROVE & GENERATE PRE-PURCHASE ORDER/);
      await act(async () => {
        fireEvent.click(validApproveBtn);
        await Promise.resolve();
      });

      act(() => {
        jest.advanceTimersByTime(1900);
      });

      expect(mockOnFinalized).toHaveBeenCalledWith('PO-2026-001');
      expect(mockOnClose).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('shows the PO number, issue date and seal the server returns after approval', async () => {
      jest.useFakeTimers();
      mockApprovePO.mockResolvedValueOnce({
        success: true,
        poNumber: 'PO-SERVER-9',
        issueDate: '2026-09-05',
        shaSignature: 'c'.repeat(64),
      });

      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-088"
          vendorId="v-088"
          vendorName="Seal Vendor"
          totalAmount={1000}
          unitPrice={1000}
          leadTime={5}
          deliveryDate="2026-09-30"
          lineItems={baseLineItems}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByText(/APPROVE & GENERATE PRE-PURCHASE ORDER/));
        await Promise.resolve();
      });

      expect(screen.getByText('PRE-PURCHASE ORDER: PO-SERVER-9')).toBeInTheDocument();
      expect(screen.getByText('Issue Date: 2026-09-05')).toBeInTheDocument();
      expect(screen.getByText(UI_STRINGS.modals.purchaseOrder.sealedBadge)).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith(
        'Pre-Purchase Order Finalised',
        formatString(UI_STRINGS.modals.purchaseOrder.finalisedToast, { poNumber: 'PO-SERVER-9', vendorName: 'Seal Vendor' }),
        'success'
      );

      act(() => {
        jest.advanceTimersByTime(1900);
      });
      jest.useRealTimers();
    });

    it('reports an approval that returns no PO number without inventing one', async () => {
      jest.useFakeTimers();
      mockApprovePO.mockResolvedValueOnce({ success: true });
      const mockOnFinalized = jest.fn();

      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-089"
          vendorId="v-089"
          vendorName="Silent Vendor"
          totalAmount={1000}
          unitPrice={1000}
          leadTime={5}
          deliveryDate="2026-09-30"
          lineItems={baseLineItems}
          onFinalized={mockOnFinalized}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByText(/APPROVE & GENERATE PRE-PURCHASE ORDER/));
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        'Pre-Purchase Order Finalised',
        formatString(UI_STRINGS.modals.purchaseOrder.finalisedWithoutNumberToast, { vendorName: 'Silent Vendor' }),
        'success'
      );
      expect(screen.getByText(`PRE-PURCHASE ORDER: ${UI_STRINGS.modals.purchaseOrder.notIssuedYet}`)).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1900);
      });
      expect(mockOnFinalized).toHaveBeenCalledWith('');
      jest.useRealTimers();
    });

    it('shows placeholders, never zero or a default party or term, for values the record does not hold', () => {
      const mockWrite = jest.fn();
      window.open = jest.fn().mockReturnValue({
        document: { open: jest.fn(), write: mockWrite, close: jest.fn() },
        focus: jest.fn(),
        print: jest.fn(),
      });

      render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-090"
          vendorId="v-090"
          vendorName="Blank Vendor"
          totalAmount={0}
          unitPrice={0}
          leadTime={0}
          deliveryDate=""
          lineItems={[{ description: '', quantity: 0, unit: '' }]}
        />
      );

      expect(screen.queryByText('₹0')).not.toBeInTheDocument();
      expect(screen.queryByText('Net 30 Days')).not.toBeInTheDocument();
      expect(screen.queryByText('Purchasing Entity')).not.toBeInTheDocument();
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notAvailable).length).toBeGreaterThanOrEqual(4);
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notRecorded).length).toBeGreaterThanOrEqual(3);

      fireEvent.click(screen.getByText(/Export PDF/));
      const html = String(mockWrite.mock.calls[0][0]);
      expect(html).not.toContain('PO-2026-');
      expect(html).not.toContain('Purchasing Entity');
      expect(html).not.toContain('₹0');
      expect(html).toContain(UI_STRINGS.modals.purchaseOrder.notIssuedYet);
    });

    it('displays grand total in words for various amounts', () => {
      const { rerender } = render(
        <PurchaseOrderModal
          isOpen={true}
          onClose={jest.fn()}
          rfqNumber="RFQ-WORDS-01"
          vendorId="v-words"
          vendorName="Words Vendor"
          totalAmount={20000000}
          unitPrice={20000000}
          quote={taxOnly(5000000)}
          leadTime={10}
          deliveryDate="2026-12-01"
          lineItems={[{ description: 'Heavy Turbine', quantity: 1, unit: 'Nos' }]}
        />
      );

      expect(screen.getByText(/Rupees Two Crore/)).toBeInTheDocument();

      rerender(
        <PurchaseOrderModal
          isOpen={true}
          onClose={jest.fn()}
          rfqNumber="RFQ-WORDS-02"
          vendorId="v-words"
          vendorName="Words Vendor"
          totalAmount={1000000000000}
          unitPrice={1000000000000}
          quote={taxOnly(100)}
          leadTime={10}
          deliveryDate="2026-12-01"
          lineItems={[{ description: 'Mega Project', quantity: 1, unit: 'Nos' }]}
        />
      );
      expect(screen.queryByText(/Rupees/)).not.toBeInTheDocument();
    });
  });

  describe('MultiChannelChaserModal & WhatsAppChaserModal', () => {
    const mockOnClose = jest.fn();

    it('returns null when closed', () => {
      const { container } = render(
        <MultiChannelChaserModal
          isOpen={false}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-001"
          vendorName="Precision Hydro"
          initialChannel="whatsapp"
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders and dispatches chasing message with channel selection, templates, and scripts for call, whatsapp, and sms channels', () => {
      // Test 1: Start with call
      const { unmount: unmount1 } = render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-001"
          vendorName="Precision Hydro"
          initialChannel="call"
        />
      );
      expect(screen.getByText(/CALL/)).toBeInTheDocument();
      const callSendBtn = screen.getByText(/Initiate AI Voice Call/);
      fireEvent.click(callSendBtn);
      expect(mockTriggerChannelChaser).toHaveBeenCalledWith(
        'RFQ-2026-001',
        'call',
        'Precision Hydro',
        expect.any(String)
      );
      unmount1();

      // Test 2: Start with whatsapp
      const { unmount: unmount2 } = render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-001"
          vendorName="Precision Hydro"
          initialChannel="whatsapp"
        />
      );
      // Change template to technical_request and back
      const templateSelect = screen.getByRole('combobox');
      fireEvent.change(templateSelect, { target: { value: 'technical_request' } });
      fireEvent.change(templateSelect, { target: { value: 'urgent_reminder' } });

      const waSendBtn = screen.getByText(/Send WhatsApp Chaser/);
      fireEvent.click(waSendBtn);
      expect(mockTriggerChannelChaser).toHaveBeenCalledWith(
        'RFQ-2026-001',
        'whatsapp',
        'Precision Hydro',
        expect.any(String)
      );
      unmount2();

      // Test 3: Start with sms and test switching tabs and typing
      render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-001"
          vendorName="Precision Hydro"
          initialChannel="sms"
        />
      );

      // Switch to call tab
      fireEvent.click(screen.getByText(/AI Voice Call/));
      const textareas = screen.getAllByRole('textbox');
      if (textareas.length > 0) {
        fireEvent.change(textareas[textareas.length - 1], { target: { value: 'Custom call script' } });
      }

      // Switch to WhatsApp tab
      fireEvent.click(screen.getByText(/WhatsApp Bot/));

      // Switch to SMS tab
      fireEvent.click(screen.getByText(/SMS Direct/));

      // Change phone number
      const inputs = screen.getAllByRole('textbox');
      if (inputs.length > 1) {
        fireEvent.change(inputs[1], { target: { value: '+91 98888 77777' } });
      }

      // Click Dispatch
      const dispatchBtn = screen.getByText(/Broadcast SMS Alert/);
      fireEvent.click(dispatchBtn);

      expect(mockTriggerChannelChaser).toHaveBeenCalledWith(
        'RFQ-2026-001',
        'sms',
        'Precision Hydro',
        expect.any(String)
      );
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('WhatsAppChaserModal alias works identically', () => {
      render(
        <WhatsAppChaserModal
          isOpen={true}
          onClose={mockOnClose}
          rfqNumber="RFQ-2026-002"
          vendorName="Apex"
          initialChannel="whatsapp"
        />
      );
      expect(screen.getByText(/Dispatch AI Follow-Up/)).toBeInTheDocument();
      const sendBtn = screen.getByText(/Send WhatsApp Chaser/);
      fireEvent.click(sendBtn);
      expect(mockTriggerChannelChaser).toHaveBeenCalledWith(
        'RFQ-2026-002',
        'whatsapp',
        'Apex',
        expect.any(String)
      );
    });
  });

  describe('MultiChannelChaserModal quotation link and templates', () => {
    const mockOnCloseChaser = jest.fn();

    it('links the urgent message to the vendor quotation form on this origin, with no guessed domain or deadline', () => {
      render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnCloseChaser}
          rfqNumber="RFQ-2026-001"
          vendorName="Apex Industrial"
          initialChannel="whatsapp"
        />
      );

      const quotationLink = `${window.location.origin}${VENDOR_QUOTATION_ROUTE}?rfq=RFQ-2026-001`;
      expect(
        screen.getByText(
          formatString(UI_STRINGS.modals.chaser.urgentReminderWithLink, {
            vendorName: 'Apex Industrial',
            rfqNumber: 'RFQ-2026-001',
            quotationLink,
          })
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/portal\.procucev\.com/)).not.toBeInTheDocument();
      expect(screen.queryByText(/within 24 hours/)).not.toBeInTheDocument();
    });

    it('switches between the urgent and technical templates', () => {
      render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnCloseChaser}
          rfqNumber="RFQ-2026-002"
          vendorName="Beta Tools"
          initialChannel="sms"
        />
      );

      const templateSelect = screen.getByRole('combobox');
      fireEvent.change(templateSelect, { target: { value: 'technical_request' } });
      expect(
        screen.getByText(formatString(UI_STRINGS.modals.chaser.technicalRequestTemplate, { rfqNumber: 'RFQ-2026-002' }))
      ).toBeInTheDocument();

      fireEvent.change(templateSelect, { target: { value: 'urgent_reminder' } });
      expect(
        screen.getByText(
          formatString(UI_STRINGS.modals.chaser.urgentReminderWithLink, {
            vendorName: 'Beta Tools',
            rfqNumber: 'RFQ-2026-002',
            quotationLink: `${window.location.origin}${VENDOR_QUOTATION_ROUTE}?rfq=RFQ-2026-002`,
          })
        )
      ).toBeInTheDocument();
    });

    it('shows the AI voice script without an invented 4:00 PM deadline', () => {
      render(
        <MultiChannelChaserModal
          isOpen={true}
          onClose={mockOnCloseChaser}
          rfqNumber="RFQ-2026-003"
          vendorName="Gamma Pumps"
          initialChannel="call"
        />
      );

      expect(
        screen.getByDisplayValue(formatString(UI_STRINGS.modals.chaser.callScript, { rfqNumber: 'RFQ-2026-003' }))
      ).toBeInTheDocument();
      expect(screen.queryByDisplayValue(/4:00 PM/)).not.toBeInTheDocument();
    });
  });

  describe('RFQFollowUpDeepDiveModal rows with no outreach record', () => {
    const rfqWithoutOutreach = {
      id: 'rfq-quiet',
      rfqNumber: 'RFQ-2026-004',
      title: 'Quiet RFQ',
      category: 'Mechanical',
      sourcingMode: 'mode_1',
      status: 'Quotes Pending',
      quotesCount: 0,
      createdAt: '2026-08-29',
      assignedVendors: [{ id: 'av-quiet', name: 'Quiet Vendor', contactPerson: '', phone: '' }],
    } as unknown as RFQItem;

    it('marks every channel not dispatched and invents no attempt count, escalation or statistic', () => {
      render(<RFQFollowUpDeepDiveModal isOpen={true} onClose={jest.fn()} rfq={rfqWithoutOutreach} />);

      // Call, WhatsApp, SMS and 24h email each show the not-dispatched badge.
      expect(screen.getAllByText(`⏳ ${UI_STRINGS.recordPlaceholders.notDispatched}`)).toHaveLength(4);
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notDispatched)).toHaveLength(1);
      expect(screen.getByText(`Target Delivery: ${UI_STRINGS.recordPlaceholders.notRecorded}`)).toBeInTheDocument();
      expect(screen.queryByText(/Attempt #/)).not.toBeInTheDocument();
      expect(screen.queryByText(UI_STRINGS.modals.followUp.escalationQueued)).not.toBeInTheDocument();
      expect(screen.queryByText(/Callback Queued|Pending 24h|Pending outreach|Standard/)).not.toBeInTheDocument();
      expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
      // The stat cards and tab counts read "Not available" where the server sent no count.
      expect(screen.getAllByText(new RegExp(UI_STRINGS.recordPlaceholders.notAvailable)).length).toBeGreaterThan(0);
      // The footer is gone. Each channel shows its next follow-up, counted from the RFQ creation time (2026-08-29).
      expect(screen.queryByText(/Next Automated Follow-Up Wave/)).not.toBeInTheDocument();
      expect(screen.getByTestId('next-follow-up-call')).toHaveTextContent(
        `${UI_STRINGS.modals.followUp.nextFollowUpLabel} 29 Aug 2026, 04:00 pm IST`
      );
    });
  });

  describe('VendorEvaluationSummaryModal recorded and unrecorded values', () => {
    it('shows placeholders for unrecorded scores and remarks and checks only documents that are verified', () => {
      const record = {
        vendorName: 'Check Vendor',
        category: 'Electrical',
        submissionDate: '2026-08-30',
        overallScore: 80,
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        systemAction: 'Review',
        moduleScores: {
          commercial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25 },
        },
        documents: [
          { id: 'd-1', name: 'Verified Cert.pdf', status: 'Verified', verified: true },
          { id: 'd-2', name: 'Pending Cert.pdf', status: 'Pending Review', verified: false },
        ],
      } as unknown as VendorEvaluationRecord;

      render(<VendorEvaluationSummaryModal isOpen={true} onClose={jest.fn()} record={record} />);

      expect(screen.getByText('20 / 25 pts')).toBeInTheDocument();
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notEvaluated)).toHaveLength(5);
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notRecorded)).toHaveLength(6);
      expect(screen.getByText(UI_STRINGS.modals.evaluation.documentsHeading)).toBeInTheDocument();
      expect(screen.queryByText('Verified Statutory PDFs & Certifications')).not.toBeInTheDocument();
      expect(screen.getByText('✓ Verified')).toBeInTheDocument();
      expect(screen.getByText('Pending Review')).toBeInTheDocument();
      expect(screen.queryByText('✓ Pending Review')).not.toBeInTheDocument();
    });

    it('shows not-evaluated in place of an overall score the record does not hold', () => {
      const record = {
        vendorName: 'Unscored Vendor',
        category: 'Electrical',
        submissionDate: '2026-08-30',
        status: 'REGISTERED / NOT EVALUATED',
        systemAction: 'Review',
      } as unknown as VendorEvaluationRecord;

      render(<VendorEvaluationSummaryModal isOpen={true} onClose={jest.fn()} record={record} />);

      // The overall score plus the six module scores.
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notEvaluated)).toHaveLength(7);
      expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    });
  });

  describe('RFQFollowUpDeepDiveModal', () => {
    const mockOnClose = jest.fn();
    const sampleRfq: RFQItem = {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-001',
      title: 'Centrifugal Slurry Pumps',
      category: 'Mechanical',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-09-20',
      status: 'Quotes Pending',
      sourcingMode: 'mode_1',
      quotesCount: 2,
      budget: 500000,
      extractedEntities: [],
      quotes: [],
      chasingActive: true,
      followUpData: {
        totalTargetVendors: 6,
        respondedVendors: 2,
        pendingVendors: 4,
        nextScheduledChaser: 'Today 04:00 PM',
        channelStats: {
          whatsappDelivered: 6,
          whatsappRead: 3,
          callsConnected: 3,
          smsSent: 6,
        },
        callStats: { connected: 3, total: 6, avgDuration: '1m 45s' },
        whatsappStats: { read: 3, total: 6, responseRate: '50%' },
        smsStats: { delivered: 6, total: 6 },
        emailStats: { opened: 3, total: 6 },
        vendors: [
          {
            vendorId: 'v-001',
            vendorName: 'Apex Industrial Dynamics Pvt Ltd',
            phone: '+91 98201 44820',
            contactPerson: 'Rajesh Nair',
            call: { status: 'completed', lastAttempt: '2h ago', duration: '1m 45s', transcriptSnippet: 'Vendor agreed to submit by 5 PM.', summary: 'Call connected' },
            whatsapp: { status: 'replied', lastAttempt: '1h ago', messagePreview: 'Quote uploaded', linkClicked: true },
            sms: { status: 'delivered', lastAttempt: '3h ago', deliveryReport: 'DELIVRD-AIRTEL' },
            email24h: { is24hReminderSent: true, lastAttempt: '1h ago' },
            overallStatus: 'Responded',
            lastInteraction: '1h ago',
            attemptsCount: 3,
            bidStatus: 'Submitted',
          },
          {
            vendorId: 'v-002',
            vendorName: 'Precision Hydro Pumps',
            phone: '+91 98201 44999',
            contactPerson: 'Karan Sharma',
            call: { status: 'connected', lastAttempt: '4h ago', duration: '30s' },
            whatsapp: { status: 'read', lastAttempt: '2h ago', linkClicked: false },
            sms: { status: 'clicked', lastAttempt: '4h ago' },
            email24h: { is24hReminderSent: false, lastAttempt: '2h ago' },
            overallStatus: 'Responded',
            lastInteraction: '2h ago',
            attemptsCount: 2,
            bidStatus: 'In Review',
          },
          {
            vendorId: 'v-003',
            vendorName: 'FlowTech Systems',
            phone: '+91 98201 44111',
            contactPerson: 'Sunil Rao',
            call: { status: 'voicemail', lastAttempt: '5h ago' },
            whatsapp: { status: 'delivered', lastAttempt: '3h ago' },
            sms: { status: 'sent', lastAttempt: '5h ago' },
            email24h: { is24hReminderSent: false },
            overallStatus: 'Pending',
            lastInteraction: '3h ago',
            attemptsCount: 1,
            bidStatus: 'Pending',
          },
          {
            vendorId: 'v-004',
            vendorName: 'Sterling Valves & Pipes',
            phone: '+91 98201 44222',
            contactPerson: 'Priya Mehra',
            call: { status: 'scheduled', lastAttempt: '6h ago' },
            whatsapp: { status: 'pending', lastAttempt: '4h ago' },
            sms: { status: 'queued', lastAttempt: '6h ago' },
            email24h: { is24hReminderSent: false },
            overallStatus: 'Pending',
            lastInteraction: '4h ago',
            attemptsCount: 1,
            bidStatus: 'Pending',
          },
          {
            vendorId: 'v-005',
            vendorName: 'Delta Turbo Equipments',
            phone: '+91 98201 44333',
            contactPerson: 'Anil Sen',
            call: { status: 'failed', lastAttempt: '7h ago' },
            whatsapp: { status: 'failed', lastAttempt: '5h ago' },
            sms: { status: 'failed', lastAttempt: '7h ago' },
            email24h: { is24hReminderSent: false },
            overallStatus: 'Pending',
            lastInteraction: '5h ago',
            attemptsCount: 1,
            bidStatus: 'Pending',
          },
          {
            vendorId: 'v-006',
            vendorName: 'Unknown Dynamics',
            phone: '+91 98201 44444',
            contactPerson: 'Ramesh Gupta',
            call: { status: 'other_call_status', lastAttempt: '8h ago' },
            whatsapp: { status: 'other_wa_status', lastAttempt: '6h ago' },
            sms: { status: 'other_sms_status', lastAttempt: '8h ago' },
            email24h: { is24hReminderSent: false },
            overallStatus: 'Pending',
            lastInteraction: '6h ago',
            attemptsCount: 1,
            bidStatus: 'Pending',
          },
        ],
      } as any,
    };

    it('returns null when closed or rfq is null', () => {
      const { container } = render(
        <RFQFollowUpDeepDiveModal isOpen={false} onClose={mockOnClose} rfq={null} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders deep dive modal with all badge variants and channel filter tabs and sub-modals', () => {
      render(
        <RFQFollowUpDeepDiveModal isOpen={true} onClose={mockOnClose} rfq={sampleRfq} />
      );

      expect(screen.getByText('Vendor Follow-Up Details')).toBeInTheDocument();
      expect(screen.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
      expect(screen.getByText('Precision Hydro Pumps')).toBeInTheDocument();

      // Enforce confidentiality: vendor company name only; personal contact names and mobile numbers are hidden
      expect(screen.queryByText('+91 98201 44999')).not.toBeInTheDocument();
      expect(screen.queryByText('Karan Sharma')).not.toBeInTheDocument();
      expect(screen.queryByText(/Contact:/i)).not.toBeInTheDocument();

      // Test all channel filter tabs using button role
      const tabButtons = screen.getAllByRole('button');
      const callTab = tabButtons.find((b) => b.textContent?.includes('Calls ('));
      if (callTab) fireEvent.click(callTab);

      const waTab = tabButtons.find((b) => b.textContent?.includes('WhatsApp ('));
      if (waTab) fireEvent.click(waTab);

      const smsTab = tabButtons.find((b) => b.textContent?.includes('SMS ('));
      if (smsTab) fireEvent.click(smsTab);

      const allTab = tabButtons.find((b) => b.textContent?.includes('All Channels ('));
      if (allTab) fireEvent.click(allTab);

      // Click on vendor Call button (which opens submodal with phone hidden)
      const callTextElements = screen.getAllByText('Call');
      if (callTextElements.length > 0) {
        fireEvent.click(callTextElements[0]);
        expect(screen.getByText(/Dispatch AI Follow-Up/)).toBeInTheDocument();
        expect(screen.getByText('Target Vendor')).toBeInTheDocument();
        expect(screen.queryByText('Target Vendor & Phone Number')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Cancel'));
      }

      // Click on vendor WhatsApp button
      const waTextElements = screen.getAllByText('WhatsApp');
      if (waTextElements.length > 0) {
        fireEvent.click(waTextElements[0]);
        expect(screen.getByText(/Dispatch AI Follow-Up/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Cancel'));
      }

      // Click on vendor SMS button
      const smsTextElements = screen.getAllByText('SMS');
      if (smsTextElements.length > 0) {
        fireEvent.click(smsTextElements[0]);
        expect(screen.getByText(/Dispatch AI Follow-Up/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Cancel'));
      }

      // Close Deep Dive
      fireEvent.click(screen.getByText('Close Vendor Follow-Up Details'));
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('renders fallback when followUp is null or vendors list is empty', () => {
      const emptyRfq: RFQItem = {
        ...sampleRfq,
        followUpData: {
          ...sampleRfq.followUpData,
          vendors: [],
        } as any,
      };

      const { unmount } = render(
        <RFQFollowUpDeepDiveModal isOpen={true} onClose={mockOnClose} rfq={emptyRfq} />
      );
      expect(screen.getByText('No vendors found for this channel filter.')).toBeInTheDocument();
      unmount();

      const nullFollowUpRfq: RFQItem = {
        ...sampleRfq,
        followUpData: undefined,
        assignedVendors: [
          { id: 'av-1', name: 'Assigned Vendor 1', contactPerson: 'Bob', phone: '+91 99999 22222' },
        ],
      };
      const { unmount: unmountNull } = render(
        <RFQFollowUpDeepDiveModal isOpen={true} onClose={mockOnClose} rfq={nullFollowUpRfq} />
      );
      // The next follow-up times come from the RFQ creation time, so they show even without follow-up data.
      expect(screen.getByTestId('next-follow-up-call')).toHaveTextContent(
        `${UI_STRINGS.modals.followUp.nextFollowUpLabel} 29 Aug 2026, 04:00 pm IST`
      );
      expect(screen.queryByText('Today 03:00 PM')).not.toBeInTheDocument();
      expect(screen.getByText('Assigned Vendor 1')).toBeInTheDocument();
      unmountNull();
    });

    it('shows the next follow-up for each channel, counted from the RFQ creation time', () => {
      render(<RFQFollowUpDeepDiveModal isOpen={true} onClose={mockOnClose} rfq={sampleRfq} />);

      // sampleRfq is created on 2026-08-29 at 05:30 IST, before the business window opens at 10:00.
      expect(screen.getByTestId('next-follow-up-call')).toHaveTextContent(
        `${UI_STRINGS.modals.followUp.nextFollowUpLabel} 29 Aug 2026, 04:00 pm IST`
      );
      expect(screen.getByTestId('next-follow-up-whatsapp')).toHaveTextContent(
        `${UI_STRINGS.modals.followUp.nextFollowUpLabel} 30 Aug 2026, 02:00 pm IST`
      );
      expect(screen.getByTestId('next-follow-up-sms')).toHaveTextContent(
        `${UI_STRINGS.modals.followUp.nextFollowUpLabel} 29 Aug 2026, 05:35 am IST`
      );
      expect(screen.getByTestId('next-follow-up-email')).toHaveTextContent(
        `${UI_STRINGS.modals.followUp.nextFollowUpLabel} 30 Aug 2026, 05:30 am IST`
      );
      // Only the AI call and WhatsApp times count business hours, so only their tiles carry the note.
      expect(screen.getAllByText(UI_STRINGS.modals.followUp.businessHoursNote)).toHaveLength(2);
    });

    it('shows the not-recorded placeholder on every channel when the RFQ creation time is unreadable', () => {
      render(<RFQFollowUpDeepDiveModal isOpen={true} onClose={mockOnClose} rfq={{ ...sampleRfq, createdAt: '' }} />);

      for (const channel of ['call', 'whatsapp', 'sms', 'email']) {
        expect(screen.getByTestId(`next-follow-up-${channel}`)).toHaveTextContent(
          `${UI_STRINGS.modals.followUp.nextFollowUpLabel} ${UI_STRINGS.recordPlaceholders.notRecorded}`
        );
      }
    });
  });

  describe('VendorSurveyModal', () => {
    const mockOnClose = jest.fn();

    it('returns null when closed', () => {
      const { container } = render(<VendorSurveyModal isOpen={false} onClose={mockOnClose} />);
      expect(container.firstChild).toBeNull();
    });

    it('states that no survey is connected, offers no dispatch action and sends nothing', () => {
      const { unmount } = render(<VendorSurveyModal isOpen={true} onClose={mockOnClose} />);
      expect(screen.getByText('Mode 3 AI Vendor Survey')).toBeInTheDocument();
      expect(screen.getByText(UI_STRINGS.vendorSurvey.notConnected)).toBeInTheDocument();
      expect(screen.queryByText(/Execute Mode 3 Survey/)).not.toBeInTheDocument();
      expect(screen.queryByText(/24/)).not.toBeInTheDocument();
      expect(mockShowToast).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText(UI_STRINGS.vendorSurvey.closeButton));
      expect(mockOnClose).toHaveBeenCalled();
      unmount();

      // Test top X button
      render(<VendorSurveyModal isOpen={true} onClose={mockOnClose} />);
      const topX = screen.getAllByRole('button')[0];
      fireEvent.click(topX);
      expect(mockOnClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('VendorEvaluationSummaryModal', () => {
    const mockOnClose = jest.fn();
    const sampleRecord: VendorEvaluationRecord = {
      id: 'eval-1',
      vendorId: 'v-001',
      vendorName: 'Apex Industrial Dynamics Pvt Ltd',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apexindustrial.in',
      phone: '+91 98201 44820',
      category: 'Engineering Spares - Mechanical',
      submissionDate: '2026-08-29',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      overallScore: 92.4,
      systemAction: 'Auto-Promoted to Preferred Tier',
      capaRequired: false,
      capaNotes: 'None required.',
      questionBreakdown: [
        {
          refId: 'Q1',
          pillarId: 'M1',
          pillarName: 'Commercial Competitiveness',
          criteria: 'Pricing consistency',
          attachmentName: 'RateCard.pdf',
          attachmentVerified: true,
          score: 95,
          weightedScore: 23.75,
          remarks: 'Within benchmark',
        },
      ],
      moduleScores: {
        commercial: { score: 92, weightedScore: 23.0, maxScore: 25, weight: 25, remarks: 'Fair price' },
        technical: { score: 90, weightedScore: 13.5, maxScore: 15, weight: 15, remarks: 'High tech' },
        quality: { score: 94, weightedScore: 18.8, maxScore: 20, weight: 20, remarks: 'High quality' },
        delivery: { score: 93, weightedScore: 18.6, maxScore: 20, weight: 20, remarks: 'Fast delivery' },
        financial: { score: 80, weightedScore: 8.0, maxScore: 10, weight: 10, remarks: 'Solid finances' },
        governance: { score: 94, weightedScore: 9.4, maxScore: 10, weight: 10, remarks: 'Compliant' },
      },
      documents: [
        { id: 'doc-1', name: 'ISO 9001 Certificate.pdf', type: 'Quality Certification', uploadDate: '2026-08-29', verified: true, status: 'Verified' },
        { id: 'doc-2', name: 'GST Certificate.pdf', type: 'Tax ID', uploadDate: '2026-08-29', verified: false, status: 'Pending Review' },
      ],
    };

    it('returns null when closed or record is null', () => {
      const { container } = render(
        <VendorEvaluationSummaryModal isOpen={false} onClose={mockOnClose} record={null} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders evaluation summary report from props and handles download report and close', () => {
      render(
        <VendorEvaluationSummaryModal isOpen={true} onClose={mockOnClose} record={sampleRecord} />
      );

      expect(screen.getByText('Mode 3 Vendor Evaluation Summary Report')).toBeInTheDocument();
      expect(screen.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
      expect(screen.getByText('92.4%')).toBeInTheDocument();

      // Download PDF button
      const downloadBtn = screen.getByText(/Download Report \(PDF\)/);
      fireEvent.click(downloadBtn);
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('renders evaluation summary report with conditional and disqualified statuses and store selectedVendorEvaluation fallback', () => {
      const conditionalRecord: VendorEvaluationRecord = {
        ...sampleRecord,
        status: 'CONDITIONAL / UNDER REVIEW',
        overallScore: 68.5,
        capaRequired: true,
      };

      const { unmount } = render(
        <VendorEvaluationSummaryModal isOpen={true} onClose={mockOnClose} record={conditionalRecord} />
      );
      expect(screen.getByText('CONDITIONAL / UNDER REVIEW')).toBeInTheDocument();
      unmount();

      const disqualifiedRecord: VendorEvaluationRecord = {
        ...sampleRecord,
        status: 'DISQUALIFIED SUPPLIER',
        overallScore: 42.0,
        capaRequired: false,
      };

      const { unmount: unmount2 } = render(
        <VendorEvaluationSummaryModal isOpen={true} onClose={mockOnClose} record={disqualifiedRecord} />
      );
      expect(screen.getByText('DISQUALIFIED SUPPLIER')).toBeInTheDocument();
      unmount2();

      // Test fallback when moduleScores and documents are missing
      const minimalRecord = {
        vendorName: 'Minimal Vendor Ltd',
        category: 'Mechanical',
        submissionDate: '2026-08-29',
        overallScore: 75,
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        systemAction: 'Review',
      };

      const { unmount: unmount3 } = render(
        <VendorEvaluationSummaryModal isOpen={true} onClose={mockOnClose} record={minimalRecord} />
      );
      expect(screen.getByText('Minimal Vendor Ltd')).toBeInTheDocument();
      // Each module with no recorded score shows the not-evaluated placeholder, never a substitute number.
      expect(screen.getAllByText(UI_STRINGS.recordPlaceholders.notEvaluated)).toHaveLength(6);
      expect(screen.queryByText('24 / 25 pts')).not.toBeInTheDocument();
      unmount3();

      (storeModule.useApp as jest.Mock).mockReturnValue({
        selectedVendorEvaluation: sampleRecord,
      });

      render(
        <VendorEvaluationSummaryModal isOpen={true} onClose={mockOnClose} />
      );

      expect(screen.getByText('Mode 3 Vendor Evaluation Summary Report')).toBeInTheDocument();
      expect(screen.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
    });
  });

  describe('ActivePipelineModal', () => {
    const mockOnClose = jest.fn();
    const mockOnOpenDeepDive = jest.fn();
    const mockOnNavigateToMatrix = jest.fn();

    const sampleRfqs: RFQItem[] = [
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-001',
        title: 'Industrial Centrifugal Pumps',
        category: 'Mechanical',
        sourcingMode: 'mode_1',
        status: 'In Evaluation',
        quotesCount: 3,
        targetDeliveryDate: '2026-09-30',
        budget: 450000,
        createdAt: '2026-08-20',
        extractedEntities: [],
        quotes: [],
        chasingActive: true,
        source: 'email_gateway',
      },
      {
        id: 'rfq-2',
        rfqNumber: 'RFQ-2026-002',
        title: 'High Pressure Titanium Valves',
        category: 'Piping',
        sourcingMode: 'mode_2',
        status: 'AI Recommended',
        quotesCount: 2,
        targetDeliveryDate: '2026-10-15',
        budget: 250000,
        createdAt: '2026-08-22',
        extractedEntities: [],
        quotes: [],
        chasingActive: false,
        source: 'manual_entry',
      },
    ];

    it('returns null when closed', () => {
      const { container } = render(
        <ActivePipelineModal
          isOpen={false}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onOpenDeepDive={mockOnOpenDeepDive}
          onNavigateToMatrix={mockOnNavigateToMatrix}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders list of active RFQs, filters, and handles actions', () => {
      render(
        <ActivePipelineModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onOpenDeepDive={mockOnOpenDeepDive}
          onNavigateToMatrix={mockOnNavigateToMatrix}
        />
      );

      expect(screen.getByText('Active Procurement Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Industrial Centrifugal Pumps')).toBeInTheDocument();
      expect(screen.getByText('High Pressure Titanium Valves')).toBeInTheDocument();

      // Filter by search input
      const searchInput = screen.getByPlaceholderText(/Search by RFQ number, title, category, or status/i);
      fireEvent.change(searchInput, { target: { value: 'Mechanical' } });
      expect(screen.getByText('Industrial Centrifugal Pumps')).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'email_gateway' } });
      expect(screen.getByText('Industrial Centrifugal Pumps')).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'In Evaluation' } });
      expect(screen.getByText('Industrial Centrifugal Pumps')).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'ZZZNoMatch' } });
      expect(screen.getByText('No matching requisitions found')).toBeInTheDocument();

      // Reset search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Trigger View Quotes action
      const quoteBtns = screen.getAllByTitle('View Quotes');
      fireEvent.click(quoteBtns[0]);
      expect(mockOnNavigateToMatrix).toHaveBeenCalledWith(sampleRfqs[0]);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('IntakeSourcesModal', () => {
    const mockOnClose = jest.fn();
    const mockOnOpenDeepDive = jest.fn();

    const sampleRfqs: RFQItem[] = [
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-001',
        title: 'Industrial Centrifugal Pumps',
        category: 'Mechanical',
        sourcingMode: 'mode_1',
        status: 'In Evaluation',
        quotesCount: 3,
        targetDeliveryDate: '2026-09-30',
        budget: 450000,
        createdAt: '2026-08-20',
        extractedEntities: [],
        quotes: [],
        chasingActive: true,
        source: 'email_gateway',
        sourceEmail: 'rfqs@client.com',
      },
      {
        id: 'rfq-2',
        rfqNumber: 'RFQ-2026-002',
        title: 'High Pressure Titanium Valves',
        category: 'Piping',
        sourcingMode: 'mode_2',
        status: 'AI Recommended',
        quotesCount: 2,
        targetDeliveryDate: '2026-10-15',
        budget: 250000,
        createdAt: '2026-08-22',
        extractedEntities: [],
        quotes: [],
        chasingActive: false,
        source: 'manual_entry',
      },
      {
        id: 'rfq-3',
        rfqNumber: 'RFQ-2026-003',
        title: 'Uploaded BOQ Sheet',
        category: 'Electrical',
        sourcingMode: 'mode_1',
        status: 'Parsing',
        quotesCount: 0,
        targetDeliveryDate: '2026-10-20',
        budget: 100000,
        createdAt: '2026-08-23',
        extractedEntities: [],
        quotes: [],
        chasingActive: false,
        source: 'web_portal',
        sourceFileName: 'electrical_boq.pdf',
      },
    ];

    it('returns null when closed', () => {
      const { container } = render(
        <IntakeSourcesModal
          isOpen={false}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onOpenDeepDive={mockOnOpenDeepDive}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders intake source breakdown and channel filtering', () => {
      render(
        <IntakeSourcesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onOpenDeepDive={mockOnOpenDeepDive}
        />
      );

      expect(screen.getByText('Requisitions by Intake Source')).toBeInTheDocument();
      expect(screen.getByText(/Autonomous Ingestion · Auto-circulated/i)).toBeInTheDocument();

      // Click card for Email Gateway
      const emailCard = screen.getByText(/Autonomous Ingestion · Auto-circulated/i);
      fireEvent.click(emailCard);
      expect(screen.getByText('Industrial Centrifugal Pumps')).toBeInTheDocument();

      // Click card for Web Portal
      const webPortalCard = screen.getByText(/Web Portal BOQ PDF\/Excel Ingest/i);
      fireEvent.click(webPortalCard);
      expect(screen.getByText('Uploaded BOQ Sheet')).toBeInTheDocument();

      // Click card for Manual RFQ
      const manualCard = screen.getByText(/Parametric Line-Item Entry Form/i);
      fireEvent.click(manualCard);
      expect(screen.getByText('High Pressure Titanium Valves')).toBeInTheDocument();

      // Click tab buttons
      const emailTab = screen.getByRole('button', { name: /via Email Upload \(/i });
      fireEvent.click(emailTab);

      const webTab = screen.getByRole('button', { name: /AI RFQ Create \(/i });
      fireEvent.click(webTab);

      const manualTab = screen.getByRole('button', { name: /Manual RFQ \(/i });
      fireEvent.click(manualTab);

      // Click All Channels tab
      const allChannelsBtn = screen.getByRole('button', { name: /All Channels/i });
      fireEvent.click(allChannelsBtn);

      // Search filtering by filename
      const searchInput = screen.getByPlaceholderText(/Filter by origin or title/i);
      fireEvent.change(searchInput, { target: { value: 'electrical_boq.pdf' } });
      expect(screen.getByText('Uploaded BOQ Sheet')).toBeInTheDocument();

      // Search filtering by email
      fireEvent.change(searchInput, { target: { value: 'rfqs@client.com' } });
      expect(screen.getByText('Industrial Centrifugal Pumps')).toBeInTheDocument();

      // View Quotes button click (fallback to onOpenDeepDive)
      const viewQuotesBtns = screen.getAllByTitle('View Quotes');
      if (viewQuotesBtns.length > 0) {
        fireEvent.click(viewQuotesBtns[0]);
        expect(mockOnOpenDeepDive).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('renders and handles onNavigateToMatrix when provided', () => {
      const mockOnNavigateToMatrix = jest.fn();
      render(
        <IntakeSourcesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onOpenDeepDive={mockOnOpenDeepDive}
          onNavigateToMatrix={mockOnNavigateToMatrix}
        />
      );

      const viewQuotesBtns = screen.getAllByTitle('View Quotes');
      if (viewQuotesBtns.length > 0) {
        fireEvent.click(viewQuotesBtns[0]);
        expect(mockOnNavigateToMatrix).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('renders empty state when no rfqs match', () => {
      render(
        <IntakeSourcesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={[]}
          onOpenDeepDive={mockOnOpenDeepDive}
        />
      );
      expect(screen.getByText('No requisitions from this intake source')).toBeInTheDocument();
    });
  });

  describe('SupplierQuotesModal', () => {
    const mockOnClose = jest.fn();
    const mockOnNavigateToMatrix = jest.fn();
    const mockOnOpenDeepDive = jest.fn();

    const sampleRfqs: RFQItem[] = [
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-001',
        title: 'Industrial Centrifugal Pumps',
        category: 'Mechanical',
        sourcingMode: 'mode_1',
        status: 'In Evaluation',
        quotesCount: 1,
        targetDeliveryDate: '2026-09-30',
        budget: 450000,
        createdAt: '2026-08-20',
        extractedEntities: [],
        quotes: [
          {
            vendorId: 'v-01',
            vendorName: 'Apex Fluid Dynamics',
            vendorCategory: 'Client List',
            unitPrice: 420000,
            totalPrice: 420000,
            leadTimeDays: 14,
            aiMatchScore: 94,
            isBestPrice: true,
            warrantyYears: 2,
            complianceStatus: 'Fully Compliant',
            paymentTerms: '30 Days Net',
            remarks: 'Standard delivery',
          },
          {
            vendorId: 'v-02',
            vendorName: 'Global Valves Ltd',
            vendorCategory: 'Procucev Network',
            unitPrice: 435000,
            totalPrice: 435000,
            leadTimeDays: 20,
            aiMatchScore: 88,
            isBestPrice: false,
            warrantyYears: 1,
            complianceStatus: 'Minor Exception',
            paymentTerms: '45 Days Net',
            remarks: 'Alternative seal material',
          },
          {
            vendorId: 'v-03',
            vendorName: 'Precision Dynamics',
            vendorCategory: 'Procucev - AI Rec',
            unitPrice: 450000,
            totalPrice: 450000,
            leadTimeDays: 25,
            aiMatchScore: 82,
            isBestPrice: false,
            warrantyYears: 1,
            complianceStatus: 'Pending Review' as any,
            paymentTerms: '30 Days Net',
            remarks: 'Pending test reports',
          },
        ],
        chasingActive: true,
      },
      {
        id: 'rfq-2',
        rfqNumber: 'RFQ-2026-002',
        title: 'Titanium Valves',
        category: 'Piping',
        sourcingMode: 'mode_1',
        status: 'Quotes Pending',
        quotesCount: 0,
        targetDeliveryDate: '2026-09-30',
        budget: 0,
        createdAt: '2026-08-20',
        extractedEntities: [],
        quotes: [],
        followUpData: {
          rfqNumber: 'RFQ-2026-002',
          totalInvited: 2,
          respondedCount: 1,
          autoChasingEnabled: true,
          callStats: { total: 2, connected: 1, avgDuration: '2m' },
          whatsappStats: { total: 2, delivered: 2, read: 1, replied: 1 },
          smsStats: { total: 2, delivered: 2, clicked: 1 },
          vendors: [],
        },
        chasingActive: true,
      },
    ];

    it('returns null when closed', () => {
      const { container } = render(
        <SupplierQuotesModal
          isOpen={false}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onNavigateToMatrix={mockOnNavigateToMatrix}
          onOpenDeepDive={mockOnOpenDeepDive}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders supplier quotes, handles search filtering, view quotes button and matrix navigation', () => {
      render(
        <SupplierQuotesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={sampleRfqs}
          onNavigateToMatrix={mockOnNavigateToMatrix}
          onOpenDeepDive={mockOnOpenDeepDive}
        />
      );

      expect(screen.getByText('Supplier Quotes & Evaluation Matrix')).toBeInTheDocument();
      expect(screen.getAllByText('Apex Fluid Dynamics').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Lowest Quoted Price/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Minor Exception/i)).toBeInTheDocument();
      expect(screen.getByText(/Pending Review/i)).toBeInTheDocument();

      // Search by vendor name
      const searchInput = screen.getByPlaceholderText(/Search by vendor name, item title, or RFQ/i);
      fireEvent.change(searchInput, { target: { value: 'Apex' } });
      expect(screen.getByText('Apex Fluid Dynamics')).toBeInTheDocument();

      // Search by RFQ number
      fireEvent.change(searchInput, { target: { value: 'RFQ-2026-001' } });
      expect(screen.getByText('Apex Fluid Dynamics')).toBeInTheDocument();

      // Search by title
      fireEvent.change(searchInput, { target: { value: 'Centrifugal' } });
      expect(screen.getByText('Apex Fluid Dynamics')).toBeInTheDocument();

      // Search by compliance status
      fireEvent.change(searchInput, { target: { value: 'Minor Exception' } });
      expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();

      // View RFQ details links
      const viewRfqLinks = screen.getAllByTitle('View RFQ Details');
      expect(viewRfqLinks.length).toBeGreaterThan(0);

      // View Quotes action
      const viewQuotesBtns = screen.getAllByTitle('View Quotes');
      if (viewQuotesBtns.length > 0) {
        fireEvent.click(viewQuotesBtns[0]);
        expect(mockOnNavigateToMatrix).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      }

      // Search with non-matching query to test empty results within non-empty list
      fireEvent.change(searchInput, { target: { value: 'ZZZNonExistent' } });
      expect(screen.getByText('No supplier quotes found')).toBeInTheDocument();

      // Click fallback View Quotes button in empty state
      const fallbackBtn = screen.getByRole('button', { name: /View Quotes/i });
      fireEvent.click(fallbackBtn);
      expect(mockOnNavigateToMatrix).toHaveBeenCalledWith(sampleRfqs[0]);
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('renders empty state when no quotes found', () => {
      render(
        <SupplierQuotesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={[]}
          onNavigateToMatrix={mockOnNavigateToMatrix}
          onOpenDeepDive={mockOnOpenDeepDive}
        />
      );
      expect(screen.getByText('No supplier quotes found')).toBeInTheDocument();
    });
  });

  describe('SubscriptionPaymentModal', () => {
    const mockOnClose = jest.fn();
    const mockCreatePaymentLink = jest.fn();

    it('returns null when closed', () => {
      const { container } = render(
        <SubscriptionPaymentModal
          isOpen={false}
          onClose={mockOnClose}
          planId="plan-enterprise"
          planName="Enterprise Tier"
          price="₹9,999/mo"
          createPaymentLink={mockCreatePaymentLink}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders payment modal and handles successful checkout link creation', async () => {
      mockCreatePaymentLink.mockResolvedValue('https://checkout.zoho.com/test');

      render(
        <SubscriptionPaymentModal
          isOpen={true}
          onClose={mockOnClose}
          planId="plan-enterprise"
          planName="Enterprise Tier"
          price="₹9,999/mo"
          createPaymentLink={mockCreatePaymentLink}
        />
      );

      expect(screen.getByText('Secure Payment')).toBeInTheDocument();
      expect(screen.getByText('Enterprise Tier')).toBeInTheDocument();

      const payBtn = screen.getByRole('button', { name: /Pay ₹9,999\/mo/i });
      await act(async () => {
        fireEvent.click(payBtn);
      });

      expect(mockCreatePaymentLink).toHaveBeenCalledWith('plan-enterprise');
    });

    it('renders billingDurationLabel when provided', () => {
      render(
        <SubscriptionPaymentModal
          isOpen={true}
          onClose={mockOnClose}
          planId="version_1"
          planName="Version 1 Plan"
          price="₹4,999"
          billingDurationLabel="12 Months (Recommended)"
          createPaymentLink={mockCreatePaymentLink}
        />
      );

      expect(screen.getByText('Billing Period')).toBeInTheDocument();
      expect(screen.getByText('12 Months (Recommended)')).toBeInTheDocument();
    });

    it('renders base price and GST breakdown when provided', () => {
      render(
        <SubscriptionPaymentModal
          isOpen={true}
          onClose={mockOnClose}
          planId="version_1"
          planName="Version 1 Plan"
          price="₹5,898.82"
          billingDurationLabel="12 Months (Recommended)"
          breakdown={{
            basePrice: '₹4,999',
            gstAmount: '₹899.82',
          }}
          createPaymentLink={mockCreatePaymentLink}
        />
      );

      expect(screen.getByText('Base Plan Price')).toBeInTheDocument();
      expect(screen.getByText('₹4,999')).toBeInTheDocument();
      // No GST rate is supplied with this breakdown, so the label carries no percentage.
      expect(screen.getByText(UI_STRINGS.modals.subscriptionPayment.gstLabel)).toBeInTheDocument();
      expect(screen.queryByText(/GST \(\d+%\)/)).not.toBeInTheDocument();
      expect(screen.getByText('₹899.82')).toBeInTheDocument();
      expect(screen.getByText('Amount Due')).toBeInTheDocument();
      expect(screen.getByText('₹5,898.82')).toBeInTheDocument();
    });

    it('shows the GST rate in the label only when the pricing data supplies it', () => {
      render(
        <SubscriptionPaymentModal
          isOpen={true}
          onClose={mockOnClose}
          planId="version_1"
          planName="Version 1 Plan"
          price="₹5,898.82"
          breakdown={{
            basePrice: '₹4,999',
            gstAmount: '₹899.82',
            gstPercent: 18,
          }}
          createPaymentLink={mockCreatePaymentLink}
        />
      );

      expect(screen.getByText(formatString(UI_STRINGS.modals.subscriptionPayment.gstLabelWithRate, { gstPercent: 18 }))).toBeInTheDocument();
      expect(screen.queryByText(UI_STRINGS.modals.subscriptionPayment.gstLabel)).not.toBeInTheDocument();
    });

    it('handles checkout error when payment link creation fails', async () => {
      mockCreatePaymentLink.mockResolvedValue(null);

      render(
        <SubscriptionPaymentModal
          isOpen={true}
          onClose={mockOnClose}
          planId="plan-enterprise"
          planName="Enterprise Tier"
          price="₹9,999/mo"
          createPaymentLink={mockCreatePaymentLink}
        />
      );

      const payBtn = screen.getByRole('button', { name: /Pay ₹9,999\/mo/i });
      await act(async () => {
        fireEvent.click(payBtn);
      });

      expect(screen.getByText('Could not start checkout. Please try again.')).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('ActivePipelineModal null-safety & extended search', () => {
    const mockOnClose = jest.fn();
    const mockRfqs: RFQItem[] = [
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-001',
        title: 'Hydraulic Seals',
        category: 'Mechanical',
        status: 'In Evaluation',
        source: 'email_gateway',
        sourcingMode: 'cb_open',
        quotesCount: 3,
        assignedVendors: [{ id: 'v1', name: 'Vendor Alpha', contactPerson: 'John', email: 'john@alpha.com', score: 90 }],
        extractedEntities: [{ id: 'ent-1', itemName: 'High pressure seal', technicalSpecs: 'Specs A', quantity: 10, unit: 'Nos', category: 'Mechanical', majorCategory: 'Mechanical', minorCategory: 'Seals', confidence: 0.95, targetDate: '2026-09-15' }],
        lineItems: [],
        createdAt: '2026-09-01',
        targetDeliveryDate: '2026-09-15',
      },
      {
        id: 'rfq-2',
        rfqNumber: 'RFQ-2026-002',
        title: 'Servo Motors',
        category: 'Electrical',
        status: 'AI Recommended',
        source: 'manual_entry',
        sourcingMode: 'sole_source',
        quotesCount: 1,
        assignedVendors: [],
        extractedEntities: [],
        lineItems: [{ description: 'AC Servo Motor' } as any],
        createdAt: '2026-09-02',
      } as any,
    ];

    it('renders and filters by search input safely with nullish fields', () => {
      const onDeepDive = jest.fn();
      const onMatrix = jest.fn();
      render(
        <ActivePipelineModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={mockRfqs}
          onOpenDeepDive={onDeepDive}
          onNavigateToMatrix={onMatrix}
        />
      );

      expect(screen.getByText('Active Procurement Pipeline')).toBeInTheDocument();
      expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();
      expect(screen.getByText('RFQ-2026-002')).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText('Search by RFQ number, title, category, or status...');
      fireEvent.change(searchInput, { target: { value: 'Hydraulic' } });
      expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();
      expect(screen.queryByText('RFQ-2026-002')).not.toBeInTheDocument();

      // Test searching by vendor and line item
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });
      expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();

      // Test reset filters button
      const resetBtn = screen.getByText('Reset Filters');
      fireEvent.click(resetBtn);
      expect(screen.getByText('RFQ-2026-002')).toBeInTheDocument();
    });
  });

  describe('IntakeSourcesModal null-safety & extended search', () => {
    const mockOnClose = jest.fn();
    const mockRfqs: RFQItem[] = [
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-001',
        title: 'Email Order RFQ',
        category: 'Pneumatics',
        status: 'Quotes Received',
        source: 'email_gateway',
        sourceEmail: 'orders@supplier.com',
        sourceFileName: 'order.pdf',
        quotes: [],
        createdAt: '2026-09-01',
      } as any,
      {
        id: 'rfq-2',
        rfqNumber: 'RFQ-2026-002',
        title: 'Portal Ingest RFQ',
        category: 'Electronics',
        status: 'AI Recommended',
        source: 'web_portal',
        quotes: [],
        createdAt: '2026-09-02',
      } as any,
    ];

    it('renders tabs and filters safely by search input', () => {
      render(
        <IntakeSourcesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={mockRfqs}
          onOpenDeepDive={jest.fn()}
        />
      );

      expect(screen.getByText('Requisitions by Intake Source')).toBeInTheDocument();
      expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText('Filter by origin or title...');
      fireEvent.change(searchInput, { target: { value: 'orders@supplier.com' } });
      expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();
      expect(screen.queryByText('RFQ-2026-002')).not.toBeInTheDocument();
    });
  });

  describe('SupplierQuotesModal null-safety & extended search', () => {
    const mockOnClose = jest.fn();
    const mockRfqs: RFQItem[] = [
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-001',
        title: 'Valves',
        category: 'Mechanical',
        status: 'In Evaluation',
        quotes: [
          {
            vendorId: 'v1',
            vendorName: 'Apex Hydraulics',
            vendorCategory: 'Client List',
            unitPrice: 1200,
            totalPrice: 12000,
            leadTimeDays: 7,
            complianceStatus: 'Fully Compliant',
            aiMatchScore: 94,
          } as any,
        ],
        createdAt: '2026-09-01',
      } as any,
    ];

    it('renders supplier quotes and handles search filtering without throwing errors', () => {
      const onMatrix = jest.fn();
      const onDeepDive = jest.fn();
      render(
        <SupplierQuotesModal
          isOpen={true}
          onClose={mockOnClose}
          rfqs={mockRfqs}
          onNavigateToMatrix={onMatrix}
          onOpenDeepDive={onDeepDive}
        />
      );

      expect(screen.getByText('Supplier Quotes & Evaluation Matrix')).toBeInTheDocument();
      expect(screen.getByText('Apex Hydraulics')).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText('Search by vendor name, item title, or RFQ...');
      fireEvent.change(searchInput, { target: { value: 'Apex' } });
      expect(screen.getByText('Apex Hydraulics')).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });
      expect(screen.getByText('No supplier quotes found')).toBeInTheDocument();
    });
  });
});
