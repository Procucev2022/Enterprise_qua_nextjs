import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AllRFQsConsole from '@/app/category-manager/all-rfqs';
import CategoryManagerAllRFQsPage from '@/app/category-manager/all-rfqs/page';
import * as rfqClient from '@/lib/rfqClient';
import * as storeModule from '@/lib/store';
import * as reportsClient from '@/lib/reportsClient';
import { RFQItem } from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

jest.mock('@/lib/rfqClient');
jest.mock('@/lib/store');
jest.mock('@/lib/reportsClient', () => ({
  exportReportToCsv: jest.fn(),
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const S = UI_STRINGS.allRfqs;
const S2 = UI_STRINGS.inviteVendors;
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

function makeRfq(overrides: Partial<RFQItem> & { id: string }): RFQItem {
  return {
    rfqNumber: `RFQ-2026-${overrides.id}`,
    title: 'Test RFQ',
    category: 'Cables',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-01',
    budget: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    buyerAccountName: 'Alpha Buyer Co',
    ...overrides,
  };
}

const ROWS: RFQItem[] = [
  makeRfq({ id: '001', title: 'Copper Cable', category: 'Cables', status: 'Quotes Pending', budget: 150000, buyerAccountName: 'Alpha Buyer Co' }),
  makeRfq({ id: '002', title: 'Steel Pumps', category: 'Pumps', status: 'PO Generated', quotesCount: 3, buyerAccountName: 'Beta Buyer Co' }),
  makeRfq({ id: '003', title: 'Valves Lot', category: 'Valves', status: 'Parsing', buyerAccountName: null }),
];

const mockFetch = rfqClient.fetchAllRFQs as jest.Mock;
const mockShowToast = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  push.mockClear();
  mockFetch.mockResolvedValue({ success: true, rfqs: ROWS });
  (storeModule.useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
});

describe('AllRFQsConsole', () => {
  it('loads and renders every RFQ with its buyer attribution', async () => {
    render(<AllRFQsConsole />);

    expect(screen.getByText(S.loading)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    // Appears both as a table cell and as a filter option.
    expect(screen.getAllByText('Beta Buyer Co').length).toBeGreaterThanOrEqual(1);
    // The unattributed RFQ falls back to a placeholder rather than a blank cell.
    expect(screen.getByText(S.buyerUnknown)).toBeInTheDocument();
    // 3 RFQs across 2 named buyers.
    expect(screen.getByTestId('all-rfqs-count')).toHaveTextContent('3');
    expect(screen.getByTestId('all-rfqs-count')).toHaveTextContent('2');
  });

  it('formats a stated budget and marks an unstated one', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    expect(screen.getAllByText(S.budgetUnset).length).toBeGreaterThan(0);
    expect(screen.getByText(/1,50,000|150,000/)).toBeInTheDocument();
  });

  it('shows the latest vendor quotation submission date, and a placeholder when none exist', async () => {
    const quoted = makeRfq({
      id: '010',
      title: 'Quoted RFQ',
      status: 'Quotes Received',
      quotesCount: 2,
      buyerAccountName: 'Alpha Buyer Co',
      quotes: [
        { vendorId: 'v-1', vendorName: 'Early Vendor', submittedAt: '2026-10-01T09:00:00.000Z' },
        // The later timestamp is the one that must surface as "latest".
        { vendorId: 'v-2', vendorName: 'Late Vendor', submittedAt: '2026-10-05T14:30:00.000Z' },
        // An earlier timestamp to test the false branch of reduce comparator
        { vendorId: 'v-3', vendorName: 'Oldest Vendor', submittedAt: '2026-09-01T00:00:00.000Z' },
        // Invalid and missing timestamps
        { vendorId: 'v-4', vendorName: 'Invalid Vendor', submittedAt: 'invalid-date' },
        { vendorId: 'v-5', vendorName: 'No Timestamp Vendor' } as any,
      ] as RFQItem['quotes'],
    });
    mockFetch.mockResolvedValue({ success: true, rfqs: [quoted, ROWS[0]] });

    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Quoted RFQ')).toBeInTheDocument());

    const cells = screen.getAllByTestId('all-rfqs-latest-quote');
    // Latest of the two quotes is the 5 Oct timestamp — rendered with month + year.
    expect(cells.some((c) => /Oct 2026/.test(c.textContent || ''))).toBe(true);
    // The quote-less RFQ shows the placeholder instead of a date.
    expect(screen.getByText(S.latestQuoteNone)).toBeInTheDocument();
  });

  it('filters by free-text search', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'pumps' } });

    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    expect(screen.queryByText('Copper Cable')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3 RFQs')).toBeInTheDocument();
  });

  it('clears all active search and filter values', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'pumps' } });
    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'PO Generated' } });
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: S.clearFilters }));

    expect(screen.getByLabelText(S.searchLabel)).toHaveValue('');
    expect(screen.getByLabelText(S.statusFilterLabel)).toHaveValue('all');
    expect(screen.getByLabelText(S.buyerFilterLabel)).toHaveValue('all');
    expect(screen.getByText('Copper Cable')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 3 RFQs')).toBeInTheDocument();
  });

  it('clears the search field without resetting the other filters', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'pumps' } });
    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'PO Generated' } });
    fireEvent.click(screen.getByRole('button', { name: S.clearSearch }));

    expect(screen.getByLabelText(S.searchLabel)).toHaveValue('');
    expect(screen.getByLabelText(S.statusFilterLabel)).toHaveValue('PO Generated');
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    expect(screen.queryByText('Copper Cable')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'PO Generated' } });

    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    expect(screen.queryByText('Copper Cable')).not.toBeInTheDocument();
  });

  it('filters by buyer', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.buyerFilterLabel), { target: { value: 'Alpha Buyer Co' } });

    expect(screen.getByText('Copper Cable')).toBeInTheDocument();
    expect(screen.queryByText('Steel Pumps')).not.toBeInTheDocument();
  });

  it('shows a no-matches message when filters exclude everything', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'zzz-nothing' } });

    expect(screen.getByText(S.noMatches)).toBeInTheDocument();
  });

  it('shows the empty state when the system has no RFQs', async () => {
    mockFetch.mockResolvedValue({ success: true, rfqs: [] });
    render(<AllRFQsConsole />);

    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());
  });

  it('surfaces a load failure and retries on demand', async () => {
    mockFetch.mockResolvedValueOnce({ success: false, error: 'Boom.' });
    render(<AllRFQsConsole />);

    await waitFor(() => expect(screen.getByText('Boom.')).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce({ success: true, rfqs: ROWS });
    fireEvent.click(screen.getAllByRole('button', { name: S.retryAction })[1]);

    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());
  });

  it('surfaces default load failure when error property is omitted', async () => {
    mockFetch.mockResolvedValueOnce({ success: false });
    render(<AllRFQsConsole />);

    await waitFor(() => expect(screen.getByText(S.loadFailed)).toBeInTheDocument());
  });

  it('reloads when the header refresh button is pressed', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: S.retryAction })[0]);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('invokes the matrix navigation callback for the chosen RFQ', async () => {
    const onNavigateToMatrix = jest.fn();
    render(<AllRFQsConsole onNavigateToMatrix={onNavigateToMatrix} />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Open the comparative quote matrix for ${ROWS[1].rfqNumber}`));

    expect(onNavigateToMatrix).toHaveBeenCalledWith(ROWS[1]);
  });

  it('invokes the details callback for the chosen RFQ', async () => {
    const onViewDetails = jest.fn();
    render(<AllRFQsConsole onViewDetails={onViewDetails} />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`View the full submitted detail for ${ROWS[1].rfqNumber}`));

    expect(onViewDetails).toHaveBeenCalledWith(ROWS[1]);
  });

  it('does not throw when no navigation callbacks are supplied', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Open the comparative quote matrix for ${ROWS[1].rfqNumber}`));
    fireEvent.click(screen.getByLabelText(`View the full submitted detail for ${ROWS[1].rfqNumber}`));
    // No assertion beyond "it rendered and clicked without error".
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
  });

  it('opens the Invite Vendors modal for a row, and applies the updated RFQ to the table on success', async () => {
    const mockFetchCandidates = rfqClient.fetchVendorCandidates as jest.Mock;
    const mockInvite = rfqClient.inviteVendorsToRFQ as jest.Mock;
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [{ id: 'v-1', name: 'Steel Vendor', majorCategory: 'Pumps', alreadyInvited: false }],
    });
    const updatedRow = { ...ROWS[1], quotesCount: 9 };
    mockInvite.mockResolvedValue({ success: true, rfq: updatedRow, invitedCount: 1 });

    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Invite vendors to ${ROWS[1].rfqNumber}`));

    await waitFor(() => expect(mockFetchCandidates).toHaveBeenCalledWith(ROWS[1].id));
    await waitFor(() => expect(screen.getByText('Steel Vendor')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S2.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith(ROWS[1].id, ['v-1']));
    // The modal closes and the row's quotesCount reflects the server's updated RFQ.
    await waitFor(() => expect(screen.queryByTestId('invite-vendors-modal')).not.toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('closes the Invite Vendors modal without changing the table when cancelled', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Invite vendors to ${ROWS[1].rfqNumber}`));
    await waitFor(() => expect(screen.getByTestId('invite-vendors-modal')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(S2.closeAria));
    await waitFor(() => expect(screen.queryByTestId('invite-vendors-modal')).not.toBeInTheDocument());
  });

  it('opens BuyerDetailsModal when buyer name button is clicked and closes on Close button', async () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      buyerAccounts: [
        {
          id: 'b-1',
          organizationName: 'Alpha Buyer Co',
          brandName: 'Alpha Tech',
          contactPerson: 'Alpha Officer',
          contactDesignation: 'VP SCM',
          corporateEmail: 'procure@alpha.com',
          mobileNumber: '+91 9876543210',
          gstin: '27AAAAA0000A1Z5',
          city: 'Mumbai',
          state: 'Maharashtra',
        },
      ],
    });

    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    const buyerBtn = screen.getByRole('button', { name: /Alpha Buyer Co/i });
    fireEvent.click(buyerBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Enterprise Buyer Account & Profile Details/)).toBeInTheDocument();
    expect(screen.getByText('Alpha Officer')).toBeInTheDocument();
    expect(screen.getByText('27AAAAA0000A1Z5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Close modal/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens VendorDetailsModal when a quoted vendor button is clicked and closes on Close button', async () => {
    const quotedRow = makeRfq({
      id: '020',
      title: 'Electrical Transformers',
      status: 'Quotes Received',
      quotesCount: 1,
      quotes: [
        {
          vendorId: 'v-navin',
          vendorName: 'Navin Electricals',
          vendorCategory: 'Client List',
          unitPrice: 45000,
          totalPrice: 90000,
          leadTimeDays: 14,
          aiMatchScore: 94,
          isBestPrice: true,
          warrantyYears: 2,
          complianceStatus: 'Fully Compliant',
          paymentTerms: 'Net 30',
          remarks: 'Standard testing included',
        },
      ] as any,
    });
    mockFetch.mockResolvedValue({ success: true, rfqs: [quotedRow] });
    (storeModule.useApp as jest.Mock).mockReturnValue({
      showToast: mockShowToast,
      buyerVendors: [
        {
          id: 'v-navin',
          name: 'Navin Electricals',
          contactPerson: 'Navin Chaudhary',
          phone: '+91 9157154504',
          email: 'navin@electricals.com',
          location: 'Ahmedabad, Gujarat',
          rating: 4.9,
          majorCategory: 'Electrical Equipment',
        },
      ],
    });

    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Electrical Transformers')).toBeInTheDocument());

    const vendorBtn = screen.getByRole('button', { name: /Navin Electricals/i });
    expect(vendorBtn).toBeInTheDocument();
    fireEvent.click(vendorBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Navin Chaudhary')).toBeInTheDocument();
    expect(screen.getByText('navin@electricals.com')).toBeInTheDocument();
    expect(screen.getByText('"Standard testing included"')).toBeInTheDocument();
    expect(screen.getByText(/L1 Best Price/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Close modal/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens VendorListModal when +more button is clicked and selects a vendor', async () => {
    const multiRow = makeRfq({
      id: '030',
      title: 'Power Cables',
      status: 'Quotes Received',
      quotesCount: 3,
      quotes: [
        { vendorId: 'v-1', vendorName: 'Vendor 1' },
        { vendorId: 'v-2', vendorName: 'Vendor 2' },
        { vendorId: 'v-3', vendorName: 'Vendor 3' },
      ] as any,
    });
    mockFetch.mockResolvedValue({ success: true, rfqs: [multiRow] });

    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Power Cables')).toBeInTheDocument());

    const moreBtn = screen.getByRole('button', { name: /\+1 more/i });
    expect(moreBtn).toBeInTheDocument();
    fireEvent.click(moreBtn);

    // Vendor list modal opens
    expect(screen.getByText(/Quoted Vendors \(3\)/i)).toBeInTheDocument();
    expect(screen.getByText('Vendor 3')).toBeInTheDocument();

    // Click View Details button for Vendor 3
    const viewDetailBtns = screen.getAllByRole('button', { name: /View Details/i });
    fireEvent.click(viewDetailBtns[viewDetailBtns.length - 1]);
    expect(screen.getByText(/Vendor Profile & Quotation Details/i)).toBeInTheDocument();

    // Close VendorDetailsModal
    fireEvent.click(screen.getByRole('button', { name: /Close modal/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('filters by search term matching quoted vendor name or invited vendor name', async () => {
    const searchRows: RFQItem[] = [
      makeRfq({
        id: 'q-search',
        title: 'Special Item',
        quotes: [{ vendorId: 'vq-1', vendorName: 'Specialist Supplies', totalPrice: 500, leadTimeDays: 2, warrantyYears: 1, submittedAt: '2026-06-01' } as any],
        assignedVendors: [],
      }),
      makeRfq({
        id: 'a-search',
        title: 'Another Item',
        quotes: [],
        assignedVendors: [{ id: 'va-1', name: 'Nominated Partner' } as any],
      }),
    ];
    mockFetch.mockResolvedValueOnce({ success: true, rfqs: searchRows });
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Special Item')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(S.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'specialist' } });
    expect(screen.getByText('Special Item')).toBeInTheDocument();
    expect(screen.queryByText('Another Item')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'nominated' } });
    expect(screen.queryByText('Special Item')).not.toBeInTheDocument();
    expect(screen.getByText('Another Item')).toBeInTheDocument();
  });

  it('opens VendorDetailsModal when an invited vendor chip is clicked', async () => {
    const rfqWithAssigned: RFQItem[] = [
      makeRfq({
        id: 'rfq-assigned-chip',
        title: 'Equipment Purchase',
        assignedVendors: [
          { id: 'av-1', name: 'Alpha Logistics' } as any,
        ],
      }),
    ];
    mockFetch.mockResolvedValueOnce({ success: true, rfqs: rfqWithAssigned });
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Equipment Purchase')).toBeInTheDocument());

    const vendorChip = screen.getByTitle('Invited vendor: Alpha Logistics. Click to view details.');
    fireEvent.click(vendorChip);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close modal/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens VendorListModal for assigned vendors with +more button and views details', async () => {
    const rfqManyAssigned: RFQItem[] = [
      makeRfq({
        id: 'rfq-many-assigned',
        title: 'Heavy Machinery',
        assignedVendors: [
          { id: 'av-1', name: 'Alpha Logistics', contactPerson: 'John Doe', city: 'Mumbai' } as any,
          { id: 'av-2', name: 'Beta Freight' } as any,
          { id: 'av-3', name: 'Gamma Supply' } as any,
        ],
      }),
    ];
    mockFetch.mockResolvedValueOnce({ success: true, rfqs: rfqManyAssigned });
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Heavy Machinery')).toBeInTheDocument());

    const moreBtn = screen.getByTitle('Click to view all invited vendors');
    fireEvent.click(moreBtn);

    expect(screen.getByText(/Invited Vendors \(3\)/i)).toBeInTheDocument();
    expect(screen.getByText('Contact: John Doe')).toBeInTheDocument();
    expect(screen.getByText('Mumbai')).toBeInTheDocument();

    // Click view details on first assigned vendor in modal
    const viewDetailsButtons = screen.getAllByRole('button', { name: 'View Details' });
    fireEvent.click(viewDetailsButtons[0]);

    // Vendor details modal opened
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close modal/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('supports string representation of assigned vendors and modal close interactions', async () => {
    const rfqStringAssigned: RFQItem[] = [
      makeRfq({
        id: 'rfq-str-assigned',
        title: 'Textile Fiber',
        quotes: [
          { vendorId: 'vq-best', vendorName: 'Best Bidder Corp', totalPrice: 400, isBestPrice: true, submittedAt: '2026-06-01' } as any,
          { vendorId: 'vq-2', vendorName: 'Second Bidder', totalPrice: 600, submittedAt: '2026-06-02' } as any,
          { vendorId: 'vq-3', vendorName: 'Third Bidder', totalPrice: 700, submittedAt: '2026-06-03' } as any,
        ],
        assignedVendors: [
          'String Vendor One' as any,
          { companyName: 'Company Only Vendor' } as any,
          { vendorName: 'Named Vendor Only' } as any,
        ],
      }),
    ];
    mockFetch.mockResolvedValueOnce({ success: true, rfqs: rfqStringAssigned });
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Textile Fiber')).toBeInTheDocument());

    // Open Quotes modal (+1 more)
    fireEvent.click(screen.getByTitle('Click to view all quoted vendors'));
    expect(screen.getByText('L1 Best Price')).toBeInTheDocument();

    // Close modal using close button
    const closeButtons = screen.getAllByRole('button');
    const closeX = closeButtons.find(b => b.className.includes('rounded-lg p-1.5 text-slate-400'));
    if (closeX) {
      fireEvent.click(closeX);
    }

    // Open assigned vendors modal and close using bottom Close button
    fireEvent.click(screen.getByTitle('Click to view all invited vendors'));
    expect(screen.getAllByText('String Vendor One').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Company Only Vendor').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Named Vendor Only').length).toBeGreaterThanOrEqual(1);

    const closeBottom = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBottom);
  });

  it('renders category signals and needsAssignment indicators for mode_0 and v0 RFQs', async () => {
    const rfqWithEntities: RFQItem[] = [
      makeRfq({
        id: 'rfq-v0-header',
        title: 'V0 With Header',
        sourcingMode: 'v0' as any,
        category: 'Electronics',
        assignedVendors: [],
      }),
      makeRfq({
        id: 'rfq-entities-cat',
        title: 'Entity Driven RFQ',
        sourcingMode: 'mode_0',
        category: '',
        needsCategoryManagerAssignment: true,
        extractedEntities: [
          { majorCategory: 'Electronics', minorCategory: 'Semiconductors' } as any,
        ],
        assignedVendors: [],
      }),
      makeRfq({
        id: 'rfq-minor-cat',
        title: 'Minor Only RFQ',
        sourcingMode: 'mode_0',
        category: '',
        extractedEntities: [
          { minorCategory: 'Wires' } as any,
        ],
        assignedVendors: [],
      }),
      makeRfq({
        id: 'rfq-generic-cat',
        title: 'Generic Only RFQ',
        sourcingMode: 'mode_0',
        category: '',
        extractedEntities: [
          { category: 'General Goods' } as any,
        ],
        assignedVendors: [],
      }),
      makeRfq({
        id: 'rfq-no-signal',
        title: 'No Category Signal RFQ',
        status: 'v0' as any,
        sourcingMode: 'mode_0',
        category: '',
        extractedEntities: [{ majorCategory: '' } as any],
        assignedVendors: [],
      }),
    ];
    mockFetch.mockResolvedValueOnce({ success: true, rfqs: rfqWithEntities });
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Entity Driven RFQ')).toBeInTheDocument());
    expect(screen.getByText('No Category Signal RFQ')).toBeInTheDocument();
    expect(screen.getAllByText('Pending CM Assignment').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Assign Vendors').length).toBeGreaterThanOrEqual(1);
  });

  describe('Date Range Filtering and CSV Export', () => {
    it('renders start date, end date inputs and export csv button in the header', async () => {
      mockFetch.mockResolvedValueOnce({ success: true, rfqs: ROWS });
      render(<AllRFQsConsole />);
      await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

      expect(screen.getByLabelText(S.startDateLabel)).toBeInTheDocument();
      expect(screen.getByLabelText(S.endDateLabel)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: S.exportCsvAria })).toBeInTheDocument();
    });

    it('filters RFQs by start date and end date', async () => {
      const variedRows: RFQItem[] = [
        makeRfq({ id: 'd1', title: 'Jan RFQ', createdAt: '2026-01-15T10:00:00.000Z' }),
        makeRfq({ id: 'd2', title: 'Jun RFQ', createdAt: '2026-06-15T10:00:00.000Z' }),
        makeRfq({ id: 'd3', title: 'Dec RFQ', createdAt: '2026-12-15T10:00:00.000Z' }),
      ];
      mockFetch.mockResolvedValueOnce({ success: true, rfqs: variedRows });
      render(<AllRFQsConsole />);
      await waitFor(() => expect(screen.getByText('Jun RFQ')).toBeInTheDocument());

      // Filter by start date
      fireEvent.change(screen.getByLabelText(S.startDateLabel), { target: { value: '2026-06-01' } });
      expect(screen.queryByText('Jan RFQ')).not.toBeInTheDocument();
      expect(screen.getByText('Jun RFQ')).toBeInTheDocument();
      expect(screen.getByText('Dec RFQ')).toBeInTheDocument();

      // Filter by end date
      fireEvent.change(screen.getByLabelText(S.endDateLabel), { target: { value: '2026-11-30' } });
      expect(screen.queryByText('Jan RFQ')).not.toBeInTheDocument();
      expect(screen.getByText('Jun RFQ')).toBeInTheDocument();
      expect(screen.queryByText('Dec RFQ')).not.toBeInTheDocument();

      // Clear filters
      fireEvent.click(screen.getByRole('button', { name: S.clearFilters }));
      expect(screen.getByText('Jan RFQ')).toBeInTheDocument();
      expect(screen.getByText('Jun RFQ')).toBeInTheDocument();
      expect(screen.getByText('Dec RFQ')).toBeInTheDocument();
      expect((screen.getByLabelText(S.startDateLabel) as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText(S.endDateLabel) as HTMLInputElement).value).toBe('');
    });

    it('exports CSV with formatted RFQ data when Export CSV button is clicked', async () => {
      mockFetch.mockResolvedValueOnce({ success: true, rfqs: ROWS });
      render(<AllRFQsConsole />);
      await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

      const exportBtn = screen.getByRole('button', { name: S.exportCsvAria });
      expect(exportBtn).not.toBeDisabled();
      fireEvent.click(exportBtn);

      expect(reportsClient.exportReportToCsv).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            [S.colRfqNumber]: ROWS[0].rfqNumber,
            [S.colTitle]: ROWS[0].title,
            [S.colCategory]: ROWS[0].category,
            [S.colBuyer]: ROWS[0].buyerAccountName,
          }),
        ]),
        expect.stringMatching(new RegExp(`^${S.downloadFilename}`))
      );
    });

    it('disables Export CSV button when no RFQs match filters', async () => {
      mockFetch.mockResolvedValueOnce({ success: true, rfqs: ROWS });
      render(<AllRFQsConsole />);
      await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

      // Set date range that matches nothing
      fireEvent.change(screen.getByLabelText(S.startDateLabel), { target: { value: '2029-01-01' } });
      expect(screen.getByText(S.noMatches)).toBeInTheDocument();

      const exportBtn = screen.getByRole('button', { name: S.exportCsvAria });
      expect(exportBtn).toBeDisabled();
    });

    it('handles date filtering for RFQs with missing or empty createdAt', async () => {
      const rowsWithMissingDate: RFQItem[] = [
        makeRfq({ id: 'valid-date', title: 'Dated RFQ', createdAt: '2026-06-15T10:00:00.000Z' }),
        makeRfq({ id: 'empty-date', title: 'Undated RFQ', createdAt: '' }),
      ];
      mockFetch.mockResolvedValueOnce({ success: true, rfqs: rowsWithMissingDate });
      render(<AllRFQsConsole />);
      await waitFor(() => expect(screen.getByText('Dated RFQ')).toBeInTheDocument());

      // Applying a date filter excludes the undated RFQ
      fireEvent.change(screen.getByLabelText(S.startDateLabel), { target: { value: '2026-06-01' } });
      expect(screen.getByText('Dated RFQ')).toBeInTheDocument();
      expect(screen.queryByText('Undated RFQ')).not.toBeInTheDocument();
    });

    it('exports CSV with date suffix when single start or end date is selected and handles diverse RFQ shapes', async () => {
      const richRows: RFQItem[] = [
        makeRfq({
          id: 'rich-1',
          title: 'Rich RFQ',
          category: '',
          buyerAccountName: null,
          budget: 0,
          createdAt: '2026-06-15T10:00:00.000Z',
          quotes: [
            {
              vendorId: 'v-1',
              vendorName: 'Quoted Vendor A',
              vendorCategory: 'Client List',
              unitPrice: 100,
              totalPrice: 1000,
              leadTimeDays: 5,
              aiMatchScore: 90,
              warrantyYears: 1,
              complianceStatus: 'Fully Compliant',
              paymentTerms: '30 days',
              remarks: 'Standard bid',
              submittedAt: '2026-06-16T12:00:00.000Z',
            },
          ],
          assignedVendors: [
            { id: 'v-assigned', name: 'Assigned Vendor B' } as any,
          ],
          deliveryLocation: '',
          targetDeliveryDate: '',
          deadline: '',
          sourcingMode: 'mode_1',
        }),
      ];
      mockFetch.mockResolvedValueOnce({ success: true, rfqs: richRows });
      render(<AllRFQsConsole />);
      await waitFor(() => expect(screen.getByText('Rich RFQ')).toBeInTheDocument());

      // Export with startDate only
      fireEvent.change(screen.getByLabelText(S.startDateLabel), { target: { value: '2026-01-01' } });
      const exportBtn = screen.getByRole('button', { name: S.exportCsvAria });
      fireEvent.click(exportBtn);

      expect(reportsClient.exportReportToCsv).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            [S.colTitle]: 'Rich RFQ',
            [S.colCategory]: EMPTY_VALUE,
            [S.colBuyer]: S.buyerUnknown,
            [S.colBudget]: S.budgetUnset,
            [S.colVendors]: 'Quoted Vendor A',
            [S.colInvitedVendors]: 'Assigned Vendor B',
          }),
        ]),
        expect.stringMatching(/2026-01-01_to_all$/)
      );

      // Export with endDate only
      fireEvent.change(screen.getByLabelText(S.startDateLabel), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText(S.endDateLabel), { target: { value: '2026-12-31' } });
      fireEvent.click(exportBtn);

      expect(reportsClient.exportReportToCsv).toHaveBeenCalledWith(
        expect.any(Array),
        expect.stringMatching(/all_to_2026-12-31$/)
      );
    });
  });
});

describe('CategoryManagerAllRFQsPage', () => {
  it('wires the matrix action to the shared quote-matrix route', async () => {
    const setSelectedRFQForMatrix = jest.fn();
    (storeModule.useApp as jest.Mock).mockReturnValue({ setSelectedRFQForMatrix });

    render(<CategoryManagerAllRFQsPage />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Open the comparative quote matrix for ${ROWS[1].rfqNumber}`));

    expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(ROWS[1]);
    expect(push).toHaveBeenCalledWith('/category-manager/quote-matrix');
  });

  it('wires the details action to the CM rfq-details route addressed by RFQ number', async () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({ setSelectedRFQForMatrix: jest.fn() });

    render(<CategoryManagerAllRFQsPage />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`View the full submitted detail for ${ROWS[1].rfqNumber}`));

    expect(push).toHaveBeenCalledWith(`/category-manager/rfq-details?rfq=${ROWS[1].rfqNumber}`);
  });
});
