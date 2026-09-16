import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VendorConsole from '@/app/category-manager/vendor-console';
import * as storeModule from '@/lib/store';
import * as rfqClient from '@/lib/rfqClient';
import type { RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/store');
jest.mock('@/lib/rfqClient', () => ({
  fetchAllVendors: jest.fn(),
}));

const mockFetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;

function makeVendor(i: number): RFQVendorCandidate {
  return {
    id: `v-${i}`,
    name: `Vendor ${i}`,
    contactPerson: `Contact ${i}`,
    phone: '9876543210',
    email: `vendor${i}@example.com`,
    majorCategory: 'Fasteners',
    minorCategories: [],
    location: 'Bengaluru',
    rating: 4,
    source: 'buyer_manual',
    alreadyInvited: false,
  };
}

const PAGE_SIZE = 20;
const ALL_VENDORS = Array.from({ length: 25 }, (_, i) => makeVendor(i));

function page(vendors: RFQVendorCandidate[], pageNumber: number, total: number) {
  return {
    success: true,
    candidates: vendors,
    pagination: { page: pageNumber, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
  };
}

describe('VendorConsole — pagination over a large vendor roster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({ rfqs: [] });
    mockFetchAllVendors.mockImplementation(async (opts: { page?: number; search?: string } = {}) => {
      const search = (opts.search || '').toLowerCase();
      const filtered = search ? ALL_VENDORS.filter((v) => v.name.toLowerCase().includes(search)) : ALL_VENDORS;
      const pageNumber = opts.page || 1;
      const start = (pageNumber - 1) * PAGE_SIZE;
      return page(filtered.slice(start, start + PAGE_SIZE), pageNumber, filtered.length);
    });
  });

  test('renders only the first page of cards, with a Load More button, and appends the next page on click', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());
    expect(screen.getByText('Vendor 19')).toBeInTheDocument();
    expect(screen.queryByText('Vendor 20')).not.toBeInTheDocument();

    const loadMore = screen.getByTestId('load-more-vendor-cards');
    expect(loadMore).toHaveTextContent('Load 20 more vendors');

    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.getByText('Vendor 20')).toBeInTheDocument());
    expect(screen.getByText('Vendor 24')).toBeInTheDocument();
    expect(screen.queryByTestId('load-more-vendor-cards')).not.toBeInTheDocument();
  });

  test('re-fetches from page one when the search term changes (server-side search)', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    const search = screen.getByPlaceholderText(/Search Vendor name or category/i);
    fireEvent.change(search, { target: { value: 'Vendor 1' } });

    // Matches "Vendor 1", "Vendor 10".."Vendor 19" (11 rows) — all fit in one
    // page (20), so no Load More button, and unrelated vendors are gone.
    await waitFor(() => expect(screen.queryByText('Vendor 0')).not.toBeInTheDocument());
    expect(screen.getByText('Vendor 1')).toBeInTheDocument();
    expect(screen.queryByTestId('load-more-vendor-cards')).not.toBeInTheDocument();
  });

  test('shows a loading state while fetching and an error state if the fetch fails', async () => {
    mockFetchAllVendors.mockResolvedValueOnce({ success: false, reason: 'SERVER', error: 'Could not load vendors.' });

    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    expect(screen.getByText(/Loading vendors/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Could not load vendors.')).toBeInTheDocument());
  });

  test('highlights a card red when the vendor has no email, and green when it has one', async () => {
    const withEmail = makeVendor(0);
    const withoutEmail = { ...makeVendor(1), email: '' };
    mockFetchAllVendors.mockResolvedValueOnce(page([withEmail, withoutEmail], 1, 2));

    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    const emailCard = screen.getByText('Vendor 0').closest('.glass-panel');
    const noEmailCard = screen.getByText('Vendor 1').closest('.glass-panel');
    expect(emailCard?.className).toContain('border-emerald-300');
    expect(noEmailCard?.className).toContain('border-rose-300');
  });

  test('surfaces an error and stops the loading-more spinner when a "Load More" fetch fails', async () => {
    mockFetchAllVendors.mockResolvedValueOnce(page(ALL_VENDORS.slice(0, PAGE_SIZE), 1, 25));
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    mockFetchAllVendors.mockResolvedValueOnce({ success: false, reason: 'SERVER', error: 'Could not load more vendors.' });
    fireEvent.click(screen.getByTestId('load-more-vendor-cards'));

    await waitFor(() => expect(screen.getByText('Could not load more vendors.')).toBeInTheDocument());
  });

  test('opens and closes the Bulk Upload Vendors modal from its button', async () => {
    mockFetchAllVendors.mockResolvedValueOnce(page([], 1, 0));
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(mockFetchAllVendors).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/Bulk Upload Vendors/i));
    expect(screen.getByTestId('vendor-upload-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('vendor-upload-modal')).not.toBeInTheDocument();
  });

  test('computes awarded spend only from PO-generated RFQs actually awarded to that vendor', async () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: [
        { status: 'PO Generated', awardedVendor: 'Vendor 0', awardedAmount: 50000 },
        { status: 'PO Generated', awardedVendor: 'Someone Else', awardedAmount: 99999 },
        { status: 'Quotes Pending', awardedVendor: 'Vendor 0', awardedAmount: 12345 },
      ],
    });
    mockFetchAllVendors.mockResolvedValueOnce(page([makeVendor(0)], 1, 1));
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    expect(screen.getAllByText((_, el) => el?.textContent === '₹50,000').length).toBeGreaterThan(0);
  });

  test('does not re-fetch on an unrelated re-render when the search term is unchanged', async () => {
    mockFetchAllVendors.mockResolvedValueOnce(page(ALL_VENDORS.slice(0, PAGE_SIZE), 1, 25));
    const { rerender } = render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);

    rerender(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
  });

  test('shows real avg lead time / quote compliance and expands quote detail with a compliance badge', async () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: [
        {
          rfqNumber: 'RFQ-1',
          title: 'Test RFQ',
          status: 'PO Generated',
          awardedVendor: 'Vendor 0',
          awardedAmount: 1000,
          budget: 5000,
          extractedEntities: [],
          quotes: [{ vendorId: 'v-0', leadTimeDays: 7, complianceStatus: 'Fully Compliant', totalPrice: 4500 }],
        },
      ],
    });
    mockFetchAllVendors.mockResolvedValueOnce(page([makeVendor(0)], 1, 1));
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    expect(screen.getAllByText(/7 days/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText(/Review Performance/i));
    expect(screen.getAllByText(/7 days/).length).toBeGreaterThan(0);
    expect(screen.getByText('Fully Compliant')).toBeInTheDocument();
  });

  test('falls back to a placeholder avatar/label when a vendor has no name, and shows the amber badge for a non-Fully-Compliant quote', async () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: [
        {
          rfqNumber: 'RFQ-2',
          title: 'Test RFQ 2',
          status: 'Quotes Pending',
          budget: 5000,
          extractedEntities: [],
          quotes: [{ vendorId: 'v-noname', leadTimeDays: 9, complianceStatus: 'Partially Compliant', totalPrice: 3000 }],
        },
      ],
    });
    mockFetchAllVendors.mockResolvedValueOnce(
      page([{ ...makeVendor(0), id: 'v-noname', name: '' }], 1, 1)
    );
    render(<VendorConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('Unnamed Vendor').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText(/Review Performance/i));
    expect(screen.getByText('Partially Compliant')).toBeInTheDocument();
  });
});
