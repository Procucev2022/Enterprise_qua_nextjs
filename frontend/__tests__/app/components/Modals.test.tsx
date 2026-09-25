import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PurchaseOrderModal,
  MultiChannelChaserModal,
  WhatsAppChaserModal,
  RFQFollowUpDeepDiveModal,
  VendorSurveyModal,
  RbacModal,
  VendorEvaluationSummaryModal,
  ActivePipelineModal,
  IntakeSourcesModal,
  SupplierQuotesModal,
  SubscriptionPaymentModal,
} from '@/app/components/Modals';
import * as storeModule from '@/lib/store';
import { RFQItem, VendorEvaluationRecord } from '@/lib/types';

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

      expect(screen.getByText('Purchase Order Generation & Dispatch')).toBeInTheDocument();
      expect(screen.getByText('PURCHASE ORDER: PO-2026-001')).toBeInTheDocument();

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

      // Notes input
      const notesInput = screen.getByDisplayValue(/Approved based on AI/);
      fireEvent.change(notesInput, { target: { value: 'Custom approver note' } });

      // Approve button — approvePO is now async and only resolves via the
      // real backend response
      const approveBtn = screen.getByText(/APPROVE & GENERATE PO/);
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

      expect(screen.getByText('RFQ AI Follow-Up Telemetry & Deep Dive')).toBeInTheDocument();
      expect(screen.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();

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

      // Click on vendor Call button (which opens submodal)
      const callTextElements = screen.getAllByText('Call');
      if (callTextElements.length > 0) {
        fireEvent.click(callTextElements[0]);
        expect(screen.getByText(/Dispatch AI Follow-Up/)).toBeInTheDocument();
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
      fireEvent.click(screen.getByText('Close Deep Dive'));
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
      expect(screen.getByText('Today 03:00 PM')).toBeInTheDocument();
      expect(screen.getByText('Assigned Vendor 1')).toBeInTheDocument();
      unmountNull();
    });
  });

  describe('VendorSurveyModal', () => {
    const mockOnClose = jest.fn();

    it('returns null when closed', () => {
      const { container } = render(<VendorSurveyModal isOpen={false} onClose={mockOnClose} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders and handles survey form submission and cancel and close X button', () => {
      jest.useFakeTimers();
      const { unmount } = render(<VendorSurveyModal isOpen={true} onClose={mockOnClose} />);
      expect(screen.getByText('Mode 3 AI Vendor Survey')).toBeInTheDocument();

      const cancelBtn = screen.getByText('Cancel');
      fireEvent.click(cancelBtn);
      expect(mockOnClose).toHaveBeenCalled();

      const submitBtn = screen.getByText(/Execute Mode 3 Survey/);
      fireEvent.click(submitBtn);

      act(() => {
        jest.advanceTimersByTime(1100);
      });

      expect(mockShowToast).toHaveBeenCalledWith('Mode 3 Survey Dispatched', expect.any(String), 'success');
      expect(mockOnClose).toHaveBeenCalled();
      unmount();

      // Test top X button
      render(<VendorSurveyModal isOpen={true} onClose={mockOnClose} />);
      const topX = screen.getAllByRole('button')[0];
      fireEvent.click(topX);
      expect(mockOnClose).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('RbacModal', () => {
    const mockOnClose = jest.fn();

    it('returns null when closed', () => {
      const { container } = render(<RbacModal isOpen={false} onClose={mockOnClose} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders and allows clicking Sync Azure AD Roles and close button and top X button', () => {
      const { unmount } = render(<RbacModal isOpen={true} onClose={mockOnClose} />);
      expect(screen.getByText('Azure Active Directory & RBAC Matrix')).toBeInTheDocument();

      const closeBtn = screen.getByText('Close');
      fireEvent.click(closeBtn);
      expect(mockOnClose).toHaveBeenCalled();

      const syncBtn = screen.getByText(/Sync Azure AD Roles/);
      fireEvent.click(syncBtn);

      expect(mockShowToast).toHaveBeenCalledWith('RBAC Policies Synchronized', expect.any(String), 'success');
      expect(mockOnClose).toHaveBeenCalled();
      unmount();

      // Top X
      render(<RbacModal isOpen={true} onClose={mockOnClose} />);
      const topX = screen.getAllByRole('button')[0];
      fireEvent.click(topX);
      expect(mockOnClose).toHaveBeenCalled();
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
      expect(screen.getByText('24 / 25 pts')).toBeInTheDocument();
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
      const emailTab = screen.getByRole('button', { name: /Email Gateway \(/i });
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
        quotesCount: 2,
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
          vendors: [
            {
              vendorId: 'v-02',
              vendorName: 'Precision Flow',
              contactPerson: 'Alice',
              phone: '+91 99999 11111',
              overallStatus: 'Responded',
              lastInteraction: '2h ago',
              attemptsCount: 1,
              bidStatus: 'Submitted',
              call: { status: 'completed', lastAttempt: '2h ago' },
              whatsapp: { status: 'delivered', lastAttempt: '2h ago' },
              sms: { status: 'delivered', lastAttempt: '2h ago' },
              email24h: { status: 'delivered', lastAttempt: '2h ago', is24hReminderSent: true },
            },
          ],
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

      // Search input with match
      const searchInput = screen.getByPlaceholderText(/Search by vendor name, item title, or RFQ/i);
      fireEvent.change(searchInput, { target: { value: 'Apex' } });

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
});
