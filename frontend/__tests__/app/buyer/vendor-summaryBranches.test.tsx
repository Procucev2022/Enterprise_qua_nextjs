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

    expect(screen.getByText('Vendor Template Upload Batch Details')).toBeInTheDocument();
    const historyModal = screen.getByTestId('upload-history-modal');
    expect(within(historyModal).getByText('Alpha Industrial')).toBeInTheDocument();
    fireEvent.change(within(historyModal).getByPlaceholderText('Search this batch...'), {
      target: { value: 'only a contact' },
    });
    expect(within(historyModal).queryByText('Alpha Industrial')).not.toBeInTheDocument();
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

    // The searchable category input shows suggestions when >= 3 characters are typed
    const categoryInput = addDialog.querySelector('#add-vendor-category-input') as HTMLInputElement;
    fireEvent.change(categoryInput, { target: { value: 'Back filing' } });
    const suggestionOption = screen.getByRole('option', { name: /Back filing/i });
    fireEvent.click(suggestionOption);

    expect(within(addDialog).getByText('Back filing')).toBeInTheDocument();
  });

  it('clears the rating field in the add form', () => {
    renderSummary();
    fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
    const rating = screen.getByPlaceholderText('1.0 - 5.0') as HTMLInputElement;

    fireEvent.change(rating, { target: { value: '4.5' } });
    fireEvent.change(rating, { target: { value: '' } });
    expect(rating.value).toBe('');
  });

  it('reconciles uploaded history batches into the buyer directory on mount and handles deduplication and corrupt history', () => {
    seedUploadHistory([
      {
        id: 'batch-reconcile-1',
        fileName: 'Testing data.csv',
        records: [
          {
            vendorName: 'Reconciled Mfg Co',
            email: 'reconciled@mfg.test',
            phone: '9876543210',
            gstin: '36ABCDE1234F1Z5',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500037',
            rating: 4.5,
            majorCategory: 'Mechanical',
            minorCategories: ['Pumps'],
          },
          {
            email: 'emailonly@history.test',
          },
          {
            name: 'Duplicate Email Co',
            email: 'RECONCILED@MFG.TEST',
          },
          {
            name: 'Failed Row Co',
            email: 'failed@history.test',
            status: 'FAILED',
          },
          {
            name: '',
            email: '',
          },
        ],
      },
      {
        records: null,
      },
    ]);

    renderSummary();
    expect(screen.getByText('Reconciled Mfg Co')).toBeInTheDocument();
    expect(screen.getByText('emailonly@history.test')).toBeInTheDocument();
    expect(screen.queryByText('Failed Row Co')).not.toBeInTheDocument();

    localStorage.setItem('procucev_vendor_upload_history', JSON.stringify({ not: 'an-array' }));
    renderSummary();

    localStorage.setItem('procucev_vendor_upload_history', '{invalid-json');
    renderSummary();
  });

  it('normalizes vendor minor categories from clientMappedCategories, poMinorCategories, vendorSelectedCategories, and itemsSupplied', () => {
    const vendorsToNormalize = [
      {
        id: 'v-norm-client',
        name: 'Client Mapped Co',
        source: 'buyer_uploaded',
        majorCategory: '',
        minorCategories: [],
        clientMappedCategories: ['Valves'],
      },
      {
        id: 'v-norm-po',
        name: 'PO Minor Co',
        source: 'buyer_uploaded',
        majorCategory: '',
        minorCategories: [],
        poMinorCategories: ['Pumps'],
      },
      {
        id: 'v-norm-self',
        name: 'Vendor Selected Co',
        source: 'buyer_uploaded',
        majorCategory: '',
        minorCategories: [],
        vendorSelectedCategories: ['Cables'],
      },
      {
        id: 'v-norm-items',
        name: 'Items Supplied Co',
        source: 'buyer_uploaded',
        majorCategory: 'Civil Works',
        minorCategories: [],
        itemsSupplied: ['Plumbing Kit', 'Unknown Item'],
      },
    ];
    (useApp as jest.Mock).mockReturnValue(storeWith({ buyerVendors: vendorsToNormalize }));
    renderSummary();

    expect(screen.getByText('Client Mapped Co')).toBeInTheDocument();
    expect(screen.getByText('PO Minor Co')).toBeInTheDocument();
    expect(screen.getByText('Vendor Selected Co')).toBeInTheDocument();
    expect(screen.getByText('Items Supplied Co')).toBeInTheDocument();
  });

  it('displays PO category suggestions from poMajorCategory, RFQ records, and clientMappedCategories and applies them', () => {
    const rfqSourcedVendor = {
      id: 'v-rfq-sug',
      name: 'RFQ Suggested Co',
      source: 'buyer_uploaded',
      majorCategory: 'Vendor Master',
      minorCategories: [],
    };
    const poSourcedVendor = {
      id: 'v-po-sug',
      name: 'PO Suggested Co',
      source: 'buyer_uploaded',
      majorCategory: 'Mechanical',
      minorCategories: ['Valves'],
      poMajorCategory: 'Mechanical',
      poMinorCategories: ['Pumps'],
    };
    const clientSugVendor = {
      id: 'v-client-sug',
      name: 'Client Sug Co',
      source: 'buyer_uploaded',
      majorCategory: 'Mechanical',
      minorCategories: [],
      clientMappedCategories: ['Custom NonTaxon Minor'],
    };
    const emptyRfqSugVendor = {
      id: 'v-rfq-major-only',
      name: 'RFQ Major Only Co',
      source: 'buyer_uploaded',
      majorCategory: '',
      minorCategories: [],
    };

    const rfqs = [
      {
        id: 'rfq-s-1',
        quotations: [{ vendorId: 'v-rfq-sug', vendorName: 'RFQ Suggested Co' }],
        followUps: [],
        extractedEntities: [
          { majorCategory: 'Vendor Master', minorCategory: 'Uncategorized' },
          { majorCategory: 'Mechanical', minorCategory: 'Valves' },
        ],
      },
      {
        id: 'rfq-s-2',
        quotations: [],
        followUps: [{ vendorId: 'v-rfq-major-only', vendorName: 'RFQ Major Only Co' }],
        extractedEntities: [{ majorCategory: '', minorCategory: 'Valves' }],
      },
    ];

    (useApp as jest.Mock).mockReturnValue(
      storeWith({
        buyerVendors: [rfqSourcedVendor, poSourcedVendor, clientSugVendor, emptyRfqSugVendor],
        rfqs,
      })
    );

    const { rerender } = renderSummary();

    // 1. PO Ingestion suggestion & Apply PO Suggestion button
    fireEvent.click(screen.getByTestId('edit-category-vendor-v-po-sug'));
    let modal = screen.getByTestId('vendor-category-modal');
    expect(within(modal).getByText(/Suggested from PO Ingestion:/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Mechanical \(Pumps\)/i)).toBeInTheDocument();
    fireEvent.click(within(modal).getByTestId('apply-po-suggestion-button'));
    fireEvent.click(within(modal).getByTestId('close-vendor-category-modal'));

    // 2. RFQ Records suggestion
    fireEvent.click(screen.getByTestId('add-category-vendor-v-rfq-sug'));
    modal = screen.getByTestId('vendor-category-modal');
    expect(within(modal).getByText(/Suggested from PO Purchase Dump \/ RFQ Records:/i)).toBeInTheDocument();
    expect(within(modal).getByText('Category Not Assigned')).toBeInTheDocument();
    fireEvent.click(within(modal).getByTestId('close-vendor-category-modal'));

    // 3. RFQ suggestion with empty majorCategory ('Multi-Category')
    fireEvent.click(screen.getByTestId('add-category-vendor-v-rfq-major-only'));
    modal = screen.getByTestId('vendor-category-modal');
    expect(within(modal).getByText(/Multi-Category \(Valves\)/i)).toBeInTheDocument();
    fireEvent.click(within(modal).getByTestId('apply-po-suggestion-button'));
    fireEvent.click(within(modal).getByTestId('close-vendor-category-modal'));

    // 4. PO Master Data suggestion (clientMappedCategories without taxonomy hit falls back to vendor.majorCategory)
    fireEvent.click(screen.getByTestId('edit-category-vendor-v-client-sug'));
    modal = screen.getByTestId('vendor-category-modal');
    expect(within(modal).getByText(/Suggested from PO Master Data:/i)).toBeInTheDocument();
    fireEvent.click(within(modal).getByTestId('close-vendor-category-modal'));

    // 5. Storage / custom event listener triggers loadUploadHistory refresh
    fireEvent(window, new Event('vendor_upload_history_updated'));
    rerender(<VendorSummary onViewEvaluation={jest.fn()} onNavigateToWizard={jest.fn()} />);
  });
});
