import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NotificationBell, { relativeTime } from '@/app/components/NotificationBell';
import * as storeModule from '@/lib/store';
import * as client from '@/lib/notificationClient';
import type { AppNotification } from '@/lib/types';

jest.mock('@/lib/store');
jest.mock('@/lib/notificationClient');

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const mockFetch = client.fetchNotifications as jest.Mock;
const mockMarkRead = client.markNotificationRead as jest.Mock;
const mockMarkAll = client.markAllNotificationsRead as jest.Mock;

function ntf(overrides: Partial<AppNotification> & { id: string }): AppNotification {
  return {
    recipientType: 'vendor',
    recipientId: 'v-1',
    kind: 'rfq_category_match',
    rfqId: 'rfq-1',
    rfqNumber: 'RFQ-2026-00500',
    title: 'New RFQ in Cables',
    message: 'Alpha Buyer raised RFQ-2026-00500.',
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  (storeModule.useApp as jest.Mock).mockReturnValue({
    currentRole: 'vendor',
    isLoggedIn: true,
    aiFeed: [],
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore();
  mockFetch.mockResolvedValue({ success: true, notifications: [], unreadCount: 0 });
  mockMarkRead.mockResolvedValue(true);
  mockMarkAll.mockResolvedValue(true);
});

describe('NotificationBell — recipient inbox', () => {
  it('fetches on mount and shows the unread badge count', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      notifications: [ntf({ id: 'n1' }), ntf({ id: 'n2', read: true })],
      unreadCount: 1,
    });

    render(<NotificationBell />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('caps the badge at 9+', async () => {
    mockFetch.mockResolvedValue({ success: true, notifications: [], unreadCount: 25 });
    render(<NotificationBell />);
    expect(await screen.findByText('9+')).toBeInTheDocument();
  });

  it('opens the dropdown and lists notifications, newest state reflected', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      notifications: [ntf({ id: 'n1', title: 'Pump RFQ' })],
      unreadCount: 1,
    });
    render(<NotificationBell />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /unread notification/i }));

    expect(await screen.findByText('Pump RFQ')).toBeInTheDocument();
    // Opening re-fetches.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state when there are no notifications', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
  });

  it('marks one notification read and navigates on click (vendor → opportunity feed)', async () => {
    mockFetch.mockResolvedValue({ success: true, notifications: [ntf({ id: 'n1' })], unreadCount: 1 });
    render(<NotificationBell />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /unread notification/i }));
    fireEvent.click(await screen.findByText('New RFQ in Cables'));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('n1'));
    expect(push).toHaveBeenCalledWith('/vendor/opportunity-feed');
  });

  it('navigates a buyer quote notification to the RFQ detail page', async () => {
    mockStore({ currentRole: 'buyer', isLoggedIn: true, aiFeed: [] });
    mockFetch.mockResolvedValue({
      success: true,
      notifications: [
        ntf({ id: 'n1', kind: 'quote_received', recipientType: 'buyer', title: 'New quote on RFQ-2026-00500', read: true }),
      ],
      unreadCount: 0,
    });
    render(<NotificationBell />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByText('New quote on RFQ-2026-00500'));

    expect(push).toHaveBeenCalledWith('/buyer/rfq-details?rfq=RFQ-2026-00500');
    // Already read → no mark-read call.
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('marks all read from the dropdown header', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      notifications: [ntf({ id: 'n1' }), ntf({ id: 'n2' })],
      unreadCount: 2,
    });
    render(<NotificationBell />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /unread notification/i }));
    fireEvent.click(await screen.findByText('Mark all read'));

    await waitFor(() => expect(mockMarkAll).toHaveBeenCalled());
    // Badge clears optimistically.
    await waitFor(() => expect(screen.queryByText('2')).not.toBeInTheDocument());
  });

  it('stays open when a click lands inside the dropdown', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    const heading = await screen.findByText('Notifications');

    fireEvent.mouseDown(heading);

    expect(screen.getByText('You have no notifications yet.')).toBeInTheDocument();
  });

  it('navigates without a mark-read call for an already-read notification', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      notifications: [ntf({ id: 'n1', read: true, title: 'Already read RFQ' })],
      unreadCount: 0,
    });
    render(<NotificationBell />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByText('Already read RFQ'));

    expect(mockMarkRead).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/vendor/opportunity-feed');
  });

  it('closes on an outside click', async () => {
    render(
      <div>
        <NotificationBell />
        <button type="button">outside</button>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('outside'));
    await waitFor(() =>
      expect(screen.queryByText('You have no notifications yet.')).not.toBeInTheDocument()
    );
  });

  it('polls on an interval while mounted', async () => {
    jest.useFakeTimers();
    try {
      render(<NotificationBell />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      act(() => {
        jest.advanceTimersByTime(46_000);
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    } finally {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
  });

  it('keeps its last state when a refresh fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ success: true, notifications: [ntf({ id: 'n1' })], unreadCount: 1 })
      .mockResolvedValueOnce({ success: false, notifications: [], unreadCount: 0, error: 'boom' });
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /unread notification/i })); // triggers a 2nd fetch that fails
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // Badge still shows the last good value.
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('relativeTime', () => {
  const NOW = Date.now();
  it.each([
    ['NaN for an unparseable date', 'not-a-date', ''],
    ['just now under a minute', new Date(NOW - 15_000).toISOString(), 'just now'],
    ['minutes', new Date(NOW - 5 * 60_000).toISOString(), '5m ago'],
    ['hours', new Date(NOW - 3 * 3_600_000).toISOString(), '3h ago'],
    ['days', new Date(NOW - 2 * 86_400_000).toISOString(), '2d ago'],
  ])('renders %s', (_label, iso, expected) => {
    expect(relativeTime(iso)).toBe(expected);
  });
});

describe('NotificationBell — routing edge cases', () => {
  it('closes without navigating when a notification has no usable target', async () => {
    mockStore({ currentRole: 'buyer', isLoggedIn: true, aiFeed: [] });
    mockFetch.mockResolvedValue({
      success: true,
      notifications: [ntf({ id: 'n1', kind: 'quote_received', recipientType: 'buyer', rfqNumber: null, title: 'Orphan quote' })],
      unreadCount: 1,
    });
    render(<NotificationBell />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /unread notification/i }));
    fireEvent.click(await screen.findByText('Orphan quote'));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('n1'));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('NotificationBell — non-inbox roles', () => {
  it('shows the AI chaser feed for a category manager and never calls the notifications API', async () => {
    mockStore({
      currentRole: 'category_manager',
      isLoggedIn: true,
      aiFeed: [
        { id: 'a1', title: 'WhatsApp Chaser', message: 'Sent', timestamp: '10:00', type: 'whatsapp' },
        { id: 'a2', title: 'Call Chaser', message: 'Connected', timestamp: '10:01', type: 'call' },
        { id: 'a3', title: 'SMS Chaser', message: 'Delivered', timestamp: '10:02', type: 'sms' },
        { id: 'a4', title: 'System Event', message: 'Scored', timestamp: '10:03', type: 'scoring' },
      ],
    });
    render(<NotificationBell />);

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('Vendor Follow Up Status')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp Chaser')).toBeInTheDocument();
    expect(screen.getByText('📞 Call')).toBeInTheDocument();
    expect(screen.getByText('📱 SMS')).toBeInTheDocument();
    expect(screen.getByText('System Event')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('renders nothing to fetch when signed out', () => {
    mockStore({ currentRole: 'vendor', isLoggedIn: false, aiFeed: [] });
    render(<NotificationBell />);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
