import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorQuotationFormPage from '@/app/vendor/quotation-form/page';
import QuotationForm from '@/app/vendor/quotation-form';
import { useApp } from '@/lib/store';
import type { ExtractedEntity, RFQItem, VendorOpportunity } from '@/lib/types';

const mockRouterPush = jest.fn();
const mockRefreshRFQs = jest.fn();
let mockSearchParams = new Map<string, string>();

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => ({ get: (key: string) => mockSearchParams.get(key) || null }),
}));

jest.mock('@/app/vendor/quotation-form', () => {
  return jest.fn(function MockQuotationForm({ opportunity, onBack, onSubmitSuccess }: React.ComponentProps<typeof import('@/app/vendor/quotation-form').default>) {
    return (
      <div data-testid="mock-quotation-form">
        <span data-testid="opp-title">{opportunity?.title}</span>
        <span data-testid="opp-type">{opportunity?.type}</span>
        <span data-testid="opp-status">{opportunity?.status}</span>
        <span data-testid="opp-buyer">{opportunity?.buyer}</span>
        <span data-testid="opp-est-val">{opportunity?.estimatedValue || 'no-est-val'}</span>
        <button data-testid="back-btn" onClick={onBack}>Back</button>
        <button data-testid="submit-btn" onClick={onSubmitSuccess}>Submit</button>
      </div>
    );
  });
});

function makeRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'rfq-1', rfqNumber: 'RFQ-2026-001', title: 'Centrifugal Pump Unit',
    category: 'Mechanical', sourcingMode: 'mode_1', status: 'Quotes Pending',
    quotesCount: 0, quotes: [], targetDeliveryDate: '2026-09-15', budget: 150000,
    createdAt: '2026-09-01', chasingActive: false, extractedEntities: [],
    ...overrides,
  };
}

function setStore(overrides: Partial<ReturnType<typeof useApp>> = {}) {
  jest.mocked(useApp).mockReturnValue({
    selectedVendorOpportunity: null, vendorOpportunities: [], rfqs: [],
    refreshRFQs: mockRefreshRFQs, isLoadingDB: false,
    ...overrides,
  } as ReturnType<typeof useApp>);
}

function renderedOpportunity() {
  return jest.mocked(QuotationForm).mock.calls.at(-1)?.[0].opportunity;
}

describe('VendorQuotationFormPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new Map();
    mockRefreshRFQs.mockResolvedValue(undefined);
    setStore();
  });

  test('renders the empty state and requests RFQs when no opportunity exists', () => {
    render(<VendorQuotationFormPage />);
    expect(screen.getByText(/No open opportunity is available to quote on right now/i)).toBeInTheDocument();
    expect(mockRefreshRFQs).toHaveBeenCalledTimes(1);
  });

  test('resolves the requested RFQ with its stated budget, buyer and pending bid status', () => {
    mockSearchParams.set('rfq', 'RFQ-2026-001');
    setStore({ rfqs: [makeRFQ({ buyerAccountName: 'L&T Ltd', deliveryLocation: 'Mumbai' })] });
    render(<VendorQuotationFormPage />);
    expect(screen.getByTestId('opp-title')).toHaveTextContent('Centrifugal Pump Unit');
    expect(screen.getByTestId('opp-type')).toHaveTextContent('direct_invitation');
    expect(screen.getByTestId('opp-status')).toHaveTextContent('pending_bid');
    expect(screen.getByTestId('opp-buyer')).toHaveTextContent('L&T Ltd');
    expect(screen.getByTestId('opp-est-val')).toHaveTextContent(`₹${(150000).toLocaleString('en-IN')}`);
    fireEvent.click(screen.getByTestId('back-btn'));
    expect(mockRouterPush).toHaveBeenCalledWith('/vendor/opportunity-feed');
    fireEvent.click(screen.getByTestId('submit-btn'));
    expect(mockRouterPush).toHaveBeenCalledWith('/vendor/quotation-form');
  });

  test('resolves an id parameter while preserving a closed marketplace RFQ and its unstated budget', () => {
    mockSearchParams.set('id', 'RFQ-MODE-3');
    setStore({ rfqs: [makeRFQ({
      id: 'rfq-m3', rfqNumber: 'RFQ-MODE-3', title: 'Marketplace Screws',
      sourcingMode: 'mode_3', status: 'Closed', budget: 0,
    })] });
    render(<VendorQuotationFormPage />);
    expect(screen.getByTestId('opp-title')).toHaveTextContent('Marketplace Screws');
    expect(screen.getByTestId('opp-type')).toHaveTextContent('network_marketplace');
    expect(screen.getByTestId('opp-status')).toHaveTextContent('Closed');
    expect(screen.getByTestId('opp-buyer')).toHaveTextContent('Buyer enterprise');
    expect(screen.getByTestId('opp-est-val')).toHaveTextContent('no-est-val');
  });

  test('marks an RFQ with existing quotes as under review', () => {
    mockSearchParams.set('rfq', 'RFQ-QUOTES-1');
    setStore({ rfqs: [makeRFQ({
      rfqNumber: 'RFQ-QUOTES-1', title: 'Valves Package',
      quotes: [{ vendorId: 'v-1' } as RFQItem['quotes'][number]],
    })] });
    render(<VendorQuotationFormPage />);
    expect(screen.getByTestId('opp-title')).toHaveTextContent('Valves Package');
    expect(screen.getByTestId('opp-status')).toHaveTextContent('under_review');
  });

  test('uses the selected opportunity and does not refresh a populated opportunity list', () => {
    const opportunity = {
      id: 'opp-selected-1', rfqNumber: 'RFQ-SEL-1', title: 'Direct Selected Opp',
      type: 'direct_invitation', status: 'pending_bid', buyer: 'Selected Buyer Corp',
    } as VendorOpportunity;
    setStore({ selectedVendorOpportunity: opportunity, vendorOpportunities: [opportunity] });
    render(<VendorQuotationFormPage />);
    expect(screen.getByTestId('opp-title')).toHaveTextContent(opportunity.title);
    expect(mockRefreshRFQs).not.toHaveBeenCalled();
  });

  test('prefers an open RFQ when deriving an opportunity without a requested RFQ', () => {
    setStore({ rfqs: [
      makeRFQ({ id: 'rfq-expired-1', rfqNumber: 'RFQ-EXP-1', title: 'Expired RFQ', status: 'Expired' }),
      makeRFQ({ id: 'rfq-active-1', rfqNumber: 'RFQ-ACT-1', title: 'Active Open RFQ' }),
    ] });
    render(<VendorQuotationFormPage />);
    expect(screen.getByTestId('opp-title')).toHaveTextContent('Active Open RFQ');
    expect(screen.getByTestId('opp-status')).toHaveTextContent('pending_bid');
  });

  test('retains the closed status when only closed RFQs are available', () => {
    setStore({ rfqs: [makeRFQ({ title: 'Only Closed RFQ', status: 'Closed' })] });
    render(<VendorQuotationFormPage />);
    expect(screen.getByTestId('opp-title')).toHaveTextContent('Only Closed RFQ');
    expect(screen.getByTestId('opp-status')).toHaveTextContent('Closed');
  });

  test.each([['rfq', 'RFQ-TARGET'], ['id', 'opp-target']])('uses a requested opportunity matched through %s ahead of the selected opportunity', (parameter, value) => {
    const selected = { id: 'opp-selected', rfqNumber: 'RFQ-SELECTED', title: 'Previously selected' } as VendorOpportunity;
    const requested = { id: 'opp-target', rfqNumber: 'RFQ-TARGET', title: 'Requested opportunity' } as VendorOpportunity;
    mockSearchParams.set(parameter, value);
    setStore({
      selectedVendorOpportunity: selected,
      vendorOpportunities: [selected, requested],
      rfqs: [makeRFQ({ rfqNumber: requested.rfqNumber, title: 'Raw RFQ must not replace the existing opportunity' })],
    });
    render(<VendorQuotationFormPage />);
    expect(renderedOpportunity()).toBe(requested);
    expect(mockRefreshRFQs).not.toHaveBeenCalled();
  });

  test('gives the rfq query parameter precedence when id points at a different opportunity', () => {
    const requested = { id: 'opp-requested', rfqNumber: 'RFQ-REQUESTED', title: 'Requested RFQ' } as VendorOpportunity;
    const other = { id: 'opp-other', rfqNumber: 'RFQ-OTHER', title: 'Other opportunity' } as VendorOpportunity;
    mockSearchParams.set('rfq', requested.rfqNumber);
    mockSearchParams.set('id', other.id);
    setStore({ selectedVendorOpportunity: other, vendorOpportunities: [other, requested] });
    render(<VendorQuotationFormPage />);
    expect(renderedOpportunity()).toBe(requested);
  });

  test('retains the selected opportunity when a requested RFQ is unavailable', () => {
    const selected = { id: 'opp-selected', rfqNumber: 'RFQ-SELECTED', title: 'Selected available opportunity' } as VendorOpportunity;
    const other = { id: 'opp-other', rfqNumber: 'RFQ-OTHER', title: 'Other available opportunity' } as VendorOpportunity;
    mockSearchParams.set('rfq', 'RFQ-MISSING');
    setStore({ selectedVendorOpportunity: selected, vendorOpportunities: [other, selected], rfqs: [makeRFQ()] });
    render(<VendorQuotationFormPage />);
    expect(renderedOpportunity()).toBe(selected);
  });

  test('uses the first opportunity when there is no requested or selected opportunity', () => {
    const first = { id: 'opp-first', rfqNumber: 'RFQ-FIRST', title: 'First available opportunity' } as VendorOpportunity;
    setStore({ vendorOpportunities: [first], rfqs: [makeRFQ()] });
    render(<VendorQuotationFormPage />);
    expect(renderedOpportunity()).toBe(first);
  });

  test.each(['requested', 'default'])('maps RFQ line items and preserves purchase details on the %s route', (route) => {
    const line: ExtractedEntity = {
      id: 'line-pump', itemName: 'Industrial Pump', quantity: 2, unit: 'Each',
      technicalSpecs: 'SS316', targetDate: '2026-12-01', confidence: 95,
      category: 'Pumps', majorCategory: 'Mechanical', minorCategory: 'Pumps',
    };
    const rfq = makeRFQ({
      id: 'rfq-lines', rfqNumber: 'RFQ-LINES', title: 'Pump and valve package',
      buyerAccountName: 'Industrial Buyer', deliveryLocation: 'Delhi Plant',
      category: 'Mechanical', targetDeliveryDate: '2026-12-01', sourcingMode: 'mode_3',
      quotes: [{ vendorId: 'existing-quote' } as RFQItem['quotes'][number]],
      extractedEntities: [line, { ...line, id: '', itemName: 'Isolation Valve', quantity: 3 }],
    });
    if (route === 'requested') mockSearchParams.set('id', rfq.id);
    setStore({ rfqs: [rfq] });
    render(<VendorQuotationFormPage />);
    expect(renderedOpportunity()).toMatchObject({
      id: 'opp-rfq-lines', rfqNumber: rfq.rfqNumber, title: rfq.title,
      buyer: 'Industrial Buyer', deadline: '2026-12-01', deliveryLocation: 'Delhi Plant',
      majorCategory: 'Mechanical', minorCategory: 'Pumps',
      type: 'network_marketplace', status: 'under_review',
      estimatedValue: `₹${rfq.budget.toLocaleString('en-IN')}`,
      lineItems: [
        { id: 'line-pump', description: 'Industrial Pump', quantity: 2, unitPrice: 0, leadTimeDays: 0, marketBandStatus: 'optimal', paymentTerms: '' },
        { id: 'item-1', description: 'Isolation Valve', quantity: 3, unitPrice: 0, leadTimeDays: 0, marketBandStatus: 'optimal', paymentTerms: '' },
      ],
    });
  });

  test.each(['requested', 'default'])('preserves an expired RFQ on the %s route', (route) => {
    const rfq = makeRFQ({
      id: 'rfq-expired', rfqNumber: 'RFQ-EXPIRED', status: 'Expired',
      targetDeliveryDate: '', category: '', budget: 0,
    });
    if (route === 'requested') mockSearchParams.set('id', rfq.id);
    setStore({ rfqs: [rfq] });
    render(<VendorQuotationFormPage />);
    expect(renderedOpportunity()).toMatchObject({
      status: 'Expired', deadline: '', buyer: 'Buyer enterprise',
      majorCategory: '', minorCategory: '', deliveryLocation: '', lineItems: [],
    });
  });
});
