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

  test('opens checkout at the 12-month price the pricing API returns and reads the download balance from the backend', async () => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue({
      seller: {
        connect: { '12_months': { totalWithGst: 2000.7, baseDurationPrice: 1700, gstAmount: 300.7 } },
        select: { '12_months': { totalWithGst: 4000.2, baseDurationPrice: 3390, gstAmount: 610.2 } },
      },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.vendorSubscription = 'connect';
    mockApp.vendorFreeCreditsAllocated = 50;
    mockApp.vendorFreeCreditsUsed = 10;
    mockApp.vendorFreeCreditsRemaining = 40;
    const { container } = render(<VendorSubscriptionCenter />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[style="width: 20%;"]')).toBeInTheDocument();
    expect(screen.getByText('10 / 50')).toBeInTheDocument();
    expect(screen.getByText('40 downloads remaining')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]);
    expect(screen.getByTestId('checkout')).toHaveAttribute('data-plan', 'select');
    expect(screen.getByTestId('checkout')).toHaveAttribute('data-price', '₹4,000');
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actions.cancel }));
    expect(screen.queryByTestId('checkout')).not.toBeInTheDocument();
  });

  test.each([
    ['only a 6-month price is returned', { seller: { select: { '6_months': { totalWithGst: 2000, baseDurationPrice: 1800, gstAmount: 200 } } } }],
    ['no plan prices are returned', { seller: {} }],
  ])('keeps the Select plan blocked, with no invented price, when %s', async (_label, config) => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue(config as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.vendorSubscription = 'connect';
    render(<VendorSubscriptionCenter />);
    await act(async () => { await Promise.resolve(); });
    const selectButton = screen.getByRole('button', { name: 'Switch to Select Model' });
    expect(selectButton).toBeDisabled();
    fireEvent.click(selectButton);
    expect(screen.queryByTestId('checkout')).not.toBeInTheDocument();
  });

  test('shows the pricing error with a retry action, and a retry loads the prices', async () => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValueOnce(null);
    render(<VendorSubscriptionCenter />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(UI_STRINGS.vendorWorkspace.pricesUnavailableNotice));
    expect(screen.getByRole('button', { name: 'Switch to Select Model' })).toBeDisabled();
    jest.mocked(fetchSubscriptionPricing).mockResolvedValueOnce({
      seller: { select: { '12_months': { totalWithGst: 4000, baseDurationPrice: 3390, gstAmount: 610 } } },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.vendorWorkspace.pricesRetryAction }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Switch to Select Model' })).toBeEnabled();
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
    expect(addAuditLog).toHaveBeenCalledWith(expect.stringContaining('Vendor'));
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
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue({
      seller: {
        connect: { '12_months': { totalWithGst: 8849, baseDurationPrice: 7499, gstAmount: 1350 } },
        select: { '12_months': { totalWithGst: 17699, baseDurationPrice: 14999, gstAmount: 2700 } },
      },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.vendorOpportunities = [makeOpportunity()];
    mockApp.vendorSubscription = 'connect';
    mockApp.vendorFreeCreditsRemaining = 0;
    updateVendorSubscription.mockResolvedValue(false);
    render(<OpportunityFeed onNavigateToBidForm={jest.fn()} />);
    fireEvent.click(screen.getByTitle('Download RFQ Technical BOQ Spreadsheet on Email'));
    const selectUpgrade = document.querySelector('button[data-plan="select"]');
    if (!selectUpgrade) throw new Error('Select upgrade action missing');
    // The plan prices load when the dialog opens, and the paid buttons stay disabled until they arrive.
    await waitFor(() => expect(selectUpgrade).toBeEnabled());
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
    expect(addAuditLog).toHaveBeenCalledWith(expect.stringContaining(SESSION.name));
  });

  test('prevents an import exceeding the catalogue limit the pricing API returns', async () => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue({
      seller: { select: { catalogueLimit: 100 } },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.currentUserSession = null;
    mockApp.vendorCatalogue = Array.from({ length: 99 }, (_, index) => ({ id: `${index}`, sku: `ITEM-${index}`, name: 'Existing', category: 'Pumps', specs: '', unitPrice: 1, leadTimeDays: 1, moq: 1 }));
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: true, error: null, rows: [row(), row({ rowNumber: 3, sku: 'IMPORTED-2' })] });
    const { container } = render(<ItemCatalogue />);
    await screen.findByText(UI_STRINGS.vendorWorkspace.catalogueCapacityWithLimit.replace('{limit}', '100'));
    upload(new File(['workbook'], 'catalogue.xlsx'));
    await waitFor(() => expect(parseCatalogueWorkbook).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1));
    const importButton = screen.getByRole('button', { name: /Import Valid Rows/ });
    await act(async () => { fireEvent.click(importButton); });
    expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('1'), 'warning');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('catalogue product limit from the pricing API', () => {
  test('refuses a new product once the limit the pricing API returns is reached', async () => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue({
      seller: { select: { catalogueLimit: 1 } },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.currentUserSession = null;
    mockApp.vendorCatalogue = [{ id: 'only', name: 'Existing', sku: 'EXISTING', category: 'Pumps', specs: '', unitPrice: 1, leadTimeDays: 1, moq: 1 }];
    render(<ItemCatalogue />);
    await screen.findByText(UI_STRINGS.vendorWorkspace.catalogueCapacityWithLimit.replace('{limit}', '1'));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/), { target: { value: 'New item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'NEW-1' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '1' } });
    await act(async () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); });
    expect(showToast).toHaveBeenCalledWith('Limit Reached', UI_STRINGS.vendorWorkspace.catalogueFullMessage, 'warning');
    expect(global.fetch).not.toHaveBeenCalledWith('/api/catalogue', expect.objectContaining({ method: 'POST' }));
  });

  test('shows the capacity without a limit figure when the pricing API returns no limit', () => {
    render(<ItemCatalogue />);
    expect(screen.getByText(UI_STRINGS.vendorWorkspace.catalogueCapacityWithoutLimit)).toBeInTheDocument();
    expect(screen.queryByText(/Limit:/)).not.toBeInTheDocument();
  });
});

describe('catalogue load, save and import failure paths', () => {
  const row = (overrides: Partial<CatalogueUploadRow> = {}): CatalogueUploadRow => ({
    rowNumber: 2, name: 'Imported Item', sku: 'IMPORTED-1', category: 'Engineering Spares - Mechanical',
    specs: '', unitPrice: 100, leadTimeDays: 3, moq: 1, errors: [], ...overrides,
  });
  const product = (overrides: Record<string, unknown> = {}) => ({
    id: 'p-1', name: 'Existing Pump', sku: 'EXISTING-1', category: 'Pumps', specs: '',
    unitPrice: 100, leadTimeDays: 2, moq: 1, ...overrides,
  });

  function fetchReturning(handler: (url: string, options: { method?: string; body?: string }) => unknown) {
    global.fetch = jest.fn((url: string, options: { method?: string; body?: string } = {}) =>
      Promise.resolve(handler(url, options))) as unknown as typeof fetch;
  }

  test('shows a placeholder value for a product whose price, lead time or MOQ is not known', () => {
    mockApp.vendorCatalogue = [product({ unitPrice: null, leadTimeDays: null, moq: null })];
    render(<ItemCatalogue />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    fireEvent.click(screen.getByTitle('Edit Product'));
    expect((screen.getByPlaceholderText('850') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('5') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('10') as HTMLInputElement).value).toBe('');
  });

  test.each([
    [75, 'from-amber-500'],
    [10, 'from-indigo-600'],
  ])('colours the capacity bar for %i of 100 products', (count, colourClass) => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue({
      seller: { select: { catalogueLimit: 100 } },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.vendorCatalogue = Array.from({ length: count }, (_, index) => product({ id: `c-${index}`, sku: `SKU-${index}` }));
    const { container } = render(<ItemCatalogue />);
    return waitFor(() => expect(container.querySelector(`.${colourClass}`)).toBeInTheDocument());
  });

  test('loads the catalogue for the vendor and reports the failure when the vendor record cannot be read', async () => {
    mockApp.currentUserSession = SESSION;
    fetchReturning(() => ({ ok: false, status: 500, json: async () => ({ success: false }) }));
    render(<ItemCatalogue />);
    expect(await screen.findByText(UI_STRINGS.vendorWorkspace.catalogueUnavailable)).toBeInTheDocument();
  });

  test('shows an empty catalogue when the vendor has no profile yet', async () => {
    fetchReturning(() => ({ ok: false, status: 404, json: async () => ({ success: false }) }));
    render(<ItemCatalogue />);
    await waitFor(() => expect(setVendorCatalogue).toHaveBeenCalledWith([]));
    expect(screen.queryByText(UI_STRINGS.vendorWorkspace.catalogueUnavailable)).not.toBeInTheDocument();
  });

  test('shows an empty catalogue when the vendor record has no id', async () => {
    fetchReturning((url) => (url.startsWith('/api/vendors/')
      ? { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
      : { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }));
    render(<ItemCatalogue />);
    await waitFor(() => expect(setVendorCatalogue).toHaveBeenCalledWith([]));
  });

  test('reports an unreadable catalogue, and keeps an empty list when the catalogue response has no data', async () => {
    fetchReturning((url) => (url.startsWith('/api/vendors/')
      ? { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'v-1' } }) }
      : { ok: false, status: 503, json: async () => ({ success: false }) }));
    const { unmount } = render(<ItemCatalogue />);
    expect(await screen.findByText(UI_STRINGS.vendorWorkspace.catalogueUnavailable)).toBeInTheDocument();
    unmount();

    fetchReturning((url) => (url.startsWith('/api/vendors/')
      ? { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'v-1' } }) }
      : { ok: true, status: 200, json: async () => ({ success: true }) }));
    render(<ItemCatalogue />);
    await waitFor(() => expect(setVendorCatalogue).toHaveBeenCalledWith([]));
  });

  test('ignores a catalogue load that finishes after the page has closed', async () => {
    fetchReturning((url) => (url.startsWith('/api/vendors/')
      ? { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'v-1' } }) }
      : { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }));
    const { unmount } = render(<ItemCatalogue />);
    unmount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(setVendorCatalogue).not.toHaveBeenCalledWith([]);
  });

  test('reports a failed save with the server reason, and with default wording when there is no reason', async () => {
    mockApp.vendorCatalogue = [product()];
    fetchReturning(() => ({ ok: true, status: 200, json: async () => ({ success: false }) }));
    render(<ItemCatalogue />);
    fireEvent.click(screen.getByTitle('Edit Product'));
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Save Failed', 'Failed to update product.', 'warning'));

    jest.clearAllMocks();
    fetchReturning(() => Promise.reject('network down'));
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Save Failed', 'Could not save the product. Please try again.', 'warning'));
  });

  test('reports a failed add with the server reason', async () => {
    mockApp.vendorCatalogue = [];
    fetchReturning(() => ({ ok: true, status: 200, json: async () => ({ success: false }) }));
    render(<ItemCatalogue />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/), { target: { value: 'New item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'NEW-2' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '1' } });
    await act(async () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Save Failed', 'Failed to add product.', 'warning'));
  });

  test('reports a failed delete with the server reason, and with default wording when there is no reason', async () => {
    mockApp.vendorCatalogue = [product()];
    fetchReturning(() => ({ ok: true, status: 200, json: async () => ({ success: false }) }));
    render(<ItemCatalogue />);
    fireEvent.click(screen.getByTitle('Delete Product'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Delete Failed', 'Failed to delete product.', 'warning'));

    jest.clearAllMocks();
    fetchReturning(() => Promise.reject('offline'));
    fireEvent.click(screen.getByTitle('Delete Product'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Delete Failed', 'Could not delete the product. Please try again.', 'warning'));
  });

  test('imports a workbook that fits the limit, skips a failed row with default wording, and reports it', async () => {
    jest.mocked(fetchSubscriptionPricing).mockResolvedValue({
      seller: { select: { catalogueLimit: 100 } },
    } as unknown as Awaited<ReturnType<typeof fetchSubscriptionPricing>>);
    mockApp.currentUserSession = null;
    mockApp.vendorCatalogue = [product()];
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: true, error: null, rows: [
      row({ sku: 'FITS-1' }), row({ rowNumber: 3, sku: 'FAILS-2' }),
    ] });
    fetchReturning((_url, options) => (options.body && options.body.includes('FAILS-2')
      ? { ok: true, status: 200, json: async () => ({ success: false }) }
      : { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'new-1', sku: 'FITS-1' } }) }));
    const { container } = render(<ItemCatalogue />);
    await screen.findByText(UI_STRINGS.vendorWorkspace.catalogueCapacityWithLimit.replace('{limit}', '100'));
    fireEvent.change(screen.getByLabelText('Upload catalogue Excel workbook'), { target: { files: [new File(['w'], 'catalogue.xlsx')] } });
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Import Valid Rows/ })); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Import Partially Completed', expect.stringContaining('Row 3: Import failed.'), 'warning'));
  });

  test('stops with a notice when no row in the workbook is valid', async () => {
    mockApp.currentUserSession = null;
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: true, error: null, rows: [row({ errors: ['Missing name.'] })] });
    const { container } = render(<ItemCatalogue />);
    fireEvent.change(screen.getByLabelText('Upload catalogue Excel workbook'), { target: { files: [new File(['w'], 'catalogue.xlsx')] } });
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Import Valid Rows/ })); });
    expect(showToast).toHaveBeenCalledWith('Nothing to Import', 'Fix the validation errors before importing.', 'warning');
  });

  test('reports an import that fails before the server answers, with default wording', async () => {
    mockApp.currentUserSession = null;
    jest.mocked(parseCatalogueWorkbook).mockReturnValue({ success: true, error: null, rows: [row()] });
    fetchReturning(() => Promise.reject('timeout'));
    const { container } = render(<ItemCatalogue />);
    fireEvent.change(screen.getByLabelText('Upload catalogue Excel workbook'), { target: { files: [new File(['w'], 'catalogue.xlsx')] } });
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Import Valid Rows/ })); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Import Failed', 'Could not complete the catalogue import.', 'warning'));
  });

  test('shows a category group with no minor categories without failing', () => {
    mockApp.categoryTaxonomy = [{ majorCategory: 'Solo Group' }] as unknown as ReturnType<typeof useApp>['categoryTaxonomy'];
    render(<ItemCatalogue />);
    expect(screen.getByRole('option', { name: 'Solo Group' })).toBeInTheDocument();
  });
});
