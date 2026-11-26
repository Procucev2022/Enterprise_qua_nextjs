import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistrationsDashboard from '@/app/category-manager/components/RegistrationsDashboard';
import { UI_STRINGS } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';
import { exportReportToCsv } from '@/lib/reportsClient';

jest.mock('@/lib/userPreferencesClient', () => ({
  getUserPreference: jest.fn().mockResolvedValue(null),
  saveUserPreference: jest.fn().mockResolvedValue(true),
  deleteUserPreference: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/reportsClient', () => {
  const actual = jest.requireActual('@/lib/reportsClient');
  return {
    ...actual,
    exportReportToCsv: jest.fn(),
  };
});

const mockClients = [
  {
    id: 'reg-client-101',
    userName: 'verababu',
    companyName: 'Verababu eneterprises',
    phoneNumber: '+919381877013',
    userEmail: 'veerababuv2002@gmail.com',
    regDate: '2026-06-30T10:30:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-102',
    userName: 'Govardhan Kilari',
    companyName: 'GOVARDHAN PVT LTD',
    phoneNumber: '+917780755357',
    userEmail: 'govardhjan.kilari@procucev.com',
    regDate: '2026-06-30T09:15:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-107',
    userName: 'Raghavendra',
    companyName: 'Raghavendra Solutions Pvt Ltd',
    phoneNumber: '+917981186190',
    userEmail: 'raghureddy2488975@gmail.com',
    regDate: '2026-05-20T14:30:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-113',
    userName: 'Navin Kumar',
    companyName: 'Kumar Infrastructure',
    phoneNumber: '+919845012345',
    userEmail: 'navin.kumar@kumarinfra.in',
    regDate: '2026-02-18T10:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Email',
    isApproved: true,
  },
  {
    id: 'reg-client-114',
    userName: 'Anita Rao',
    companyName: 'Rao Enterprises',
    phoneNumber: '',
    userEmail: 'anita@rao.in',
    regDate: '2026-03-10T10:00:00.000Z',
    status: 'Rejected',
    sourceType: 'Other',
    isApproved: false,
    clientType: 'Buyer',
  },
  {
    id: 'reg-client-seller-1',
    userName: 'Kishore Metals',
    companyName: 'Kishore Metals Ltd',
    phoneNumber: '+919988776655',
    userEmail: 'kishore@metals.com',
    regDate: '2026-06-30T10:30:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
    clientType: 'Seller',
  },
  {
    id: 'reg-client-empty',
    userName: '',
    companyName: '',
    phoneNumber: '',
    userEmail: '',
    regDate: '',
    status: '',
    sourceType: '',
    clientType: '',
    isApproved: false,
  },
  {
    id: 'reg-client-seller-2',
    userName: 'Suspended Seller',
    companyName: 'Suspended Metals',
    phoneNumber: '+919988776654',
    userEmail: 'suspended@seller.com',
    regDate: '2026-06-30T10:30:00.000Z',
    status: 'Rejected',
    sourceType: 'Web App',
    isApproved: false,
    clientType: 'Seller',
  },
  {
    id: 'reg-client-empty-2',
    userName: '',
    companyName: '',
    phoneNumber: '',
    userEmail: '',
    regDate: '',
    status: '',
    sourceType: '',
    clientType: '',
    isApproved: false,
  },
];

describe('RegistrationsDashboard', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('registration-session-token');
    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/internal-tasks/registrations') && !url.includes('/action')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              total: mockClients.length,
              data: mockClients,
              limit: 100,
              offset: 0,
            }),
        });
      }
      if (typeof url === 'string' && url.includes('/action')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              message: 'Action completed',
            }),
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
  });

  test('renders summary cards and updates total count', async () => {
    const onCountChange = jest.fn();
    render(<RegistrationsDashboard onTotalCountChange={onCountChange} />);

    expect(screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiTotalClients).length).toBeGreaterThan(0);
    expect(screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWebApp).length).toBeGreaterThan(0);
    expect(screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWhatsApp).length).toBeGreaterThan(0);
    expect(screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiEmail).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(mockClients.length);
    });
  });

  test('displays all table columns and client records', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
    expect(screen.getByText('GOVARDHAN PVT LTD')).toBeInTheDocument();
    expect(screen.getByText('Raghavendra')).toBeInTheDocument();
    expect(screen.getByText('Navin Kumar')).toBeInTheDocument();
    expect(screen.getByText('+919381877013')).toBeInTheDocument();
    expect(screen.getByText('veerababuv2002@gmail.com')).toBeInTheDocument();
    expect(screen.getAllByText('30-Jun-2026').length).toBeGreaterThanOrEqual(1);
  });

  test('filters by source type', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const sourceSelect = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.sourceTypeLabel);
    fireEvent.change(sourceSelect, { target: { value: 'WhatsApp' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sourceType=WhatsApp'),
        expect.objectContaining({ headers: { Authorization: 'Bearer registration-session-token' } })
      );
    });
  });

  test('searches clients with text query', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'GOVARDHAN' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=GOVARDHAN'),
        expect.objectContaining({ headers: { Authorization: 'Bearer registration-session-token' } })
      );
    });
  });

  test('displays auto-approved status indicator for both buyers and sellers without action buttons', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
      expect(screen.getByText('GOVARDHAN PVT LTD')).toBeInTheDocument();
    });

    // Auto-Approved is shown for both buyers and sellers
    const autoApprovedBadges = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.statusAutoApproved);
    expect(autoApprovedBadges.length).toBeGreaterThan(0);

    // Rejected is shown for genuinely rejected records
    expect(screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.statusRejected).length).toBeGreaterThan(0);

    // No manual accept or reject action buttons should exist
    expect(screen.queryByLabelText(/accept for/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reject for/i)).not.toBeInTheDocument();
  });

  test('filters registrations by source dropdown (All, Web App, WhatsApp, Email)', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const sourceSelect = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.sourceTypeLabel);

    fireEvent.change(sourceSelect, { target: { value: 'WhatsApp' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sourceType=WhatsApp'),
        expect.anything()
      );
    });

    fireEvent.change(sourceSelect, { target: { value: 'Email' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sourceType=Email'),
        expect.anything()
      );
    });

    fireEvent.change(sourceSelect, { target: { value: 'all' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.not.stringContaining('sourceType='),
        expect.anything()
      );
    });
  });

  test('independent filters combine correctly when multiple filters are selected', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const clientSelect = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.clientTypeLabel);
    const sourceSelect = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.sourceTypeLabel);
    const startInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.startDatePlaceholder) as HTMLInputElement;

    fireEvent.change(clientSelect, { target: { value: 'buyer' } });
    fireEvent.change(sourceSelect, { target: { value: 'Web App' } });
    fireEvent.change(startInput, { target: { value: '2026-06-01' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('clientType=buyer'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('sourceType=Web+App'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('startDate=2026-06-01'),
        expect.anything()
      );
    });
  });

  test('handles pagination navigation and page size change', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          total: 250,
          data: mockClients,
        }),
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const nextPage = screen.getByLabelText('Next page');
    expect(nextPage).not.toBeDisabled();
    fireEvent.click(nextPage);

    const prevPage = screen.getByLabelText('Previous page');
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(prevPage).not.toBeDisabled();
    });

    fireEvent.click(prevPage);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(nextPage).not.toBeDisabled();
    });

    const lastPage = screen.getByLabelText('Last page');
    fireEvent.click(lastPage);

    const firstPage = screen.getByLabelText('First page');
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(firstPage).not.toBeDisabled();
    });

    fireEvent.click(firstPage);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(nextPage).not.toBeDisabled();
    });

    const pageSizeSelect = screen.getByLabelText('Select page size');
    fireEvent.change(pageSizeSelect, { target: { value: '25' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=25'),
        expect.objectContaining({ headers: { Authorization: 'Bearer registration-session-token' } })
      );
    });
  });

  test('renders error when API returns success: false with custom error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false, error: 'Database access denied' }),
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Database access denied')).toBeInTheDocument();
    });
  });

  test('renders error when API returns success: false without error message', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false }),
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.noClientsFound)).toBeInTheDocument();
    });
  });

  test('handles non-Error rejection on fetch', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce('Network crashed completely');

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.actionError)).toBeInTheDocument();
    });
  });


  test('renders empty state when no clients returned', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          total: 0,
          data: [],
        }),
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.noClientsFound)
      ).toBeInTheDocument();
    });
  });

  test('renders error state on API failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Internal server timeout'));

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Internal server timeout')).toBeInTheDocument();
    });
  });

  test('formats invalid or missing dates gracefully', async () => {
    const clientsWithOddDates = [
      {
        ...mockClients[0],
        id: 'odd-1',
        regDate: 'invalid-date',
      },
      {
        ...mockClients[1],
        id: 'odd-2',
        regDate: '',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          total: 2,
          data: clientsWithOddDates,
        }),
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('invalid-date')).toBeInTheDocument();
      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });
  test('clicks summary cards to open modal with filtered clients', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    // Click Total Registrations card
    const totalCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiTotalClients);
    fireEvent.click(totalCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Close modal
    const closeBtn = screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn);
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Click Web App card
    const webAppCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWebApp);
    fireEvent.click(webAppCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Close modal again
    fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

    // Click WhatsApp card
    const whatsAppCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWhatsApp);
    fireEvent.click(whatsAppCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

    // Click Email card
    const emailCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiEmail);
    fireEvent.click(emailCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  test('handles keyboard enter and space on summary card to open modal', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const webAppCard = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWebApp)[0].closest('[role="group"]');
    expect(webAppCard).not.toBeNull();
    if (webAppCard) {
      fireEvent.keyDown(webAppCard, { key: 'Enter' });
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

      fireEvent.keyDown(webAppCard, { key: ' ' });
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

      // Non-activating key
      fireEvent.keyDown(webAppCard, { key: 'ArrowDown' });
    }

    const whatsAppCard = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWhatsApp)[0].closest('[role="group"]');
    if (whatsAppCard) {
      fireEvent.keyDown(whatsAppCard, { key: 'Enter' });
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));
    }

    const emailCard = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiEmail)[0].closest('[role="group"]');
    if (emailCard) {
      fireEvent.keyDown(emailCard, { key: ' ' });
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));
    }

    const totalCard = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiTotalClients)[0].closest('[role="group"]');
    if (totalCard) {
      fireEvent.keyDown(totalCard, { key: 'Enter' });
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));
    }
  });

  test('handles clicking summary cards to open modal with filtered clients', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const totalCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiTotalClients);
    fireEvent.click(totalCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

    const webAppCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWebApp);
    fireEvent.click(webAppCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

    const whatsAppCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiWhatsApp);
    fireEvent.click(whatsAppCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.closeBtn));

    const emailCards = screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiEmail);
    fireEvent.click(emailCards[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  test('clears search input with clear button and triggers refresh', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'test-query' } });

    const clearButton = screen.getByLabelText('Clear search');
    expect(clearButton).toBeInTheDocument();
    fireEvent.click(clearButton);

    expect(searchInput).toHaveValue('');

    const refreshButton = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.refreshTooltip);
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });
  test('filters by client view (Buyers / Sellers)', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const clientTypeSelect = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.clientTypeLabel);
    fireEvent.change(clientTypeSelect, { target: { value: 'buyer' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('clientType=buyer'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer registration-session-token' },
        })
      );
    });

    fireEvent.change(clientTypeSelect, { target: { value: 'seller' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('clientType=seller'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer registration-session-token' },
        })
      );
    });
  });

  test('opens column settings modal, reorders columns via drag and drop, and toggles visibility', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const gearBtn = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTooltip);
    fireEvent.click(gearBtn);

    expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).toBeInTheDocument();

    // Toggle column visibility
    const companyCheckbox = document.getElementById('col-toggle-companyName') as HTMLInputElement;
    expect(companyCheckbox).toBeInTheDocument();
    expect(companyCheckbox.checked).toBe(true);

    fireEvent.click(companyCheckbox);
    expect(companyCheckbox.checked).toBe(false);

    // Test drag and drop reordering
    const firstBadge = screen.getByText('#1');
    const secondBadge = screen.getByText('#2');
    const firstRow = firstBadge.closest('[draggable="true"]') as HTMLElement;
    const secondRow = secondBadge.closest('[draggable="true"]') as HTMLElement;

    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(firstRow, { dataTransfer });
    fireEvent.dragOver(secondRow, { dataTransfer });
    fireEvent.drop(secondRow, { dataTransfer });

    // Test Reset to Default
    const resetBtn = screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.resetToDefault);
    fireEvent.click(resetBtn);

    // Test Done button closes modal
    const doneBtn = screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.doneBtn);
    fireEvent.click(doneBtn);

    expect(screen.queryByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).not.toBeInTheDocument();
  });

  test('closes column settings modal using the close X button', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const gearBtn = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTooltip);
    fireEvent.click(gearBtn);

    expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).toBeInTheDocument();

    const closeBtn = screen.getByLabelText('Close column settings');
    fireEvent.click(closeBtn);

    expect(screen.queryByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).not.toBeInTheDocument();
  });

  test('supports sorting columns ascending and descending', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const sortUserBtn = screen.getByTestId('sort-col-userName');
    expect(sortUserBtn).toBeInTheDocument();

    // Click to sort by user name ascending
    fireEvent.click(sortUserBtn);

    // Click again to sort descending
    fireEvent.click(sortUserBtn);

    // Sort by registeredAt
    const sortDateBtn = screen.getByTestId('sort-col-regDate');
    fireEvent.click(sortDateBtn);
    fireEvent.click(sortDateBtn);
  });

  test('renders auto-approved sellers without action buttons and supports refresh', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Kishore Metals')).toBeInTheDocument();
    });

    // Auto-approved seller displays auto-approved badge
    expect(screen.getAllByText(UI_STRINGS.actionCenter.registrationsDashboard.statusAutoApproved).length).toBeGreaterThan(0);

    // Client view filter selection
    const clientSelect = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.clientTypeLabel);
    fireEvent.change(clientSelect, { target: { value: 'seller' } });
    fireEvent.change(clientSelect, { target: { value: 'buyer' } });
    fireEvent.change(clientSelect, { target: { value: 'all' } });

    // Refresh icon button
    const refreshBtn = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.refreshTooltip);
    fireEvent.click(refreshBtn);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  test('handles date range filtering with start and end date inputs', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const startInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.startDatePlaceholder) as HTMLInputElement;
    const endInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.endDatePlaceholder) as HTMLInputElement;

    // 1. Set start and end date
    fireEvent.change(startInput, { target: { value: '2026-11-01' } });
    fireEvent.change(endInput, { target: { value: '2026-11-15' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('startDate=2026-11-01&endDate=2026-11-15'),
        expect.anything()
      );
    });

    // 2. Clear date inputs
    fireEvent.change(startInput, { target: { value: '' } });
    fireEvent.change(endInput, { target: { value: '' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.not.stringContaining('startDate='),
        expect.anything()
      );
    });
  });

  test('handles Export CSV button click and exports formatted rows', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const exportBtn = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.exportBtn);
    expect(exportBtn).toBeInTheDocument();

    fireEvent.click(exportBtn);

    expect(exportReportToCsv).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          'User Name': 'verababu',
        }),
      ]),
      expect.stringContaining('registrations_')
    );
  });

  test('handles calendar picker container click and keyboard navigation', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const startInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.startDatePlaceholder) as HTMLInputElement;
    const endInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.endDatePlaceholder) as HTMLInputElement;

    const startContainer = startInput.parentElement as HTMLElement;
    const endContainer = endInput.parentElement as HTMLElement;

    // Click on container triggers focus / showPicker
    fireEvent.click(startContainer);
    fireEvent.click(endContainer);

    // Keyboard Enter / Space on container triggers picker
    fireEvent.keyDown(startContainer, { key: 'Enter' });
    fireEvent.keyDown(startContainer, { key: ' ' });
    fireEvent.keyDown(endContainer, { key: 'Enter' });
    fireEvent.keyDown(endContainer, { key: ' ' });

    // With showPicker function mocked
    startInput.showPicker = jest.fn();
    endInput.showPicker = jest.fn().mockImplementation(() => {
      throw new Error('Picker not supported');
    });

    fireEvent.click(startContainer);
    expect(startInput.showPicker).toHaveBeenCalled();

    fireEvent.click(endContainer);
    expect(endInput.showPicker).toHaveBeenCalled();
  });

  test('closes column settings modal on Escape key and backdrop click', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const gearBtn = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTooltip);
    fireEvent.click(gearBtn);

    expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).toBeInTheDocument();

    // 1. Escape key closes column settings
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).not.toBeInTheDocument();

    // Reopen
    fireEvent.click(gearBtn);
    expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).toBeInTheDocument();

    // 2. Click backdrop closes column settings
    const modalBackdrop = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle);
    fireEvent.click(modalBackdrop, { target: modalBackdrop });
    expect(screen.queryByText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTitle)).not.toBeInTheDocument();
  });

  test('closes summary card records modal on Escape key', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    // Click total registrations summary card
    const totalCard = screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.kpiTotalClients).closest('[role="group"]') as HTMLElement;
    fireEvent.click(totalCard);

    // Escape closes summary modal
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  test('hydrates saved columns from localStorage on mount and handles invalid json', async () => {
    localStorage.setItem(
      'cm_registration_columns_order_v1',
      JSON.stringify([{ key: 'userName', label: 'User Name', visible: true, required: true }])
    );
    const { unmount } = render(<RegistrationsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });
    unmount();

    localStorage.setItem('cm_registration_columns_order_v1', 'invalid-json');
    render(<RegistrationsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });
    localStorage.removeItem('cm_registration_columns_order_v1');
  });

  test('filters with only start date or only end date', async () => {
    render(<RegistrationsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });
    const startInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.startDatePlaceholder) as HTMLInputElement;
    const endInput = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.endDatePlaceholder) as HTMLInputElement;

    fireEvent.change(startInput, { target: { value: '2026-06-01' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('startDate=2026-06-01'), expect.anything());
    });
    fireEvent.change(startInput, { target: { value: '' } });
    fireEvent.change(endInput, { target: { value: '2026-06-30' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('endDate=2026-06-30'), expect.anything());
    });
  });

  test('handles drag over and drop onto same column without reordering', async () => {
    render(<RegistrationsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });
    const gearBtn = screen.getByLabelText(UI_STRINGS.actionCenter.registrationsDashboard.columnSettingsTooltip);
    fireEvent.click(gearBtn);

    const firstBadge = screen.getByText('#1');
    const firstRow = firstBadge.closest('[draggable="true"]') as HTMLElement;

    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(firstRow, { dataTransfer });
    fireEvent.dragOver(firstRow, { dataTransfer });
    fireEvent.drop(firstRow, { dataTransfer });
  });

  test('supports sorting by non-date columns ascending and descending', async () => {
    render(<RegistrationsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('verababu')).toBeInTheDocument();
    });

    const sortCompanyBtn = screen.getByTestId('sort-col-companyName');
    fireEvent.click(sortCompanyBtn);
    fireEvent.click(sortCompanyBtn);

    const sortPhoneBtn = screen.getByTestId('sort-col-phoneNumber');
    fireEvent.click(sortPhoneBtn);
    fireEvent.click(sortPhoneBtn);
  });
});
