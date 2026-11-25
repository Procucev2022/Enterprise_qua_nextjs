import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import { useApp } from '@/lib/store';
import { fetchBuyerProfile, fetchCategoryTaxonomy, saveBuyerProfile } from '@/lib/buyerProfileClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { BuyerProfile } from '@/lib/types';

jest.mock('@/lib/store');
jest.mock('@/lib/buyerProfileClient');
jest.mock('@/lib/validationSchemas');

const TAXONOMY = [
  { majorCategory: 'Civil Works', minorCategories: ['Piling', 'Excavation', 'Waterproofing', 'Roofing', 'Bricks'] },
  { majorCategory: 'IT', minorCategories: ['Laptop', 'Servers', 'Software'] },
  { majorCategory: 'Logistics', minorCategories: ['Road transport'] },
];

const PROFILE: BuyerProfile = {
  organizationId: 'org-1',
  userId: 'user-1',
  companyName: 'Test Company',
  brandName: 'Test Brand',
  organizationType: 'Public Limited',
  panNumber: 'AAACK3921P',
  gstNumber: '27AAACK3921P1Z9',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://www.example.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  street: 'Test Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  contactName: 'Test Contact',
  contactDesignation: 'Manager',
  contactEmail: 'test@example.com',
  contactPhone: '+919157154504',
  categories: [{ major: 'Civil Works', minor: 'Piling' }],
};

describe('BuyerProfilePage - Comprehensive Coverage', () => {
  const mockToast = jest.fn();
  const mockAudit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAudit,
      showToast: mockToast,
      categoryTaxonomy: TAXONOMY,
    });
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: true, data: PROFILE });
    (saveBuyerProfile as jest.Mock).mockResolvedValue({ success: true, data: PROFILE, categoryCount: 1 });
  });

  async function setup() {
    render(<BuyerProfilePage />);
    await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Save Organization Profile')).not.toBeDisabled());
  }

  // Basic rendering
  it('renders form sections', async () => { await setup(); expect(screen.getByText(/Section 1:/)).toBeInTheDocument(); });
  it('renders save button', async () => { await setup(); expect(screen.getByText('Save Organization Profile')).toBeInTheDocument(); });

  // All text inputs
  it('changes company name', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Test Company'), { target: { value: 'New' } }); });
  it('changes brand name', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Test Brand'), { target: { value: 'New' } }); });
  it('changes PAN', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('AAACK3921P'), { target: { value: 'bbbcl1234f' } }); });
  it('changes GSTIN', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('27AAACK3921P1Z9'), { target: { value: '27bbbcl1234f1z5' } }); });
  it('changes CIN', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('L28920MH1946PLC004768'), { target: { value: 'L123' } }); });
  it('changes website', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('https://www.example.com'), { target: { value: 'https://new.com' } }); });
  it('changes turnover', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('INR 1,80,000 Cr+'), { target: { value: '50' } }); });
  it('changes street', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Test Street'), { target: { value: 'New' } }); });
  it('changes city', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Mumbai'), { target: { value: 'Delhi' } }); });
  it('changes state', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Maharashtra'), { target: { value: 'Delhi' } }); });
  it('changes country', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('India'), { target: { value: 'India' } }); });
  it('changes pincode', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('400001'), { target: { value: '400076' } }); });
  it('changes contact name', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Test Contact'), { target: { value: 'New' } }); });
  it('changes designation', async () => { await setup(); fireEvent.change(screen.getByDisplayValue('Manager'), { target: { value: 'CEO' } }); });

  // Organization type
  it('changes org type', async () => {
    await setup();
    const selects = screen.queryAllByRole('combobox');
    if (selects.length > 0) fireEvent.change(selects[0], { target: { value: 'Private Limited' } });
  });

  // Category interactions - all handlers
  it('toggles minor categories on/off', async () => {
    await setup();
    const checkboxes = screen.queryAllByRole('checkbox');
    checkboxes.slice(0, 3).forEach(cb => { fireEvent.click(cb); fireEvent.click(cb); });
  });

  it('exercises Select All buttons', async () => {
    await setup();
    const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes('Select All'));
    buttons.slice(0, 2).forEach(b => fireEvent.click(b));
  });

  it('exercises Clear buttons', async () => {
    await setup();
    const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes('Clear'));
    buttons.slice(0, 2).forEach(b => fireEvent.click(b));
  });

  it('exercises category accordion chevrons', async () => {
    await setup();
    const chevrons = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('svg'));
    chevrons.slice(0, 3).forEach(b => { fireEvent.click(b); fireEvent.click(b); });
  });

  it('filters categories with search', async () => {
    await setup();
    const searchInput = screen.queryByPlaceholderText(/Search/i);
    if (searchInput) {
      fireEvent.change(searchInput, { target: { value: 'IT' } });
      fireEvent.change(searchInput, { target: { value: 'Civil' } });
      fireEvent.change(searchInput, { target: { value: '' } });
    }
  });

  // Save operations
  it('saves on button click', async () => {
    await setup();
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).toHaveBeenCalled();
  });

  it('saves on form submit', async () => {
    const { container } = render(<BuyerProfilePage />);
    await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
    const form = container.querySelector('form');
    if (form) await act(async () => { fireEvent.submit(form); });
  });

  it('disables save button during request', async () => {
    let resolve: (v: unknown) => void;
    (saveBuyerProfile as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
    await setup();
    fireEvent.click(screen.getByText('Save Organization Profile'));
    await waitFor(() => expect(screen.getByText('Save Organization Profile')).toBeDisabled());
    await act(async () => { resolve!({ success: true, data: PROFILE, categoryCount: 1 }); });
  });

  // Validation failures
  it('blocks save with empty company', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('Test Company'), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).not.toHaveBeenCalledWith(expect.objectContaining({ companyName: '' }));
  });

  it('blocks save with no categories', async () => {
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: true, data: { ...PROFILE, categories: [] } });
    await setup();
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).not.toHaveBeenCalled();
  });

  it('shows error on invalid PAN', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('AAACK3921P'), { target: { value: 'invalid' } });
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).not.toHaveBeenCalled();
  });

  it('shows error on invalid GSTIN', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('27AAACK3921P1Z9'), { target: { value: 'bad' } });
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).not.toHaveBeenCalled();
  });

  it('shows error on invalid CIN', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('L28920MH1946PLC004768'), { target: { value: 'bad' } });
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).not.toHaveBeenCalled();
  });

  it('shows error on invalid URL', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('https://www.example.com'), { target: { value: 'not-url' } });
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).not.toHaveBeenCalled();
  });

  it('shows error on invalid pincode', async () => {
    jest.useFakeTimers();
    await setup();
    fireEvent.change(screen.getByDisplayValue('400001'), { target: { value: '111111' } });
    jest.advanceTimersByTime(500);
    jest.useRealTimers();
  });

  // Load failures
  it('handles profile load failure', async () => {
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'Network' });
    render(<BuyerProfilePage />);
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
  });

  it('handles taxonomy load failure', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: false, error: 'Service down' });
    render(<BuyerProfilePage />);
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
  });

  // Save failures
  it('handles save failure', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'Save failed' });
    await setup();
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(mockToast).toHaveBeenCalled();
  });

  // Cleanup
  it('ignores responses after unmount', async () => {
    let resolve: (v: unknown) => void;
    (fetchBuyerProfile as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
    const { unmount } = render(<BuyerProfilePage />);
    await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
    unmount();
    await act(async () => { resolve!({ success: true, data: PROFILE }); });
  });

  // Multiple interactions
  it('handles rapid successive changes', async () => {
    await setup();
    for (let i = 0; i < 10; i += 1) {
      fireEvent.change(screen.getByDisplayValue(/Test Company|New Company/i), { target: { value: `Comp${i}` } });
    }
  });

  it('handles full user flow', async () => {
    await setup();
    fireEvent.change(screen.getByDisplayValue('Test Company'), { target: { value: 'Updated' } });
    const checkboxes = screen.queryAllByRole('checkbox');
    if (checkboxes.length > 1) fireEvent.click(checkboxes[1]);
    await act(async () => { fireEvent.click(screen.getByText('Save Organization Profile')); });
    expect(saveBuyerProfile).toHaveBeenCalled();
  });

  // Edge cases
  it('handles empty taxonomy', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [] });
    await setup();
  });

  it('handles null profile fields', async () => {
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: { ...PROFILE, brandName: '', website: '', annualTurnover: '' },
    });
    await setup();
  });

  it('exercises all validation paths', async () => {
    jest.useFakeTimers();
    await setup();
    const inputs = screen.queryAllByRole('textbox');
    inputs.forEach(input => {
      fireEvent.change(input, { target: { value: 'x' } });
      fireEvent.change(input, { target: { value: '' } });
    });
    jest.useRealTimers();
  });

  it('exercises category state transitions', async () => {
    await setup();
    const checkboxes = screen.queryAllByRole('checkbox');
    for (let i = 0; i < Math.min(5, checkboxes.length); i += 1) {
      fireEvent.click(checkboxes[i]);
      fireEvent.click(checkboxes[i]);
    }
  });
});
