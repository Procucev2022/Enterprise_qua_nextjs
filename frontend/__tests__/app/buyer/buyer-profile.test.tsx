import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import { useApp } from '@/lib/store';
import {
  fetchBuyerProfile,
  fetchCategoryTaxonomy,
  saveBuyerProfile,
} from '@/lib/buyerProfileClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { BUYER_PROFILE_LIMITS } from '@/lib/constants';
import type { BuyerProfile } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerProfile: jest.fn(),
  fetchCategoryTaxonomy: jest.fn(),
  saveBuyerProfile: jest.fn(),
  // The pure shape converters are exercised directly in the client's own suite,
  // so the real implementations are used here rather than stubs.
  flattenCategorySelection: jest.requireActual('@/lib/buyerProfileClient').flattenCategorySelection,
  expandCategorySelection: jest.requireActual('@/lib/buyerProfileClient').expandCategorySelection,
}));

const TAXONOMY = [
  {
    majorCategory: 'Civil Works',
    minorCategories: ['Piling', 'Excavation', 'Waterproofing', 'Roofing', 'Bricks'],
  },
  { majorCategory: 'IT', minorCategories: ['Laptop', 'Servers', 'Software'] },
  { majorCategory: 'Logistics', minorCategories: ['Road transport'] },
  { majorCategory: 'Raw Material', minorCategories: ['Steels'] },
  { majorCategory: 'Packing Material', minorCategories: ['Pet Jars'] },
  { majorCategory: 'Professional Services', minorCategories: ['Consultant'] },
];

const PROFILE: BuyerProfile = {
  organizationId: 'org-1',
  userId: 'user-1',
  companyName: 'Navin Chaudhary Enterprises',
  brandName: 'NC Heavy Engineering',
  organizationType: 'Public Limited',
  panNumber: 'AAACL1234F',
  gstNumber: '27AAACL1234F1Z5',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://www.example.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  street: 'L&T House, Ballard Estate',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  contactName: 'Navin Chaudhary',
  contactDesignation: 'Chief Procurement Officer (CPO)',
  contactEmail: 'navinchaudhary.dev@gmail.com',
  contactPhone: '+919157154504',
  categories: [
    { major: 'Civil Works', minor: 'Piling' },
    { major: 'IT', minor: 'Laptop' },
  ],
};

const mockAddAuditLog = jest.fn();
const mockShowToast = jest.fn();

function mockLoad(profile: BuyerProfile | null = PROFILE, taxonomy = TAXONOMY) {
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: taxonomy });
  (fetchBuyerProfile as jest.Mock).mockResolvedValue(
    profile ? { success: true, data: profile } : { success: false, error: 'boom' }
  );
}

/**
 * Render and wait for the mount-time load to settle.
 *
 * Waits on a rendered signal rather than flushing a fixed number of microtasks:
 * the load awaits two promises, so the number of ticks needed before React
 * commits is not something the test can count. The save button is enabled once
 * `isLoading` clears, which happens on both the success and the failure path.
 */
async function renderLoaded() {
  const utils = render(<BuyerProfilePage />);
  rerenderCurrent = () => utils.rerender(<BuyerProfilePage />);
  await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
  );
  return utils;
}

/** Re-render the mounted component, picking up the latest useApp() mock value. */
let rerenderCurrent: () => void = () => undefined;

/**
 * Read the selection summary badge.
 *
 * Queried by class rather than by text because the label is assembled from two
 * JSX expressions, which a text matcher only sees as separate nodes. The
 * `text-xs` class distinguishes it from the "Enterprise Buyer" badge in the
 * header, which shares the other classes.
 */
function selectionSummary(): string {
  const badge = document.querySelector('.badge.badge-purple.font-mono.text-xs');
  return (badge?.textContent || '').replace(/\s+/g, ' ').trim();
}

/** All "Select All" / "Clear" buttons currently rendered, in document order. */
function categoryActionButtons(label: 'Select All' | 'Clear'): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter(
    (b) => b.textContent?.trim() === label
  ) as HTMLButtonElement[];
}

/** The accordion panel for one major category. */
function majorPanel(name: string): HTMLElement {
  return screen.getByText(name).closest('div.rounded-2xl') as HTMLElement;
}

/** Expand a collapsed major by clicking its chevron. */
function expandMajor(name: string): void {
  fireEvent.click(majorPanel(name).querySelector('button.p-1') as HTMLButtonElement);
}

/** Click "Select All" inside a specific major, expanding it first if needed. */
function selectAllIn(name: string): void {
  const panel = majorPanel(name);
  let button = Array.from(panel.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Select All'
  );
  if (!button) {
    expandMajor(name);
    button = Array.from(majorPanel(name).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Select All'
    );
  }
  fireEvent.click(button as HTMLButtonElement);
}

describe('app/buyer/buyer-profile.tsx', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
    });
    (saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: PROFILE,
      categoryCount: 2,
    });
    mockLoad();
  });

  // ── Structure ─────────────────────────────────────────────────────────────
  it('renders the organization, address, contact, and category sections', async () => {
    await renderLoaded();
    expect(screen.getByText('Buyer Organization Profile')).toBeInTheDocument();
    expect(screen.getByText(/Section 1: Organization & Tax Registration/i)).toBeInTheDocument();
    expect(screen.getByText(/Registered Corporate Address/i)).toBeInTheDocument();
    expect(screen.getByText(/Key Procurement Contact Person/i)).toBeInTheDocument();
    expect(screen.getByText(/Section 3: Relevant Procurement Categories/i)).toBeInTheDocument();
  });

  // ── Load ──────────────────────────────────────────────────────────────────
  it('populates every field from the database record rather than any seeded default', async () => {
    await renderLoaded();

    expect(screen.getByDisplayValue('Navin Chaudhary Enterprises')).toBeInTheDocument();
    expect(screen.getByDisplayValue('NC Heavy Engineering')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Public Limited Company')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AAACL1234F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('27AAACL1234F1Z5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L28920MH1946PLC004768')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://www.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('INR 1,80,000 Cr+')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L&T House, Ballard Estate')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mumbai')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Maharashtra')).toBeInTheDocument();
    expect(screen.getByDisplayValue('400001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('India')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Navin Chaudhary')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Chief Procurement Officer (CPO)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('navinchaudhary.dev@gmail.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+919157154504')).toBeInTheDocument();
  });

  it('renders the category tree from the taxonomy the database returned', async () => {
    await renderLoaded();
    TAXONOMY.forEach((cat) => {
      expect(screen.getByText(cat.majorCategory)).toBeInTheDocument();
    });
  });

  it('restores the stored category selection and expands those majors', async () => {
    await renderLoaded();
    // Two stored pairs across two majors.
    expect(selectionSummary()).toBe('2 Major • 2 Minor Selected');
    // Their minors are visible, which only happens when the major is expanded.
    expect(screen.getByText('Piling')).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    // An unselected major stays collapsed.
    expect(screen.queryByText('Road transport')).not.toBeInTheDocument();
  });

  it('falls back to the default constitution when the stored value is outside the offered set', async () => {
    mockLoad({ ...PROFILE, organizationType: 'Cooperative Society' });
    await renderLoaded();
    expect(screen.getByDisplayValue('Public Limited Company')).toBeInTheDocument();
  });

  it('warns and leaves the form blank when the profile cannot be read', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Not linked to an organization.',
    });

    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.loadFailedTitle,
      'Not linked to an organization.',
      'warning'
    );
    expect(screen.queryByDisplayValue('Navin Chaudhary Enterprises')).not.toBeInTheDocument();
  });

  it('warns when the category taxonomy cannot be read', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: false,
      data: [],
      error: 'Master unavailable.',
    });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: true, data: PROFILE });

    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.loadFailedTitle,
      'Master unavailable.',
      'warning'
    );
  });

  // ── Request loop regression ───────────────────────────────────────────────
  // The load used to depend on `showToast`, which the store recreates on every
  // provider render. Reporting a failed load re-rendered the provider, which
  // changed that identity, which re-ran the mount effect, which requested again:
  // an unbounded loop that a failing endpoint drove forever.
  it('requests the profile exactly once per mount even when the load fails', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: false,
      data: [],
      error: 'Master unavailable.',
    });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'Unreachable.' });

    await renderLoaded();

    // Both failures reported, and neither retried.
    expect(mockShowToast).toHaveBeenCalledTimes(2);
    expect(fetchCategoryTaxonomy).toHaveBeenCalledTimes(1);
    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);
  });

  it('does not re-request when the provider hands down a fresh showToast identity', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: false, data: [], error: 'down' });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'down' });

    const { rerender } = await renderLoaded();
    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);

    // Every provider re-render used to produce a new callback and another round
    // of requests.
    for (let i = 0; i < 5; i += 1) {
      (useApp as jest.Mock).mockReturnValue({
        addAuditLog: jest.fn(),
        showToast: jest.fn(),
      });
      rerender(<BuyerProfilePage />);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);
    expect(fetchCategoryTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('reports a save through the current toast function after a re-render', async () => {
    await renderLoaded();

    // Proves the ref is read at call time rather than captured once, so the
    // stability fix did not pin a stale callback.
    const latestToast = jest.fn();
    (useApp as jest.Mock).mockReturnValue({ addAuditLog: mockAddAuditLog, showToast: latestToast });
    rerenderCurrent();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(latestToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      expect.any(String),
      'success'
    );
  });

  it('ignores a response that arrives after the page is closed', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    const { unmount } = render(<BuyerProfilePage />);
    await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveProfile({ success: true, data: PROFILE });
    });

    // No state written and no toast raised for a page nobody is looking at.
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('disables both save buttons until the record has loaded', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    render(<BuyerProfilePage />);
    expect(screen.getByText('Save Organization Profile').closest('button')).toBeDisabled();
    expect(screen.getByText('Save Buyer Organization Profile').closest('button')).toBeDisabled();

    await act(async () => {
      resolveProfile({ success: true, data: PROFILE });
    });

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
    );
  });

  // ── Editing ───────────────────────────────────────────────────────────────
  it('handles input changes across all form sections including the orgType select', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary Enterprises'), {
      target: { value: 'L&T Heavy Infra' },
    });
    fireEvent.change(screen.getByDisplayValue('NC Heavy Engineering'), {
      target: { value: 'L&T Power & Defense' },
    });
    fireEvent.change(screen.getByDisplayValue('Public Limited Company'), {
      target: { value: 'Private Limited' },
    });
    fireEvent.change(screen.getByDisplayValue('AAACL1234F'), { target: { value: 'bbbcl1234f' } });
    fireEvent.change(screen.getByDisplayValue('27AAACL1234F1Z5'), {
      target: { value: '27bbbcl1234f1z5' },
    });
    fireEvent.change(screen.getByDisplayValue('L28920MH1946PLC004768'), {
      target: { value: 'l12345mh1946plc000000' },
    });
    fireEvent.change(screen.getByDisplayValue('https://www.example.com'), {
      target: { value: 'https://www.ltpower.com' },
    });
    fireEvent.change(screen.getByDisplayValue('INR 1,80,000 Cr+'), {
      target: { value: '₹ 2,00,000 Cr+' },
    });
    fireEvent.change(screen.getByDisplayValue('L&T House, Ballard Estate'), {
      target: { value: 'Powai Campus, Gate 1' },
    });
    fireEvent.change(screen.getByDisplayValue('Mumbai'), { target: { value: 'Navi Mumbai' } });
    fireEvent.change(screen.getByDisplayValue('Maharashtra'), { target: { value: 'Gujarat' } });
    fireEvent.change(screen.getByDisplayValue('400001'), { target: { value: '400076' } });
    fireEvent.change(screen.getByDisplayValue('India'), { target: { value: 'United Arab Emirates' } });
    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary'), {
      target: { value: 'Vikram Malhotra' },
    });
    fireEvent.change(screen.getByDisplayValue('Chief Procurement Officer (CPO)'), {
      target: { value: 'VP Supply Chain' },
    });
    fireEvent.change(screen.getByDisplayValue('navinchaudhary.dev@gmail.com'), {
      target: { value: 'vikram@lnt.com' },
    });
    fireEvent.change(screen.getByDisplayValue('+919157154504'), {
      target: { value: '+919820199999' },
    });

    // The tax identifier inputs uppercase as the buyer types.
    expect(screen.getByDisplayValue('BBBCL1234F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('27BBBCL1234F1Z5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L12345MH1946PLC000000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Private Limited Company')).toBeInTheDocument();
  });

  it('shows the PAN and GSTIN format indicators', async () => {
    await renderLoaded();
    expect(screen.getByText('✓ Valid PAN')).toBeInTheDocument();
    expect(screen.getByText('✓ State 27 Verified')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('AAACL1234F'), { target: { value: 'NOPE' } });
    fireEvent.change(screen.getByDisplayValue('27AAACL1234F1Z5'), { target: { value: 'NOPE' } });

    expect(screen.getByText('Invalid Format')).toBeInTheDocument();
    expect(screen.getByText('Invalid GSTIN')).toBeInTheDocument();
  });

  // ── Category interactions ─────────────────────────────────────────────────
  it('filters the tree by search term', async () => {
    await renderLoaded();
    const searchInput = screen.getByPlaceholderText(/Search across all 13 Major/i);

    fireEvent.change(searchInput, { target: { value: 'Civil' } });
    expect(screen.getByText('Civil Works')).toBeInTheDocument();
    expect(screen.queryByText('Logistics')).not.toBeInTheDocument();

    // A minor-category match keeps its major visible.
    fireEvent.change(searchInput, { target: { value: 'Road transport' } });
    expect(screen.getByText('Logistics')).toBeInTheDocument();
    expect(screen.queryByText('Civil Works')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Civil Works')).toBeInTheDocument();
  });

  it('toggles a major category on and off', async () => {
    await renderLoaded();

    // Logistics starts unselected; selecting it takes its single minor.
    fireEvent.click(screen.getByText('Logistics'));
    expect(selectionSummary()).toBe('3 Major • 3 Minor Selected');

    fireEvent.click(screen.getByText('Logistics'));
    expect(selectionSummary()).toBe('2 Major • 2 Minor Selected');
  });

  it('toggles a minor category, deselecting its major when the last one is cleared', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('Laptop'));
    expect(selectionSummary()).toBe('1 Major • 1 Minor Selected');

    // Re-selecting re-adds the major.
    fireEvent.click(screen.getByText('Laptop'));
    expect(selectionSummary()).toBe('2 Major • 2 Minor Selected');
  });

  it('selects and clears every minor within a major', async () => {
    await renderLoaded();

    fireEvent.click(categoryActionButtons('Select All')[0]);
    // Civil Works has 5 minors in the fixture, plus the one IT minor.
    expect(selectionSummary()).toBe('2 Major • 6 Minor Selected');

    fireEvent.click(categoryActionButtons('Clear')[0]);
    expect(selectionSummary()).toBe('1 Major • 1 Minor Selected');
  });

  it('expands and collapses a major', async () => {
    await renderLoaded();

    // Logistics is collapsed, so its minor is not rendered.
    expect(screen.queryByText('Road transport')).not.toBeInTheDocument();

    const chevrons = screen
      .getAllByRole('button')
      .filter((b) => b.querySelector('svg.lucide-chevron-right'));
    fireEvent.click(chevrons[0]);

    expect(screen.getByText('Road transport')).toBeInTheDocument();
  });

  // ── Cardinality caps ──────────────────────────────────────────────────────
  it('refuses a sixth major category', async () => {
    // Five majors already selected, one minor each.
    mockLoad({
      ...PROFILE,
      categories: [
        { major: 'Civil Works', minor: 'Piling' },
        { major: 'IT', minor: 'Laptop' },
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
        { major: 'Packing Material', minor: 'Pet Jars' },
      ],
    });
    await renderLoaded();

    fireEvent.click(screen.getByText('Professional Services'));

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMajorReached, {
        max: BUYER_PROFILE_LIMITS.MAX_MAJOR_CATEGORIES,
      }),
      'warning'
    );
    expect(selectionSummary()).toBe('5 Major • 5 Minor Selected');
  });

  it('refuses an eleventh minor category', async () => {
    mockLoad({
      ...PROFILE,
      categories: [
        ...['Piling', 'Excavation', 'Waterproofing', 'Roofing', 'Bricks'].map((minor) => ({
          major: 'Civil Works',
          minor,
        })),
        ...['Laptop', 'Servers', 'Software'].map((minor) => ({ major: 'IT', minor })),
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
      ],
    });
    await renderLoaded();

    expect(selectionSummary()).toBe('4 Major • 10 Minor Selected');

    // Packing Material is a fifth major, so the major cap is not what blocks it.
    fireEvent.click(screen.getByText('Packing Material'));

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMinorReached, {
        count: BUYER_PROFILE_LIMITS.MAX_MINOR_CATEGORIES,
        max: BUYER_PROFILE_LIMITS.MAX_MINOR_CATEGORIES,
      }),
      'warning'
    );
    expect(selectionSummary()).toBe('4 Major • 10 Minor Selected');
  });

  it('caps a major selection at the remaining allowance instead of overflowing', async () => {
    // 8 minors used, so turning on Civil Works (5 minors) may only take 2.
    mockLoad({
      ...PROFILE,
      categories: [
        ...['Laptop', 'Servers', 'Software'].map((minor) => ({ major: 'IT', minor })),
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
        { major: 'Packing Material', minor: 'Pet Jars' },
        { major: 'Professional Services', minor: 'Consultant' },
      ],
    });
    await renderLoaded();
    expect(selectionSummary()).toBe('5 Major • 7 Minor Selected');

    // A sixth major is refused by the major cap.
    fireEvent.click(screen.getByText('Civil Works'));
    expect(selectionSummary()).toBe('5 Major • 7 Minor Selected');
  });

  it('refuses a minor checkbox once the minor cap is reached', async () => {
    // Ten minors across four majors, so there is major headroom but no minor
    // headroom: it must be the minor cap that reports the refusal.
    mockLoad({
      ...PROFILE,
      categories: [
        ...['Piling', 'Excavation', 'Waterproofing', 'Roofing', 'Bricks'].map((minor) => ({
          major: 'Civil Works',
          minor,
        })),
        ...['Laptop', 'Servers', 'Software'].map((minor) => ({ major: 'IT', minor })),
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
      ],
    });
    await renderLoaded();

    expandMajor('Packing Material');
    fireEvent.click(screen.getByText('Pet Jars'));

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMinorReached, {
        count: BUYER_PROFILE_LIMITS.MAX_MINOR_CATEGORIES,
        max: BUYER_PROFILE_LIMITS.MAX_MINOR_CATEGORIES,
      }),
      'warning'
    );
    expect(selectionSummary()).toBe('4 Major • 10 Minor Selected');
  });

  it('refuses a minor checkbox in a sixth major even with minor headroom', async () => {
    // Five majors, one minor each: five minor slots free, but no major slots.
    mockLoad({
      ...PROFILE,
      categories: [
        { major: 'Civil Works', minor: 'Piling' },
        { major: 'IT', minor: 'Laptop' },
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
        { major: 'Packing Material', minor: 'Pet Jars' },
      ],
    });
    await renderLoaded();

    expandMajor('Professional Services');
    fireEvent.click(screen.getByText('Consultant'));

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMajorReached, {
        max: BUYER_PROFILE_LIMITS.MAX_MAJOR_CATEGORIES,
      }),
      'warning'
    );
    expect(selectionSummary()).toBe('5 Major • 5 Minor Selected');
  });

  it('adds a new major when a minor inside it is ticked', async () => {
    await renderLoaded();

    expandMajor('Logistics');
    fireEvent.click(screen.getByText('Road transport'));

    expect(selectionSummary()).toBe('3 Major • 3 Minor Selected');
  });

  it('refuses Select All in a sixth major', async () => {
    mockLoad({
      ...PROFILE,
      categories: [
        { major: 'Civil Works', minor: 'Piling' },
        { major: 'IT', minor: 'Laptop' },
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
        { major: 'Packing Material', minor: 'Pet Jars' },
      ],
    });
    await renderLoaded();

    selectAllIn('Professional Services');

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      formatString(UI_STRINGS.buyerProfile.maxMajorReached, {
        max: BUYER_PROFILE_LIMITS.MAX_MAJOR_CATEGORIES,
      }),
      'warning'
    );
    expect(selectionSummary()).toBe('5 Major • 5 Minor Selected');
  });

  it('refuses Select All when no minor slots remain', async () => {
    mockLoad({
      ...PROFILE,
      categories: [
        ...['Piling', 'Excavation', 'Waterproofing', 'Roofing', 'Bricks'].map((minor) => ({
          major: 'Civil Works',
          minor,
        })),
        ...['Laptop', 'Servers', 'Software'].map((minor) => ({ major: 'IT', minor })),
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
      ],
    });
    await renderLoaded();

    // Packing Material holds none of the ten used slots, so freeing its own
    // selection releases nothing.
    selectAllIn('Packing Material');

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      expect.any(String),
      'warning'
    );
    expect(selectionSummary()).toBe('4 Major • 10 Minor Selected');
  });

  it('adds a new major when Select All is used inside it', async () => {
    await renderLoaded();

    selectAllIn('Logistics');

    expect(selectionSummary()).toBe('3 Major • 3 Minor Selected');
  });

  it('caps Select All at the remaining allowance and says so', async () => {
    // Five majors, eight of the ten minor slots used.
    mockLoad({
      ...PROFILE,
      categories: [
        ...['Piling', 'Excavation'].map((minor) => ({ major: 'Civil Works', minor })),
        ...['Laptop', 'Servers', 'Software'].map((minor) => ({ major: 'IT', minor })),
        { major: 'Logistics', minor: 'Road transport' },
        { major: 'Raw Material', minor: 'Steels' },
        { major: 'Packing Material', minor: 'Pet Jars' },
      ],
    });
    await renderLoaded();
    expect(selectionSummary()).toBe('5 Major • 8 Minor Selected');

    // Civil Works has 5 minors but only 4 slots remain once its own 2 are freed.
    fireEvent.click(categoryActionButtons('Select All')[0]);

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      expect.any(String),
      'warning'
    );
    expect(selectionSummary()).toBe('5 Major • 10 Minor Selected');
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  it('saves the profile and reports what was stored', async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Navin Chaudhary Enterprises',
        organizationType: 'Public Limited',
        panNumber: 'AAACL1234F',
        pincode: '400001',
        contactName: 'Navin Chaudhary',
        categories: [
          { major: 'Civil Works', minor: 'Piling' },
          { major: 'IT', minor: 'Laptop' },
        ],
      })
    );
    // Contact email and phone belong to the account, not the organisation.
    expect(Object.keys((saveBuyerProfile as jest.Mock).mock.calls[0][0])).not.toContain('contactEmail');

    expect(mockAddAuditLog).toHaveBeenCalledWith(
      expect.stringContaining('Navin Chaudhary Enterprises')
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      formatString(UI_STRINGS.buyerProfile.savedMessage, { categoryCount: 2 }),
      'success'
    );
  });

  it('re-applies the server-normalised record after a save', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      categoryCount: 2,
      data: { ...PROFILE, annualTurnover: 'INR 2,00,000 Cr+', companyName: 'ACME Normalised' },
    });
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('INR 1,80,000 Cr+'), {
      target: { value: '₹ 2,00,000 Cr+' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(screen.getByDisplayValue('INR 2,00,000 Cr+')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ACME Normalised')).toBeInTheDocument();
  });

  it('saves on form submit as well as from the header button', async () => {
    const { container } = await renderLoaded();
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(saveBuyerProfile).toHaveBeenCalledTimes(1);
  });

  it('falls back to the locally counted categories when the server omits a count', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({ success: true, data: PROFILE });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      formatString(UI_STRINGS.buyerProfile.savedMessage, { categoryCount: 2 }),
      'success'
    );
  });

  it('succeeds without a returned record to re-apply', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({ success: true, categoryCount: 2 });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      expect.any(String),
      'success'
    );
  });

  // ── Save-path validation ──────────────────────────────────────────────────
  it('blocks a save with no legal entity name', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary Enterprises'), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.validationErrorTitle,
      expect.stringContaining(UI_STRINGS.buyerProfile.companyNameRequired),
      'warning'
    );
  });

  it.each([
    ['AAACL1234F', 'NOTAPAN', UI_STRINGS.buyerProfile.panInvalid],
    ['27AAACL1234F1Z5', '27AAACL1234F1Z', UI_STRINGS.buyerProfile.gstInvalid],
    ['L28920MH1946PLC004768', 'L28920MH1946PLC0047', UI_STRINGS.buyerProfile.cinInvalid],
    ['https://www.example.com', 'example.com', UI_STRINGS.buyerProfile.websiteInvalid],
    ['400001', '040001', UI_STRINGS.buyerProfile.pincodeInvalid],
  ])('blocks a save when %s is replaced with the malformed %s', async (current, next, message) => {
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue(current), { target: { value: next } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.validationErrorTitle,
      expect.stringContaining(message),
      'warning'
    );
  });

  it('blocks a save with no procurement category selected', async () => {
    mockLoad({ ...PROFILE, categories: [] });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.validationErrorTitle,
      UI_STRINGS.buyerProfile.categoriesRequired,
      'warning'
    );
  });

  it('refuses to save a form that never loaded', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'unreachable' });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.saveFailedTitle,
      UI_STRINGS.buyerProfile.loadUnreachable,
      'warning'
    );
  });

  // ── Save failures ─────────────────────────────────────────────────────────
  it('reports a rejected save and keeps the buyer edits on screen', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Your changes were not saved: PAN is invalid.',
    });
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary Enterprises'), {
      target: { value: 'Edited Name' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.saveFailedTitle,
      'Your changes were not saved: PAN is invalid.',
      'warning'
    );
    expect(screen.getByDisplayValue('Edited Name')).toBeInTheDocument();
    expect(mockAddAuditLog).not.toHaveBeenCalled();
  });

  it('disables the save buttons while a save is in flight and ignores a double click', async () => {
    let resolveSave: (v: unknown) => void = () => undefined;
    (saveBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    await renderLoaded();

    fireEvent.click(screen.getByText('Save Organization Profile'));

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).toBeDisabled()
    );

    // A second submit while the first is outstanding must not fire another request.
    fireEvent.click(screen.getByText('Save Organization Profile'));
    expect(saveBuyerProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ success: true, data: PROFILE, categoryCount: 2 });
    });

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
    );
  });
});
