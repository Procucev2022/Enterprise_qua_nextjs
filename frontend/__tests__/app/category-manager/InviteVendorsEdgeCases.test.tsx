import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InviteVendorsModal from '@/app/category-manager/InviteVendorsModal';
import { useApp } from '@/lib/store';
import { fetchAllVendors, fetchVendorCandidates, inviteVendorsToRFQ } from '@/lib/rfqClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { getMajorCategories } from '@/lib/categoryTaxonomy';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/rfqClient', () => ({ fetchAllVendors: jest.fn(), fetchVendorCandidates: jest.fn(), inviteVendorsToRFQ: jest.fn() }));
jest.mock('@/lib/buyerProfileClient', () => ({ fetchCategoryTaxonomy: jest.fn() }));
jest.mock('@/lib/categoryTaxonomy', () => ({ getMajorCategories: jest.fn() }));
jest.mock('@/lib/authClient', () => ({ authClient: { getToken: jest.fn() } }));

const s = UI_STRINGS.inviteVendors;
const showToast = jest.fn();
const onClose = jest.fn();
const rfq: RFQItem = {
  id: 'invite-edge-rfq', rfqNumber: 'RFQ-INVITE-EDGE', title: 'Power cables',
  category: 'Cables', sourcingMode: 'mode_0', status: 'Quotes Pending', quotesCount: 0,
  targetDeliveryDate: '2026-12-01', budget: 0, createdAt: '2026-10-01',
  chasingActive: false, extractedEntities: [], quotes: [],
};
const candidate: RFQVendorCandidate = {
  id: 'edge-vendor', name: 'Edge Supplies', majorCategory: 'Cables',
  minorCategories: [], alreadyInvited: false, contactPerson: '', email: '', phone: '',
  location: '', rating: 4.5, source: 'procucev_network',
};
const page = (candidates: RFQVendorCandidate[], pageNumber = 1, totalPages = 1) => ({
  success: true, candidates,
  pagination: { page: pageNumber, pageSize: 50, total: candidates.length, totalPages },
});

beforeEach(() => {
  jest.resetAllMocks();
  (useApp as jest.Mock).mockReturnValue({ showToast });
  (getMajorCategories as jest.Mock).mockReturnValue(['Cables', '', '   ']);
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (fetchVendorCandidates as jest.Mock).mockResolvedValue({ success: true, candidates: [] });
  (fetchAllVendors as jest.Mock).mockResolvedValue(page([]));
  (authClient.getToken as jest.Mock).mockReturnValue(null);
});

async function openAll(currentRfq = rfq) {
  render(<InviteVendorsModal isOpen rfq={currentRfq} onClose={onClose} />);
  await waitFor(() => expect(screen.getByText(s.noCandidates)).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('invite-tab-all'));
  await waitFor(() => expect(fetchAllVendors).toHaveBeenCalled());
}

function fillNewVendor(minorCategory = '') {
  fireEvent.click(screen.getByTestId('add-new-vendor-button'));
  const modal = screen.getByTestId('add-vendor-modal');
  const fields = within(modal).getAllByRole('textbox');
  [' New supplier ', ' New contact ', ' 9876543210 ', ' CONTACT@EXAMPLE.COM ', minorCategory].forEach((value, index) => {
    fireEvent.change(fields[index], { target: { value } });
  });
  const form = modal.querySelector('form');
  if (!form) throw new Error('Vendor creation form missing');
  return form;
}

test('combines API, store, RFQ and vendor categories while ignoring blank values', async () => {
  (useApp as jest.Mock).mockReturnValue({ showToast, categoryTaxonomy: [null, {}, { majorCategory: ' Store Category ' }] });
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [{ majorCategory: 'API Category' }] });
  (fetchVendorCandidates as jest.Mock).mockResolvedValue({ success: true, candidates: [{ ...candidate, majorCategory: '' }] });
  (fetchAllVendors as jest.Mock).mockResolvedValue(page([{ ...candidate, majorCategory: '' }]));
  render(<InviteVendorsModal isOpen rfq={{ ...rfq, extractedEntities: [{
    id: 'edge-item', itemName: 'Cable', quantity: 1, unit: 'm', targetDate: '', technicalSpecs: '', confidence: 95,
    majorCategory: ' RFQ Major ', minorCategory: '', category: ' Item Category ',
  }] }} onClose={onClose} />);
  await waitFor(() => expect(screen.getByText(candidate.name)).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('invite-tab-all'));
  await waitFor(() => expect(screen.getByRole('option', { name: 'API Category' })).toBeInTheDocument());
  for (const category of ['Store Category', 'RFQ Major', 'Item Category']) {
    expect(screen.getByRole('option', { name: category })).toBeInTheDocument();
  }
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'API Category' } });
  await waitFor(() => expect(fetchAllVendors).toHaveBeenCalledWith(expect.objectContaining({ category: 'API Category' })));
});

test('retains standard categories when the taxonomy request fails or contains no usable category', async () => {
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [{ majorCategory: '' }] });
  await openAll();
  expect(screen.getByRole('option', { name: 'Cables' })).toBeInTheDocument();
});

test('ignores an earlier list response after a category-filtered response has completed', async () => {
  let resolveEarlier = (value: ReturnType<typeof page>) => { void value; };
  (fetchAllVendors as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveEarlier = resolve; }))
    .mockResolvedValueOnce(page([{ ...candidate, name: 'Filtered supplier' }]));
  await openAll();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Cables' } });
  await waitFor(() => expect(screen.getByText('Filtered supplier')).toBeInTheDocument());
  await act(async () => resolveEarlier(page([{ ...candidate, name: 'Stale supplier' }])));
  expect(screen.queryByText('Stale supplier')).not.toBeInTheDocument();
});

test('ignores a stale next-page response when the category changes', async () => {
  let resolveMore = (value: ReturnType<typeof page>) => { void value; };
  (fetchAllVendors as jest.Mock)
    .mockResolvedValueOnce(page([candidate], 1, 2))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }))
    .mockResolvedValueOnce(page([{ ...candidate, name: 'Current supplier' }]));
  await openAll();
  fireEvent.click(await screen.findByTestId('load-more-vendors'));
  expect(screen.getByTestId('load-more-vendors')).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Cables' } });
  await waitFor(() => expect(screen.getByText('Current supplier')).toBeInTheDocument());
  await act(async () => resolveMore(page([{ ...candidate, name: 'Stale next page' }], 2, 2)));
  expect(screen.queryByText('Stale next page')).not.toBeInTheDocument();
});

test('creates a sparse API vendor on the all-vendors tab and selects the returned legacy identifier', async () => {
  await openAll();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ success: true, data: { _id: 123 } }) });
  const form = fillNewVendor(' Custom Minor ');
  await act(async () => { fireEvent.submit(form); });
  expect(global.fetch).toHaveBeenCalledWith('/api/vendors', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New supplier', contactPerson: 'New contact', email: 'contact@example.com', phone: '9876543210',
      majorCategory: 'Cables', minorCategories: ['Custom Minor'], source: 'procucev_network' }),
  }));
  expect(screen.getByText('New supplier')).toBeInTheDocument();
  expect(screen.getByRole('checkbox')).toBeChecked();
  (inviteVendorsToRFQ as jest.Mock).mockResolvedValue({ success: true, invitedCount: 0, excludedCount: 1, rfq });
  fireEvent.click(screen.getByRole('button', { name: formatString(s.inviteAction, { count: 1 }) }));
  await waitFor(() => expect(inviteVendorsToRFQ).toHaveBeenCalledWith(rfq.id, ['123']));
  expect(showToast.mock.calls.some(([, , kind]) => kind === 'warning')).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test.each([
  { ok: false, status: 409, json: async () => ({}) },
  { ok: false, status: 500, json: async () => { throw new Error('Invalid JSON'); } },
  { ok: true, status: 200, json: async () => ({ success: false }) },
])('keeps the creation form open on incomplete API error responses: $status', async (response) => {
  (fetchCategoryTaxonomy as jest.Mock).mockRejectedValue(new Error('Taxonomy unavailable'));
  render(<InviteVendorsModal isOpen rfq={rfq} onClose={onClose} />);
  await waitFor(() => expect(screen.getByText(s.noCandidates)).toBeInTheDocument());
  global.fetch = jest.fn().mockResolvedValue(response);
  const form = fillNewVendor();
  await act(async () => { fireEvent.submit(form); });
  expect(screen.getByTestId('add-vendor-modal')).toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'warning');
  expect(onClose).not.toHaveBeenCalled();
});

test('handles a thrown value without an error message and closes the add-vendor header action', async () => {
  render(<InviteVendorsModal isOpen rfq={rfq} onClose={onClose} />);
  await waitFor(() => expect(screen.getByText(s.noCandidates)).toBeInTheDocument());
  global.fetch = jest.fn().mockRejectedValue(null);
  const form = fillNewVendor();
  await act(async () => { fireEvent.submit(form); });
  expect(showToast).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'warning');
  fireEvent.click(within(screen.getByTestId('add-vendor-modal')).getAllByRole('button')[0]);
  expect(screen.queryByTestId('add-vendor-modal')).not.toBeInTheDocument();
});
