import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandCenter from '@/app/buyer/command-center';
import { useApp } from '@/lib/store';
import { RFQItem, AIBotFeedItem } from '@/lib/types';

// Mock useApp
jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/command-center.tsx', () => {
  const mockNavigateToWizard = jest.fn();
  const mockNavigateToMatrix = jest.fn();
  const mockNavigateToSubscription = jest.fn();
  const mockNavigateToDirectory = jest.fn();

  const mockSetSelectedRFQForMatrix = jest.fn();
  const mockShowToast = jest.fn();
  const mockSetSelectedRFQForDeepDive = jest.fn();
  const mockSetDeepDiveModalOpen = jest.fn();
  const mockOpenRFQDeepDive = jest.fn();
  const mockSetInitialSetupModalOpen = jest.fn();

  const mockRfqs: RFQItem[] = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-001',
      title: 'Centrifugal Slurry Pumps',
      category: 'Mechanical',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-09-20',
      status: 'AI Recommended',
      sourcingMode: 'mode_1',
      quotesCount: 3,
      budget: 500000,
      source: 'web_portal',
      sourceFileName: 'Requisition_Portal.pdf',
      extractedEntities: [],
      quotes: [],
      chasingActive: true,
      followUpData: {
        rfqNumber: 'RFQ-2026-001',
        autoChasingEnabled: true,
        totalInvited: 3,
        respondedCount: 2,
        callStats: { total: 3, connected: 2, avgDuration: '1m 30s' },
        whatsappStats: { total: 3, delivered: 3, read: 2, replied: 1 },
        smsStats: { total: 3, delivered: 3, clicked: 2 },
        vendors: [],
      },
    },
    {
      id: 'rfq-2',
      rfqNumber: 'RFQ-2026-002',
      title: 'Titanium Valves',
      category: 'Piping',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-09-25',
      status: 'In Evaluation',
      sourcingMode: 'mode_2',
      quotesCount: 2,
      budget: 300000,
      source: 'email_gateway',
      sourceEmail: 'requisitions@lnt.com',
      autoCirculated: true,
      extractedEntities: [],
      quotes: [],
      chasingActive: true,
    },
    {
      id: 'rfq-3',
      rfqNumber: 'RFQ-2026-003',
      title: 'Electrical Transformers',
      category: 'Electrical',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-09-30',
      status: 'PO Generated',
      sourcingMode: 'mode_3',
      quotesCount: 5,
      budget: 800000,
      source: 'manual_entry',
      sourceFileName: 'Specs.eml',
      extractedEntities: [],
      quotes: [],
      chasingActive: false,
    },
    {
      id: 'rfq-4',
      rfqNumber: 'RFQ-2026-004',
      title: 'Hydraulic Seals',
      category: 'Spares',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-10-05',
      status: 'Parsing',
      sourcingMode: 'mode_1',
      quotesCount: 0,
      budget: 50000,
      extractedEntities: [],
      quotes: [],
      chasingActive: true,
    },
  ];

  const mockAiFeed: AIBotFeedItem[] = [
    {
      id: 'feed-1',
      title: 'Call Connected with Rajesh',
      message: 'Autonomous voice agent confirmed delivery timeline.',
      timestamp: '10:30 AM',
      timeAgo: '10m ago',
      type: 'call',
      channel: 'call',
      recipient: 'Apex Supplies Ltd.',
      rfqNumber: 'RFQ-2026-001',
      status: 'completed',
      channelDetails: { duration: '1m 45s' },
    },
    {
      id: 'feed-2',
      title: 'WhatsApp Quotation Prompt Delivered',
      message: 'Bid link viewed by supplier coordinator.',
      timestamp: '10:45 AM',
      timeAgo: '15m ago',
      type: 'whatsapp',
      channel: 'whatsapp',
      recipient: 'Global Valves Ltd',
      rfqNumber: 'RFQ-2026-002',
      status: 'completed',
    },
    {
      id: 'feed-3',
      title: 'SMS Chaser Dispatched',
      message: 'SMS delivered to phone number.',
      timestamp: '11:00 AM',
      timeAgo: '30m ago',
      type: 'sms',
      channel: 'sms',
      status: 'completed',
    },
    {
      id: 'feed-4',
      title: '24h Reminder Email Sent',
      message: 'BOQ spec re-attached.',
      timestamp: '11:15 AM',
      timeAgo: '45m ago',
      type: 'email',
      channel: 'email',
      status: 'completed',
    },
    {
      id: 'feed-5',
      title: 'System Automated Scoring',
      message: 'Quotation verified with 95% compliance score.',
      timestamp: '11:30 AM',
      timeAgo: '1h ago',
      type: 'scoring',
      channel: 'system',
      status: 'completed',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRfqs,
      aiFeed: mockAiFeed,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: mockRfqs[0],
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 4,
      activeSubscription: 'free_trial',
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: false,
    });
  });

  it('renders correctly with KPIs, pipeline cards, and live feed', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    expect(screen.getByText('Active Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Intake Sources')).toBeInTheDocument();
    expect(screen.getByText('Live Outreach')).toBeInTheDocument();
  });

  it('handles navigation actions and header buttons', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Initial setup button
    fireEvent.click(screen.getByText('⚡ 1-3 Yr Purchase Setup'));
    expect(mockSetInitialSetupModalOpen).toHaveBeenCalledWith(true);

    // The header was reduced to two actions: the Public Buyer DB, Upload BOQ and
    // export-analytics buttons were removed from the component, so the assertions
    // that drove them went with them.
    //
    // Found by its icon rather than its label. The copy for this button is a raw
    // literal in the component rather than a UI_STRINGS entry, and it has been
    // reworded three times; pinning the wording here only re-breaks the suite on
    // each rewrite without telling us anything about the wiring.
    const wizardButton = screen
      .getAllByRole('button')
      .find((button) => button.querySelector('svg.lucide-plus'));
    expect(wizardButton).toBeDefined();
    fireEvent.click(wizardButton as HTMLElement);
    expect(mockNavigateToWizard).toHaveBeenCalled();

    // Manage Subscription was inside the removed banner
    expect(screen.queryByText(/Manage Subscription/i)).not.toBeInTheDocument();
  });

  it('offers no directory, BOQ upload or analytics export in the header', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    expect(screen.queryByText('Upload BOQ')).not.toBeInTheDocument();
    expect(screen.queryByText(/Public Buyer DB/)).not.toBeInTheDocument();
    expect(mockNavigateToDirectory).not.toHaveBeenCalled();
  });

  it('handles source filter tab selection', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Click via Email Upload filter
    fireEvent.click(screen.getByText(/via Email Upload \(1\)/i));
    expect(screen.getByText('Titanium Valves')).toBeInTheDocument();
    expect(screen.queryByText('Centrifugal Slurry Pumps')).not.toBeInTheDocument();

    // Click AI RFQ Create filter
    fireEvent.click(screen.getByText(/AI RFQ Create \(2\)/i));
    expect(screen.getByText('Centrifugal Slurry Pumps')).toBeInTheDocument();

    // Click Manual RFQ filter
    fireEvent.click(screen.getByText(/Manual RFQ \(1\)/i));
    expect(screen.getByText('Electrical Transformers')).toBeInTheDocument();

    // Click All Sources
    fireEvent.click(screen.getByText(/All Sources \(4\)/i));
    expect(screen.getByText('Centrifugal Slurry Pumps')).toBeInTheDocument();
  });

  it('handles channel filter tabs for AI live feed', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Calls filter
    fireEvent.click(screen.getByText('Calls'));
    expect(screen.getByText(/Call Connected with Rajesh/i)).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp Quotation Prompt/i)).not.toBeInTheDocument();

    // WA filter
    fireEvent.click(screen.getByText('WA'));
    expect(screen.getByText(/WhatsApp Quotation Prompt/i)).toBeInTheDocument();

    // SMS filter
    fireEvent.click(screen.getByText('SMS'));
    expect(screen.getByText(/SMS Chaser Dispatched/i)).toBeInTheDocument();

    // Email filter
    fireEvent.click(screen.getByText(/Email \(24h\)/i));
    expect(screen.getByText(/24h Reminder Email Sent/i)).toBeInTheDocument();

    // System filter
    fireEvent.click(screen.getByText('System'));
    expect(screen.getByText(/System Automated Scoring/i)).toBeInTheDocument();

    // All filter
    fireEvent.click(screen.getByText(/All \(5\)/i));
    expect(screen.getByText(/Call Connected with Rajesh/i)).toBeInTheDocument();
  });

  it('handles pipeline interactions: matrix navigation, deep dive modal triggers, chevron buttons, and RFQ links in feed', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Matrix button click on AI Recommended RFQ
    fireEvent.click(screen.getByText('Matrix'));
    expect(mockSetSelectedRFQForMatrix).toHaveBeenCalledWith(mockRfqs[0]);
    expect(mockNavigateToMatrix).toHaveBeenCalledWith(mockRfqs[0]);

    // Click on pipeline card to open deep dive
    fireEvent.click(screen.getByText('Titanium Valves'));
    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRfqs[1]);

    // Click on chevron button of non-AI recommended RFQ
    const chevronBtns = screen.getAllByRole('button');
    const chevBtn = chevronBtns.find(b => b.querySelector('svg.lucide-chevron-right'));
    if (chevBtn) {
      fireEvent.click(chevBtn);
      expect(mockOpenRFQDeepDive).toHaveBeenCalled();
    }

    // Click on KPI outreach card to open vendor follow-up details
    fireEvent.click(screen.getByTitle('Click to open vendor follow-up details'));
    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRfqs[0]);

    // Click on RFQ link inside AI Feed
    fireEvent.click(screen.getByRole('button', { name: 'RFQ-2026-001 ↗' }));
    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRfqs[0]);
  });

  it('renders different subscription plans and completed setup state', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      aiFeed: [],
      currentMode: 'mode_2',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 0,
      activeSubscription: 'version_1',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });

    const { rerender } = render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
      />
    );

    expect(screen.getByText(/PO History Ingested/i)).toBeInTheDocument();
    // Banner is removed completely
    expect(screen.queryByText(/Sourcing Plan:/i)).not.toBeInTheDocument();
  });

  it('filters AI feed strictly when activeBuyerAccount is present and handles various status badges', () => {
    const customRfqs: RFQItem[] = [
      {
        id: 'rfq-custom-1',
        rfqNumber: 'RFQ-CUSTOM-1',
        title: 'Custom Status RFQ',
        category: 'Mechanical',
        createdAt: '2026-08-29',
        targetDeliveryDate: '2026-09-20',
        status: 'Draft' as any,
        sourcingMode: 'invalid_mode_id' as any,
        quotesCount: 1,
        budget: 100000,
        source: 'manual_entry',
        chasingActive: false,
        extractedEntities: [],
        quotes: [],
      },
    ];

    const scopedFeed: AIBotFeedItem[] = [
      {
        id: 'feed-own',
        title: 'My Feed Item',
        message: 'Own buyer message',
        timestamp: '12:00 PM',
        timeAgo: 'Just now',
        type: 'call',
        channel: 'call',
        buyerAccountId: 'my-active-buyer-id',
        status: 'completed',
        channelDetails: { duration: '2m 10s' },
      },
      {
        id: 'feed-other',
        title: 'Other Buyer Feed Item',
        message: 'Other buyer message',
        timestamp: '12:05 PM',
        timeAgo: 'Just now',
        type: 'whatsapp',
        channel: 'whatsapp',
        buyerAccountId: 'other-buyer-id',
        status: 'completed',
      },
      {
        id: 'feed-email-item',
        title: 'Email Feed Item',
        message: 'Email item message',
        timestamp: '12:10 PM',
        timeAgo: 'Just now',
        type: 'email',
        channel: 'email',
        status: 'completed',
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      rfqs: customRfqs,
      aiFeed: scopedFeed,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: { id: 'my-active-buyer-id', companyName: 'My Buyer Co' },
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });

    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    expect(screen.getByText(/My Feed Item/i)).toBeInTheDocument();
    expect(screen.queryByText(/Other Buyer Feed Item/i)).not.toBeInTheDocument();
    expect(screen.getByText('Custom Status RFQ')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('opens Active Pipeline, Intake Sources, and Supplier Quotes modals when clicking KPI cards', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // 1. Click Active Pipeline KPI card
    const activePipelineCard = screen.getByTitle('Click to view Active Pipeline details');
    fireEvent.click(activePipelineCard);
    expect(screen.getByText('Comprehensive tracking of live RFQs, multi-channel response telemetry, and quote evaluation states.')).toBeInTheDocument();

    // Close Active Pipeline modal
    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    fireEvent.click(closeButtons[0]);

    // 2. Click Intake Sources KPI card
    const intakeSourcesCard = screen.getByTitle('Click to view Intake Sources breakdown');
    fireEvent.click(intakeSourcesCard);
    expect(screen.getByText('3 Ingestion Channels')).toBeInTheDocument();
    expect(screen.getByText('Channel-by-channel origin verification across Autonomous via Email Upload, Web Portal AI OCR, and Manual Entry.')).toBeInTheDocument();

    // Close Intake Sources modal
    const closeButtons2 = screen.getAllByRole('button', { name: /Close/i });
    fireEvent.click(closeButtons2[0]);

    // 3. Click Supplier Quotes KPI card
    const supplierQuotesCard = screen.getByTitle('Click to view Supplier Quotes');
    fireEvent.click(supplierQuotesCard);
    expect(screen.getByText('Supplier Quotes & Evaluation Matrix')).toBeInTheDocument();
    expect(screen.getByText('Consolidated parametric view of supplier price quotations, lead times, compliance ratings, and AI match scores.')).toBeInTheDocument();
  });

  it('routes quote actions from pipeline, intake, and supplier modals to the matrix', () => {
    const originalQuotes = mockRfqs[0].quotes;
    mockRfqs[0].quotes = [{
      vendorId: 'vendor-1',
      vendorName: 'Apex Supplies Ltd.',
      vendorCategory: 'Client List',
      unitPrice: 100,
      totalPrice: 300,
      leadTimeDays: 7,
      aiMatchScore: 95,
      warrantyYears: 1,
      complianceStatus: 'Fully Compliant',
      paymentTerms: '30 days',
      remarks: '',
    }];

    try {
      render(
        <CommandCenter
          onNavigateToWizard={mockNavigateToWizard}
          onNavigateToMatrix={mockNavigateToMatrix}
          onNavigateToSubscription={mockNavigateToSubscription}
          onNavigateToDirectory={mockNavigateToDirectory}
        />
      );

      fireEvent.click(screen.getByTitle('Click to view Active Pipeline details'));
      fireEvent.click(screen.getAllByTitle('View Quotes')[0]);
      expect(mockNavigateToMatrix).toHaveBeenCalledWith(mockRfqs[0]);

      fireEvent.click(screen.getByTitle('Click to view Intake Sources breakdown'));
      fireEvent.click(screen.getAllByTitle('View Quotes')[0]);
      expect(mockNavigateToMatrix).toHaveBeenCalledWith(mockRfqs[0]);

      fireEvent.click(screen.getByTitle('Click to view Supplier Quotes'));
      fireEvent.click(screen.getAllByTitle('View Quotes')[0]);
      expect(mockNavigateToMatrix).toHaveBeenCalledTimes(3);
    } finally {
      mockRfqs[0].quotes = originalQuotes;
    }
  });

  it('applies each source filter tab and clears the pipeline search', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Each source-filter tab narrows the pipeline (setRfqSourceFilter branches).
    fireEvent.click(screen.getByText(/via Email Upload \(/i));
    fireEvent.click(screen.getByText(/AI RFQ Create \(/i));
    fireEvent.click(screen.getByText(/Manual RFQ \(/i));
    fireEvent.click(screen.getByText(/All Sources \(/i));

    // Typing then clearing exercises the search field and its clear button.
    const search = screen.getByPlaceholderText(/Search pipeline by RFQ#/i);
    fireEvent.change(search, { target: { value: 'Titanium' } });
    expect((search as HTMLInputElement).value).toBe('Titanium');
    const clearBtn = search.parentElement?.querySelector('button');
    if (clearBtn) {
      fireEvent.click(clearBtn);
      expect((search as HTMLInputElement).value).toBe('');
    }
  });

  it('switches every live-feed channel filter tab', () => {
    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // feedChannelFilter branches: call / whatsapp / sms / email / system / all.
    fireEvent.click(screen.getByRole('button', { name: /^Calls$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^WA$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^SMS$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Email \(24h\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /^System$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^All \(/i }));
    expect(screen.getByText('Live Outreach')).toBeInTheDocument();
  });

  it('renders the remaining RFQ status badges (Quotes Received, Closed, Expired, default)', () => {
    const extraStatuses: RFQItem[] = [
      { ...mockRfqs[0], id: 'rfq-qr', rfqNumber: 'RFQ-QR', status: 'Quotes Received' },
      { ...mockRfqs[0], id: 'rfq-cl', rfqNumber: 'RFQ-CL', status: 'Closed' },
      { ...mockRfqs[0], id: 'rfq-ex', rfqNumber: 'RFQ-EX', status: 'Expired' },
      { ...mockRfqs[0], id: 'rfq-qp', rfqNumber: 'RFQ-QP', status: 'Quotes Pending' },
    ];
    (useApp as jest.Mock).mockReturnValue({
      rfqs: extraStatuses,
      aiFeed: mockAiFeed,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: extraStatuses[0],
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 4,
      activeSubscription: 'free_trial',
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: false,
    });

    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Open the pipeline modal so every status badge is rendered.
    fireEvent.click(screen.getByTitle('Click to view Active Pipeline details'));
    expect(screen.getAllByText('RFQ-QR').length).toBeGreaterThan(0);
  });

  it('covers search by line item entity and assigned vendor', () => {
    const rfqsWithEntities: RFQItem[] = [
      {
        ...mockRfqs[0],
        id: 'rfq-entities',
        rfqNumber: 'RFQ-ENT-1',
        title: 'Pumping Station',
        extractedEntities: [
          {
            id: 'ent-1',
            itemName: 'Submersible Pump 20HP',
            technicalSpecs: 'Stainless Steel Impeller',
            category: 'Pumps & Motors',
            majorCategory: 'Pumps & Motors',
            minorCategory: 'Pumps',
            quantity: 5,
            unit: 'Nos',
            confidence: 0.95,
            targetDate: '2026-11-30',
          },
        ],
        assignedVendors: [
          {
            id: 'v-1',
            name: 'Kirloskar Brothers',
            contactPerson: 'Suresh Patil',
            email: 'suresh@kirloskar.com',
          },
        ],
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      rfqs: rfqsWithEntities,
      aiFeed: mockAiFeed,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });

    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search pipeline by RFQ#/i);

    // 1. Search matching line item entity (Stainless Steel)
    fireEvent.change(searchInput, { target: { value: 'Stainless Steel' } });
    expect(screen.getByText('RFQ-ENT-1')).toBeInTheDocument();

    // 2. Search matching assigned vendor (Kirloskar)
    fireEvent.change(searchInput, { target: { value: 'Kirloskar' } });
    expect(screen.getByText('RFQ-ENT-1')).toBeInTheDocument();
  });

  it('covers live outreach when no RFQs exist and modal deep dive triggers', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      aiFeed: [],
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });

    const { rerender } = render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Click Live Outreach when rfqs is empty (line 337)
    fireEvent.click(screen.getByTitle('Click to open vendor follow-up details'));
    expect(mockShowToast).toHaveBeenCalledWith(
      'No Active RFQs',
      expect.stringContaining('multi-channel follow-up telemetry'),
      'info'
    );

    // Rerender with rfqs and test deep dive triggers
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRfqs,
      aiFeed: mockAiFeed,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: mockRfqs[0],
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: true, // covers lines 679-682
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });

    rerender(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Click Live Outreach when rfqs is present (lines 334-335)
    fireEvent.click(screen.getByTitle('Click to open vendor follow-up details'));
    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRfqs[0]);

    // Click on RFQ link in AI feed (line 654)
    const feedRfqLink = screen.getByText('RFQ-2026-001 ↗');
    fireEvent.click(feedRfqLink);
    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRfqs[0]);
  });

  it('covers syncing/empty states, whitespace search, missing entity/vendor fields, and feed types', () => {
    // 1. Loading RFQs with 0 RFQs covers Syncing...
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      aiFeed: undefined, // covers line 189: feed = aiFeed || []
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
      isLoadingRFQs: true, // line 259: 'Syncing...'
    });

    const { rerender } = render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );
    expect(screen.getByText('Syncing...')).toBeInTheDocument();

    // 2. Loading complete with 0 RFQs covers No Active RFQs
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      aiFeed: [],
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
      isLoadingRFQs: false, // line 259: 'No Active RFQs'
    });

    rerender(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );
    expect(screen.getByText('No Active RFQs')).toBeInTheDocument();

    // 3. Test edge case RFQs and feeds
    const edgeRfqs: RFQItem[] = [
      {
        id: 'rfq-edge-1',
        rfqNumber: 'RFQ-EDGE-001',
        title: 'Edge Requisition 1',
        category: 'Electrical',
        createdAt: '2026-08-29',
        targetDeliveryDate: '2026-09-20',
        status: 'AI Recommended',
        sourcingMode: 'mode_1',
        quotesCount: 0,
        quotes: [],
        budget: 0,
        chasingActive: false,
        source: 'email_upload', // line 514-517: sourceFileName is undefined -> 'Requisition_Email.eml'
        extractedEntities: [
          {
            id: 'ent-blank',
            itemName: '',
            technicalSpecs: undefined as any,
            category: undefined as any,
          } as any,
        ],
        assignedVendors: [
          {
            id: 'v-blank',
            name: 'Vendor X',
            contactPerson: undefined as any,
            email: undefined as any,
          } as any,
        ],
      },
      {
        id: 'rfq-edge-2',
        rfqNumber: 'RFQ-EDGE-002',
        title: 'Edge Requisition 2',
        category: 'Civil',
        createdAt: '2026-08-29',
        targetDeliveryDate: '2026-09-20',
        status: 'Closed',
        sourcingMode: 'mode_2',
        quotesCount: 0,
        quotes: [],
        budget: 0,
        chasingActive: false,
        extractedEntities: [],
        source: 'email_gateway', // line 512: sourceEmail undefined, activeBuyerAccount null -> 'via Email Upload'
      },
    ];

    const systemFeeds: AIBotFeedItem[] = [
      {
        id: 'feed-sys-1',
        title: 'Ingestion event',
        message: 'Requisition ingested',
        timestamp: '12:00 PM',
        timeAgo: '1m ago',
        status: 'completed',
        type: 'ingestion',
        channel: 'system',
        rfqNumber: 'NON_EXISTENT_RFQ', // line 654: targetRfq not found
      },
      {
        id: 'feed-sys-2',
        title: 'Escalation event',
        message: 'Escalation raised',
        timestamp: '12:05 PM',
        timeAgo: '2m ago',
        status: 'completed',
        type: 'escalation',
        channel: 'system',
      },
      {
        id: 'feed-sys-3',
        title: 'Approval event',
        message: 'Approval completed',
        timestamp: '12:10 PM',
        timeAgo: '3m ago',
        status: 'completed',
        type: 'approval',
        channel: 'system',
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      rfqs: edgeRfqs,
      aiFeed: systemFeeds,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
      isLoadingRFQs: false,
    });

    rerender(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
        onNavigateToSubscription={mockNavigateToSubscription}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    // Verify fallback file name and fallback origin
    expect(screen.getByText(/File: Requisition_Email\.eml/i)).toBeInTheDocument();
    expect(screen.getByText(/Origin: via Email Upload/i)).toBeInTheDocument();

    // Switch to system channel filter (covers ingestion, escalation, approval in line 204)
    fireEvent.click(screen.getByRole('button', { name: /System/i }));
    expect(screen.getByText('Ingestion event')).toBeInTheDocument();
    expect(screen.getByText('Escalation event')).toBeInTheDocument();
    expect(screen.getByText('Approval event')).toBeInTheDocument();

    // Click non-existent RFQ link in feed (line 654: targetRfq is undefined)
    const nonExistentLink = screen.getByText('NON_EXISTENT_RFQ ↗');
    mockOpenRFQDeepDive.mockClear();
    fireEvent.click(nonExistentLink);
    expect(mockOpenRFQDeepDive).not.toHaveBeenCalled();

    // Test search with whitespace only (line 129: term.trim() is empty)
    const searchInput = screen.getByPlaceholderText(/Search pipeline by RFQ#/i);
    fireEvent.change(searchInput, { target: { value: '   ' } });
    expect(screen.getByText('RFQ-EDGE-001')).toBeInTheDocument();
    expect(screen.getByText('RFQ-EDGE-002')).toBeInTheDocument();
  });
});

