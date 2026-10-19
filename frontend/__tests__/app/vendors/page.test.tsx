import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PublicVendorDirectoryPage from '@/app/vendors/page';
import VendorsLayout, { metadata } from '@/app/vendors/layout';
import VendorCard from '@/app/vendors/VendorCard';
import VendorDetailModal from '@/app/vendors/VendorDetailModal';
import VendorFilterSidebar from '@/app/vendors/VendorFilterSidebar';
import { fetchPublicVendors } from '@/lib/vendorDirectoryClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { PublicVendor, PublicVendorPageResult, PublicVendorFilterState } from '@/lib/types';
import { avatarForName, getInitials, renderStars } from '@/app/vendors/vendorUtils';

jest.mock('@/lib/vendorDirectoryClient', () => ({
  fetchPublicVendors: jest.fn(),
  fetchPublicVendorById: jest.fn(),
}));

const S = UI_STRINGS.publicVendorDirectory;

const MOCK_VENDOR: PublicVendor = {
  id: 'v-test-1',
  name: 'Bharat Heavy Engineering Works',
  brandName: 'Bharat Eng',
  email: 'contact@bharateng.example.com',
  phone: '+91 98765 43210',
  contactPerson: 'Rajesh Sharma',
  contactDesignation: 'Director of Operations',
  website: 'https://bharateng.example.com',
  majorCategory: 'Mechanical',
  minorCategories: ['Forging', 'CNC Machining', 'Fabrication'],
  products: ['Heavy Flanges', 'Industrial Valves', 'Pressure Vessels'],
  location: 'Pune Industrial Area',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411018',
  country: 'India',
  factoryAddress: 'Plot 42, MIDC Bhosari, Pune',
  gstin: '27AABCB1234F1Z5',
  pan: 'AAB****34F',
  msme: 'UDYAM-MH-01-0012345',
  orgType: 'Private Limited',
  annualTurnover: '₹50 Cr - ₹100 Cr',
  status: 'VERIFIED SUPPLIER',
  rating: 4.8,
  isVerified: true,
  isProcucevNetwork: true,
  createdAt: '2024-01-15T10:00:00Z',
};

const MOCK_PAGE_RESULT: PublicVendorPageResult = {
  success: true,
  data: [MOCK_VENDOR],
  pagination: {
    page: 1,
    pageSize: 24,
    total: 1,
    totalPages: 2,
  },
};

describe('Public Vendor Directory (/vendors)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    window.scrollTo = jest.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders page title, search bar, and hero banner', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    render(<PublicVendorDirectoryPage />);

    expect(screen.getByText(S.title)).toBeInTheDocument();
    expect(screen.getByText(S.subtitle)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(S.searchPlaceholder)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText('Bharat Heavy Engineering Works')).toBeInTheDocument();
    });
  });

  test('executes debounced search when user types in search input and allows clearing it', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    render(<PublicVendorDirectoryPage />);

    const searchInput = screen.getByPlaceholderText(S.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'valves' } });

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledWith(expect.objectContaining({ search: 'valves' }));
    });

    // Clear search button appears and resets search
    const clearSearchBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearSearchBtn);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledWith(expect.objectContaining({ search: '' }));
    });
  });

  test('updates category, state, rating, and verified filters', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    const { container } = render(<PublicVendorDirectoryPage />);

    // Change category
    const categorySelect = container.querySelector('#vendor-filter-category') as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: 'Electrical' } });

    // Change state
    const stateSelect = container.querySelector('#vendor-filter-state') as HTMLSelectElement;
    fireEvent.change(stateSelect, { target: { value: 'Gujarat' } });

    // Change min rating
    const ratingSelect = container.querySelector('#vendor-filter-rating') as HTMLSelectElement;
    fireEvent.change(ratingSelect, { target: { value: '4' } });

    // Change verified checkbox
    const verifiedCheckbox = container.querySelector('#vendor-filter-verified') as HTMLInputElement;
    fireEvent.click(verifiedCheckbox);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'Electrical',
          state: 'Gujarat',
          minRating: 4,
          verifiedOnly: true,
        })
      );
    });
  });

  test('clear all filters resets state to default', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    render(<PublicVendorDirectoryPage />);

    const searchInput = screen.getByPlaceholderText(S.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'test' } });

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getAllByText(S.clearFilters).length).toBeGreaterThan(0);
    });

    const clearButton = screen.getAllByText(S.clearFilters)[0];
    fireEvent.click(clearButton);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledWith(
        expect.objectContaining({
          search: '',
          category: 'all',
          state: 'all',
          minRating: 0,
          verifiedOnly: false,
        })
      );
    });
  });

  test('handles pagination navigation next and previous', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText(S.pagination.next)).toBeInTheDocument();
    });

    const nextBtn = screen.getByText(S.pagination.next);
    fireEvent.click(nextBtn);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  test('displays error banner with retry button on fetch failure', async () => {
    (fetchPublicVendors as jest.Mock)
      .mockResolvedValueOnce({
        success: false,
        data: [],
        pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 },
        error: 'Database timeout',
      })
      .mockResolvedValueOnce(MOCK_PAGE_RESULT);

    render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText('Database timeout')).toBeInTheDocument();
    });

    const retryBtn = screen.getByText(S.retryButton);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledTimes(2);
    });
  });

  test('displays empty state when zero vendors match search criteria', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 },
    });

    render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText(S.noVendorsFound)).toBeInTheDocument();
    });

    // Clear filters button in empty state
    const clearBtn = screen.getByRole('button', { name: S.clearFilters });
    fireEvent.click(clearBtn);
  });

  test('opens vendor detail modal, switches all 4 tabs, copies email, and closes via close button and Escape key', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText('Bharat Heavy Engineering Works')).toBeInTheDocument();
    });

    // Click on vendor card to open modal
    const viewButton = screen.getByText(`${S.viewDetailsButton} →`);
    fireEvent.click(viewButton);

    // Modal is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Tab 1: Overview
    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    expect(screen.getByText('(Director of Operations)')).toBeInTheDocument();
    expect(screen.getByText('contact@bharateng.example.com')).toBeInTheDocument();
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
    expect(screen.getByText('https://bharateng.example.com')).toBeInTheDocument();
    expect(screen.getByText('Plot 42, MIDC Bhosari, Pune')).toBeInTheDocument();
    expect(screen.getByText('411018')).toBeInTheDocument();

    // Copy email action
    const copyEmailBtn = screen.getByTitle(S.labels.copyEmail);
    await act(async () => {
      fireEvent.click(copyEmailBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('contact@bharateng.example.com');

    // Tab 2: Categories & Products
    const catTab = screen.getByRole('tab', { name: new RegExp(S.tabs.categories, 'i') });
    fireEvent.click(catTab);
    expect(screen.getByText('Heavy Flanges')).toBeInTheDocument();
    expect(screen.getByText('CNC Machining')).toBeInTheDocument();

    // Tab 3: Compliance & Tax
    const compTab = screen.getByRole('tab', { name: new RegExp(S.tabs.compliance, 'i') });
    fireEvent.click(compTab);
    expect(screen.getByText('27AABCB1234F1Z5')).toBeInTheDocument();
    expect(screen.getByText('AAB****34F')).toBeInTheDocument();
    expect(screen.getByText('UDYAM-MH-01-0012345')).toBeInTheDocument();
    expect(screen.getByText('Private Limited')).toBeInTheDocument();
    expect(screen.getByText('₹50 Cr - ₹100 Cr')).toBeInTheDocument();

    // Tab 4: Performance & Rating
    const perfTab = screen.getByRole('tab', { name: new RegExp(S.tabs.performance, 'i') });
    fireEvent.click(perfTab);
    expect(screen.getByText('VERIFIED SUPPLIER')).toBeInTheDocument();
    expect(screen.getAllByText(S.labels.networkBadge).length).toBeGreaterThan(0);

    // Close via close button
    const closeBtn = screen.getByLabelText(S.closeModal);
    fireEvent.click(closeBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Open again and close via Escape
    const card = screen.getByRole('button', { name: /View profile for Bharat Heavy/i });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('toggles mobile filter sidebar and handles mobile filters', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValue(MOCK_PAGE_RESULT);

    const { container } = render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    const mobileToggle = screen.getByRole('button', { name: /filters/i });
    fireEvent.click(mobileToggle);

    // Mobile sidebar is rendered
    const mobileCatSelect = container.querySelector('#vendor-filter-category-mobile') as HTMLSelectElement;
    expect(mobileCatSelect).toBeInTheDocument();

    // Close mobile sidebar
    const closeMobileBtn = screen.getByLabelText('Close filters');
    fireEvent.click(closeMobileBtn);
  });

  test('covers layout metadata and children rendering', () => {
    expect(metadata.title).toContain('Vendor Directory');
    const { getByText } = render(
      <VendorsLayout>
        <div>Vendors Content Here</div>
      </VendorsLayout>
    );
    expect(getByText('Vendors Content Here')).toBeInTheDocument();
  });

  test('covers vendorUtils helpers (avatarForName, getInitials, renderStars)', () => {
    expect(avatarForName('Acme Corp').bg).toBeDefined();
    expect(getInitials('')).toBe('??');
    expect(getInitials('Tata')).toBe('TA');
    expect(getInitials('Tata Steel Ltd')).toBe('TS');

    const stars = renderStars(4.5);
    expect(stars).toBeDefined();
    const noStars = renderStars(null);
    expect(noStars).toBeDefined();
  });

  test('covers vendor modal tabs with sparse data fallback', async () => {
    const minimalVendor: PublicVendor = {
      id: 'v-sparse',
      name: 'Sparse Co',
      majorCategory: 'Packaging',
      minorCategories: [],
      products: [],
      rating: 0,
      createdAt: null,
    };

    (fetchPublicVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [minimalVendor],
      pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
    });

    render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText('Sparse Co')).toBeInTheDocument();
    });

    const viewButton = screen.getByText(`${S.viewDetailsButton} →`);
    fireEvent.click(viewButton);

    // Categories tab with no minor categories and no products
    const catTab = screen.getByRole('tab', { name: new RegExp(S.tabs.categories, 'i') });
    fireEvent.click(catTab);
    expect(screen.getByText(S.labels.noMinorCategories)).toBeInTheDocument();
    expect(screen.getByText(S.labels.noProducts)).toBeInTheDocument();

    // Compliance tab with no compliance fields
    const compTab = screen.getByRole('tab', { name: new RegExp(S.tabs.compliance, 'i') });
    fireEvent.click(compTab);
    expect(screen.getByText('No compliance details available.')).toBeInTheDocument();

    // Performance tab with no rating
    const perfTab = screen.getByRole('tab', { name: new RegExp(S.tabs.performance, 'i') });
    fireEvent.click(perfTab);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('covers VendorCard space key, direct card click, and minimal field branches', () => {
    const onSelect = jest.fn();
    const minimal: PublicVendor = {
      id: null,
      name: 'Minimal Vendor',
      majorCategory: '',
      minorCategories: [],
      brandName: 'Minimal Vendor',
      location: 'Surat Industrial Estate',
      rating: 0,
      isVerified: false,
      isProcucevNetwork: false,
    };
    render(<VendorCard vendor={minimal} onViewDetails={onSelect} />);
    const card = screen.getByRole('button', { name: /View profile for Minimal Vendor/i });

    // Space key triggers onViewDetails
    fireEvent.keyDown(card, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(minimal);

    // Other key does not trigger onViewDetails
    fireEvent.keyDown(card, { key: 'Tab' });
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Direct card click
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  test('covers VendorDetailModal backdrop click, panel stopPropagation, clipboard failure, and non-http website', async () => {
    const onClose = jest.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error('Clipboard blocked')),
      },
    });

    const vendorWithNonHttp: PublicVendor = {
      id: 'v-non-http',
      name: 'Global Tech Industries',
      brandName: 'Global Tech',
      majorCategory: 'IT & Software',
      minorCategories: ['Cloud'],
      email: 'hello@globaltech.example.com',
      website: 'globaltech.example.com', // does not start with http
      phone: '+91 99999 88888',
      city: 'Hyderabad',
      state: 'Telangana',
      country: 'India',
      factoryAddress: 'HITEC City Phase 2',
      pincode: '500081',
      gstin: '36AAACG1234F1Z8',
      rating: 5,
      isVerified: true,
      isProcucevNetwork: true,
      createdAt: '2023-05-20T00:00:00Z',
    };

    render(<VendorDetailModal vendor={vendorWithNonHttp} onClose={onClose} />);

    // Click backdrop
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();

    // Click inside modal panel (stopPropagation)
    const modalHeading = screen.getByText('Global Tech Industries');
    fireEvent.click(modalHeading);

    // Test clipboard failure branch
    const copyBtn = screen.getByTitle(S.labels.copyEmail);
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Check website link href starts with https://
    const websiteLink = screen.getByText('globaltech.example.com');
    expect(websiteLink.closest('a')).toHaveAttribute('href', 'https://globaltech.example.com');
  });

  test('covers VendorFilterSidebar mobile drawer interactions, select changes, and clear filters', () => {
    const onUpdate = jest.fn();
    const onClear = jest.fn();
    const onClose = jest.fn();
    const filterState: PublicVendorFilterState = {
      search: '',
      category: 'Mechanical',
      state: 'all',
      minRating: 0,
      verifiedOnly: false,
      page: 1,
      pageSize: 24,
    };

    const { container } = render(
      <VendorFilterSidebar
        filter={filterState}
        hasActiveFilters={true}
        onUpdateFilter={onUpdate}
        onClearFilters={onClear}
        isMobile={true}
        onCloseMobile={onClose}
      />
    );

    // Mobile category change
    const catSelect = container.querySelector('#vendor-filter-category-mobile') as HTMLSelectElement;
    fireEvent.change(catSelect, { target: { value: 'Civil & Construction' } });
    expect(onUpdate).toHaveBeenCalledWith({ category: 'Civil & Construction' });
    expect(onClose).toHaveBeenCalled();

    // Mobile state change
    const stateSelect = container.querySelector('#vendor-filter-state-mobile') as HTMLSelectElement;
    fireEvent.change(stateSelect, { target: { value: 'Karnataka' } });
    expect(onUpdate).toHaveBeenCalledWith({ state: 'Karnataka' });

    // Mobile rating change
    const ratingSelect = container.querySelector('#vendor-filter-rating-mobile') as HTMLSelectElement;
    fireEvent.change(ratingSelect, { target: { value: '4.5' } });
    expect(onUpdate).toHaveBeenCalledWith({ minRating: 4.5 });

    // Mobile clear filters button
    const clearBtn = screen.getByRole('button', { name: S.clearFilters });
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });

  test('covers page.tsx exception handling in loadVendors, mobile drawer backdrop, and prev button', async () => {
    (fetchPublicVendors as jest.Mock).mockRejectedValueOnce(new Error('Failed network request'));

    const { container } = render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText(S.errorText)).toBeInTheDocument();
    });

    // Open mobile sidebar
    const mobileToggle = screen.getByRole('button', { name: /filters/i });
    fireEvent.click(mobileToggle);

    // Click mobile drawer backdrop
    const mobileOverlay = container.querySelector('.lg\\:hidden.fixed') as HTMLElement;
    fireEvent.click(mobileOverlay);

    // Retry after mock resolves page 2 data
    (fetchPublicVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [MOCK_VENDOR],
      pagination: { page: 2, pageSize: 24, total: 48, totalPages: 2 },
    });

    const retryBtn = screen.getByText(S.retryButton);
    fireEvent.click(retryBtn);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText(S.pagination.previous)).toBeInTheDocument();
    });

    const prevBtn = screen.getByText(S.pagination.previous);
    fireEvent.click(prevBtn);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(fetchPublicVendors).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    });
  });

  test('covers result.error fallback and updateFilter with explicit page', async () => {
    (fetchPublicVendors as jest.Mock).mockResolvedValueOnce({
      success: false,
      data: [],
      pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 },
      // error is undefined to exercise S.errorText fallback
    });

    render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText(S.errorText)).toBeInTheDocument();
    });
  });

  test('covers VendorDetailModal location only, compliance with pan only, and rating without status', async () => {
    const customVendor: PublicVendor = {
      id: 'v-custom',
      name: 'Custom Fabricators',
      majorCategory: 'Mechanical',
      minorCategories: ['Stamping'],
      products: ['Washers'],
      location: 'Industrial Area Phase 1',
      // no city, no state, no country
      city: null,
      state: null,
      country: null,
      pan: 'ABCDE5678K',
      gstin: null, // gstin is null, pan is present
      rating: 3.5,
      status: null,
      isVerified: false,
      createdAt: null,
    };

    render(<VendorDetailModal vendor={customVendor} onClose={jest.fn()} />);

    // Location is Industrial Area Phase 1
    expect(screen.getByText('Industrial Area Phase 1')).toBeInTheDocument();

    // Compliance tab
    const compTab = screen.getByRole('tab', { name: new RegExp(S.tabs.compliance, 'i') });
    fireEvent.click(compTab);
    expect(screen.getByText('ABCDE5678K')).toBeInTheDocument();

    // Performance tab
    const perfTab = screen.getByRole('tab', { name: new RegExp(S.tabs.performance, 'i') });
    fireEvent.click(perfTab);
    expect(screen.getAllByText('3.5').length).toBeGreaterThan(0);
  });

  test('covers debounce timer cleanup on unmount and vendors with null id in grid', async () => {
    const vendorNoId: PublicVendor = {
      id: null,
      name: 'No Id Vendor',
      majorCategory: 'Packaging',
      minorCategories: [],
      rating: 4,
    };
    (fetchPublicVendors as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [vendorNoId],
      pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
    });

    const { unmount } = render(<PublicVendorDirectoryPage />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText('No Id Vendor')).toBeInTheDocument();
    });

    // Trigger typing to populate debounceRef.current
    const searchInput = screen.getByPlaceholderText(S.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'debounce-test' } });

    // Unmount before timer expires to cover cleanup branch
    unmount();
  });
});
