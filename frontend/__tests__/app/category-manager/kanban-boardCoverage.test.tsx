import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import KanbanBoard from '@/app/category-manager/kanban-board';
import { RFQEditModal } from '@/app/buyer/RFQEditModal';
import { RFQFollowUpDeepDiveModal, VendorSurveyModal } from '@/app/components/Modals';
import * as storeModule from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

const KANBAN_STRINGS = UI_STRINGS.categoryManagerKanban;

jest.mock('@/lib/store');
jest.mock('@/app/buyer/RFQEditModal', () => ({ RFQEditModal: jest.fn(() => null) }));
jest.mock('@/app/components/Modals', () => ({
  MultiChannelChaserModal: jest.fn(() => null),
  VendorSurveyModal: jest.fn(() => null),
  RFQFollowUpDeepDiveModal: jest.fn(() => null),
}));

function makeRfq(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'sparse-pipeline-rfq',
    rfqNumber: 'RFQ-SPARSE-PIPELINE',
    title: 'Sparse Pipeline Requirement',
    category: 'Civil Works',
    sourcingMode: 'mode_1',
    status: 'Parsing',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-01',
    createdAt: '2026-06-01',
    budget: 10000,
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  };
}

function mockApp(rfqs: RFQItem[], overrides: Record<string, unknown> = {}) {
  (storeModule.useApp as jest.Mock).mockReturnValue({
    rfqs,
    triggerChannelChaser: jest.fn(),
    triggerBatchChannelChaser: jest.fn(),
    addAuditLog: jest.fn(),
    showToast: jest.fn(),
    setSelectedRFQForMatrix: jest.fn(),
    updateRFQ: jest.fn(),
    openRFQDeepDive: jest.fn(),
    deepDiveModalOpen: false,
    setDeepDiveModalOpen: jest.fn(),
    selectedRFQForDeepDive: null,
    ...overrides,
  });
}

describe('Kanban board sparse and legacy RFQs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps unclassified, undated parsing records reviewable when legacy metadata is absent', () => {
    const rfq = {
      ...makeRfq(),
      category: undefined,
      createdAt: undefined,
      sourcingMode: 'legacy-mode',
      source: 'legacy-import',
      extractedEntities: undefined,
    } as unknown as RFQItem;
    mockApp([rfq]);
    render(<KanbanBoard />);

    const card = within(screen.getByTestId(`parsing-card-${rfq.rfqNumber}`));
    expect(card.getByText(rfq.title)).toBeInTheDocument();
    expect(card.getByText(String(rfq.source))).toBeInTheDocument();
    expect(card.queryByText(`${UI_STRINGS.categoryManagerKanban.confidenceLabel}:`)).not.toBeInTheDocument();
    fireEvent.click(card.getByRole('button', { name: UI_STRINGS.categoryManagerKanban.reviewAction }));
    expect(jest.mocked(RFQEditModal).mock.lastCall?.[0]).toEqual(expect.objectContaining({ rfq }));
  });

  it('shows the web portal origin and category fallbacks when no source or extracted taxonomy is present', () => {
    const rfq = makeRfq({ sourceEmail: 'procurement@example.test' });
    mockApp([rfq]);
    render(<KanbanBoard />);

    const card = within(screen.getByTestId(`parsing-card-${rfq.rfqNumber}`));
    expect(card.getByText(UI_STRINGS.categoryManagerKanban.sourceLabels.web_portal)).toBeInTheDocument();
    expect(card.getByText(rfq.sourceEmail as string)).toBeInTheDocument();
    expect(card.getByText(rfq.category)).toBeInTheDocument();
  });

  it('filters zero and missing quote counts into Awaiting Quotes and opens review for a sparse row', () => {
    const sparseRfq = { ...makeRfq(), id: undefined, status: 'Closed', quotesCount: undefined, category: undefined, sourcingMode: undefined } as unknown as RFQItem;
    const quotedRfq = makeRfq({ id: 'quoted', rfqNumber: 'RFQ-ONE-QUOTE', title: 'One Quote Requirement', quotesCount: 1, deliveryPincode: '400001' });
    mockApp([sparseRfq, quotedRfq]);
    const navigate = jest.fn();
    render(<KanbanBoard onNavigateToMatrix={navigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Awaiting Quotes/i }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(sparseRfq.rfqNumber)).toBeInTheDocument();
    expect(dialog.queryByText(quotedRfq.rfqNumber)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: /Review/i }));
    expect(navigate).not.toHaveBeenCalled();
    expect(jest.mocked(RFQEditModal).mock.lastCall?.[0]).toEqual(expect.objectContaining({ rfq: sparseRfq }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Quotes Received/i }));
    const quoteDialog = within(screen.getByRole('dialog'));
    expect(quoteDialog.getByText(quotedRfq.rfqNumber)).toBeInTheDocument();
    expect(quoteDialog.queryByText(sparseRfq.rfqNumber)).not.toBeInTheDocument();
    expect(quoteDialog.getByText(`PIN: ${quotedRfq.deliveryPincode}`)).toBeInTheDocument();
    fireEvent.click(quoteDialog.getByRole('button', { name: /Matrix/i }));
    expect(navigate).toHaveBeenCalledWith(quotedRfq);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports a batch follow-up as not sent with the warning variant when no provider accepts it', async () => {
    const pending = makeRfq({ id: 'pending-1', rfqNumber: 'RFQ-PENDING-1', status: 'Quotes Pending' });
    const showToast = jest.fn();
    const triggerBatchChannelChaser = jest.fn().mockResolvedValue(false);
    mockApp([pending], { showToast, triggerBatchChannelChaser });
    render(<KanbanBoard />);

    fireEvent.click(screen.getByRole('button', { name: /Batch Multi-Channel Chaser/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        KANBAN_STRINGS.batchNotSentTitle,
        KANBAN_STRINGS.batchNotSentMessage,
        'warning'
      );
    });
    expect(triggerBatchChannelChaser).toHaveBeenCalledWith('RFQ-PENDING-1', ['call', 'whatsapp', 'sms'], true);
  });

  it('reports a batch follow-up as sent with the accepted and total counts from the server results', async () => {
    const pendingA = makeRfq({ id: 'pending-a', rfqNumber: 'RFQ-PENDING-A', status: 'Quotes Pending' });
    const pendingB = makeRfq({ id: 'pending-b', rfqNumber: 'RFQ-PENDING-B', status: 'Quotes Pending' });
    const showToast = jest.fn();
    const triggerBatchChannelChaser = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockApp([pendingA, pendingB], { showToast, triggerBatchChannelChaser });
    render(<KanbanBoard />);

    fireEvent.click(screen.getByRole('button', { name: /Batch Multi-Channel Chaser/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        KANBAN_STRINGS.batchSentTitle,
        formatString(KANBAN_STRINGS.batchSentMessage, { accepted: 1, total: 2 }),
        'success'
      );
    });
  });

  it('reports no pending RFQs without contacting any channel, and drops the static multi-channel claim', () => {
    const showToast = jest.fn();
    const triggerBatchChannelChaser = jest.fn();
    mockApp([makeRfq({ status: 'Parsing' })], { showToast, triggerBatchChannelChaser });
    render(<KanbanBoard />);

    expect(screen.queryByText(/Multi-Channel Active/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Batch Multi-Channel Chaser/i }));
    expect(showToast).toHaveBeenCalledWith(
      KANBAN_STRINGS.noPendingBatchTitle,
      KANBAN_STRINGS.noPendingBatchMessage,
      'info'
    );
    expect(triggerBatchChannelChaser).not.toHaveBeenCalled();
  });

  it('shows a dash instead of an average when there are no RFQs', () => {
    mockApp([]);
    render(<KanbanBoard />);

    expect(screen.queryByText(/Avg 0/)).not.toBeInTheDocument();
    expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);
  });

  it('allows reviewing a quoted RFQ when no matrix navigation handler is installed', () => {
    const rfq = makeRfq({ quotesCount: 1 });
    mockApp([rfq]);
    render(<KanbanBoard />);

    fireEvent.click(screen.getByRole('button', { name: /RFQs In Pipeline/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Matrix/i }));
    expect(jest.mocked(RFQEditModal).mock.lastCall?.[0]).toEqual(expect.objectContaining({ rfq }));
  });
});

function makeFollowUp(): RFQItem['followUpData'] {
  return {
    rfqNumber: 'RFQ-FOLLOW',
    totalInvited: 2,
    respondedCount: 1,
    callStats: { total: 0, connected: 0, avgDuration: '' },
    whatsappStats: { total: 2, delivered: 1, read: 0, replied: 0 },
    smsStats: { total: 2, delivered: 1, clicked: 0 },
    emailStats: { total: 2, sent24h: 1, delivered: 1, opened: 0 },
    vendors: [
      {
        vendorId: 'v-1',
        vendorName: 'Vendor One',
        phone: '',
        contactPerson: '',
        call: { status: 'pending', lastAttempt: '' },
        whatsapp: { status: 'delivered', lastAttempt: '' },
        sms: { status: 'sent', lastAttempt: '' },
        email: { status: 'delivered', lastAttempt: '', is24hReminderSent: false },
        emailSent: true,
        overallStatus: 'Pending',
        lastInteraction: '',
        attemptsCount: 1,
        bidStatus: 'Pending',
      },
      {
        vendorId: 'v-2',
        vendorName: 'Vendor Two',
        phone: '',
        contactPerson: '',
        call: { status: 'pending', lastAttempt: '' },
        whatsapp: { status: 'read', lastAttempt: '' },
        sms: { status: 'delivered', lastAttempt: '' },
        email24h: { status: 'reminded_24h', lastAttempt: '', is24hReminderSent: true },
        overallStatus: 'Responded',
        lastInteraction: '',
        attemptsCount: 2,
        bidStatus: 'Submitted',
      },
    ],
    autoChasingEnabled: true,
  } as unknown as RFQItem['followUpData'];
}

describe('Kanban board live pipeline details', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the email origin, the categories still to review, and the average extraction confidence on a parsing card', () => {
    const rfq = makeRfq({
      id: 'parsing-detail',
      rfqNumber: 'RFQ-PARSE-DETAIL',
      source: 'email_gateway',
      buyerAccountName: 'Buyer Co',
      createdAt: '2026-06-01T10:00:00Z',
      extractedEntities: [
        { majorCategory: 'Mechanical', minorCategory: 'Pumps', confidence: 90 },
        { majorCategory: 'Mechanical', minorCategory: 'Valves', confidence: 80 },
        { majorCategory: '', minorCategory: '', confidence: 70 },
      ] as unknown as RFQItem['extractedEntities'],
    });
    mockApp([rfq]);
    render(<KanbanBoard />);

    const card = within(screen.getByTestId('parsing-card-RFQ-PARSE-DETAIL'));
    expect(card.getByText(UI_STRINGS.categoryManagerKanban.sourceLabels.email_gateway)).toBeInTheDocument();
    expect(
      card.getByText(formatString(UI_STRINGS.categoryManagerKanban.needsCategoryReview, { count: 1 }))
    ).toBeInTheDocument();
    expect(card.getByText('Mechanical')).toBeInTheDocument();
    expect(card.getByText('Pumps, Valves')).toBeInTheDocument();
    expect(card.getByText('Buyer Co')).toBeInTheDocument();
    expect(card.getByText('80%')).toBeInTheDocument();
  });

  it('shows chaser progress from recorded follow-up data, and dashes where no follow-up is recorded', () => {
    const withFollowUp = makeRfq({
      id: 'pend-1',
      rfqNumber: 'RFQ-PEND-1',
      status: 'Quotes Pending',
      chasingActive: true,
      followUpData: makeFollowUp(),
      assignedVendors: [
        { id: 'v-1', name: 'Vendor One' },
        { id: 'v-2', name: 'Vendor Two' },
      ] as unknown as RFQItem['assignedVendors'],
    });
    const withoutFollowUp = makeRfq({
      id: 'pend-2',
      rfqNumber: 'RFQ-PEND-2',
      status: 'Quotes Pending',
      chasingActive: false,
      followUpData: undefined,
      assignedVendors: [{ id: 'v-3', name: 'Vendor Three' }] as unknown as RFQItem['assignedVendors'],
    });
    mockApp([withFollowUp, withoutFollowUp]);
    render(<KanbanBoard />);

    expect(screen.getByText('1 chasing')).toBeInTheDocument();
    expect(screen.getByText('Multi-Channel: Active')).toBeInTheDocument();
    expect(screen.getByText('Chasing Paused')).toBeInTheDocument();
    // Recorded deliveries across the two vendors on the follow-up record.
    expect(screen.getAllByText('2/2 Delivered')).toHaveLength(3);
    // No follow-up record: the delivered count is a dash, and the total is the invited vendors.
    expect(screen.getAllByText(`${UI_STRINGS.dataLoad.emptyCell}/1 Delivered`)).toHaveLength(3);
  });

  it('shows zero of zero when a follow-up record exists but has no vendors or stats', () => {
    const sparse = makeRfq({
      id: 'pend-3',
      rfqNumber: 'RFQ-PEND-3',
      status: 'Quotes Pending',
      followUpData: {
        rfqNumber: 'RFQ-PEND-3',
        totalInvited: 0,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: '' },
        whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: 0, delivered: 0, clicked: 0 },
        emailStats: { total: 0, sent24h: 0, opened: 0 },
        vendors: undefined,
        autoChasingEnabled: false,
      } as unknown as RFQItem['followUpData'],
    });
    mockApp([sparse]);
    render(<KanbanBoard />);

    // A follow-up record is present, so its recorded zero counts are shown rather than a dash.
    expect(screen.getAllByText('0/0 Delivered')).toHaveLength(3);
  });

  it('opens the comparative matrix from a scored RFQ that has quotes, and shows its AI match', () => {
    const scored = makeRfq({
      id: 's-1',
      rfqNumber: 'RFQ-SCORED-1',
      status: 'In Evaluation',
      quotesCount: 2,
      aiScore: 88,
    } as Partial<RFQItem>);
    const unquoted = makeRfq({ id: 's-2', rfqNumber: 'RFQ-SCORED-2', status: 'PO Generated', quotesCount: 0 });
    const setSelectedRFQForMatrix = jest.fn();
    mockApp([scored, unquoted], { setSelectedRFQForMatrix });
    const onNavigateToMatrix = jest.fn();
    render(<KanbanBoard onNavigateToMatrix={onNavigateToMatrix} />);

    expect(screen.getByText(/88% AI Match/)).toBeInTheDocument();
    expect(screen.getByText('2 quotes evaluated')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /View Comparative Quote Matrix/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /View Comparative Quote Matrix/i }));
    expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(scored);
    expect(onNavigateToMatrix).toHaveBeenCalledWith(scored);
  });

  it('navigates from the vendor summary cards, computes the response rate, and closes the filtered list', () => {
    const onNavigateToVendorConsole = jest.fn();
    const onNavigateToSpend = jest.fn();
    const invited = makeRfq({
      id: 'inv-1',
      rfqNumber: 'RFQ-INVITED',
      status: 'Quotes Pending',
      quotesCount: 1,
      assignedVendors: [
        { id: 'v-1', name: 'Vendor One' },
        { id: 'v-2', name: 'Vendor Two' },
      ] as unknown as RFQItem['assignedVendors'],
    });
    mockApp([invited]);
    render(<KanbanBoard onNavigateToVendorConsole={onNavigateToVendorConsole} onNavigateToSpend={onNavigateToSpend} />);

    // One quoted RFQ out of two invited vendors.
    expect(screen.getByText('50%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mode & Performance Analytics/i }));
    expect(onNavigateToSpend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Vendor Response Rate/i }));
    fireEvent.click(screen.getByRole('button', { name: /Total Invites/i }));
    expect(onNavigateToVendorConsole).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /RFQs In Pipeline/i }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('RFQ-INVITED')).toBeInTheDocument();
    fireEvent.click(dialog.getByText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the no-match message in a summary list with nothing in it, and closes it with the header button', () => {
    mockApp([makeRfq({ quotesCount: 0 })]);
    render(<KanbanBoard />);

    fireEvent.click(screen.getByRole('button', { name: /Quotes Received/i }));
    expect(screen.getByText('No RFQs found matching this criteria.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the Mode 3 survey and the follow-up deep dive from the store, and closes them through their callbacks', () => {
    const setDeepDiveModalOpen = jest.fn();
    const deepDiveRfq = makeRfq({ rfqNumber: 'RFQ-DEEP' });
    mockApp([makeRfq()], { deepDiveModalOpen: true, selectedRFQForDeepDive: deepDiveRfq, setDeepDiveModalOpen });
    render(<KanbanBoard />);

    fireEvent.click(screen.getByRole('button', { name: /Conduct Mode 3 Vendor Survey/i }));
    expect(jest.mocked(VendorSurveyModal).mock.lastCall?.[0]).toEqual(expect.objectContaining({ isOpen: true }));

    const survey = jest.mocked(VendorSurveyModal).mock.lastCall?.[0] as { onClose: () => void };
    act(() => survey.onClose());
    expect(jest.mocked(VendorSurveyModal).mock.lastCall?.[0]).toEqual(expect.objectContaining({ isOpen: false }));

    expect(jest.mocked(RFQFollowUpDeepDiveModal).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ isOpen: true, rfq: deepDiveRfq })
    );
    const deepDive = jest.mocked(RFQFollowUpDeepDiveModal).mock.lastCall?.[0] as { onClose: () => void };
    deepDive.onClose();
    expect(setDeepDiveModalOpen).toHaveBeenCalledWith(false);
  });

});
