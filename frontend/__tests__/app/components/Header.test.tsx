import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Header, { formatSessionCountdown } from '@/app/components/Header';
import * as storeModule from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/store');

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

jest.mock('@/lib/authClient', () => ({
  // getToken is reached through NotificationBell/notificationClient (exercised in
  // NotificationBell.test.tsx; here it only needs a quiet transport so Header
  // renders). changePassword is reached through the Account & Security panel the
  // header renders in its overlay — no test here submits that form, but the
  // module has to expose it so the panel can import it.
  authClient: {
    logout: jest.fn().mockResolvedValue(undefined),
    getToken: jest.fn().mockReturnValue(null),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('@/lib/notificationClient', () => ({
  fetchNotifications: jest.fn().mockResolvedValue({ success: true, notifications: [], unreadCount: 0 }),
  markNotificationRead: jest.fn().mockResolvedValue(true),
  markAllNotificationsRead: jest.fn().mockResolvedValue(true),
}));

const mockToggleThemeSignedOut = jest.fn();

describe('Header', () => {
  const mockSetCurrentRole = jest.fn();
  const mockSetIsLoggedIn = jest.fn();
  const mockSetCurrentMode = jest.fn();
  const mockSetVendorSubscription = jest.fn();
  const mockToggleTheme = jest.fn();
  const mockShowToast = jest.fn();
  const mockAddAuditLog = jest.fn();
  const mockSetCurrentUserSession = jest.fn();

  beforeEach(() => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      setCurrentRole: mockSetCurrentRole,
      isLoggedIn: true,
      setIsLoggedIn: mockSetIsLoggedIn,
      currentMode: 'mode_1',
      setCurrentMode: mockSetCurrentMode,
      vendorSubscription: 'connect',
      setVendorSubscription: mockSetVendorSubscription,
      vendorRfqDownloadsUsed: 5,
      aiFeed: [
        { id: '1', title: 'Auto Chaser Alert', message: 'Sent WhatsApp', timestamp: '10:00', type: 'whatsapp' },
        { id: '2', title: 'Voice SIP Call', message: 'Connected', timestamp: '10:05', type: 'call' },
        { id: '3', title: 'SMS Notice', message: 'Delivered', timestamp: '10:10', type: 'sms' },
        { id: '4', title: 'System Feed', message: 'Ingestion done', timestamp: '10:15', type: 'scoring' },
      ],
      theme: 'light',
      toggleTheme: mockToggleTheme,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      // version_3 here so the default fixture used by mode-switching-mechanics
      // tests below isn't itself restricted by the entitlement gate — that
      // gate has its own dedicated test with an explicit free_trial fixture.
      activeBuyerAccount: { organizationName: 'Tata Motors', subscriptionPlan: 'version_3' },
      activeSubscription: undefined,
      currentUserSession: {
        id: 'usr-1',
        email: 'navinchaudhary.dev@gmail.com',
        name: 'Navin Chaudhary',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'Navin Chaudhary Enterprises',
        authMethod: 'PASSWORD',
      },
      setCurrentUserSession: mockSetCurrentUserSession,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders logged out state when isLoggedIn is false and handles theme toggling in light/dark', () => {
    const { unmount } = render(<Header />);
    expect(screen.getByText('QUA AI 2.0')).toBeInTheDocument();
    unmount();

    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: false,
      theme: 'dark',
      toggleTheme: mockToggleTheme,
    });

    render(<Header />);
    expect(screen.getByText('QUA AI 2.0')).toBeInTheDocument();
    expect(screen.getByText('Need Support?')).toBeInTheDocument();

    const themeBtn = screen.getByTitle('Switch to Light Mode');
    fireEvent.click(themeBtn);
    expect(mockToggleTheme).toHaveBeenCalled();
  });

  // The buyer/CM "Sourcing Mode" and vendor "Access Tier" header
  // quick-switchers were removed entirely (not gated, removed) — sourcing
  // mode is now only ever chosen per-RFQ in the creation modal, and vendor
  // tier changes only ever happen through the real, payment-gated
  // vendor-subscription screen. This test asserts the pill/dropdown is gone
  // for both roles rather than testing switch behavior that no longer exists.
  it('renders no sourcing-mode or vendor-tier quick-switcher for either role', () => {
    const { rerender } = render(<Header />);
    expect(screen.queryByTitle('Switch Sourcing Mode')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Vendor Subscription Access Model')).not.toBeInTheDocument();

    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      setCurrentRole: mockSetCurrentRole,
      isLoggedIn: true,
      setIsLoggedIn: mockSetIsLoggedIn,
      aiFeed: [],
      theme: 'dark',
      toggleTheme: mockToggleTheme,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      activeBuyerAccount: null,
    });
    rerender(<Header />);
    expect(screen.queryByTitle('Switch Sourcing Mode')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Vendor Subscription Access Model')).not.toBeInTheDocument();
  });

  it('renders sourcing credit card for buyer on free trial showing Total, Used, and Remaining', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...(storeModule.useApp as jest.Mock)(),
      currentRole: 'buyer',
      activeSubscription: 'free_trial',
      remainingFreeRFQs: 5,
    });
    render(<Header />);
    expect(screen.getByText('Sourcing Credits:')).toBeInTheDocument();
    expect(screen.getByText('Total: 5')).toBeInTheDocument();
    expect(screen.getByText('Used: 0')).toBeInTheDocument();
    expect(screen.getByText('Remaining: 5')).toBeInTheDocument();
  });

  it('renders active plan badge when buyer is subscribed to a paid plan', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...(storeModule.useApp as jest.Mock)(),
      currentRole: 'buyer',
      activeSubscription: 'version_1',
      remainingFreeRFQs: 0,
    });
    render(<Header />);
    expect(screen.queryByText('Sourcing Credits:')).not.toBeInTheDocument();
    expect(screen.getByText('Active Plan:')).toBeInTheDocument();
    expect(screen.getByText('Mode 1')).toBeInTheDocument();
  });

  it('renders the notification bell, opening the buyer notification inbox', async () => {
    render(<Header />);

    const bellBtn = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(bellBtn);

    // A buyer sees their real notification inbox (empty in this mock), not the
    // AI chaser feed.
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
  });

  it('shows only the signed-in account details, with no demo persona switcher', () => {
    render(<Header />);

    fireEvent.click(screen.getByTitle('Signed-in account details'));

    // Real values from the verified session record
    expect(screen.getAllByText('Navin Chaudhary').length).toBeGreaterThan(0);
    expect(screen.getByText('navinchaudhary.dev@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('Password verified')).toBeInTheDocument();
    // Initials are derived from the real name
    expect(screen.getAllByText('NC').length).toBeGreaterThan(0);

    // The hardcoded demo identities and the switcher are gone
    expect(screen.queryByText('Switch Active User / Demo Persona')).not.toBeInTheDocument();
    expect(screen.queryByText('Rajesh Sharma')).not.toBeInTheDocument();
    expect(screen.queryByText('Priya Sen')).not.toBeInTheDocument();
    expect(screen.queryByText('Arun Mehta')).not.toBeInTheDocument();
    expect(screen.queryByText('Rajesh Nair')).not.toBeInTheDocument();
  });

  it('shows the organisation from the session, not an unrelated directory account', () => {
    // activeBuyerAccount here is a different company (Tata Motors) that does not
    // belong to the signed-in user, so it must never be labelled as their org.
    render(<Header />);

    fireEvent.click(screen.getByTitle('Signed-in account details'));

    expect(screen.getAllByText('Navin Chaudhary Enterprises').length).toBeGreaterThan(0);
    expect(screen.queryByText('Tata Motors')).not.toBeInTheDocument();
  });

  it('uses the aligned buyer account only when its email matches the session', () => {
    const base = (storeModule.useApp as jest.Mock)();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      currentUserSession: { ...base.currentUserSession, orgName: '' },
      activeBuyerAccount: {
        organizationName: 'Navin Chaudhary Enterprises',
        corporateEmail: 'navinchaudhary.dev@gmail.com',
      },
    });

    render(<Header />);
    fireEvent.click(screen.getByTitle('Signed-in account details'));

    expect(screen.getAllByText('Navin Chaudhary Enterprises').length).toBeGreaterThan(0);
  });

  it('shows no organisation when neither the session nor a matching account has one', () => {
    const base = (storeModule.useApp as jest.Mock)();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      currentUserSession: { ...base.currentUserSession, orgName: '' },
      activeBuyerAccount: {
        organizationName: 'Tata Motors',
        corporateEmail: 'someone.else@tatamotors.com',
      },
    });

    render(<Header />);
    fireEvent.click(screen.getByTitle('Signed-in account details'));

    expect(screen.queryByText('Tata Motors')).not.toBeInTheDocument();
  });

  it('clears the session and returns to the sign-in route on logout', () => {
    render(<Header />);

    fireEvent.click(screen.getByTitle('Signed-in account details'));
    fireEvent.click(screen.getByText('Logout'));

    expect(mockSetIsLoggedIn).toHaveBeenCalledWith(false);
    expect(mockSetCurrentUserSession).toHaveBeenCalledWith(null);
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  // Buyers reach these forms as Section 4 of /buyer/profile, so offering the
  // overlay as well would give the same settings two homes.
  it('omits the account overlay for buyers, who manage it on their profile page', () => {
    render(<Header />);

    fireEvent.click(screen.getByTitle('Signed-in account details'));

    expect(screen.queryByText(UI_STRINGS.accountSecurity.menuLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(UI_STRINGS.accountSecurity.panelTitle)).not.toBeInTheDocument();
  });

  // Vendor, category manager and admin have no profile screen of their own, so
  // the overlay stays reachable for them.
  it('opens the account overlay for roles without a profile page and closes it from both controls', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...(storeModule.useApp as jest.Mock)(),
      currentRole: 'vendor',
    });

    render(<Header />);

    const profileBtn = screen.getByTitle('Signed-in account details');
    fireEvent.click(profileBtn);
    fireEvent.click(screen.getByText(UI_STRINGS.accountSecurity.menuLabel));

    // The overlay supplies the chrome; the forms come from AccountSecurityPanel,
    // which is covered by its own suite.
    expect(screen.getByText(UI_STRINGS.accountSecurity.panelTitle)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(UI_STRINGS.accountSecurity.newPasswordPlaceholder)
    ).toBeInTheDocument();

    // Close from the header ✕.
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByText(UI_STRINGS.accountSecurity.panelTitle)).not.toBeInTheDocument();

    // Reopen and close from the footer button.
    fireEvent.click(profileBtn);
    fireEvent.click(screen.getByText(UI_STRINGS.accountSecurity.menuLabel));
    fireEvent.click(screen.getByText(UI_STRINGS.accountSecurity.closeAction));
    expect(screen.queryByText(UI_STRINGS.accountSecurity.panelTitle)).not.toBeInTheDocument();
  });
});

// ==============================================================================
// SESSION IDENTITY IN THE HEADER
// ==============================================================================
// Everything the header shows about the signed-in account comes from the session
// claims, so the cases with a partial session matter: an account with no display
// name has to fall back to the login email rather than showing a blank chip, and
// signing out has to work whether or not an email was recorded.
// ==============================================================================

describe('Header session identity', () => {
  const baseStore = () => ({
    currentRole: 'buyer',
    setCurrentRole: jest.fn(),
    isLoggedIn: true,
    setIsLoggedIn: jest.fn(),
    currentMode: 'mode_1',
    setCurrentMode: jest.fn(),
    vendorSubscription: 'connect',
    setVendorSubscription: jest.fn(),
    vendorRfqDownloadsUsed: 5,
    aiFeed: [],
    theme: 'light',
    toggleTheme: jest.fn(),
    showToast: jest.fn(),
    addAuditLog: jest.fn(),
    activeBuyerAccount: null,
    currentUserSession: null,
    setCurrentUserSession: jest.fn(),
  });

  const mountWith = (overrides: Record<string, unknown>) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({ ...baseStore(), ...overrides });
    return render(<Header />);
  };

  const openProfile = () => fireEvent.click(screen.getByTitle('Signed-in account details'));

  afterEach(() => {
    jest.clearAllMocks();
  });

  // A one-word account name has no surname to take a second initial from.
  it('derives two initials from a single-word account name', () => {
    mountWith({
      currentUserSession: {
        id: 'u1',
        email: 'navin@procucev.com',
        name: 'Navin',
        role: 'buyer',
        orgId: 'o1',
        orgName: 'Procucev',
      },
    });

    expect(screen.getAllByText('NA').length).toBeGreaterThan(0);
  });

  it('falls back to the login email when the account has no display name', () => {
    mountWith({
      currentUserSession: {
        id: 'u1',
        email: 'buyer@procucev.com',
        name: '',
        role: 'buyer',
        orgId: 'o1',
        orgName: 'Procucev',
      },
    });
    openProfile();
    // Shown on the trigger and again on the persona card inside the popover.
    // The same fallback is asserted for the Account & Security form in that
    // component's own suite.
    expect(screen.getAllByText('buyer@procucev.com').length).toBeGreaterThan(1);
  });

  it('names the one-time-code method the session was verified with', () => {
    mountWith({
      currentUserSession: {
        id: 'u1',
        email: 'buyer@procucev.com',
        name: 'Procucev Buyer',
        role: 'buyer',
        orgId: 'o1',
        orgName: 'Procucev',
        authMethod: 'EMAIL_OTP',
      },
    });
    openProfile();

    expect(screen.getByText('Email OTP verified')).toBeInTheDocument();
  });

  // The session can be gone by the time the buyer presses Logout, and the
  // audit entry and the API call both have to cope with that.
  it('signs out even when no session email was recorded', () => {
    const setIsLoggedIn = jest.fn();
    const addAuditLog = jest.fn();
    mountWith({ currentUserSession: null, setIsLoggedIn, addAuditLog });
    openProfile();

    fireEvent.click(screen.getByText(/Logout/i));

    expect(addAuditLog).toHaveBeenCalledWith('User logged out of session', undefined, undefined);
    expect(setIsLoggedIn).toHaveBeenCalledWith(false);
    expect(mockReplace).toHaveBeenCalled();
  });

  // The local session is already cleared by then, so a failed server-side logout
  // must not surface as an unhandled rejection.
  it('completes the sign-out when the logout call is rejected', async () => {
    const { authClient } = jest.requireMock('@/lib/authClient');
    authClient.logout.mockRejectedValueOnce(new Error('offline'));
    const setIsLoggedIn = jest.fn();
    mountWith({ setIsLoggedIn });
    openProfile();

    fireEvent.click(screen.getByText(/Logout/i));

    expect(setIsLoggedIn).toHaveBeenCalledWith(false);
    await Promise.resolve();
  });
});

describe('Header theme control while signed out', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('offers dark mode and labels the current one as light', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: false,
      theme: 'light',
      toggleTheme: mockToggleThemeSignedOut,
    });

    render(<Header />);

    expect(screen.getByTitle('Switch to Dark Mode')).toBeInTheDocument();
    expect(screen.getByText('Light')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Switch to Dark Mode'));
    expect(mockToggleThemeSignedOut).toHaveBeenCalled();
  });
});

describe('Header Session Timer and Auto Logout', () => {
  const mockSetIsLoggedIn = jest.fn();
  const mockSetCurrentUserSession = jest.fn();
  const mockSetCurrentRole = jest.fn();
  const mockShowToast = jest.fn();
  const mockAddAuditLog = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'buyer',
      setIsLoggedIn: mockSetIsLoggedIn,
      setCurrentRole: mockSetCurrentRole,
      setCurrentUserSession: mockSetCurrentUserSession,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      currentUserSession: { email: 'buyer@procucev.com', name: 'Buyer User' },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('renders session timer badge for buyer dashboard', () => {
    render(<Header />);
    const timer = screen.getByTestId('header-session-timer');
    expect(timer).toBeInTheDocument();
    expect(timer).toHaveTextContent(/Session:/i);
  });

  it('renders session timer badge for vendor dashboard', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'vendor',
      setIsLoggedIn: mockSetIsLoggedIn,
      setCurrentRole: mockSetCurrentRole,
      setCurrentUserSession: mockSetCurrentUserSession,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      vendorFreeCreditsRemaining: 3,
    });
    render(<Header />);
    expect(screen.getByTestId('header-session-timer')).toBeInTheDocument();
  });

  it('renders session timer badge and extends session by 3 hours for category manager dashboard', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'category_manager',
      setIsLoggedIn: mockSetIsLoggedIn,
      setCurrentRole: mockSetCurrentRole,
      setCurrentUserSession: mockSetCurrentUserSession,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
    });
    render(<Header />);
    const timer = screen.getByTestId('header-session-timer');
    expect(timer).toBeInTheDocument();
    fireEvent.click(timer);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Session Extended',
      expect.stringContaining('3 hours'),
      'info'
    );
  });

  it('allows user to click session timer to extend session by 30 minutes', () => {
    render(<Header />);
    const timer = screen.getByTestId('header-session-timer');
    fireEvent.click(timer);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Session Extended',
      expect.stringContaining('30 minutes'),
      'info'
    );
  });

  it('triggers auto logout when session timer expires', () => {
    jest.useFakeTimers();
    // Set localStorage expiration to 1 second in the future
    localStorage.setItem('procucev_session_expires_at', String(Date.now() + 1000));
    render(<Header />);

    // Fast-forward time past expiration
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockSetIsLoggedIn).toHaveBeenCalledWith(false);
    expect(mockSetCurrentUserSession).toHaveBeenCalledWith(null);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Session Expired',
      expect.stringContaining('logged out automatically'),
      'warning'
    );
    jest.useRealTimers();
  });

  it('covers active plan versions, vendor zero credits, and modal backdrop click', () => {
    // 1. formatSessionCountdown helper directly
    expect(formatSessionCountdown(3665)).toBe('01:01:05');
    expect(formatSessionCountdown(0)).toBe('00:00');

    // 2. version_1, version_2, version_3, and unlimited active plan
    const base = (storeModule.useApp as jest.Mock)();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'buyer',
      activeSubscription: 'version_1',
    });
    const { rerender } = render(<Header />);
    expect(screen.getByText('Mode 1')).toBeInTheDocument();

    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'buyer',
      activeSubscription: 'version_2',
    });
    rerender(<Header />);
    expect(screen.getByText('Mode 2')).toBeInTheDocument();

    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'buyer',
      activeSubscription: 'version_3',
    });
    rerender(<Header />);
    expect(screen.getByText('Mode 3')).toBeInTheDocument();

    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'buyer',
      activeSubscription: 'unlimited',
    });
    rerender(<Header />);
    expect(screen.getByText('unlimited')).toBeInTheDocument();

    // 3. Vendor with 0 credits and undefined credits
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'vendor',
      vendorFreeCreditsRemaining: 0,
    });
    rerender(<Header />);
    expect(screen.getByText('0')).toBeInTheDocument();

    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'vendor',
      vendorFreeCreditsRemaining: undefined,
    });
    rerender(<Header />);
    expect(screen.getByText('5')).toBeInTheDocument();

    // 4. Admin role opening account modal and closing via backdrop click
    (storeModule.useApp as jest.Mock).mockReturnValue({
      ...base,
      isLoggedIn: true,
      currentRole: 'admin',
    });
    rerender(<Header />);
    fireEvent.click(screen.getByTitle('Signed-in account details'));
    fireEvent.click(screen.getByText(UI_STRINGS.accountSecurity.menuLabel));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Click inside modal content should not close it
    fireEvent.click(screen.getByText(UI_STRINGS.accountSecurity.panelTitle));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click backdrop closes it
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('covers session timer keydown events and warning color intervals', () => {
    jest.useFakeTimers();
    // 2 minutes left (amber)
    localStorage.setItem('procucev_session_expires_at', String(Date.now() + 120_000));
    const { rerender } = render(<Header />);
    let timer = screen.getByTestId('header-session-timer');
    expect(timer.className).toContain('text-amber');

    // 30 seconds left (rose)
    localStorage.setItem('procucev_session_expires_at', String(Date.now() + 30_000));
    rerender(<Header />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    timer = screen.getByTestId('header-session-timer');
    expect(timer.className).toContain('text-rose');

    // Keydown on timer (Enter, Space, other key)
    fireEvent.keyDown(timer, { key: 'Enter' });
    expect(mockShowToast).toHaveBeenCalledWith(
      'Session Extended',
      expect.stringContaining('30 minutes'),
      'info'
    );

    fireEvent.keyDown(timer, { key: ' ' });
    expect(mockShowToast).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(timer, { key: 'Tab' });
    expect(mockShowToast).toHaveBeenCalledTimes(2);

    // Auto logout where logout rejects to cover catch callback (func 13)
    (authClient.logout as jest.Mock).mockRejectedValueOnce(new Error('Logout network error'));
    localStorage.setItem('procucev_session_expires_at', String(Date.now() - 1000));
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    jest.useRealTimers();
  });
});
