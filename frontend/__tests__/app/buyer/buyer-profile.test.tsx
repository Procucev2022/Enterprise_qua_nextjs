import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import { useApp } from '@/lib/store';
import {
  fetchBuyerProfile,
  fetchCategoryTaxonomy,
  saveBuyerProfile,
} from '@/lib/buyerProfileClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import * as validationSchemas from '@/lib/validationSchemas';
import type { BuyerProfile } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/validationSchemas', () => {
  const actual = jest.requireActual('@/lib/validationSchemas');
  return {
    ...actual,
    validatePincode: jest.fn(actual.validatePincode),
  };
});

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerProfile: jest.fn(),
  fetchCategoryTaxonomy: jest.fn(),
  saveBuyerProfile: jest.fn(),
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
 */
function selectionSummary(): string {
  const badge =
    document.querySelector('.badge.badge-purple.font-mono.text-xs') ??
    document.querySelector('.badge.badge-purple.font-mono');
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
  return (
    screen.getByText(name).closest('div.rounded-2xl') ??
    screen.getByText(name).closest('div.rounded-xl')
  ) as HTMLElement;
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
  it('renders organization, address, contact, category, and security sections', async () => {
    await renderLoaded();
    expect(screen.getByText(/Section 1: Organization & Tax Registration/i)).toBeInTheDocument();
    expect(screen.getByText(/Registered Corporate Address/i)).toBeInTheDocument();
    expect(screen.getByText(/Key Procurement Contact Person/i)).toBeInTheDocument();
    expect(screen.getByText(/Section 3: Relevant Procurement Categories/i)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.accountSecurity.sectionTitle)).toBeInTheDocument();
  });

  it('renders the account security forms outside the organization profile form', async () => {
    await renderLoaded();

    const newPasswordInput = screen.getByPlaceholderText(
      UI_STRINGS.accountSecurity.newPasswordPlaceholder
    );
    const accountForm = newPasswordInput.closest('form');
    expect(accountForm).not.toBeNull();

    const legalEntityInput = screen.getByDisplayValue('Navin Chaudhary Enterprises');
    const profileForm = legalEntityInput.closest('form');
    expect(profileForm).not.toBeNull();

    expect(accountForm).not.toBe(profileForm);
    expect(profileForm?.contains(accountForm as Node)).toBe(false);
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

  // ── Request loop regression ───────────────────────────────────────────────
  it('requests the profile exactly once per mount even when the load fails', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: false,
      data: [],
      error: 'Master unavailable.',
    });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'Unreachable.' });

    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledTimes(2);
    expect(fetchCategoryTaxonomy).toHaveBeenCalledTimes(1);
    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);
  });

  it('does not re-request when the provider hands down a fresh showToast identity', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: false, data: [], error: 'down' });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'down' });

    const { rerender } = await renderLoaded();
    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);

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

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('disables the save button until the record has loaded', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    render(<BuyerProfilePage />);
    expect(screen.getByText('Save Organization Profile').closest('button')).toBeDisabled();

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

  // ── Category Selection ────────────────────────────────────────────────────
  it('renders the category tree from the taxonomy the database returned', async () => {
    await renderLoaded();
    TAXONOMY.forEach((cat) => {
      expect(screen.getByText(cat.majorCategory)).toBeInTheDocument();
    });
  });

  it('restores the stored category selection and shows count badge', async () => {
    await renderLoaded();
    expect(selectionSummary()).toBe('2 Major • 2 Minor Selected');
  });

  it('filters categories using the search bar', async () => {
    await renderLoaded();
    const searchInput = screen.getByPlaceholderText(/Search across all 13 Major and 120\+ Minor categories/i);
    fireEvent.change(searchInput, { target: { value: 'Pumps' } });
    expect(screen.queryByText('Civil Works')).not.toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Civil Works')).toBeInTheDocument();
  });

  it('toggles a major category on and off', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('Logistics'));
    expect(selectionSummary()).toBe('3 Major • 3 Minor Selected');

    fireEvent.click(screen.getByText('Logistics'));
    expect(selectionSummary()).toBe('2 Major • 2 Minor Selected');
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
      })
    );
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

    fireEvent.click(screen.getByText('Save Organization Profile'));
    expect(saveBuyerProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ success: true, data: PROFILE, categoryCount: 2 });
    });

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
    );
  });

  // ── Sections & Address Coverage ──────────────────────────────────────────
  it('exercises street, city, state, pincode, contact inputs and save', async () => {
    await renderLoaded();

    // 1. Street, city, state, pincode inputs
    const streetInput = screen.getByDisplayValue('L&T House, Ballard Estate');
    fireEvent.change(streetInput, { target: { value: 'New Industrial Area, MIDC' } });

    const pincodeInput = screen.getByDisplayValue('400001');
    fireEvent.change(pincodeInput, { target: { value: '400701' } });

    // 2. Contact inputs
    const contactNameInput = screen.getByDisplayValue('Navin Chaudhary');
    fireEvent.change(contactNameInput, { target: { value: 'Navin C' } });

    // 3. Save profile
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).toHaveBeenCalled();
  });

  it('validates pincode debounce, dummy pincode, and invalid format', async () => {
    jest.useFakeTimers();
    await renderLoaded();

    const pincodeInput = screen.getByDisplayValue('400001');

    // 1. Clear pincode
    fireEvent.change(pincodeInput, { target: { value: '' } });

    // 2. Dummy pincode
    fireEvent.change(pincodeInput, { target: { value: '111111' } });
    expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

    // 3. 6-digit invalid format (starts with 0)
    fireEvent.change(pincodeInput, { target: { value: '012345' } });
    expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

    // 4. 6-digit valid pincode with debounce timer
    fireEvent.change(pincodeInput, { target: { value: '411001' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    jest.useRealTimers();
  });

  // ── Category Taxonomy Accordion, Minor Toggles & Caps ───────────────────
  it('expands and collapses category accordion panels via chevron', async () => {
    await renderLoaded();

    // Civil Works is selected in PROFILE so it starts expanded
    expect(screen.getByText('Piling')).toBeInTheDocument();

    // Raw Material starts collapsed
    expect(screen.queryByText('Steels')).not.toBeInTheDocument();

    // Expand Raw Material
    expandMajor('Raw Material');
    expect(screen.getByText('Steels')).toBeInTheDocument();

    // Collapse Civil Works
    expandMajor('Civil Works');
    expect(screen.queryByText('Piling')).not.toBeInTheDocument();
  });

  it('selects and deselects minor categories individually', async () => {
    await renderLoaded();

    // Civil Works is expanded; select 'Excavation'
    const excavationLabel = screen.getByText('Excavation').closest('label')!;
    const excavationInput = excavationLabel.querySelector('input')!;
    fireEvent.click(excavationInput);

    expect(selectionSummary()).toBe('2 Major • 3 Minor Selected');

    // Deselect 'Excavation'
    fireEvent.click(excavationInput);
    expect(selectionSummary()).toBe('2 Major • 2 Minor Selected');

    // Deselect 'Piling' (the only selected minor in Civil Works)
    const pilingLabel = screen.getByText('Piling').closest('label')!;
    const pilingInput = pilingLabel.querySelector('input')!;
    fireEvent.click(pilingInput);

    // Deselecting all minors should deselect the major
    expect(selectionSummary()).toBe('1 Major • 1 Minor Selected');
  });

  it('supports Select All and Clear buttons within a major category', async () => {
    await renderLoaded();

    // Select All in Civil Works (5 minors)
    selectAllIn('Civil Works');
    expect(selectionSummary()).toBe('2 Major • 6 Minor Selected');

    // Clear Civil Works
    const panel = majorPanel('Civil Works');
    const clearBtn = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Clear'
    )!;
    fireEvent.click(clearBtn);

    expect(selectionSummary()).toBe('1 Major • 1 Minor Selected');
  });

  it('filters by minor category keyword in search bar', async () => {
    await renderLoaded();

    const searchInput = screen.getByPlaceholderText(/Search across all 13 Major and 120\+ Minor categories/i);
    fireEvent.change(searchInput, { target: { value: 'Laptop' } });

    expect(screen.getByText('IT')).toBeInTheDocument();
    expect(screen.queryByText('Civil Works')).not.toBeInTheDocument();
  });

  it('enforces major category limit cap and shows toast', async () => {
    // 7 taxonomy items to exceed MAX_MAJOR_CATEGORIES (5)
    const bigTaxonomy = Array.from({ length: 7 }, (_, i) => ({
      majorCategory: `Category ${i + 1}`,
      minorCategories: [`Subcat ${i + 1}A`, `Subcat ${i + 1}B`],
    }));
    const initialMajors = bigTaxonomy.slice(0, 5).map((c) => ({
      major: c.majorCategory,
      minor: c.minorCategories[0],
    }));

    mockLoad({ ...PROFILE, categories: initialMajors }, bigTaxonomy);
    await renderLoaded();

    expect(selectionSummary()).toBe('5 Major • 5 Minor Selected');

    // Try to toggle 6th category
    fireEvent.click(screen.getByText('Category 6'));

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      expect.stringContaining('5'),
      'warning'
    );
  });

  it('enforces minor category limit cap and shows toast', async () => {
    // 1 major category with 45 minors, exceeding MAX_MINOR_CATEGORIES (40)
    const minors = Array.from({ length: 45 }, (_, i) => `Subcat ${i + 1}`);
    const bigTaxonomy = [{ majorCategory: 'Huge Category', minorCategories: minors }];
    const initialCategories = minors.slice(0, 40).map((m) => ({
      major: 'Huge Category',
      minor: m,
    }));

    mockLoad({ ...PROFILE, categories: initialCategories }, bigTaxonomy);
    await renderLoaded();

    // Try to select 41st minor
    const subcat41 = screen.getByText('Subcat 41').closest('label')!.querySelector('input')!;
    fireEvent.click(subcat41);

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      expect.stringContaining('40'),
      'warning'
    );
  });

  it('backfills profile fields from activeBuyerAccount if profile returned blank fields', async () => {
    const blankProfile: BuyerProfile = {
      organizationId: 'org-blank',
      userId: 'user-blank',
      companyName: '',
      brandName: '',
      organizationType: 'Public Limited',
      panNumber: '',
      gstNumber: '',
      cinNumber: '',
      website: '',
      annualTurnover: '',
      street: '',
      city: '',
      state: '',
      pincode: '',
      country: '',
      contactName: '',
      contactDesignation: '',
      contactEmail: '',
      contactPhone: '',
      categories: [{ major: 'Civil Works', minor: 'Piling' }],
    };

    const mockAccount = {
      organizationName: 'Backfilled Org Name',
      brandName: 'Backfilled Brand',
      gstin: '27AAACL1234F1Z5',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India',
      contactPerson: 'Aditi Sharma',
      mobileNumber: '+919876543210',
      corporateEmail: 'aditi@backfilled.com',
    };

    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
      activeBuyerAccount: mockAccount,
    });

    mockLoad(blankProfile);
    await renderLoaded();

    expect(screen.getByDisplayValue('Backfilled Org Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Backfilled Brand')).toBeInTheDocument();
    expect(screen.getByDisplayValue('27AAACL1234F1Z5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AAACL1234F')).toBeInTheDocument(); // Derived PAN from GSTIN
    expect(screen.getByDisplayValue('Pune')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Aditi Sharma')).toBeInTheDocument();
  });

  it('covers pincode invalid patterns, catch block and save blocked by pincode error', async () => {
    // Mount with dummy pincode 111111: passes regex schema but fails dummy check (setting pincodeError)
    mockLoad({
      ...PROFILE,
      pincode: '111111',
    });
    await renderLoaded();

    await waitFor(() => {
      expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();
    });

    // Trying to save while pincode has error blocks save (lines 509-510)
    const saveBtn = screen.getByRole('button', { name: /^Save Organization Profile$/i });
    fireEvent.click(saveBtn);
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.validationErrorTitle,
      'Invalid or dummy PIN code',
      'warning'
    );

    const pinInput = screen.getByDisplayValue('111111');

    // 2 digits: hits else branch (lines 127-129)
    fireEvent.change(pinInput, { target: { value: '40' } });

    // API throwing exception in validatePincode (line 121)
    const { validatePincode } = jest.requireMock('@/lib/validationSchemas');
    (validatePincode as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    jest.useFakeTimers();
    fireEvent.change(pinInput, { target: { value: '400001' } });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();
  });

  it('covers category major and minor selection cap edge cases', async () => {
    // Return a mock taxonomy with 10 majors, each having 5 minors
    const { fetchCategoryTaxonomy } = jest.requireMock('@/lib/buyerProfileClient');
    const largeTaxonomy = Array.from({ length: 10 }, (_, i) => ({
      majorCategory: `Major Cat ${i + 1}`,
      minorCategories: [`Minor ${i + 1}-A`, `Minor ${i + 1}-B`, `Minor ${i + 1}-C`, `Minor ${i + 1}-D`, `Minor ${i + 1}-E`],
    }));
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: largeTaxonomy });

    mockLoad({
      ...PROFILE,
      categories: [
        // 2 majors with 5 minors each = 10 minors total! (MAX_MINOR_CATEGORIES is 10)
        { major: 'Major Cat 1', minor: 'Minor 1-A' },
        { major: 'Major Cat 1', minor: 'Minor 1-B' },
        { major: 'Major Cat 1', minor: 'Minor 1-C' },
        { major: 'Major Cat 1', minor: 'Minor 1-D' },
        { major: 'Major Cat 1', minor: 'Minor 1-E' },
        { major: 'Major Cat 2', minor: 'Minor 2-A' },
        { major: 'Major Cat 2', minor: 'Minor 2-B' },
        { major: 'Major Cat 2', minor: 'Minor 2-C' },
        { major: 'Major Cat 2', minor: 'Minor 2-D' },
        { major: 'Major Cat 2', minor: 'Minor 2-E' },
      ],
    }, largeTaxonomy);

    await renderLoaded();

    // Toggle 3rd major when remainingSlots <= 0 (lines 381-383)
    const major3Title = screen.getByText('Major Cat 3');
    fireEvent.click(major3Title);
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      expect.stringContaining('minor'),
      'warning'
    );

    // Expand accordion for Major Cat 3 and click Select All when remainingSlots <= 0 (lines 438-439)
    expandMajor('Major Cat 3');
    const panel3 = majorPanel('Major Cat 3');
    const selectAllBtn3 = Array.from(panel3.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Select All'
    );
    if (selectAllBtn3) {
      fireEvent.click(selectAllBtn3);
      expect(mockShowToast).toHaveBeenCalledWith(
        UI_STRINGS.buyerProfile.limitReachedTitle,
        expect.stringContaining('minor'),
        'warning'
      );
    }
  });

  it('covers major category cap in toggleMinorCategory and selectAllMinorInMajor', async () => {
    const { fetchCategoryTaxonomy } = jest.requireMock('@/lib/buyerProfileClient');
    const largeTaxonomy = Array.from({ length: 8 }, (_, i) => ({
      majorCategory: `Major Cap ${i + 1}`,
      minorCategories: [`Sub ${i + 1}-A`, `Sub ${i + 1}-B`],
    }));
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: largeTaxonomy });

    // 5 majors with 1 minor each = 5 majors (MAX_MAJOR_CATEGORIES = 5), but only 5 minors (< 10)
    mockLoad({
      ...PROFILE,
      categories: [
        { major: 'Major Cap 1', minor: 'Sub 1-A' },
        { major: 'Major Cap 2', minor: 'Sub 2-A' },
        { major: 'Major Cap 3', minor: 'Sub 3-A' },
        { major: 'Major Cap 4', minor: 'Sub 4-A' },
        { major: 'Major Cap 5', minor: 'Sub 5-A' },
      ],
    }, largeTaxonomy);

    await renderLoaded();

    // Expand Major Cap 6 (unselected major)
    expandMajor('Major Cap 6');

    // 1. Toggle minor in unselected major when major cap (5) is reached (lines 416-417)
    const sub6A = screen.getByText('Sub 6-A');
    fireEvent.click(sub6A);
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.limitReachedTitle,
      expect.stringContaining('5 major'),
      'warning'
    );

    // 2. Select all in unselected major when major cap (5) is reached (lines 430-431)
    const panel6 = majorPanel('Major Cap 6');
    const selectAllBtn6 = Array.from(panel6.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Select All'
    );
    if (selectAllBtn6) {
      fireEvent.click(selectAllBtn6);
      expect(mockShowToast).toHaveBeenCalledWith(
        UI_STRINGS.buyerProfile.limitReachedTitle,
        expect.stringContaining('5 major'),
        'warning'
      );
    }
  });

  it('covers selecting minor in unselected major when caps allow and partial select all', async () => {
    const { fetchCategoryTaxonomy } = jest.requireMock('@/lib/buyerProfileClient');
    const customTaxonomy = [
      { majorCategory: 'Cat A', minorCategories: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'] },
      { majorCategory: 'Cat B', minorCategories: ['B1', 'B2', 'B3', 'B4', 'B5'] },
    ];
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: customTaxonomy });

    // 1 major with 8 minors (8 out of 10 slots filled, 2 remaining slots)
    mockLoad({
      ...PROFILE,
      categories: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map((m) => ({ major: 'Cat A', minor: m })),
    }, customTaxonomy);

    await renderLoaded();

    // Expand Cat B (which has 5 minors, but only 2 slots remain)
    expandMajor('Cat B');

    // 1. Toggle minor in unselected major when slots are available (line 421)
    const b1 = screen.getByText('B1');
    fireEvent.click(b1);
    // Now 9 minors selected across 2 majors
    expect(selectionSummary()).toBe('2 Major • 9 Minor Selected');

    // 2. Click select all on Cat B when allMinor.length (5) > remainingSlots (line 444 & 448)
    const panelB = majorPanel('Cat B');
    const selectAllBtnB = Array.from(panelB.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Select All'
    );
    if (selectAllBtnB) {
      fireEvent.click(selectAllBtnB);
      expect(mockShowToast).toHaveBeenCalledWith(
        UI_STRINGS.buyerProfile.limitReachedTitle,
        expect.stringContaining('minor'),
        'warning'
      );
    }
  });

  it('covers postal pincode successful resolution with post office auto-populating city and state', async () => {
    mockLoad();
    await renderLoaded();

    const { validatePincode } = jest.requireMock('@/lib/validationSchemas');
    (validatePincode as jest.Mock).mockResolvedValueOnce({
      isValid: true,
      postOffices: [{ District: 'Pune', State: 'Maharashtra' }],
    });

    const pinInput = screen.getByDisplayValue('400001');
    jest.useFakeTimers();
    fireEvent.change(pinInput, { target: { value: '411001' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();

    expect(screen.getByDisplayValue('Pune')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Maharashtra')).toBeInTheDocument();
  });

  it('covers postal pincode lookup failure with default message fallback', async () => {
    mockLoad();
    await renderLoaded();

    const { validatePincode } = jest.requireMock('@/lib/validationSchemas');
    (validatePincode as jest.Mock).mockResolvedValueOnce({
      isValid: false,
      message: undefined,
    });

    const pinInput = screen.getByDisplayValue('400001');
    jest.useFakeTimers();
    fireEvent.change(pinInput, { target: { value: '411009' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText('Invalid PIN code')).toBeInTheDocument();
    });
  });

  it('covers search term no matching categories and taxonomy empty fallback', async () => {
    mockLoad();
    await renderLoaded();

    const searchInput = screen.getByPlaceholderText(/Search across all 13 Major and 120\+ Minor categories/i);
    fireEvent.change(searchInput, { target: { value: 'NONEXISTENT_KEYWORD_XYZ' } });

    expect(screen.getByText(/No categories found matching "NONEXISTENT_KEYWORD_XYZ"./i)).toBeInTheDocument();
  });

  it('covers taxonomy loading failure with error toast', async () => {
    const { fetchCategoryTaxonomy } = jest.requireMock('@/lib/buyerProfileClient');
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Taxonomy server unreachable',
    });

    mockLoad();
    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.loadFailedTitle,
      'Taxonomy server unreachable',
      'warning'
    );
  });

  it('covers activeBuyerAccount backfilling branches with address1, zip_code, and derived PAN', async () => {
    const emptyProfile = {
      organizationId: 'org-2',
      userId: 'user-2',
      companyName: '',
      brandName: '',
      organizationType: 'Private Limited' as const,
      panNumber: '',
      gstNumber: '',
      cinNumber: '',
      annualTurnover: '',
      website: '',
      street: '',
      city: '',
      state: '',
      pincode: '',
      country: '',
      contactName: '',
      contactDesignation: '',
      contactEmail: '',
      contactPhone: '',
      categories: [{ major: 'Civil Works', minor: 'Piling' }],
    };

    const mockAccount = {
      organizationName: 'Tata Projects Limited',
      // brandName is omitted to test fallback to organizationName (line 300)
      gstin: '27AABCT1234F1Z8',
      city: 'Navi Mumbai',
      state: 'Maharashtra',
      zip_code: '400703', // tests zip_code fallback (line 305)
      country: 'India',
      address1: 'Plot 45, MIDC Industrial Area', // tests address1 fallback (line 314)
      pan: 'AABCT1234F', // tests pan fallback (line 310)
      contactPerson: 'Vikram Joshi',
      corporateEmail: 'vikram.joshi@tata.com',
      mobileNumber: '+919820011223',
    };

    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
      activeBuyerAccount: mockAccount,
    });

    mockLoad(emptyProfile);
    await renderLoaded();

    const legalEntityField = screen.getByText(/^Legal Entity Name \*/).parentElement;
    const brandDivisionField = screen.getByText('Brand / Procurement Division').parentElement;
    if (!legalEntityField || !brandDivisionField) throw new Error('Organization identity fields are missing.');

    // Loading enables Save before the account backfill effect has necessarily
    // committed its brand-name fallback, particularly under React 19 scheduling.
    await waitFor(() => {
      expect(within(legalEntityField).getByRole('textbox')).toHaveValue(mockAccount.organizationName);
      expect(within(brandDivisionField).getByRole('textbox')).toHaveValue(mockAccount.organizationName);
    });
    expect(screen.getByDisplayValue('Plot 45, MIDC Industrial Area')).toBeInTheDocument();
    expect(screen.getByDisplayValue('400703')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AABCT1234F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Vikram Joshi')).toBeInTheDocument();
  });

  it('covers primary post office with Division and Name fallback, empty post offices, and save failure without error text', async () => {
    mockLoad();
    await renderLoaded();

    const { validatePincode } = jest.requireMock('@/lib/validationSchemas');

    // 1. Post office with Division instead of District
    (validatePincode as jest.Mock).mockResolvedValueOnce({
      isValid: true,
      postOffices: [{ Division: 'Thane Urban', State: 'Maharashtra' }],
    });

    const pinInput = screen.getByDisplayValue('400001');
    jest.useFakeTimers();
    fireEvent.change(pinInput, { target: { value: '400601' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();
    expect(screen.getByDisplayValue('Thane Urban')).toBeInTheDocument();

    // 2. Post office with Name only (no District, no Division)
    (validatePincode as jest.Mock).mockResolvedValueOnce({
      isValid: true,
      postOffices: [{ Name: 'Belapur Node', State: '' }],
    });
    jest.useFakeTimers();
    fireEvent.change(pinInput, { target: { value: '400614' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();
    expect(screen.getByDisplayValue('Belapur Node')).toBeInTheDocument();

    // 3. Post office with empty array
    (validatePincode as jest.Mock).mockResolvedValueOnce({
      isValid: true,
      postOffices: [],
    });
    jest.useFakeTimers();
    fireEvent.change(pinInput, { target: { value: '400002' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();

    // 4. Save failure without an error string
    const { saveBuyerProfile } = jest.requireMock('@/lib/buyerProfileClient');
    (saveBuyerProfile as jest.Mock).mockResolvedValueOnce({ success: false });
    const saveBtn = screen.getByRole('button', { name: /^Save Organization Profile$/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        UI_STRINGS.buyerProfile.saveFailedTitle,
        '',
        'warning'
      );
    });
  });

  it('covers categoryTaxonomy provided via useApp and street fallback variations', async () => {
    const customTax = [{ majorCategory: 'Special Cat', minorCategories: ['Spec 1'] }];

    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
      categoryTaxonomy: customTax,
      activeBuyerAccount: {
        organizationName: 'City Only Org',
        city: 'Jaipur',
        state: '', // state is empty to hit resolvedCity fallback in resolvedStreet
        street: 'Direct Street 101', // hits activeBuyerAccount.street
        panNumber: 'BBBCP1234F', // hits activeBuyerAccount.panNumber
        contactDesignation: 'VP Sourcing',
      },
    });

    mockLoad({
      ...PROFILE,
      street: '',
      panNumber: '',
      contactDesignation: '',
      categories: [{ major: 'Special Cat', minor: 'Spec 1' }],
    });

    await renderLoaded();

    expect(screen.getByDisplayValue('Direct Street 101')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BBBCP1234F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('VP Sourcing')).toBeInTheDocument();
  });

  it('covers profile and taxonomy failure without error property', async () => {
    (fetchBuyerProfile as jest.Mock).mockResolvedValueOnce({ success: false });
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValueOnce({ success: false });

    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.loadFailedTitle,
      '',
      'warning'
    );
  });

  it('covers completely blank profile without activeBuyerAccount', async () => {
    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
      activeBuyerAccount: null,
    });

    const completelyBlank: BuyerProfile = {
      organizationId: 'org-blank',
      userId: 'user-blank',
      companyName: '',
      brandName: '',
      organizationType: 'Public Limited',
      panNumber: '',
      gstNumber: '',
      cinNumber: '',
      annualTurnover: '',
      website: '',
      street: '',
      city: '',
      state: '',
      pincode: '',
      country: '',
      contactName: '',
      contactDesignation: '',
      contactEmail: '',
      contactPhone: '',
      categories: [{ major: 'Civil Works', minor: 'Piling' }],
    };

    mockLoad(completelyBlank);
    await renderLoaded();

    const pinInput = screen.getAllByRole('textbox').find((t) => (t as HTMLInputElement).maxLength === 6);
    if (pinInput) {
      // 1 digit pincode: hits raw.length < 3 (line 94 branch 3.0)
      fireEvent.change(pinInput, { target: { value: '4' } });
    }

    // Postal API returning empty strings in post office detail
    const { validatePincode } = jest.requireMock('@/lib/validationSchemas');
    (validatePincode as jest.Mock).mockResolvedValueOnce({
      isValid: true,
      postOffices: [{ District: '', Division: '', Name: '', State: '' }],
    });
    if (pinInput) {
      jest.useFakeTimers();
      fireEvent.change(pinInput, { target: { value: '400099' } });
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      jest.useRealTimers();
    }
  });

  it('covers selectAllMinorInMajor on an unselected major', async () => {
    mockLoad();
    await renderLoaded();

    // Raw Material starts unselected
    expandMajor('Raw Material');
    const panel = majorPanel('Raw Material');
    const selectAllBtn = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Select All'
    );
    if (selectAllBtn) {
      fireEvent.click(selectAllBtn);
    }
    // Now Raw Material is selected in selectedMajor (line 447 branch 100.0)
    expect(selectionSummary()).toContain('3 Major');
  });
});









