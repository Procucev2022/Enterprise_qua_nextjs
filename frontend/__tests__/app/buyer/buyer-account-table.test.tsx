import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import BuyerAccountTable from '@/app/buyer/buyer-account-table';
import { useApp } from '@/lib/store';
import { BuyerAccount } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/buyer-account-table.tsx', () => {
  const mockAddBuyerAccount = jest.fn();
  const mockUpdateBuyerAccount = jest.fn();
  const mockDeleteBuyerAccount = jest.fn();
  const mockAlignActiveBuyerAccount = jest.fn();
  const mockImportPublicBuyerDatabase = jest.fn();
  const mockShowToast = jest.fn();

  const mockBuyerAccounts: BuyerAccount[] = [
    {
      id: 'buyer-1',
      organizationName: 'Larsen & Toubro Limited',
      brandName: 'L&T Heavy Engineering',
      industrySector: 'Heavy Engineering & Manufacturing',
      corporateEmail: 'procurement@lnt.com',
      contactPerson: 'Vikram Malhotra',
      contactDesignation: 'VP Procurement',
      mobileNumber: '+91 98201 44820',
      primaryPlantLocation: 'Navi Mumbai Hub, MH',
      gstin: '27AAACL1234A1Z5',
      panNumber: 'AAACL1234A',
      cinNumber: 'L99999MH1946PLC004768',
      sourcingMode: 'mode_2',
      subscriptionPlan: 'version_2',
      remainingFreeRFQs: 5,
      totalRFQsCreated: 12,
      totalSpend: '$4.2M',
      accountSource: 'enterprise_sso',
      status: 'ACTIVE_VERIFIED',
      syncTimestamp: '2026-08-29 10:00 UTC',
      createdDate: '2026-01-15',
      supportedMajorCategories: ['Engineering Spares - Mechanical', 'Civil Works', 'Electrical'],
    },
    {
      id: 'buyer-2',
      organizationName: 'Tata Steel Limited',
      brandName: '',
      industrySector: 'Metals & Mining',
      corporateEmail: 'procurement@tatasteel.com',
      contactPerson: 'Ravi Verma',
      contactDesignation: '',
      mobileNumber: '+91 98201 55667',
      primaryPlantLocation: 'Jamshedpur Works, JH',
      gstin: '20AAACT1234A1Z6',
      sourcingMode: 'mode_1',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 2,
      totalRFQsCreated: 8,
      totalSpend: '$2.8M',
      accountSource: 'public_system',
      status: 'SYNCED_LEGACY',
      syncTimestamp: '2026-08-29 11:00 UTC',
      createdDate: '2026-02-10',
      supportedMajorCategories: ['Engineering Spares - Mechanical'],
    },
    {
      id: 'buyer-3',
      organizationName: 'Adani Infra Tech',
      brandName: 'Adani Group',
      industrySector: 'EPC & Infrastructure Projects',
      corporateEmail: 'infra@adani.com',
      contactPerson: 'Sanjay Rawat',
      contactDesignation: 'Director',
      mobileNumber: '+91 98201 99887',
      primaryPlantLocation: 'Mundra Port, GJ',
      gstin: '24AAACA1234A1Z7',
      panNumber: 'AAACA1234A',
      sourcingMode: 'mode_3',
      subscriptionPlan: 'version_3',
      remainingFreeRFQs: 0,
      totalRFQsCreated: 20,
      totalSpend: '$10.5M',
      accountSource: 'web_registration',
      status: 'PENDING_ALIGNMENT',
      syncTimestamp: '2026-08-29 12:00 UTC',
      createdDate: '2026-03-01',
      supportedMajorCategories: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: mockBuyerAccounts,
      activeBuyerAccount: mockBuyerAccounts[0],
      addBuyerAccount: mockAddBuyerAccount,
      updateBuyerAccount: mockUpdateBuyerAccount,
      deleteBuyerAccount: mockDeleteBuyerAccount,
      alignActiveBuyerAccount: mockAlignActiveBuyerAccount,
      importPublicBuyerDatabase: mockImportPublicBuyerDatabase,
      showToast: mockShowToast,
    });
  });

  it('renders table headers, search input, and buyer account rows', () => {
    render(<BuyerAccountTable />);
    expect(screen.getByText('Integrated Buyer Directory & Public System Database')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();
    expect(within(table).getByText('Tata Steel Limited')).toBeInTheDocument();
  });

  it('filters table across all search fields, clear button, and source filter buttons', () => {
    render(<BuyerAccountTable />);
    const searchInput = screen.getByPlaceholderText(/Search by Company Name/i);
    const table = screen.getByRole('table');

    // Search by brand
    fireEvent.change(searchInput, { target: { value: 'Adani Group' } });
    expect(within(table).getByText('Adani Infra Tech')).toBeInTheDocument();

    // Search by email
    fireEvent.change(searchInput, { target: { value: 'procurement@tatasteel.com' } });
    expect(within(table).getByText('Tata Steel Limited')).toBeInTheDocument();

    // Search by GSTIN
    fireEvent.change(searchInput, { target: { value: '27AAACL1234A1Z5' } });
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();

    // Search by location
    fireEvent.change(searchInput, { target: { value: 'Mundra' } });
    expect(within(table).getByText('Adani Infra Tech')).toBeInTheDocument();

    // Search by industry
    fireEvent.change(searchInput, { target: { value: 'Heavy Engineering' } });
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();

    // Clear search using Clear Search button
    fireEvent.click(screen.getByLabelText('Clear Search'));
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();

    // Filter by Source buttons
    fireEvent.click(screen.getByText(/Public DB \(1\)/i));
    expect(within(table).getByText('Tata Steel Limited')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Web \(1\)/i));
    expect(within(table).getByText('Adani Infra Tech')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/All Sources \(3\)/i));
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();
  });

  it('handles add buyer account modal form workflow with full fields and category toggles', () => {
    render(<BuyerAccountTable />);
    // Open add modal
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    expect(screen.getByText(/Add \/ Align Existing Public Buyer Account/i)).toBeInTheDocument();

    // Fill form using placeholders
    fireEvent.change(screen.getByPlaceholderText('e.g. Larsen & Toubro Limited'), {
      target: { value: 'Reliance Industries Ltd' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. L&T Heavy Engineering Division'), {
      target: { value: 'RIL Petro' },
    });
    fireEvent.change(screen.getByPlaceholderText('procurement@company.com'), {
      target: { value: 'cpo@ril.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('+91 98201 44820'), {
      target: { value: '+91 99887 76655' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. Rajesh Sharma'), {
      target: { value: 'Mukesh A' },
    });
    fireEvent.change(screen.getByPlaceholderText('Chief Procurement Officer (CPO)'), {
      target: { value: 'Managing Director' },
    });
    fireEvent.change(screen.getByPlaceholderText('27AAACL1234F1Z5'), {
      target: { value: '27AAACR1234A1Z1' },
    });
    fireEvent.change(screen.getByPlaceholderText('AAACL1234F'), {
      target: { value: 'AAACR1234A' },
    });

    // Selects in Add modal
    const modalSelects = screen.getAllByRole('combobox');
    const indSelect = modalSelects.find((s) => s.querySelector('option[value="EPC & Infrastructure Projects"]'));
    if (indSelect) fireEvent.change(indSelect, { target: { value: 'EPC & Infrastructure Projects' } });

    const modeSelect = modalSelects.find((s) => s.querySelector('option[value="mode_3"]'));
    if (modeSelect) fireEvent.change(modeSelect, { target: { value: 'mode_3' } });

    const planSelect = modalSelects.find((s) => s.querySelector('option[value="version_3"]'));
    if (planSelect) fireEvent.change(planSelect, { target: { value: 'version_3' } });

    const srcSelect = modalSelects.find((s) => s.querySelector('option[value="web_registration"]'));
    if (srcSelect) fireEvent.change(srcSelect, { target: { value: 'web_registration' } });

    // Click Category badges in modal to toggle category
    const catBadges = screen.getAllByRole('button');
    const toggleableCat = catBadges.find((b) => b.textContent?.includes('Civil Works'));
    if (toggleableCat) {
      fireEvent.click(toggleableCat);
      fireEvent.click(toggleableCat);
    }

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Add Buyer to Database/i });
    fireEvent.click(submitBtn);

    expect(mockAddBuyerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: 'Reliance Industries Ltd',
        brandName: 'RIL Petro',
        corporateEmail: 'cpo@ril.com',
        contactPerson: 'Mukesh A',
        contactDesignation: 'Managing Director',
        mobileNumber: '+91 99887 76655',
        gstin: '27AAACR1234A1Z1',
        panNumber: 'AAACR1234A',
        status: 'ACTIVE_VERIFIED',
      })
    );
  });

  it('handles add buyer account fallback defaults and validation errors', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));

    // 1. Validation error when orgName is empty
    fireEvent.change(screen.getByPlaceholderText('e.g. Larsen & Toubro Limited'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));
    expect(mockShowToast).toHaveBeenCalledWith(
      'Validation Error',
      'Organization Name, Email, Contact Person, and GSTIN are required.',
      'warning'
    );

    // 2. Add with public_system and empty categories to test fallbacks
    fireEvent.change(screen.getByPlaceholderText('e.g. Larsen & Toubro Limited'), {
      target: { value: 'BHEL Ltd' },
    });
    fireEvent.change(screen.getByPlaceholderText('procurement@company.com'), {
      target: { value: 'procure@bhel.in' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. Rajesh Sharma'), {
      target: { value: 'Nalini S' },
    });
    fireEvent.change(screen.getByPlaceholderText('27AAACL1234F1Z5'), {
      target: { value: '07AAACB1234A1Z0' },
    });

    // Unselect initial 3 categories
    const catBadges = screen.getAllByRole('button');
    const mech = catBadges.find((b) => b.textContent?.includes('Engineering Spares - Mechanical'));
    const elec = catBadges.find((b) => b.textContent?.includes('Engineering Spares - Electrical'));
    const civil = catBadges.find((b) => b.textContent?.includes('Civil Works'));
    if (mech) fireEvent.click(mech);
    if (elec) fireEvent.click(elec);
    if (civil) fireEvent.click(civil);

    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));

    expect(mockAddBuyerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: 'BHEL Ltd',
        brandName: 'BHEL Ltd',
        corporateEmail: 'procure@bhel.in',
        status: 'SYNCED_LEGACY',
        panNumber: 'AAACB1234A',
        supportedMajorCategories: ['Engineering Spares - Mechanical'],
      })
    );
  });

  it('handles edit buyer account modal workflow and updates specifications, and cancel', () => {
    render(<BuyerAccountTable />);
    // Click Edit on first account
    const editBtns = screen.getAllByTitle('Edit Account Specifications');
    fireEvent.click(editBtns[0]);
    expect(screen.getByText('Edit Buyer Account Specifications')).toBeInTheDocument();

    // Modify fields in edit form
    const orgInput = screen.getByDisplayValue('Larsen & Toubro Limited');
    fireEvent.change(orgInput, { target: { value: 'L&T Global Engineering' } });
    const brandInput = screen.getByDisplayValue('L&T Heavy Engineering');
    fireEvent.change(brandInput, { target: { value: 'L&T Global Brand' } });
    const emailInput = screen.getByDisplayValue('procurement@lnt.com');
    fireEvent.change(emailInput, { target: { value: 'global@lnt.com' } });
    const phoneInput = screen.getByDisplayValue('+91 98201 44820');
    fireEvent.change(phoneInput, { target: { value: '+91 98201 00000' } });

    // Save changes
    const updateBtn = screen.getByRole('button', { name: /Update Specifications/i });
    fireEvent.click(updateBtn);
    expect(mockUpdateBuyerAccount).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({
        organizationName: 'L&T Global Engineering',
        brandName: 'L&T Global Brand',
        corporateEmail: 'global@lnt.com',
        mobileNumber: '+91 98201 00000',
      })
    );

    // Open edit modal on buyer-2 (empty brand, empty designation, undefined PAN/CIN)
    fireEvent.click(editBtns[1]);
    expect(screen.getByDisplayValue('Tata Steel Limited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Update Specifications/i }));
    expect(mockUpdateBuyerAccount).toHaveBeenCalledWith(
      'buyer-2',
      expect.objectContaining({
        organizationName: 'Tata Steel Limited',
      })
    );
  });

  it('handles all modal close buttons (X buttons and cancel buttons)', () => {
    render(<BuyerAccountTable />);

    // 1. Add Modal X button
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    expect(screen.getByText(/Add \/ Align Existing Public Buyer Account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close Add Modal'));
    expect(screen.queryByText(/Add \/ Align Existing Public Buyer Account/i)).not.toBeInTheDocument();

    // 2. Sync Modal X button
    fireEvent.click(screen.getByText(/Sync Public DB/i));
    expect(screen.getByText(/Sync Public System Buyer Database/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close Sync Modal'));
    expect(screen.queryByText(/Sync Public System Buyer Database/i)).not.toBeInTheDocument();

    // 3. Edit Modal X button
    const editBtns = screen.getAllByTitle('Edit Account Specifications');
    fireEvent.click(editBtns[0]);
    expect(screen.getByText('Edit Buyer Account Specifications')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close Edit Modal'));
    expect(screen.queryByText('Edit Buyer Account Specifications')).not.toBeInTheDocument();
  });

  it('handles align session, delete, CSV export, and public DB batch sync workflows and modal cancels', () => {
    jest.useFakeTimers();
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    render(<BuyerAccountTable />);

    // Align active account on second row
    const alignBtns = screen.getAllByText('Align Session');
    fireEvent.click(alignBtns[0]);
    expect(mockAlignActiveBuyerAccount).toHaveBeenCalledWith('buyer-2');

    // Delete account
    const deleteBtns = screen.getAllByTitle('Delete Record');
    fireEvent.click(deleteBtns[0]);
    expect(mockDeleteBuyerAccount).toHaveBeenCalledWith('buyer-1');

    // Export Master CSV
    fireEvent.click(screen.getByText('Export Master'));
    expect(mockShowToast).toHaveBeenCalledWith('Export Complete', expect.any(String), 'info');

    // Open sync public database modal
    fireEvent.click(screen.getByText(/Sync Public DB/i));
    expect(screen.getByText(/Sync Public System Buyer Database/i)).toBeInTheDocument();

    // Trigger batch sync
    fireEvent.click(screen.getByText(/Sync 3 Public System Buyers Now/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(mockImportPublicBuyerDatabase).toHaveBeenCalled();

    // Test cancel on Sync Modal
    fireEvent.click(screen.getByText(/Sync Public DB/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Sync Public System Buyer Database/i)).not.toBeInTheDocument();

    // Test cancel on Add Modal
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Add \/ Align Existing Public Buyer Account/i)).not.toBeInTheDocument();

    // Test cancel on Edit Modal
    const editBtns = screen.getAllByTitle('Edit Account Specifications');
    fireEvent.click(editBtns[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit Buyer Account Specifications')).not.toBeInTheDocument();

    jest.useRealTimers();
  });

  it('handles empty filtered accounts and null activeBuyerAccount', () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: [],
      activeBuyerAccount: null,
      addBuyerAccount: mockAddBuyerAccount,
      updateBuyerAccount: mockUpdateBuyerAccount,
      deleteBuyerAccount: mockDeleteBuyerAccount,
      alignActiveBuyerAccount: mockAlignActiveBuyerAccount,
      importPublicBuyerDatabase: mockImportPublicBuyerDatabase,
      showToast: mockShowToast,
    });

    render(<BuyerAccountTable />);
    expect(screen.getByText('No buyer accounts matching your query.')).toBeInTheDocument();
  });
});
