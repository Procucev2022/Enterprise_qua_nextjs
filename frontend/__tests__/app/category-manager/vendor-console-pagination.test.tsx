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
});
