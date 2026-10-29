import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InviteVendorsModal from '@/app/category-manager/InviteVendorsModal';
import * as rfqClient from '@/lib/rfqClient';
import * as buyerProfileClient from '@/lib/buyerProfileClient';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { MAX_INVITE_VENDORS, getIndianStates, getCitiesForState, INDIAN_STATES_AND_CITIES } from '@/lib/constants';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/rfqClient', () => ({
  fetchVendorCandidates: jest.fn(),
  fetchAllVendors: jest.fn(),
  inviteVendorsToRFQ: jest.fn(),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchCategoryTaxonomy: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

const mockShowToast = jest.fn();
const mockOnClose = jest.fn();
const mockOnInvited = jest.fn();

const S = UI_STRINGS.inviteVendors;

const RFQ: RFQItem = {
  id: 'rfq-filter-test',
  rfqNumber: 'RFQ-2026-999',
  title: 'Heavy Machining & Fasteners',
  category: 'Fasteners & Industrial Hardware',
  sourcingMode: 'mode_0',
  status: 'Quotes Pending',
  quotesCount: 0,
  targetDeliveryDate: '2026-11-30',
  budget: 500000,
  createdAt: '2026-10-01',
  chasingActive: false,
  extractedEntities: [],
  quotes: [],
  assignedVendors: [
    {
      id: 'v-already-assigned',
      name: 'Already Assigned Co',
      email: 'assigned@example.com',
      vendorCategory: 'Procucev Network',
    },
  ],
};

const mockVendorsPool: RFQVendorCandidate[] = [
  {
    id: 'v-pune-1',
    name: 'Apex Pune Fasteners Pvt Ltd',
    email: 'contact@apexfasteners.in',
    phone: '9876543201',
    contactPerson: 'Rajesh Sharma',
    majorCategory: 'Fasteners & Industrial Hardware',
    minorCategories: ['Hex Bolts', 'Nuts'],
    city: 'Pune',
    state: 'Maharashtra',
    location: 'Pune, Maharashtra',
    rating: 4.8,
    source: 'procucev_network',
    alreadyInvited: false,
  },
  {
    id: 'v-pune-2',
    name: 'Precision Tools Pune',
    email: 'sales@precisiontools.com',
    phone: '9876543202',
    contactPerson: 'Suresh Patil',
    majorCategory: 'Fasteners & Industrial Hardware',
    minorCategories: ['Studs'],
    city: 'Pune',
    state: 'Maharashtra',
    location: 'Pune, Maharashtra',
    rating: 4.6,
    source: 'procucev_network',
    alreadyInvited: false,
  },
  {
    id: 'v-mumbai-1',
    name: 'Bombay Industrial Hardware',
    email: 'info@bombayhardware.com',
    phone: '9876543203',
    contactPerson: 'Karan Mehta',
    majorCategory: 'Fasteners & Industrial Hardware',
    minorCategories: ['Washers'],
    city: 'Mumbai',
    state: 'Maharashtra',
    location: 'Mumbai, Maharashtra',
    rating: 4.9,
    source: 'procucev_network',
    alreadyInvited: false,
  },
  {
    id: 'v-ahmedabad-1',
    name: 'Gujarat Techno Forge',
    email: 'orders@technoforge.com',
    phone: '9876543204',
    contactPerson: 'Bhavesh Patel',
    majorCategory: 'Mechanical & Fluid Equipment',
    minorCategories: ['Valves'],
    city: 'Ahmedabad',
    state: 'Gujarat',
    location: 'Ahmedabad, Gujarat',
    rating: 4.7,
    source: 'procucev_network',
    alreadyInvited: false,
  },
  {
    id: 'v-bengaluru-1',
    name: 'Bangalore Precision Works',
    email: 'sales@bangaloreprecision.com',
    phone: '9876543205',
    contactPerson: 'Anand Kumar',
    majorCategory: 'Electrical Equipment',
    minorCategories: ['Switchgear'],
    city: 'Bengaluru',
    state: 'Karnataka',
    location: 'Bengaluru, Karnataka',
    rating: 4.5,
    source: 'procucev_network',
    alreadyInvited: false,
  },
  {
    id: 'v-already-assigned',
    name: 'Already Assigned Co',
    email: 'assigned@example.com',
    phone: '9876543206',
    contactPerson: 'Assigned Person',
    majorCategory: 'Fasteners & Industrial Hardware',
    minorCategories: [],
    city: 'Pune',
    state: 'Maharashtra',
    location: 'Pune, Maharashtra',
    rating: 4.4,
    source: 'procucev_network',
    alreadyInvited: true,
  },
];

describe('InviteVendorsModal — Comprehensive Multi-Filter & 20-Vendor Limit Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      categoryTaxonomy: [
        { majorCategory: 'Fasteners & Industrial Hardware' },
        { majorCategory: 'Mechanical & Fluid Equipment' },
        { majorCategory: 'Electrical Equipment' },
      ],
    });
    (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        { majorCategory: 'Fasteners & Industrial Hardware' },
        { majorCategory: 'Mechanical & Fluid Equipment' },
        { majorCategory: 'Electrical Equipment' },
      ],
    });
    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValue({
      success: true,
      candidates: mockVendorsPool,
    });
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      candidates: mockVendorsPool,
      pagination: { page: 1, pageSize: 50, total: mockVendorsPool.length, totalPages: 1 },
    });
  });

  it('Requirement 1: Filters vendors by State, dynamically updates City options, and filters by City', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });

    const stateSelect = screen.getByTestId('invite-vendors-state-filter');
    const citySelect = screen.getByTestId('invite-vendors-city-filter');

    // Initially when no state is selected, city select is disabled with placeholder
    expect(citySelect).toBeDisabled();
    expect(citySelect).toHaveTextContent(S.selectStateFirst);

    // Select Maharashtra
    fireEvent.change(stateSelect, { target: { value: 'Maharashtra' } });
    expect(citySelect).not.toBeDisabled();

    // City options for Maharashtra are loaded
    expect(screen.getByRole('option', { name: 'Pune' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();

    // Only Maharashtra vendors should be visible
    expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('Bombay Industrial Hardware')).toBeInTheDocument();
    expect(screen.queryByText('Gujarat Techno Forge')).not.toBeInTheDocument();
    expect(screen.queryByText('Bangalore Precision Works')).not.toBeInTheDocument();

    // Now filter by City: Pune
    fireEvent.change(citySelect, { target: { value: 'Pune' } });
    expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('Precision Tools Pune')).toBeInTheDocument();
    expect(screen.queryByText('Bombay Industrial Hardware')).not.toBeInTheDocument();

    // Changing State to Gujarat updates City options and resets city value
    fireEvent.change(stateSelect, { target: { value: 'Gujarat' } });
    expect((citySelect as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: 'Ahmedabad' })).toBeInTheDocument();
    expect(screen.getByText('Gujarat Techno Forge')).toBeInTheDocument();
    expect(screen.queryByText('Apex Pune Fasteners Pvt Ltd')).not.toBeInTheDocument();
  });

  it('Requirement 2: Search by vendor name and by email address with clear button', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('invite-vendors-search');

    // Search by name
    fireEvent.change(searchInput, { target: { value: 'Bombay' } });
    await waitFor(() => {
      expect(screen.getByText('Bombay Industrial Hardware')).toBeInTheDocument();
      expect(screen.queryByText('Apex Pune Fasteners Pvt Ltd')).not.toBeInTheDocument();
    });

    // Clear search using the clear button
    const clearBtn = screen.getByTestId('clear-search-btn');
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });

    // Search by email address
    fireEvent.change(searchInput, { target: { value: 'orders@technoforge.com' } });
    await waitFor(() => {
      expect(screen.getByText('Gujarat Techno Forge')).toBeInTheDocument();
      expect(screen.queryByText('Apex Pune Fasteners Pvt Ltd')).not.toBeInTheDocument();
    });
  });

  it('Requirement 2 & 5: Enforces 20-vendor maximum limit, displays count ratio (15/20), and allows removing selected vendors', async () => {
    // Generate 25 candidate vendors
    const twentyFiveCandidates: RFQVendorCandidate[] = Array.from({ length: 25 }, (_, i) => ({
      id: `cand-${i + 1}`,
      name: `Candidate Supplier ${i + 1}`,
      email: `supplier${i + 1}@domain.com`,
      phone: `98765000${i < 10 ? '0' + i : i}`,
      contactPerson: `Contact ${i + 1}`,
      majorCategory: 'Fasteners & Industrial Hardware',
      minorCategories: [],
      city: 'Pune',
      state: 'Maharashtra',
      location: 'Pune, Maharashtra',
      rating: 4.5,
      source: 'procucev_network',
      alreadyInvited: false,
    }));

    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValue({
      success: true,
      candidates: twentyFiveCandidates,
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Supplier 1')).toBeInTheDocument();
    });

    // Select All capped at 20 vendors
    fireEvent.click(screen.getByText(S.selectAll));

    const countBadge = screen.getByTestId('selected-vendor-count');
    expect(countBadge).toHaveTextContent(`20/${MAX_INVITE_VENDORS}`);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Limit Reached',
      formatString(S.maxSelectionWarning, { max: MAX_INVITE_VENDORS }),
      'warning'
    );

    // Try selecting 21st vendor manually -> blocked
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[20]);
    expect(countBadge).toHaveTextContent(`20/${MAX_INVITE_VENDORS}`);

    // Selected vendors chips bar is present
    expect(screen.getByTestId('selected-vendors-bar')).toBeInTheDocument();

    // Remove single vendor using chip (x) button
    const removeBtn = screen.getByTestId('remove-selected-cand-1');
    fireEvent.click(removeBtn);
    expect(countBadge).toHaveTextContent(`19/${MAX_INVITE_VENDORS}`);

    // Clear all selection button
    const clearAllBtn = screen.getByTestId('clear-all-selected-btn');
    fireEvent.click(clearAllBtn);
    expect(screen.queryByTestId('selected-vendors-bar')).not.toBeInTheDocument();
  });

  it('Requirement 3: Sends RFQ invitations to selected vendors with duplicate prevention and loading states', async () => {
    (rfqClient.inviteVendorsToRFQ as jest.Mock).mockResolvedValue({
      success: true,
      rfq: RFQ,
      invitedCount: 2,
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });

    // Already assigned vendor cannot be selected (checkbox is disabled)
    const alreadyAssigned = screen.getByText('Already Assigned Co').closest('label')!;
    const assignedCheckbox = alreadyAssigned.querySelector('input[type="checkbox"]')!;
    expect(assignedCheckbox).toBeDisabled();

    // Select two active vendors
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const inviteBtn = screen.getByTestId('invite-selected-vendors-btn');
    expect(inviteBtn).toHaveTextContent(formatString(S.inviteAction, { count: 2 }));

    fireEvent.click(inviteBtn);

    await waitFor(() => {
      expect(rfqClient.inviteVendorsToRFQ).toHaveBeenCalledWith(RFQ.id, ['v-pune-1', 'v-pune-2']);
      expect(mockShowToast).toHaveBeenCalledWith(
        S.successTitle,
        formatString(S.successMessage, { count: 2, rfqNumber: RFQ.rfqNumber }),
        'success'
      );
      expect(mockOnInvited).toHaveBeenCalledWith(RFQ, 2);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('Requirement 4 & 5: Responsive layout and server-side pagination with Category, State, City, and Search filters in All Vendors tab', async () => {
    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValue({ success: true, candidates: [] });
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      candidates: mockVendorsPool,
      pagination: { page: 1, pageSize: 50, total: 100, totalPages: 2 },
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    // Check modal max-width class for expanded responsive styling
    const modalDialog = screen.getByTestId('invite-vendors-modal').firstElementChild!;
    expect(modalDialog.className).toContain('max-w-4xl');

    // Switch to All Vendors tab
    fireEvent.click(screen.getByTestId('invite-tab-all'));

    await waitFor(() => {
      expect(rfqClient.fetchAllVendors).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 })
      );
    });

    // Apply combined filters
    fireEvent.change(screen.getByTestId('invite-vendors-category-filter'), {
      target: { value: 'Fasteners & Industrial Hardware' },
    });
    fireEvent.change(screen.getByTestId('invite-vendors-state-filter'), {
      target: { value: 'Maharashtra' },
    });
    fireEvent.change(screen.getByTestId('invite-vendors-city-filter'), {
      target: { value: 'Pune' },
    });
    fireEvent.change(screen.getByTestId('invite-vendors-search'), {
      target: { value: 'Apex' },
    });

    await waitFor(() => {
      expect(rfqClient.fetchAllVendors).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'Apex',
          category: 'Fasteners & Industrial Hardware',
          state: 'Maharashtra',
          city: 'Pune',
          page: 1,
        })
      );
    });

    // Load More pagination with combined filters
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValueOnce({
      success: true,
      candidates: [mockVendorsPool[1]],
      pagination: { page: 2, pageSize: 50, total: 100, totalPages: 2 },
    });

    const loadMoreBtn = screen.getByTestId('load-more-vendors');
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(rfqClient.fetchAllVendors).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          search: 'Apex',
          category: 'Fasteners & Industrial Hardware',
          state: 'Maharashtra',
          city: 'Pune',
        })
      );
    });
  });

  it('Requirement 3 edge cases: handles submit when selection is empty and when all selected vendors already invited', async () => {
    const mutableAssignedVendors: any[] = [];
    const rfqWithMutableAssigned = { ...RFQ, assignedVendors: mutableAssignedVendors };

    render(
      <InviteVendorsModal isOpen={true} rfq={rfqWithMutableAssigned} onClose={mockOnClose} onInvited={mockOnInvited} />
    );

    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });

    const inviteBtn = screen.getByTestId('invite-selected-vendors-btn');

    // 1. Submit when selected.size === 0 (disabled button click)
    fireEvent.click(inviteBtn);
    expect(rfqClient.inviteVendorsToRFQ).not.toHaveBeenCalled();

    // 2. Select a vendor
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // Selects Apex Pune Fasteners Pvt Ltd (v-pune-1)

    // Mutate assignedVendors in place so rfq prop identity does not trigger useEffect prune
    mutableAssignedVendors.push({
      id: 'v-pune-1',
      name: 'Apex Pune Fasteners Pvt Ltd',
      email: 'contact@apexfasteners.in',
      vendorCategory: 'Procucev Network',
    });

    // Clicking invite now detects toInvite.length === 0
    fireEvent.click(inviteBtn);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Already Invited',
      'All selected vendors have already been invited to this RFQ.',
      'warning'
    );
    expect(rfqClient.inviteVendorsToRFQ).not.toHaveBeenCalled();
  });

  it('Requirement 1 & 2 edge cases: filters by contact person, minor category, and partial location strings', async () => {
    const candidatesWithPartialLocation: RFQVendorCandidate[] = [
      {
        id: 'v-partial-loc-1',
        name: 'Western Metal Forgings',
        email: 'info@westernmetal.com',
        phone: '9876543207',
        contactPerson: 'Karan Mehta',
        majorCategory: 'Mechanical & Fluid Equipment',
        minorCategories: ['Studs', 'Special Fasteners'],
        city: undefined,
        state: undefined,
        location: 'Ahmedabad, Gujarat',
        rating: 4.7,
        source: 'procucev_network',
        alreadyInvited: false,
      },
    ];

    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValue({
      success: true,
      candidates: candidatesWithPartialLocation,
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => {
      expect(screen.getByText('Western Metal Forgings')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('invite-vendors-search');
    const categorySelect = screen.getByTestId('invite-vendors-category-filter');
    const stateSelect = screen.getByTestId('invite-vendors-state-filter');
    const citySelect = screen.getByTestId('invite-vendors-city-filter');

    // Filter by contact person
    fireEvent.change(searchInput, { target: { value: 'Karan' } });
    expect(screen.getByText('Western Metal Forgings')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Filter by minor category
    fireEvent.change(categorySelect, { target: { value: 'Studs' } });
    expect(screen.getByText('Western Metal Forgings')).toBeInTheDocument();
    fireEvent.change(categorySelect, { target: { value: '' } });

    // Filter by State using location fallback
    fireEvent.change(stateSelect, { target: { value: 'Gujarat' } });
    expect(screen.getByText('Western Metal Forgings')).toBeInTheDocument();

    // Filter by City using location fallback
    fireEvent.change(citySelect, { target: { value: 'Ahmedabad' } });
    expect(screen.getByText('Western Metal Forgings')).toBeInTheDocument();
  });

  it('Requirement 4 edge cases: handles RFQs with extracted entities and RFQs without categories or entities', async () => {
    const rfqWithEntities: RFQItem = {
      ...RFQ,
      category: '',
      extractedEntities: [
        {
          id: 'ent-1',
          itemName: 'Switchgear Panel',
          quantity: 2,
          unit: 'pcs',
          majorCategory: 'Electrical Equipment',
          minorCategory: 'Switchgear',
          category: 'Cables',
        } as unknown as import('@/lib/types').ExtractedEntity,
      ],
    };

    const { unmount } = render(
      <InviteVendorsModal isOpen={true} rfq={rfqWithEntities} onClose={mockOnClose} onInvited={mockOnInvited} />
    );

    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });
    unmount();

    // Render RFQ without entities and without category
    const rfqEmpty: RFQItem = {
      ...RFQ,
      category: '',
      extractedEntities: undefined as any,
    };

    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValueOnce({
      success: true,
      candidates: [],
    });

    render(<InviteVendorsModal isOpen={true} rfq={rfqEmpty} onClose={mockOnClose} onInvited={mockOnInvited} />);

    // Since signals.length === 0, modal defaults tab to 'all'. Switch back to category tab to verify empty category banner
    fireEvent.click(screen.getByTestId('invite-tab-category'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'This V0 RFQ was submitted without a category. Switch to the "All Vendors" tab above to search and manually assign suppliers.'
        )
      ).toBeInTheDocument();
    });

    // Click "Go to All Vendors" button
    fireEvent.click(screen.getByText('Go to All Vendors'));
  });

  it('Requirement 5 edge cases: handles load more failure and candidate without ID gracefully', async () => {
    const candidatesWithNull = [
      ...mockVendorsPool,
      { id: '', name: 'No ID Vendor', email: 'noid@example.com' } as any,
    ];

    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValue({
      success: true,
      candidates: candidatesWithNull,
    });
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      candidates: mockVendorsPool,
      pagination: { page: 1, pageSize: 50, total: 100, totalPages: 2 },
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    // Switch to All Vendors tab
    fireEvent.click(screen.getByTestId('invite-tab-all'));

    await waitFor(() => {
      expect(screen.getByTestId('load-more-vendors')).toBeInTheDocument();
    });

    // Mock failure for load more
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Network error fetching more vendors',
    });

    fireEvent.click(screen.getByTestId('load-more-vendors'));

    await waitFor(() => {
      expect(screen.getByText('Network error fetching more vendors')).toBeInTheDocument();
    });
  });
  it('Requirement 1 & 5: All 36 States/UTs and towns (e.g. Andaman and Nicobar Islands, Ladakh) are available, and parenthesized alias city matches vendor', async () => {
    const states = getIndianStates();
    expect(states.length).toBe(36);
    expect(states).toContain('Andaman and Nicobar Islands');
    expect(states).toContain('Ladakh');
    expect(states).toContain('Sikkim');
    expect(states).toContain('Puducherry');

    const andamanCities = getCitiesForState('Andaman and Nicobar Islands');
    expect(andamanCities).toContain('Sri Vijaya Puram (Port Blair)');

    const ladakhCities = getCitiesForState('Ladakh');
    expect(ladakhCities).toContain('Leh');
    expect(ladakhCities).toContain('Kargil');

    // Case-insensitive & trimming
    expect(getCitiesForState('  ladakh  ')).toEqual(ladakhCities);
    expect(getCitiesForState('')).toEqual([]);

    // Candidate vendor in Port Blair
    const candidateWithAlias: RFQVendorCandidate[] = [
      ...mockVendorsPool,
      {
        id: 'v-andaman-1',
        name: 'Bay of Bengal Marine Spares',
        email: 'bay@andamanmarinespares.in',
        phone: '9876543299',
        contactPerson: 'Anand Kumar',
        majorCategory: 'Fasteners & Industrial Hardware',
        minorCategories: ['Marine Spares'],
        city: 'Port Blair',
        state: 'Andaman and Nicobar Islands',
        location: 'Port Blair, Andaman',
        rating: 4.5,
        source: 'procucev_network',
        alreadyInvited: false,
      },
    ];

    (rfqClient.fetchVendorCandidates as jest.Mock).mockResolvedValue({
      success: true,
      candidates: candidateWithAlias,
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Pune Fasteners Pvt Ltd')).toBeInTheDocument();
    });

    // Select state 'Andaman and Nicobar Islands'
    const stateSelect = screen.getByTestId('invite-vendors-state-filter');
    fireEvent.change(stateSelect, { target: { value: 'Andaman and Nicobar Islands' } });

    // Verify city dropdown contains 'Sri Vijaya Puram (Port Blair)'
    const citySelect = screen.getByTestId('invite-vendors-city-filter');
    expect(citySelect).toBeInTheDocument();

    // Select city 'Sri Vijaya Puram (Port Blair)'
    fireEvent.change(citySelect, { target: { value: 'Sri Vijaya Puram (Port Blair)' } });

    // The candidate with city 'Port Blair' should be visible
    await waitFor(() => {
      expect(screen.getByText('Bay of Bengal Marine Spares')).toBeInTheDocument();
    });

    // Pune vendor should not be visible
    expect(screen.queryByText('Apex Pune Fasteners Pvt Ltd')).not.toBeInTheDocument();
  });
});
