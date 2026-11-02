import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistrationsDashboard from '@/app/category-manager/components/RegistrationsDashboard';
import { UI_STRINGS } from '@/lib/uiStrings';

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
];

describe('RegistrationsDashboard', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
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

  test('renders header with title and total count badge', async () => {
    const onCountChange = jest.fn();
    render(<RegistrationsDashboard onTotalCountChange={onCountChange} />);

    expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.title)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('4 Total')).toBeInTheDocument();
      expect(onCountChange).toHaveBeenCalledWith(4);
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
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('sourceType=WhatsApp'));
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
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('search=GOVARDHAN'));
    });
  });

  test('accepts client registration and updates status', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
    expect(screen.getByText('GOVARDHAN PVT LTD')).toBeInTheDocument();
    });

    const acceptButton = screen.getByLabelText(
      `${UI_STRINGS.actionCenter.registrationsDashboard.acceptTooltip} for Govardhan Kilari`
    );
    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/internal-tasks/registrations/reg-client-102/action'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'accept' }),
        })
      );
      expect(
        screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.acceptSuccess)
      ).toBeInTheDocument();
    });
  });

  test('rejects client registration and updates status', async () => {
    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
    expect(screen.getByText('GOVARDHAN PVT LTD')).toBeInTheDocument();
    });

    const rejectButton = screen.getByLabelText(
      `${UI_STRINGS.actionCenter.registrationsDashboard.rejectTooltip} for Govardhan Kilari`
    );
    fireEvent.click(rejectButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/internal-tasks/registrations/reg-client-102/action'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'reject' }),
        })
      );
      expect(
        screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.rejectSuccess)
      ).toBeInTheDocument();
    });

    // Dismiss feedback banner
    const closeFeedback = screen.getByText('×');
    fireEvent.click(closeFeedback);
    expect(
      screen.queryByText(UI_STRINGS.actionCenter.registrationsDashboard.rejectSuccess)
    ).not.toBeInTheDocument();
  });

  test('handles action error from API', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/action')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ success: false, error: 'Database conflict' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, total: mockClients.length, data: mockClients }),
      });
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
    expect(screen.getByText('GOVARDHAN PVT LTD')).toBeInTheDocument();
    });

    const acceptButton = screen.getByLabelText(
      `${UI_STRINGS.actionCenter.registrationsDashboard.acceptTooltip} for Govardhan Kilari`
    );
    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(screen.getByText('Database conflict')).toBeInTheDocument();
    });
  });

  test('handles network error on action', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/action')) {
        return Promise.reject(new Error('Network drop'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, total: mockClients.length, data: mockClients }),
      });
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
    expect(screen.getByText('GOVARDHAN PVT LTD')).toBeInTheDocument();
    });

    const acceptButton = screen.getByLabelText(
      `${UI_STRINGS.actionCenter.registrationsDashboard.acceptTooltip} for Govardhan Kilari`
    );
    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.registrationsDashboard.actionError)).toBeInTheDocument();
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
    fireEvent.click(nextPage);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=100'));
    });

    const prevPage = screen.getByLabelText('Previous page');
    fireEvent.click(prevPage);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=0'));
    });

    const lastPage = screen.getByLabelText('Last page');
    fireEvent.click(lastPage);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=200'));
    });

    const firstPage = screen.getByLabelText('First page');
    fireEvent.click(firstPage);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=0'));
    });

    const pageSizeSelect = screen.getByLabelText('Select page size');
    fireEvent.change(pageSizeSelect, { target: { value: '25' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('limit=25'));
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

  test('handles action failure when API returns error without message', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/action')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ success: false }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, total: mockClients.length, data: mockClients }),
      });
    });

    render(<RegistrationsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Govardhan Kilari')).toBeInTheDocument();
    });

    const acceptButton = screen.getByLabelText(
      `${UI_STRINGS.actionCenter.registrationsDashboard.acceptTooltip} for Govardhan Kilari`
    );
    fireEvent.click(acceptButton);

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
});

