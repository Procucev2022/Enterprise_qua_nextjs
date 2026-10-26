import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VendorConsole, { classifyVendorSource, isBuyerOrSelfOnboardedVendor, isProcucevNetworkVendor } from '@/app/category-manager/vendor-console';
import { useApp } from '@/lib/store';
import { fetchAllVendors } from '@/lib/rfqClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { getMajorCategories } from '@/lib/categoryTaxonomy';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/rfqClient', () => ({ fetchAllVendors: jest.fn() }));
jest.mock('@/lib/buyerProfileClient', () => ({ fetchCategoryTaxonomy: jest.fn() }));
jest.mock('@/lib/categoryTaxonomy', () => ({ getMajorCategories: jest.fn() }));

const candidate: RFQVendorCandidate = {
  id: 'network-vendor', name: 'Acme', contactPerson: 'Network Contact', email: 'acme@example.com',
  phone: '9876543210', majorCategory: 'Cables', minorCategories: [], location: 'Pune',
  rating: 4.5, source: 'procucev_network', alreadyInvited: false,
};
const page = (candidates: RFQVendorCandidate[], pageNumber = 1, totalPages = 1) => ({
  success: true, candidates,
  pagination: { page: pageNumber, pageSize: 20, total: candidates.length, totalPages },
});
const rfq: RFQItem = {
  id: 'console-rfq', rfqNumber: 'RFQ-CONSOLE', title: 'Console RFQ', category: 'Cables',
  sourcingMode: 'mode_1', status: 'PO Generated', quotesCount: 1,
  targetDeliveryDate: '2026-12-01', budget: 2000, createdAt: '2026-10-01',
  chasingActive: false, extractedEntities: [], awardedVendor: candidate.name, awardedAmount: 1000,
  quotes: [{ vendorId: candidate.id, vendorName: candidate.name, vendorCategory: 'Client List',
    unitPrice: 100, totalPrice: 1000, leadTimeDays: 5, aiMatchScore: 95,
    warrantyYears: 0, complianceStatus: 'Minor Exception', paymentTerms: 'Advance', remarks: 'Quote audit remarks' }],
};

beforeEach(() => {
  jest.resetAllMocks();
  (useApp as jest.Mock).mockReturnValue({ rfqs: [] });
  (getMajorCategories as jest.Mock).mockReturnValue(['Cables', '', '   ']);
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (fetchAllVendors as jest.Mock).mockResolvedValue(page([candidate]));
});

describe('vendor source classification', () => {
  test.each(['self_onboarded', 'self_registration', 'legacy_self_onboard', 'legacy_self_reg'])('recognizes self-registration source %s', (source) => {
    expect(classifyVendorSource({ source }).subType).toBe('self_onboarded');
    expect(isBuyerOrSelfOnboardedVendor({ source })).toBe(true);
    expect(isProcucevNetworkVendor({ source })).toBe(false);
  });

  test.each(['buyer_uploaded', 'vendor_master_ingestion', 'historical_purchase_dump', 'buyer_manual', 'buyer_excel', 'buyer', 'legacy_buyer', 'legacy_ingestion', 'legacy_purchase_dump'])('recognizes buyer import source %s', (source) => {
    expect(classifyVendorSource({ source }).subType).toBe('buyer_added');
  });

  test.each(['v-hist-1', 'v-navin-1', 'vm-1', 'v-ingest-1', 'v-buyer-1'])('recognizes legacy buyer identifier %s', (id) => {
    expect(classifyVendorSource({ id }).section).toBe('self_onboard_buyer');
  });

  test.each(['category_manager_upload', 'legacy_category_manager', 'legacy_cm_upload', 'excel'])('recognizes catalog upload source %s', (source) => {
    expect(classifyVendorSource({ source }).subType).toBe('cm_upload');
    expect(isProcucevNetworkVendor({ source })).toBe(true);
  });

  test.each(['v-bulk-1', 'v-cm-1'])('recognizes catalog identifier %s', (id) => {
    expect(classifyVendorSource({ id }).subType).toBe('cm_upload');
  });

  test('uses buyer binding, excludes the public all marker, and preserves CM upload ownership', () => {
    expect(classifyVendorSource({ buyerId: 'buyer-1' }).subType).toBe('buyer_added');
    expect(classifyVendorSource({ buyerAccountId: 'buyer-2' }).subType).toBe('buyer_added');
    expect(classifyVendorSource({ buyerAccountId: 'all', buyerId: 'all' }).subType).toBe('procucev_network');
    expect(classifyVendorSource({ source: 'category_manager_upload', buyerId: 'buyer-1' }).subType).toBe('cm_upload');
    expect(classifyVendorSource({ addedByBuyerCompany: 'Owner company' }).label).toContain('Owner company');
    expect(classifyVendorSource(null as unknown as Parameters<typeof classifyVendorSource>[0]).subType).toBe('procucev_network');
  });
});

test('filters the two supplier streams and audits a quotation with real metrics and matrix navigation', async () => {
  (useApp as jest.Mock).mockReturnValue({ rfqs: [rfq, { ...rfq, id: 'no-quote', quotes: [] }],
    categoryTaxonomy: [null, {}, { majorCategory: ' Store Category ' }] });
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [{ majorCategory: 'API Category' }] });
  (fetchAllVendors as jest.Mock).mockResolvedValue(page([
    candidate,
    { ...candidate, id: 'self-vendor', name: 'Self Supplier', contactPerson: '', source: 'self_onboarded' },
    { ...candidate, id: 'buyer-vendor', name: 'Buyer Supplier', source: 'buyer_manual', addedByBuyerCompany: 'Owner company' },
    { ...candidate, id: 'cm-vendor', name: ' ', contactPerson: '', email: '', phone: '', location: '', source: 'category_manager_upload' },
  ]));
  const navigate = jest.fn();
  render(<VendorConsole onNavigateToMatrix={navigate} />);
  const card = await screen.findByTestId(`vendor-card-${candidate.id}`);
  expect(within(card).getByText(candidate.email)).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'API Category' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Store Category' })).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: UI_STRINGS.actions.reviewVendorPerformance }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByText(rfq.title));
  expect(within(dialog).getByText(rfq.quotes[0].remarks || '')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: /Go to Central Quote Matrix/ }));
  expect(navigate).toHaveBeenCalledWith(rfq);
  fireEvent.click(within(dialog).getByText(rfq.title));
  fireEvent.click(within(dialog).getByRole('button', { name: /Close Modal/ }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /1\. CM Uploaded/ }));
  expect(screen.queryByTestId('vendor-card-self-vendor')).not.toBeInTheDocument();
  expect(screen.getByTestId('vendor-card-cm-vendor')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /2\. Self-Onboard/ }));
  expect(screen.queryByTestId(`vendor-card-${candidate.id}`)).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByTestId('vendor-card-self-vendor')).getByRole('button', { name: UI_STRINGS.actions.reviewVendorPerformance }));
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /All Suppliers/ }));
  fireEvent.click(within(screen.getByTestId('vendor-card-cm-vendor')).getByRole('button', { name: UI_STRINGS.actions.reviewVendorPerformance }));
  fireEvent.click(screen.getByRole('dialog'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByTestId(`vendor-card-${candidate.id}`)).getByRole('button', { name: UI_STRINGS.actions.reviewVendorPerformance }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Close modal$/ }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Add \/ Upload CM Vendors/ }));
  expect(screen.getByTestId('vendor-upload-modal')).toBeInTheDocument();
});

test('keeps latest category results when a slower initial request arrives later', async () => {
  let resolveEarlier = (value: ReturnType<typeof page>) => { void value; };
  (fetchAllVendors as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveEarlier = resolve; }))
    .mockResolvedValueOnce(page([{ ...candidate, name: 'Current supplier' }]));
  render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'Cables' } });
  await waitFor(() => expect(screen.getByTestId(`vendor-card-${candidate.id}`)).toBeInTheDocument());
  await act(async () => resolveEarlier(page([{ ...candidate, id: 'stale', name: 'Stale supplier' }])));
  expect(screen.queryByTestId('vendor-card-stale')).not.toBeInTheDocument();
  expect(fetchAllVendors).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'Cables' }));
});

test('ignores stale pagination responses and treats an exact category search as a category filter', async () => {
  let resolveMore = (value: ReturnType<typeof page>) => { void value; };
  (fetchAllVendors as jest.Mock)
    .mockResolvedValueOnce(page([candidate], 1, 2))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }))
    .mockResolvedValueOnce(page([{ ...candidate, id: 'filtered', name: 'Filtered supplier' }], 1, 2))
    .mockResolvedValueOnce(page([{ ...candidate, id: 'second', name: 'Second supplier' }], 2, 2));
  render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
  fireEvent.click(await screen.findByTestId('load-more-vendor-cards'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cables' } });
  await waitFor(() => expect(screen.getByTestId('vendor-card-filtered')).toBeInTheDocument());
  await act(async () => resolveMore(page([{ ...candidate, id: 'stale', name: 'Stale supplier' }], 2, 2)));
  expect(screen.queryByTestId('vendor-card-stale')).not.toBeInTheDocument();
  expect(fetchAllVendors).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'Cables', search: '' }));
});

test('uses fallback categories and renders sparse vendors when taxonomy lookup fails', async () => {
  (getMajorCategories as jest.Mock).mockReturnValue([]);
  (fetchCategoryTaxonomy as jest.Mock).mockRejectedValue(new Error('Taxonomy unavailable'));
  (fetchAllVendors as jest.Mock).mockResolvedValue(page([{ ...candidate, name: '', contactPerson: '', email: '', phone: '', majorCategory: '' }]));
  render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
  expect(await screen.findByTestId(`vendor-card-${candidate.id}`)).toBeInTheDocument();
});

test('retains fallback options when a taxonomy response contains blank categories', async () => {
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [{ majorCategory: '' }] });
  render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
  await screen.findByTestId(`vendor-card-${candidate.id}`);
  expect(screen.getByRole('option', { name: 'Cables' })).toBeInTheDocument();
});
