import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BuyerAccountTable from '@/app/buyer/buyer-account-table';
import { useApp } from '@/lib/store';
import { BuyerAccount } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

const MISSING_ADD_FIELDS_MESSAGE =
  'Complete the required fields: Organization legal name, Corporate email, Mobile number, Contact person name, GSTIN, Sourcing mode, Subscription tier, Account source, Free RFQs remaining (a whole number, 0 or more), At least one major category.';

const minorsFor = (majors: string[]): string[] =>
  Array.from(
    new Set(
      CATEGORY_TAXONOMY_FIXTURE.filter((entry) => majors.includes(entry.majorCategory)).flatMap(
        (entry) => entry.minorCategories
      )
    )
  );

describe('app/buyer/buyer-account-table.tsx', () => {
  const mockAddBuyerAccount = jest.fn();
  const mockUpdateBuyerAccount = jest.fn();
  const mockDeleteBuyerAccount = jest.fn();
  const mockAlignActiveBuyerAccount = jest.fn();
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

  const buildAppMock = (overrides: Record<string, unknown> = {}) => ({
    buyerAccounts: mockBuyerAccounts,
    activeBuyerAccount: mockBuyerAccounts[0],
    addBuyerAccount: mockAddBuyerAccount,
    updateBuyerAccount: mockUpdateBuyerAccount,
    deleteBuyerAccount: mockDeleteBuyerAccount,
    alignActiveBuyerAccount: mockAlignActiveBuyerAccount,
    showToast: mockShowToast,
    // The category master lives in the store now, read from the database rather
    // than imported from a bundled categories.json, so a mocked context has to
    // supply it or the major-category picker reads `undefined`.
    categoryTaxonomy: CATEGORY_TAXONOMY_FIXTURE,
    categoryTaxonomyError: null,
    ...overrides,
  });

  const selectWithOption = (value: string): HTMLSelectElement => {
    const match = screen
      .getAllByRole('combobox')
      .find((select): select is HTMLSelectElement => select.querySelector(`option[value="${value}"]`) !== null);
    if (!match) throw new Error(`No select offers the option ${value}`);
    return match;
  };

  const fillRequiredAddFields = () => {
    fireEvent.change(screen.getByPlaceholderText('Legal name of the organization'), {
      target: { value: 'Reliance Industries Ltd' },
    });
    fireEvent.change(screen.getByPlaceholderText('procurement@company.com'), {
      target: { value: 'CPO@RIL.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('+91 XXXXX XXXXX'), {
      target: { value: '+91 99887 76655' },
    });
    fireEvent.change(screen.getByPlaceholderText('Full name'), {
      target: { value: 'Mukesh A' },
    });
    fireEvent.change(screen.getByPlaceholderText('15-character GSTIN'), {
      target: { value: '27aaacr1234a1z1' },
    });
    fireEvent.change(selectWithOption('mode_3'), { target: { value: 'mode_3' } });
    fireEvent.change(selectWithOption('version_3'), { target: { value: 'version_3' } });
    fireEvent.change(selectWithOption('web_registration'), { target: { value: 'web_registration' } });
    fireEvent.change(screen.getByPlaceholderText('0 or more'), { target: { value: '3' } });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue(buildAppMock());
  });

  it('renders table headers, search input, and buyer account rows', () => {
    render(<BuyerAccountTable />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();
    expect(within(table).getByText('Tata Steel Limited')).toBeInTheDocument();
  });

  it('filters table across all search fields, clear button, and source filter buttons', () => {
    render(<BuyerAccountTable />);
    const searchInput = screen.getByPlaceholderText(/Search by Company Name/i);
    const table = screen.getByRole('table');

    fireEvent.change(searchInput, { target: { value: 'Adani Group' } });
    expect(within(table).getByText('Adani Infra Tech')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'procurement@tatasteel.com' } });
    expect(within(table).getByText('Tata Steel Limited')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '27AAACL1234A1Z5' } });
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Mundra' } });
    expect(within(table).getByText('Adani Infra Tech')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Heavy Engineering' } });
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear Search'));
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Public DB \(1\)/i));
    expect(within(table).getByText('Tata Steel Limited')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Web \(1\)/i));
    expect(within(table).getByText('Adani Infra Tech')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/All Sources \(3\)/i));
    expect(within(table).getByText('Larsen & Toubro Limited')).toBeInTheDocument();
  });

  it('offers no public database sync action and makes no connection or sync claim', () => {
    render(<BuyerAccountTable />);
    expect(screen.queryByText(/Sync Public DB/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sync 3 Public System Buyers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gateway: Connected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/100% In Sync/i)).not.toBeInTheDocument();
  });

  it('shows the active session buyer name, or a dash when no account is active', () => {
    const { unmount } = render(<BuyerAccountTable />);
    expect(screen.getByText('Current Session Buyer').parentElement).toHaveTextContent('Larsen & Toubro Limited');
    unmount();

    (useApp as jest.Mock).mockReturnValue(buildAppMock({ activeBuyerAccount: null }));
    render(<BuyerAccountTable />);
    expect(screen.getByText('Current Session Buyer').parentElement).toHaveTextContent('—');
    expect(screen.getByText('Current Session Buyer').parentElement).not.toHaveTextContent('Larsen');
  });

  it('starts the add form empty, with no preset plan, categories, industry, or plant location', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));

    expect(screen.getByPlaceholderText('Legal name of the organization')).toHaveValue('');
    expect(screen.getByPlaceholderText('+91 XXXXX XXXXX')).toHaveValue('');
    expect(screen.getByPlaceholderText('Chief Procurement Officer (CPO)')).toHaveValue('');
    expect(screen.getByPlaceholderText('0 or more')).toHaveValue(null);
    expect(screen.getByPlaceholderText('City or plant, state')).toHaveValue('');
    expect(selectWithOption('mode_3')).toHaveValue('');
    expect(selectWithOption('version_3')).toHaveValue('');
    expect(selectWithOption('web_registration')).toHaveValue('');
    expect(selectWithOption('EPC & Infrastructure Projects')).toHaveValue('');
    CATEGORY_TAXONOMY_FIXTURE.slice(0, 3).forEach((entry) => {
      const chip = screen.getByRole('button', { name: entry.majorCategory });
      expect(chip.querySelector('svg')).toBeNull();
    });
  });

  it('submits only the fields the user entered, with minor categories taken from the selection', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fillRequiredAddFields();
    fireEvent.click(screen.getByRole('button', { name: 'Civil Works' }));
    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));

    expect(mockAddBuyerAccount).toHaveBeenCalledTimes(1);
    const payload = mockAddBuyerAccount.mock.calls[0][0];
    const civilMinors = minorsFor(['Civil Works']);
    expect(payload).toEqual(
      expect.objectContaining({
        organizationName: 'Reliance Industries Ltd',
        corporateEmail: 'cpo@ril.com',
        contactPerson: 'Mukesh A',
        mobileNumber: '+91 99887 76655',
        gstin: '27AAACR1234A1Z1',
        industrySector: '',
        sourcingMode: 'mode_3',
        subscriptionPlan: 'version_3',
        remainingFreeRFQs: 3,
        accountSource: 'web_registration',
        status: 'ACTIVE_VERIFIED',
        primaryPlantLocation: '',
        supportedMajorCategories: ['Civil Works'],
        supportedMinorCategories: civilMinors,
      })
    );
    expect(civilMinors).toContain('Bricks');
    expect(civilMinors).not.toContain('Pumps & Accessories');
    expect(payload).not.toHaveProperty('brandName');
    expect(payload).not.toHaveProperty('contactDesignation');
    expect(payload).not.toHaveProperty('panNumber');
    expect(payload).not.toHaveProperty('cinNumber');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('derives minor categories from every selected major and nothing else', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fillRequiredAddFields();
    fireEvent.click(screen.getByRole('button', { name: 'Civil Works' }));
    fireEvent.click(screen.getByRole('button', { name: 'Engineering Spares - Mechanical' }));
    fireEvent.click(screen.getByRole('button', { name: 'Engineering Spares - Mechanical' }));
    fireEvent.click(screen.getByRole('button', { name: 'Engineering Spares - Electrical' }));
    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));

    const payload = mockAddBuyerAccount.mock.calls[0][0];
    expect(payload.supportedMajorCategories).toEqual(['Civil Works', 'Engineering Spares - Electrical']);
    expect(payload.supportedMinorCategories).toEqual(minorsFor(['Civil Works', 'Engineering Spares - Electrical']));
    expect(payload.supportedMinorCategories).not.toContain('Abrasives');
  });

  it('lists every missing required field in one validation message and creates nothing', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));

    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', MISSING_ADD_FIELDS_MESSAGE, 'warning');
    expect(mockAddBuyerAccount).not.toHaveBeenCalled();
  });

  it('rejects a free RFQ count that is not a whole number', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fillRequiredAddFields();
    fireEvent.click(screen.getByRole('button', { name: 'Civil Works' }));
    fireEvent.change(screen.getByPlaceholderText('0 or more'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      'Validation Error',
      'Complete the required fields: Free RFQs remaining (a whole number, 0 or more).',
      'warning'
    );
    expect(mockAddBuyerAccount).not.toHaveBeenCalled();
  });

  it('closes the add modal on Cancel and on the X button', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    expect(screen.getByText(/Add \/ Align Existing Public Buyer Account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close Add Modal'));
    expect(screen.queryByText(/Add \/ Align Existing Public Buyer Account/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Add \/ Align Existing Public Buyer Account/i)).not.toBeInTheDocument();
  });

  it('edit sends only the four fields shown in the dialog', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getAllByTitle('Edit Account Specifications')[0]);
    expect(screen.getByText('Edit Buyer Account Specifications')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Larsen & Toubro Limited'), {
      target: { value: 'L&T Global Engineering' },
    });
    fireEvent.change(screen.getByDisplayValue('L&T Heavy Engineering'), {
      target: { value: 'L&T Global Brand' },
    });
    fireEvent.change(screen.getByDisplayValue('procurement@lnt.com'), {
      target: { value: 'Global@LnT.com' },
    });
    fireEvent.change(screen.getByDisplayValue('+91 98201 44820'), {
      target: { value: '+91 98201 00000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update Specifications/i }));

    expect(mockUpdateBuyerAccount).toHaveBeenCalledWith('buyer-1', {
      organizationName: 'L&T Global Engineering',
      brandName: 'L&T Global Brand',
      corporateEmail: 'global@lnt.com',
      mobileNumber: '+91 98201 00000',
    });
    expect(screen.queryByText('Edit Buyer Account Specifications')).not.toBeInTheDocument();
  });

  it('edit loads an account with no brand as an empty brand and saves the trimmed name', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getAllByTitle('Edit Account Specifications')[1]);
    expect(screen.getByDisplayValue('Tata Steel Limited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Update Specifications/i }));

    expect(mockUpdateBuyerAccount).toHaveBeenCalledWith('buyer-2', {
      organizationName: 'Tata Steel Limited',
      brandName: '',
      corporateEmail: 'procurement@tatasteel.com',
      mobileNumber: '+91 98201 55667',
    });
  });

  it('edit requires organization name, email, and mobile before saving', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getAllByTitle('Edit Account Specifications')[0]);
    fireEvent.change(screen.getByDisplayValue('Larsen & Toubro Limited'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Specifications/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      'Validation Error',
      'Complete the required fields: Organization legal name.',
      'warning'
    );
    expect(mockUpdateBuyerAccount).not.toHaveBeenCalled();
  });

  it('closes the edit modal on the X and Cancel buttons', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getAllByTitle('Edit Account Specifications')[0]);
    fireEvent.click(screen.getByLabelText('Close Edit Modal'));
    expect(screen.queryByText('Edit Buyer Account Specifications')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle('Edit Account Specifications')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit Buyer Account Specifications')).not.toBeInTheDocument();
  });

  it('aligns a session, deletes a record, and exports the master CSV of real rows', () => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    render(<BuyerAccountTable />);

    fireEvent.click(screen.getAllByText('Align Session')[0]);
    expect(mockAlignActiveBuyerAccount).toHaveBeenCalledWith('buyer-2');

    fireEvent.click(screen.getAllByTitle('Delete Record')[0]);
    expect(mockDeleteBuyerAccount).toHaveBeenCalledWith('buyer-1');

    fireEvent.click(screen.getByText('Export Master'));
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Export Complete', expect.any(String), 'info');
  });

  it('shows the free RFQ balance of a trial account without a hardcoded limit', () => {
    render(<BuyerAccountTable />);
    expect(screen.getByText('2 free RFQs remaining')).toBeInTheDocument();
    expect(screen.queryByText(/of 5 free RFQs/i)).not.toBeInTheDocument();
  });

  it('shows the legacy label for public-system records and no sync timestamp claim', () => {
    render(<BuyerAccountTable />);
    expect(screen.getByText('Legacy Public Record')).toBeInTheDocument();
    expect(screen.queryByText(/Synced from Public DB/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Last saved:/).length).toBe(3);
  });

  it('handles empty filtered accounts and null activeBuyerAccount', () => {
    (useApp as jest.Mock).mockReturnValue(buildAppMock({ buyerAccounts: [], activeBuyerAccount: null }));

    render(<BuyerAccountTable />);
    expect(screen.getByText('No buyer accounts matching your query.')).toBeInTheDocument();
  });

  it('submits the optional brand, designation and PAN, and marks a public-system account as legacy', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    fillRequiredAddFields();
    fireEvent.change(screen.getByPlaceholderText('Brand or division, if different'), {
      target: { value: 'Reliance Retail' },
    });
    fireEvent.change(screen.getByPlaceholderText('Chief Procurement Officer (CPO)'), {
      target: { value: 'Head of Sourcing' },
    });
    fireEvent.change(screen.getByPlaceholderText('10-character PAN'), { target: { value: 'aaacr1234a' } });
    fireEvent.change(screen.getByPlaceholderText('City or plant, state'), { target: { value: 'Jamnagar, GJ' } });
    fireEvent.change(selectWithOption('public_system'), { target: { value: 'public_system' } });
    fireEvent.click(screen.getByRole('button', { name: 'Civil Works' }));
    fireEvent.click(screen.getByRole('button', { name: /Add Buyer to Database/i }));

    expect(mockAddBuyerAccount).toHaveBeenCalledTimes(1);
    expect(mockAddBuyerAccount.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        brandName: 'Reliance Retail',
        contactDesignation: 'Head of Sourcing',
        panNumber: 'AAACR1234A',
        primaryPlantLocation: 'Jamnagar, GJ',
        accountSource: 'public_system',
        status: 'SYNCED_LEGACY',
      })
    );
  });

  it('edit reports a blank mobile number it cannot save without', () => {
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getAllByTitle('Edit Account Specifications')[0]);
    // A whitespace-only value satisfies the field's required attribute but trims to nothing.
    fireEvent.change(screen.getByDisplayValue('+91 98201 44820'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Specifications/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      'Validation Error',
      'Complete the required fields: Mobile number.',
      'warning'
    );
    expect(mockUpdateBuyerAccount).not.toHaveBeenCalled();
  });

  it('shows dashes for a record with no plant, industry, category list or sync time', () => {
    const bareBuyer: Partial<BuyerAccount> = {
      ...mockBuyerAccounts[1],
      id: 'buyer-bare',
      organizationName: 'Bare Buyer Ltd',
      primaryPlantLocation: '',
      industrySector: '',
      syncTimestamp: '',
    };
    // The record arrives without a category list at all, not an empty one.
    delete bareBuyer.supportedMajorCategories;
    (useApp as jest.Mock).mockReturnValue(buildAppMock({ buyerAccounts: [bareBuyer] }));

    render(<BuyerAccountTable />);
    const row = screen.getByText('Bare Buyer Ltd').closest('tr') as HTMLElement;
    // Plant location and industry each render a standalone dash.
    expect(within(row).getAllByText('—')).toHaveLength(2);
    // The last-saved dash shares its element with the label, so it is matched by its full text.
    expect(within(row).getByText(/Last saved:/)).toHaveTextContent('Last saved: —');
  });

  it('explains an empty category master with the error the store reports', () => {
    (useApp as jest.Mock).mockReturnValue(
      buildAppMock({ categoryTaxonomy: [], categoryTaxonomyError: 'The category master could not be read.' })
    );
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    expect(screen.getByText('The category master could not be read.')).toBeInTheDocument();
  });

  it('falls back to the standard message when an empty category master has no error', () => {
    (useApp as jest.Mock).mockReturnValue(buildAppMock({ categoryTaxonomy: [], categoryTaxonomyError: null }));
    render(<BuyerAccountTable />);
    fireEvent.click(screen.getByText(/Add Existing Public Buyer/i));
    expect(screen.getByText(UI_STRINGS.buyerProfile.taxonomyEmpty)).toBeInTheDocument();
  });
});
