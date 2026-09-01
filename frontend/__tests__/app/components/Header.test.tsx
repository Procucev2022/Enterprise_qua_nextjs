import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '@/app/components/Header';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/lib/authClient', () => ({
  authClient: { logout: jest.fn().mockResolvedValue(undefined) },
}));

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
      activeBuyerAccount: { organizationName: 'Tata Motors' },
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

  it('renders logged in header with buyer sourcing mode and handles mode switch to mode 1, 2, 3', () => {
    render(<Header />);

    const modeBtn = screen.getByTitle('Switch Sourcing Mode');
    expect(modeBtn).toBeInTheDocument();
    fireEvent.click(modeBtn);

    const mode2Options = screen.getAllByText(/Version 2: Hybrid Sourcing Plan/);
    fireEvent.click(mode2Options[mode2Options.length - 1]);
    expect(mockSetCurrentMode).toHaveBeenCalledWith('mode_2');

    // Switch to mode 3
    fireEvent.click(modeBtn);
    const mode3Options = screen.getAllByText(/Version 3: AI Autonomous Sourcing Plan/);
    fireEvent.click(mode3Options[mode3Options.length - 1]);
    expect(mockSetCurrentMode).toHaveBeenCalledWith('mode_3');

    // Reopen dropdown and switch to mode 1
    fireEvent.click(modeBtn);
    const mode1Options = screen.getAllByText(/Version 1: Client Roster Sourcing Plan/);
    fireEvent.click(mode1Options[mode1Options.length - 1]);
    expect(mockSetCurrentMode).toHaveBeenCalledWith('mode_1');
  });

  it('renders vendor model for vendor role with premium, connect, and select subscription states', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      setCurrentRole: mockSetCurrentRole,
      isLoggedIn: true,
      setIsLoggedIn: mockSetIsLoggedIn,
      currentMode: 'mode_1',
      setCurrentMode: mockSetCurrentMode,
      vendorSubscription: 'premium',
      setVendorSubscription: mockSetVendorSubscription,
      vendorRfqDownloadsUsed: 2,
      aiFeed: [],
      theme: 'dark',
      toggleTheme: mockToggleTheme,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      activeBuyerAccount: null,
    });

    const { rerender } = render(<Header />);

    const vendorModelBtn = screen.getByTitle('Vendor Subscription Access Model');
    expect(vendorModelBtn).toBeInTheDocument();
    fireEvent.click(vendorModelBtn);

    // Switch to premium
    const premiumOptions = screen.getAllByText(/Premium Model \(Client Uploaded\)/);
    fireEvent.click(premiumOptions[premiumOptions.length - 1]);
    expect(mockSetVendorSubscription).toHaveBeenCalledWith('premium');

    // Switch to select state
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      setCurrentRole: mockSetCurrentRole,
      isLoggedIn: true,
      setIsLoggedIn: mockSetIsLoggedIn,
      currentMode: 'mode_1',
      setCurrentMode: mockSetCurrentMode,
      vendorSubscription: 'select',
      setVendorSubscription: mockSetVendorSubscription,
      vendorRfqDownloadsUsed: 8,
      aiFeed: [],
      theme: 'light',
      toggleTheme: mockToggleTheme,
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      activeBuyerAccount: null,
    });
    rerender(<Header />);

    fireEvent.click(vendorModelBtn);
    const selectOptions = screen.getAllByText(/Select Model \(\$349 \/ 3 Months\)/);
    fireEvent.click(selectOptions[selectOptions.length - 1]);
    expect(mockSetVendorSubscription).toHaveBeenCalledWith('select');

    // Switch to connect
    fireEvent.click(vendorModelBtn);
    const connectOptions = screen.getAllByText(/Connect Model \(\$149 \/ 3 Months\)/);
    fireEvent.click(connectOptions[connectOptions.length - 1]);
    expect(mockSetVendorSubscription).toHaveBeenCalledWith('connect');
  });

  it('opens and closes notifications dropdown', () => {
    render(<Header />);

    const bellBtn = screen.getByTitle('Real-time AI Chaser Alerts');
    fireEvent.click(bellBtn);

    expect(screen.getByText('Vendor Follow Up Status')).toBeInTheDocument();
    expect(screen.getByText('Auto Chaser Alert')).toBeInTheDocument();
    expect(screen.getByText('Voice SIP Call')).toBeInTheDocument();
    expect(screen.getByText('SMS Notice')).toBeInTheDocument();
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

  it('opens account modal and handles display name & password updates and top and bottom close buttons', () => {
    render(<Header />);

    const profileBtn = screen.getByTitle('Signed-in account details');
    fireEvent.click(profileBtn);

    const accountBtn = screen.getByText(/Account & Security/);
    fireEvent.click(accountBtn);

    expect(screen.getByText('Account & Security Settings')).toBeInTheDocument();

    // Display Name Update validation and success
    const nameInput = screen.getByPlaceholderText('Enter your full display name...');
    const saveNameBtn = screen.getByText('Save Name');

    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(saveNameBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', 'Display Name cannot be empty.', 'warning');

    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.click(saveNameBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Profile Updated', 'Account display name set to: New Name', 'success');

    // Password Update validation
    const updatePwdBtn = screen.getByText('Update Password');
    fireEvent.click(updatePwdBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', 'Please enter your current password.', 'warning');

    const currPwdInput = screen.getByPlaceholderText('Enter your current password');
    const newPwdInput = screen.getByPlaceholderText('Min 8 characters');
    const confirmPwdInput = screen.getByPlaceholderText('Re-enter new password');

    fireEvent.change(currPwdInput, { target: { value: 'old123' } });
    fireEvent.change(newPwdInput, { target: { value: 'short' } });
    fireEvent.click(updatePwdBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Weak Password', expect.any(String), 'warning');

    fireEvent.change(newPwdInput, { target: { value: 'password123' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'password456' } });
    fireEvent.click(updatePwdBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Password Mismatch', expect.any(String), 'warning');

    fireEvent.change(confirmPwdInput, { target: { value: 'password123' } });
    fireEvent.click(updatePwdBtn);
    expect(mockShowToast).toHaveBeenCalledWith('Password Changed Successfully', expect.any(String), 'success');

    // Close Settings with top X button
    const closeXBtn = screen.getByText('✕');
    fireEvent.click(closeXBtn);
    expect(screen.queryByText('Account & Security Settings')).not.toBeInTheDocument();

    // Reopen and test bottom Close Settings button
    fireEvent.click(profileBtn);
    fireEvent.click(screen.getByText(/Account & Security/));
    const closeBottomBtn = screen.getByText('Close Settings');
    fireEvent.click(closeBottomBtn);
    expect(screen.queryByText('Account & Security Settings')).not.toBeInTheDocument();
  });
});
