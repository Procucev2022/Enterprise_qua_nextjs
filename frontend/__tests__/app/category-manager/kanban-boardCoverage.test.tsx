import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import KanbanBoard from '@/app/category-manager/kanban-board';
import { RFQEditModal } from '@/app/buyer/RFQEditModal';
import * as storeModule from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

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

function mockApp(rfqs: RFQItem[]) {
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

  it('allows reviewing a quoted RFQ when no matrix navigation handler is installed', () => {
    const rfq = makeRfq({ quotesCount: 1 });
    mockApp([rfq]);
    render(<KanbanBoard />);

    fireEvent.click(screen.getByRole('button', { name: /RFQs In Pipeline/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Matrix/i }));
    expect(jest.mocked(RFQEditModal).mock.lastCall?.[0]).toEqual(expect.objectContaining({ rfq }));
  });
});
