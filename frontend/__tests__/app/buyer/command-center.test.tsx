import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandCenter from '@/app/buyer/command-center';
import { useApp } from '@/lib/store';
import { RFQItem, AIBotFeedItem } from '@/lib/types';

// Mock useApp
jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/app/components/Modals', () => ({
  RFQFollowUpDeepDiveModal: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="deep-dive-modal">
        <button onClick={onClose}>Close Deep Dive</button>
      </div>
    ) : null,
  MultiChannelChaserModal: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="chaser-modal">
        <button onClick={onClose}>Close Chaser</button>
      </div>
    ) : null,
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

    expect(screen.getByText('Enterprise Sourcing Dashboard')).toBeInTheDocument();
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

    // Manage Subscription button
    fireEvent.click(screen.getByText(/Manage Subscription/i));
    expect(mockNavigateToSubscription).toHaveBeenCalled();
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

    // Click Email Gateway filter
    fireEvent.click(screen.getByText(/Email Gateway \(1\)/i));
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

    // Click on KPI outreach card to open deep dive
    fireEvent.click(screen.getByTitle('Click to open multi-channel deep dive'));
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
    expect(screen.getByText(/Version 1 \(Client Roster Plan\)/i)).toBeInTheDocument();

    // version_2
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
      activeSubscription: 'version_2',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });
    rerender(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
      />
    );
    expect(screen.getByText(/Version 2 \(Hybrid Sourcing Plan\)/i)).toBeInTheDocument();

    // version_3
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      aiFeed: [],
      currentMode: 'mode_3',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 0,
      activeSubscription: 'version_3',
      activeBuyerAccount: null,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });
    rerender(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
      />
    );
    expect(screen.getByText(/Version 3 \(AI Autonomous Sourcing Plan\)/i)).toBeInTheDocument();
  });

  it('filters Vendor Follow Up Status feed to only show events belonging to the buyer RFQs', () => {
    const buyerFeed: AIBotFeedItem[] = [
      {
        id: 'feed-buyer-1',
        title: 'Voice Call Connected: Slurry Pumps',
        message: 'Vendor Apex confirmed lead time 14 days.',
        timestamp: '10:00 AM',
        timeAgo: '10m ago',
        type: 'call',
        channel: 'call',
        status: 'completed',
        rfqNumber: 'RFQ-2026-001',
        recipient: 'Apex Supplies',
      },
      {
        id: 'feed-other-buyer',
        title: 'Voice Call Connected: Other Buyer RFQ',
        message: 'Other buyer vendor answered.',
        timestamp: '10:05 AM',
        timeAgo: '5m ago',
        type: 'call',
        channel: 'call',
        status: 'completed',
        rfqNumber: 'RFQ-2026-999', // Not in mockRfqs
        recipient: 'Foreign Vendor',
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRfqs,
      aiFeed: buyerFeed,
      currentMode: 'mode_1',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 5,
      activeSubscription: 'version_1',
      activeBuyerAccount: { id: 'buyer-lnt', organizationName: 'L&T' },
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
    });

    render(
      <CommandCenter
        onNavigateToWizard={mockNavigateToWizard}
        onNavigateToMatrix={mockNavigateToMatrix}
      />
    );

    expect(screen.getByText(/Voice Call Connected: Slurry Pumps/i)).toBeInTheDocument();
    expect(screen.queryByText(/Voice Call Connected: Other Buyer RFQ/i)).not.toBeInTheDocument();
  });

  it('filters out feed events from other organizations and handles optional directory navigation', () => {
    const orgFeeds = [
      {
        id: 'feed-match-org',
        title: 'Org Matched Feed',
        message: 'AI Category Cross-Match completed and persisted for Organization buyer-org-123. Dual-file ERP ingestion sealed.',
        type: 'ingestion',
        timestamp: '10:00 AM',
        organizationId: 'buyer-org-123',
      },
      {
        id: 'feed-diff-org',
        title: 'Other Org Feed',
        message: 'AI Category Cross-Match completed and persisted for Organization diff-org-999. Dual-file ERP ingestion sealed.',
        type: 'ingestion',
        timestamp: '10:05 AM',
        organizationId: 'diff-org-999',
      },
      {
        id: 'feed-diff-buyer-org',
        title: 'Other Buyer Org Feed',
        message: 'Dispatched notification for other organization.',
        type: 'ingestion',
        timestamp: '10:10 AM',
        buyerOrgId: 'diff-org-888',
      },
      {
        id: 'feed-matched-buyer-org',
        title: 'Matched Buyer Org Feed',
        message: 'Dispatched notification for active buyer organization.',
        type: 'ingestion',
        timestamp: '10:15 AM',
        buyerOrgId: 'buyer-org-123',
      },
    ];

    const mockNavigateToSubscription = jest.fn();
    const mockNavigateToDirectory = jest.fn();

    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      aiFeed: orgFeeds,
      currentMode: 'mode_3',
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      selectedRFQForDeepDive: null,
      setSelectedRFQForDeepDive: mockSetSelectedRFQForDeepDive,
      deepDiveModalOpen: true,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      openRFQDeepDive: mockOpenRFQDeepDive,
      remainingFreeRFQs: 0,
      activeSubscription: 'free',
      activeBuyerAccount: { id: 'buyer-org-123', organizationName: 'Active Org Inc' },
      buyerVendors: [],
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

    expect(screen.getByText(/Org Matched Feed/i)).toBeInTheDocument();
    expect(screen.getByText(/Matched Buyer Org Feed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Other Org Feed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Other Buyer Org Feed/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Close Deep Dive'));
    expect(mockSetDeepDiveModalOpen).toHaveBeenCalledWith(false);
  });
});
