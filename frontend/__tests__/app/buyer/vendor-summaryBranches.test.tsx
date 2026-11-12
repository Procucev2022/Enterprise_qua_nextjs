import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import VendorSummary, { isBuyerUploaded } from '@/app/buyer/vendor-summary';
import { useApp } from '@/lib/store';
import * as rfqClient from '@/lib/rfqClient';
import * as buyerProfileClient from '@/lib/buyerProfileClient';
import { setCategoryTaxonomy } from '@/lib/categoryTaxonomy';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));
jest.mock('@/lib/rfqClient', () => ({
  fetchAllVendors: jest.fn(),
}));
jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerProfile: jest.fn(),
}));
jest.mock('@/app/category-manager/VendorUploadModal', () => () => null);

const mockFetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;
const mockFetchBuyerProfile = buyerProfileClient.fetchBuyerProfile as jest.Mock;

const UPLOAD_HISTORY_KEY = 'procucev_vendor_upload_history';

const mockShowToast = jest.fn();
const mockAddBuyerVendor = jest.fn();
const mockUpdateBuyerVendor = jest.fn();
const mockDeleteBuyerVendor = jest.fn();
const mockDeleteMultipleBuyerVendors = jest.fn();

const buyerVendors = [
  {
    id: 'v-1',
    name: 'Apex Supplies Ltd.',
    contactPerson: 'Rajesh Nair',
    email: 'rajesh@apex.in',
    location: 'Pune, Maharashtra',
    rating: 4.8,
    source: 'buyer_manual',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    evaluated: true,
    majorCategory: 'Mechanical',
    minorCategories: ['Valves'],
  },
  // Ownership fields (buyerId) make these buyer-uploaded, so they appear in the roster.
  {
    id: 'v-excel',
    name: 'Catalogue Vendor Co',
    source: 'excel',
    buyerId: 'acc-1',
    status: 'REGISTERED',
    majorCategory: 'Electrical',
    minorCategories: [],
  },
  {
    id: 'v-self',
    name: 'Self Onboarded Co',
    source: 'self_onboarded',
    buyerId: 'acc-1',
    status: 'REGISTERED',
    majorCategory: 'Civil',
    minorCategories: [],
  },
  {
    id: 'v-network',
    name: 'Network Partner Co',
    source: 'procucev_network',
    buyerId: 'acc-1',
    status: 'REGISTERED',
    majorCategory: 'Civil',
    minorCategories: [],
  },
];

function storeWith(overrides: Record<string, unknown> = {}) {
  return {
    vendorEvaluations: [],
    currentMode: 'mode_3',
    rfqs: [],
    showToast: mockShowToast,
    buyerVendors,
    addBuyerVendor: mockAddBuyerVendor,
    updateBuyerVendor: mockUpdateBuyerVendor,
    deleteBuyerVendor: mockDeleteBuyerVendor,
    deleteMultipleBuyerVendors: mockDeleteMultipleBuyerVendors,
    categoryTaxonomy: CATEGORY_TAXONOMY_FIXTURE,
    reviseVendorRating: jest.fn(),
    openRatingRevisionEmailModal: jest.fn(),
    activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
    ...overrides,
  };
}

const renderSummary = () =>
  render(<VendorSummary onViewEvaluation={jest.fn()} onNavigateToWizard={jest.fn()} />);

/** Seeds the upload history the modal reads from local storage. */
const seedUploadHistory = (batches: unknown[]) => {
  localStorage.setItem(UPLOAD_HISTORY_KEY, JSON.stringify(batches));
};

const openUploadHistory = () => fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setCategoryTaxonomy(CATEGORY_TAXONOMY_FIXTURE);
  (useApp as jest.Mock).mockReturnValue(storeWith());
  mockFetchAllVendors.mockResolvedValue({
    success: true,
    candidates: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  });
  mockFetchBuyerProfile.mockResolvedValue({ success: false, error: 'unavailable' });
});

describe('app/buyer/vendor-summary.tsx: uncovered branches', () => {
  it('does not treat a vendor record with no source as buyer-uploaded', () => {
    expect(isBuyerUploaded({})).toBe(false);
  });

  it('labels catalogue, self-onboarded and network-sourced vendors by their origin', () => {
    renderSummary();
    expect(screen.getByText('Catalogue Vendor Co')).toBeInTheDocument();
    expect(screen.getByText('Category Manager Catalogue')).toBeInTheDocument();
    expect(screen.getByText('Direct Self-Onboarded')).toBeInTheDocument();
    expect(screen.getByText('Procucev Network Partner')).toBeInTheDocument();
  });

  it('clears a vendor selection when its checkbox is clicked a second time', () => {
    renderSummary();
    const checkbox = screen.getByTestId('select-vendor-v-1') as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('counts a batch from its records when it has no total or imported figure, and filters nameless records', () => {
    seedUploadHistory([
      {
        id: 'batch-legacy',
        fileName: 'legacy-upload.xlsx',
        timestamp: '2026-05-01 09:00',
        records: [
          { vendorCode: 'VC-100', name: 'Alpha Industrial' },
          { vendorCode: 'VC-101', contactPerson: 'Only A Contact' },
        ],
      },
    ]);
    renderSummary();
    openUploadHistory();
    fireEvent.click(screen.getByRole('button', { name: /View Records/i }));

    expect(screen.getByText('Alpha Industrial')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search this batch...'), {
      target: { value: 'only a contact' },
    });
    expect(screen.queryByText('Alpha Industrial')).not.toBeInTheDocument();
  });

  it('shows dashes for a batch with no id, file name, timestamp, counts or records', () => {
    seedUploadHistory([{}]);
    renderSummary();
    openUploadHistory();
    fireEvent.click(screen.getByRole('button', { name: /View Records/i }));

    expect(screen.getByText(/Batch ID:/)).toHaveTextContent('Batch ID: — · Uploaded: —');
  });

  it('adds a minor category picked from the dropdown in the add form', () => {
    renderSummary();
    fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
    const addDialog = screen.getByText(/Add a vendor you deal with directly/).closest('.modal-content') as HTMLElement;

    const majorSelect = within(addDialog)
      .getAllByRole('combobox')
      .find((select) => select.querySelector('option[value="Civil Works"]') !== null) as HTMLSelectElement;
    fireEvent.change(majorSelect, { target: { value: 'Civil Works' } });

    // The minor list is built from the chosen major, so it appears only once a major is selected.
    const minorSelect = addDialog.querySelector('#add-vendor-minor-category') as HTMLSelectElement;
    fireEvent.change(minorSelect, { target: { value: 'Back filing' } });

    // The option and the new tag both read "Back filing".
    expect(within(addDialog).getAllByText('Back filing').length).toBeGreaterThan(1);
  });

  it('clears the rating field in the add form', () => {
    renderSummary();
    fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
    const rating = screen.getByPlaceholderText('1.0 - 5.0') as HTMLInputElement;

    fireEvent.change(rating, { target: { value: '4.5' } });
    fireEvent.change(rating, { target: { value: '' } });
    expect(rating.value).toBe('');
  });
});
