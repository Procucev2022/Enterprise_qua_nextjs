import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VendorSubscriptionCenter from '@/app/vendor/vendor-subscription';
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import ItemCatalogue from '@/app/vendor/item-catalogue';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { fetchSubscriptionPricing } from '@/lib/subscriptionPaymentClient';
import { parseCatalogueWorkbook, type CatalogueUploadRow } from '@/lib/catalogueUploadClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { VendorOpportunity } from '@/lib/types';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/subscriptionPaymentClient', () => ({ fetchSubscriptionPricing: jest.fn() }));
jest.mock('@/lib/catalogueUploadClient', () => ({
  parseCatalogueWorkbook: jest.fn(),
  downloadCatalogueTemplate: jest.fn(),
}));
jest.mock('@/lib/authClient', () => ({
  authClient: { getSessionUser: jest.fn(), getToken: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/app/components/Modals', () => ({
  SubscriptionPaymentModal: ({ isOpen, onClose, planId, price }: {
    isOpen: boolean; onClose: () => void; planId: string; price: string;
  }) => isOpen ? (
    <div data-testid="checkout" data-plan={planId} data-price={price}>
      <button onClick={onClose}>{UI_STRINGS.actions.cancel}</button>
    </div>
  ) : null,
}));

const SESSION = {
  id: 'vendor-remaining', email: 'vendor@remaining.test', name: 'Remaining Vendor',
  role: 'vendor' as const, orgId: 'org-remaining', orgName: 'Remaining Supplies',
};
const makeOpportunity = (overrides: Partial<VendorOpportunity> = {}): VendorOpportunity => ({
  id: 'opp-direct', type: 'direct_invitation', rfqNumber: 'RFQ/REMAINING 1',
  title: 'Industrial Pump', buyer: 'Buyer Company', deadline: '2027-01-01',
  deliveryLocation: 'Pune / Maharashtra', estimatedValue: '1000', status: 'Open',
  ...overrides,
} as VendorOpportunity);

const showToast = jest.fn();
const addAuditLog = jest.fn();
const updateVendorSubscription = jest.fn();
const refreshFromDB = jest.fn();
const checkVendorPaymentLinkStatus = jest.fn();
const refreshVendorCredits = jest.fn();
const setVendorCatalogue = jest.fn();
let mockApp: Partial<ReturnType<typeof useApp>>;

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/vendor/vendor-subscription');
  mockApp = {
    vendorSubscription: 'premium', vendorRfqDownloadsUsed: 0, vendorCatalogue: [],
    vendorOpportunities: [], vendorFreeCreditsRemaining: 5, vendorUnlockedRfqIds: [],
    buyerVendors: [], currentUserSession: SESSION, categoryTaxonomy: CATEGORY_TAXONOMY_FIXTURE,
    showToast, addAuditLog, updateVendorSubscription, refreshFromDB,
    checkVendorPaymentLinkStatus, refreshVendorCredits, setVendorCatalogue,
    createVendorPaymentLink: jest.fn(), setVendorRfqDownloadsUsed: jest.fn(),
  };
  jest.mocked(useApp).mockImplementation(() => mockApp as ReturnType<typeof useApp>);
  jest.mocked(authClient.getSessionUser).mockReturnValue(SESSION);
  jest.mocked(authClient.getToken).mockReturnValue(null);
  jest.mocked(fetchSubscriptionPricing).mockResolvedValue(null);
  updateVendorSubscription.mockResolvedValue(true);
  refreshFromDB.mockResolvedValue(undefined);
  refreshVendorCredits.mockResolvedValue(undefined);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  jest.restoreAllMocks();
});

describe('vendor subscription pricing and payment reconciliation', () => {
  test.each(['PAID', 'CANCELED', 'EXPIRED', 'CREATED', null])('reconciles %s once and removes only the payment query parameter', async (status) => {
    window.history.replaceState(null, '', '/vendor/vendor-subscription?linkId=link-1&ref=email');
    mockApp.buyerVendors = [{ id: 'vendor-1', email: SESSION.email.toUpperCase() }] as ReturnType<typeof useApp>['buyerVendors'];
    checkVendorPaymentLinkStatus.mockResolvedValue(status);
    const { rerender } = render(<VendorSubscriptionCenter />);
    await waitFor(() => expect(checkVendorPaymentLinkStatus).toHaveBeenCalledWith('link-1'));
    await waitFor(() => expect(window.location.search).toBe('?ref=email'));
    expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.any(String), status === 'PAID' ? 'success' : status === 'EXPIRED' ? 'warning' : 'info');
    expect(refreshFromDB).toHaveBeenCalledTimes(status === 'PAID' || status === 'CREATED' || status === null ? 1 : 0);
    mockApp.buyerVendors = [...(mockApp.buyerVendors || [])];
    rerender(<VendorSubscriptionCenter />);
    expect(checkVendorPaymentLinkStatus).toHaveBeenCalledTimes(1);
  });

  test('waits for this vendor to load before reconciling a payment', async () => {
    window.history.replaceState(null, '', '/vendor/vendor-subscription?linkId=link-2');
    jest.mocked(authClient.getSessionUser).mockReturnValue(null);
    const { rerender } = render(<VendorSubscriptionCenter />);
    expect(checkVendorPaymentLinkStatus).not.toHaveBeenCalled();
    jest.mocked(authClient.getSessionUser).mockReturnValue(SESSION);
    mockApp.buyerVendors = [{ id: 'other' }, { id: 'vendor-1', email: SESSION.email }] as ReturnType<typeof useApp>['buyerVendors'];
    checkVendorPaymentLinkStatus.mockResolvedValue('EXPIRED');
    rerender(<VendorSubscriptionCenter />);
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(checkVendorPaymentLinkStatus).toHaveBeenCalledTimes(1);
  });

  test.each([
    { seller: { connect: { '12_months': { totalWithGst: 2000.7 } }, select: { '12_months': { totalWithGst: 4000.2 } } } },
    { seller: { connect: { '6_months': { totalWithGst: 1000 } }, select: { '6_months': { totalWithGst: 2000 } } } },
    { seller: {} },
  ])('uses configured subscription pricing with safe missing-plan fallbacks: %p', async (config) => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue(config as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.vendorSubscription = 'connect';
    mockApp.vendorRfqDownloadsUsed = 10;
    const { container } = render(<VendorSubscriptionCenter />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[style="width: 20%;"]')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]);
    const selectData = ('select' in config.seller ? config.seller.select : undefined);
    const amount = selectData?.['12_months']?.totalWithGst ?? selectData?.['6_months']?.totalWithGst;
    expect(screen.getByTestId('checkout')).toHaveAttribute('data-plan', 'select');
    expect(screen.getByTestId('checkout')).toHaveAttribute('data-price', amount ? `₹${Math.round(amount).toLocaleString('en-IN')}` : '₹14,999');
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actions.cancel }));
    expect(screen.queryByTestId('checkout')).not.toBeInTheDocument();
  });

  test('ignores a late pricing response after unmount', async () => {
    let resolvePricing: (value: Awaited<ReturnType<typeof fetchSubscriptionPricing>>) => void = () => undefined;
    jest.mocked(fetchSubscriptionPricing).mockReturnValue(new Promise((resolve) => { resolvePricing = resolve; }));
    const { unmount } = render(<VendorSubscriptionCenter />);
    unmount();
    await act(async () => { resolvePricing({ seller: {} } as Awaited<ReturnType<typeof fetchSubscriptionPricing>>); });
    expect(showToast).not.toHaveBeenCalled();
  });

  test('does not announce a rejected subscription change and records a confirmed free-plan change', async () => {
    mockApp.vendorSubscription = 'select';
    mockApp.currentUserSession = null;
    updateVendorSubscription.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<VendorSubscriptionCenter />);
    const premiumButton = screen.getAllByRole('button')[0];
    await act(async () => { fireEvent.click(premiumButton); });
    expect(showToast).not.toHaveBeenCalled();
    expect(addAuditLog).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(premiumButton); });
    expect(updateVendorSubscription).toHaveBeenNthCalledWith(2, 'premium');
    expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'success');
    expect(addAuditLog).toHaveBeenCalledWith(expect.stringContaining('Vendor'), undefined, undefined);
  });
});

describe('opportunity feed navigation, matching and access failures', () => {
  test('opens both direct and network RFQ details and quotation forms', async () => {
    mockApp.vendorSubscription = 'select';
    mockApp.vendorOpportunities = [makeOpportunity(), makeOpportunity({ id: 'opp-network', type: 'network_marketplace', rfqNumber: 'NETWORK/2' })];
    render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    const details = screen.getAllByTitle('View RFQ Details');
    const quoteButtons = screen.getAllByTitle('Submit Detailed Quotation');
    details.forEach((button) => fireEvent.click(button));
    quoteButtons.forEach((button) => fireEvent.click(button));
    expect(mockPush.mock.calls).toEqual([
      ['/vendor/rfq-details?rfq=RFQ%2FREMAINING%201'], ['/vendor/rfq-details?rfq=NETWORK%2F2'],
      ['/vendor/quotation-form?rfq=RFQ%2FREMAINING%201'], ['/vendor/quotation-form?rfq=NETWORK%2F2'],
    ]);
    await act(async () => { await Promise.resolve(); });
  });

  test('renders closed and expired cards without quotation actions in both sections', async () => {
    mockApp.vendorOpportunities = (['Closed', 'Expired'] as const).flatMap((status) => [
      makeOpportunity({ id: `direct-${status}`, status }),
      makeOpportunity({ id: `network-${status}`, type: 'network_marketplace', status }),
    ]);
    render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    expect(screen.queryByTitle('Submit Detailed Quotation')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('View RFQ Details')).toHaveLength(4);
    await act(async () => { await Promise.resolve(); });
  });

  test('matches a real vendor minor category and buyer account relationship', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {
      majorCategory: 'Another Category', minorCategories: [' precision valves '], buyerAccountId: 'buyer-account',
    } }) });
    mockApp.vendorOpportunities = [makeOpportunity({ majorCategory: 'Mechanical', minorCategory: 'Precision Valves', buyerAccountId: 'buyer-account' })];
    const { container } = render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    await waitFor(() => expect(container.querySelector('.border-emerald-300')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Upgrade$/ })).not.toBeInTheDocument();
  });

  test.each([
    { status: 403, body: { success: false } },
    { status: 400, body: { success: false, exhausted: true, error: 'Credits depleted' } },
    { status: 500, body: { success: false } },
  ])('shows the server access failure without consuming local quota: %p', async ({ status, body }) => {
    mockApp.vendorSubscription = 'select';
    mockApp.vendorOpportunities = [makeOpportunity({ type: 'network_marketplace' })];
    global.fetch = jest.fn().mockImplementation((url: string) => Promise.resolve({
      ok: !url.endsWith('/download'), status, json: async () => url.endsWith('/download') ? body : { success: true, data: {} },
    }));
    render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTitle('Download RFQ Technical BOQ Spreadsheet on Email')); });
    expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'warning');
    expect(refreshVendorCredits).not.toHaveBeenCalled();
    expect(refreshFromDB).not.toHaveBeenCalled();
  });

  test('allows a buyer-id roster match to download with no authentication token', async () => {
    mockApp.currentUserSession = { ...SESSION, orgName: '', name: 'Named Vendor' };
    mockApp.buyerVendors = [{ id: 'v', email: SESSION.email, buyerId: 'buyer-id' }] as ReturnType<typeof useApp>['buyerVendors'];
    mockApp.vendorOpportunities = [makeOpportunity({ type: 'network_marketplace', buyerAccountId: 'buyer-id' })];
    global.fetch = jest.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true, json: async () => ({ success: true, data: url.endsWith('/download') ? {} : {} }),
    }));
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTitle('Download RFQ Technical BOQ Spreadsheet on Email')); });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/download'), expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }));
    expect(refreshVendorCredits).toHaveBeenCalledTimes(1);
    expect(refreshFromDB).not.toHaveBeenCalled();
  });

  test('lets a vendor close a paid upgrade checkout and rejects an unsuccessful free downgrade', async () => {
    mockApp.vendorOpportunities = [makeOpportunity()];
    mockApp.vendorSubscription = 'connect';
    mockApp.vendorRfqDownloadsUsed = 50;
    updateVendorSubscription.mockResolvedValue(false);
    render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    fireEvent.click(screen.getByTitle('Download RFQ Technical BOQ Spreadsheet on Email'));
    const selectUpgrade = document.querySelector('button[data-plan="select"]');
    if (!selectUpgrade) throw new Error('Select upgrade action missing');
    fireEvent.click(selectUpgrade);
    expect(screen.getByTestId('checkout')).toHaveAttribute('data-plan', 'select');
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actions.cancel }));
    expect(screen.queryByTestId('checkout')).not.toBeInTheDocument();
    const premiumUpgrade = document.querySelector('button[data-plan="premium"]');
    if (!premiumUpgrade) throw new Error('Premium plan action missing');
    await act(async () => { fireEvent.click(premiumUpgrade); });
    expect(updateVendorSubscription).toHaveBeenCalledWith('premium');
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});

describe('catalogue workbook preview validation', () => {
  const row = (overrides: Partial<CatalogueUploadRow> = {}): CatalogueUploadRow => ({
    rowNumber: 2, name: 'Imported Item', sku: 'IMPORTED-1', category: 'Engineering Spares - Mechanical',
    specs: '', unitPrice: 100, leadTimeDays: 3, moq: 1, errors: [], ...overrides,
  });

  function upload(file?: File) {
    fireEvent.change(screen.getByLabelText('Upload catalogue Excel workbook'), { target: { files: file ? [file] : [] } });
  }

  test('rejects missing, unsupported and oversized workbook selections before parsing', () => {
    mockApp.currentUserSession = null;
    render(<ItemCatalogue />);
    upload();
    expect(showToast).not.toHaveBeenCalled();
    upload(new File(['csv'], 'catalogue.csv'));
    const oversized = new File(['xlsx'], 'catalogue.xlsx');
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });
    upload(oversized);
    expect(parseCatalogueWorkbook).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast.mock.calls.every((call) => call[2] === 'warning')).toBe(true);
  });

  test('reports parser and file-reader failures without showing a stale preview', async () => {
    mockApp.currentUserSession = null;
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: false, rows: [], error: 'Invalid workbook header' });
    render(<ItemCatalogue />);
    upload(new File(['invalid'], 'catalogue.xlsx'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), 'Invalid workbook header', 'warning'));
    jest.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });
    upload(new File(['unreadable'], 'catalogue.xlsx'));
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  test('marks existing and duplicate SKUs while importing only valid rows', async () => {
    mockApp.currentUserSession = { ...SESSION, orgName: '' };
    mockApp.vendorCatalogue = [{ id: 'existing', name: 'Existing', sku: 'EXISTING', category: 'Pumps', specs: '', unitPrice: 1, leadTimeDays: 1, moq: 1 }];
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: true, error: null, rows: [
      row({ sku: 'existing' }), row({ rowNumber: 3, sku: 'New' }), row({ rowNumber: 4, sku: 'NEW' }),
      row({ rowNumber: 5, sku: '' }), row({ rowNumber: 6, sku: 'New', errors: ['SKU is duplicated in this workbook.'] }),
    ] });
    const { container } = render(<ItemCatalogue />);
    upload(new File(['workbook'], 'catalogue.xlsx'));
    await waitFor(() => expect(parseCatalogueWorkbook).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1));
    const importButton = screen.getByRole('button', { name: /Import Valid Rows/ });
    await act(async () => { fireEvent.click(importButton); });
    expect(global.fetch).toHaveBeenCalledWith('/api/catalogue', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"sku":"New"') }));
    expect(addAuditLog).toHaveBeenCalledWith(expect.stringContaining(SESSION.name), undefined, SESSION.email);
  });

  test('prevents an import exceeding available catalogue capacity', async () => {
    mockApp.currentUserSession = null;
    mockApp.vendorCatalogue = Array.from({ length: 99 }, (_, index) => ({ id: `${index}`, sku: `ITEM-${index}`, name: 'Existing', category: 'Pumps', specs: '', unitPrice: 1, leadTimeDays: 1, moq: 1 }));
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: true, error: null, rows: [row(), row({ rowNumber: 3, sku: 'IMPORTED-2' })] });
    const { container } = render(<ItemCatalogue />);
    upload(new File(['workbook'], 'catalogue.xlsx'));
    await waitFor(() => expect(parseCatalogueWorkbook).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1));
    const importButton = screen.getByRole('button', { name: /Import Valid Rows/ });
    await act(async () => { fireEvent.click(importButton); });
    expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('1'), 'warning');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
