import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { validatePincode } from '@/lib/validationSchemas';
import { ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { UserSession } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn(), clearSessionCache: jest.fn() }));
jest.mock('@/lib/authClient', () => ({ authClient: {
  loginWithPassword: jest.fn(), requestOtp: jest.fn(), verifyOtp: jest.fn(), register: jest.fn(),
} }));
jest.mock('@/lib/validationSchemas', () => ({
  ...jest.requireActual('@/lib/validationSchemas'), validatePincode: jest.fn(),
}));
const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }), useSearchParams: () => mockSearchParams,
}));

const SESSION: UserSession = {
  id: 'remaining-buyer', email: 'buyer@remaining.test', name: 'Buyer Name', role: 'buyer',
  orgId: 'org-remaining', orgName: 'Buyer Organization',
};
const showToast = jest.fn();
const setInitialSetupModalOpen = jest.fn();
const setCurrentUserSession = jest.fn();
const refreshFromDB = jest.fn();
let mockApp: Partial<ReturnType<typeof useApp>>;

const change = (id: string, value: string) => {
  const input = document.getElementById(id);
  if (!input) throw new Error(`Missing form field ${id}`);
  fireEvent.change(input, { target: { value } });
};
const submit = (container: HTMLElement) => {
  const form = container.querySelector('form');
  if (!form) throw new Error('Missing authentication form');
  fireEvent.submit(form);
};
const openRegister = () => {
  const tabs = screen.getAllByRole('button');
  fireEvent.click(tabs[1]);
};
const fillRegistration = () => {
  Object.entries({
    'reg-name': SESSION.name, 'reg-org': SESSION.orgName, 'reg-email': SESSION.email,
    'reg-mobile': '9876543210', 'reg-password': 'SecurePass123!', 'reg-gstin': '27AAAAA0000A1Z5',
    'reg-city': 'Pune', 'reg-state': 'Maharashtra', 'reg-pincode': '411001',
  }).forEach(([id, value]) => change(id, value));
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/login');
  mockSearchParams = new URLSearchParams();
  mockApp = {
    isLoggedIn: false, currentRole: 'buyer', currentUserSession: null,
    setCurrentRole: jest.fn(), setIsLoggedIn: jest.fn(), setCurrentUserSession,
    setInitialSetupModalOpen, showToast, initialSetupCompleted: false,
    setRemainingFreeRFQs: jest.fn(), setActiveSubscription: jest.fn(), addBuyerAccount: jest.fn(),
    refreshFromDB,
  };
  jest.mocked(useApp).mockImplementation(() => mockApp as ReturnType<typeof useApp>);
  jest.mocked(validatePincode).mockResolvedValue({ isValid: true, postOffices: [] });
});

afterEach(() => {
  jest.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('login redirects and session initialization', () => {
  test.each([
    ['vendor', true, false, '', '/vendor-first-login'],
    ['vendor', true, false, '/vendor/rfq-details?rfq=1', '/vendor-first-login?redirect=%2Fvendor%2Frfq-details%3Frfq%3D1'],
    ['buyer', true, false, '', '/buyer-first-login'],
    ['buyer', false, true, '/buyer/rfqs?status=open', '/buyer-first-login?redirect=%2Fbuyer%2Frfq-summary%3Fstatus%3Dopen'],
    ['buyer', false, true, '', '/buyer-first-login'],
    ['buyer', false, false, 'https://untrusted.test', ROLE_LANDING_ROUTE.buyer],
  ])('routes an active %s session through its required setup', (role, passwordChangeRequired, onboardingRequired, redirect, expected) => {
    mockApp.isLoggedIn = true;
    mockApp.currentRole = role as UserSession['role'];
    mockApp.currentUserSession = { ...SESSION, role: role as UserSession['role'], passwordChangeRequired: Boolean(passwordChangeRequired), onboardingRequired: Boolean(onboardingRequired) };
    if (redirect) mockSearchParams.set('redirect', String(redirect));
    render(<LoginPage />);
    expect(mockReplace).toHaveBeenCalledWith(expected);
  });

  test('accepts returnUrl from the browser query when hook params are empty', () => {
    window.history.replaceState(null, '', '/login?returnUrl=%2Fbuyer%2Frfqs%3Fstatus%3Dopen');
    mockApp.isLoggedIn = true;
    render(<LoginPage />);
    expect(mockReplace).toHaveBeenCalledWith('/buyer/rfq-summary?status=open');
  });

  test('falls back to the buyer route for an unrecognized account role', () => {
    mockApp.isLoggedIn = true;
    mockApp.currentRole = 'unknown' as UserSession['role'];
    render(<LoginPage />);
    expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
  });

  test.each([
    { ...SESSION, onboardingRequired: true },
    { ...SESSION, role: 'vendor' as const, passwordChangeRequired: true, orgName: '' },
    { ...SESSION, role: 'unknown' as UserSession['role'] },
  ])('establishes a returned session before navigating through setup: %p', async (user) => {
    mockSearchParams.set('redirect', '/buyer/command-center');
    jest.mocked(authClient.loginWithPassword).mockResolvedValue({ success: true, user });
    const { container } = render(<LoginPage />);
    change('login-email', 'BUYER@REMAINING.TEST');
    change('login-mobile', '9876543210');
    change('login-password', 'SecurePass123!');
    await act(async () => { submit(container); });
    expect(setCurrentUserSession).toHaveBeenCalledWith(user);
    expect(setInitialSetupModalOpen).not.toHaveBeenCalled();
    expect(refreshFromDB).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(user.role === 'vendor'
      ? '/vendor-first-login?redirect=%2Fbuyer%2Fcommand-center'
      : user.onboardingRequired ? '/buyer-first-login?redirect=%2Fbuyer%2Fcommand-center' : '/buyer/command-center');
  });

  test('uses the shared error fallback when password authentication returns no user', async () => {
    jest.mocked(authClient.loginWithPassword).mockResolvedValue({ success: true });
    const { container } = render(<LoginPage />);
    change('login-email', SESSION.email);
    change('login-mobile', '9876543210');
    change('login-password', 'SecurePass123!');
    await act(async () => { submit(container); });
    expect(showToast).toHaveBeenCalledWith(UI_STRINGS.auth.signInFailedTitle, UI_STRINGS.auth.serverErrorFallback, 'warning');
  });
});

describe('registration pincode validation', () => {
  test('clears validation for an empty or incomplete PIN and blocks a dummy PIN', async () => {
    const { container } = render(<LoginPage />);
    openRegister();
    fillRegistration();
    change('reg-pincode', '111111');
    submit(container);
    expect(authClient.requestOtp).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UI_STRINGS.auth.registrationFailedTitle, expect.any(String), 'warning');
    change('reg-pincode', '41');
    expect(document.getElementById('reg-pincode')).not.toHaveClass('border-red-400');
    change('reg-pincode', '411');
    expect(document.getElementById('reg-pincode')).not.toHaveClass('border-red-400');
    change('reg-pincode', '');
    expect(document.getElementById('reg-pincode')).not.toHaveClass('border-red-400');
  });

  test('does not dispatch verification for an incorrectly formatted PIN', () => {
    const { container } = render(<LoginPage />);
    openRegister();
    fillRegistration();
    change('reg-pincode', '41100');
    submit(container);
    expect(authClient.requestOtp).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UI_STRINGS.auth.registrationFailedTitle, expect.any(String), 'warning');
  });

  test.each([
    { isValid: true, postOffices: [{ District: 'District City', Division: 'Ignored', Name: 'Ignored', State: 'New State' }], city: 'District City', state: 'New State' },
    { isValid: true, postOffices: [{ Division: 'Division City' }], city: 'Division City', state: 'Maharashtra' },
    { isValid: true, postOffices: [{ Name: 'Office City' }], city: 'Office City', state: 'Maharashtra' },
    { isValid: true, postOffices: [{}], city: 'Pune', state: 'Maharashtra' },
    { isValid: true, city: 'Pune', state: 'Maharashtra' },
  ])('uses available post-office details without replacing known values with blanks: %p', async ({ city, state, ...result }) => {
    jest.useFakeTimers();
    jest.mocked(validatePincode).mockResolvedValue(result as Awaited<ReturnType<typeof validatePincode>>);
    render(<LoginPage />);
    openRegister();
    fillRegistration();
    await act(async () => { await jest.advanceTimersByTimeAsync(350); });
    expect(validatePincode).toHaveBeenCalledWith('411001');
    expect(document.getElementById('reg-city')).toHaveValue(city);
    expect(document.getElementById('reg-state')).toHaveValue(state);
  });

  test.each([{ isValid: false }, { isValid: false, message: 'PIN not served' }])('prevents registration when the PIN lookup rejects the code: %p', async (result) => {
    jest.useFakeTimers();
    jest.mocked(validatePincode).mockResolvedValue(result);
    const { container } = render(<LoginPage />);
    openRegister();
    fillRegistration();
    await act(async () => { await jest.advanceTimersByTimeAsync(350); });
    submit(container);
    expect(authClient.requestOtp).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UI_STRINGS.auth.registrationFailedTitle, expect.any(String), 'warning');
  });

  test('allows a later retry after an unavailable PIN lookup', async () => {
    jest.useFakeTimers();
    jest.mocked(validatePincode).mockRejectedValueOnce(new Error('Lookup unavailable'));
    render(<LoginPage />);
    openRegister();
    fillRegistration();
    await act(async () => { await jest.advanceTimersByTimeAsync(350); });
    expect(document.getElementById('reg-pincode')).not.toHaveClass('border-red-400');
    change('reg-pincode', '411002');
    await act(async () => { await jest.advanceTimersByTimeAsync(350); });
    expect(validatePincode).toHaveBeenCalledTimes(2);
  });
});

describe('registration validation and OTP retry boundaries', () => {
  test.each(['reg-name', 'reg-org', 'reg-email', 'reg-mobile', 'reg-password', 'reg-gstin', 'reg-city', 'reg-state', 'reg-pincode'])('requires the %s field before requesting verification codes', (id) => {
    const { container } = render(<LoginPage />);
    openRegister();
    fillRegistration();
    change(id, '');
    submit(container);
    expect(authClient.requestOtp).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UI_STRINGS.auth.missingFieldsTitle, expect.any(String), 'warning');
  });

  test('resends separate development codes and preserves typed codes when a resend omits them', async () => {
    jest.mocked(authClient.requestOtp)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, demoEmailCode: '111222', demoMobileCode: '333444' })
      .mockResolvedValueOnce({ success: true });
    const { container } = render(<LoginPage />);
    openRegister();
    fillRegistration();
    await act(async () => { submit(container); });
    const resendButton = screen.getByRole('button', { name: /Resend Verification Codes/ });
    await act(async () => { fireEvent.click(resendButton); });
    expect(document.getElementById('reg-email-otp')).toHaveValue('111222');
    expect(document.getElementById('reg-mobile-otp')).toHaveValue('333444');
    change('reg-email-otp', '555666');
    change('reg-mobile-otp', '777888');
    await act(async () => { fireEvent.click(resendButton); });
    expect(document.getElementById('reg-email-otp')).toHaveValue('555666');
    expect(document.getElementById('reg-mobile-otp')).toHaveValue('777888');
  });

  test('does not create a session for a successful registration response missing its user', async () => {
    jest.mocked(authClient.requestOtp).mockResolvedValue({ success: true, demoCode: '123456' });
    jest.mocked(authClient.register).mockResolvedValue({ success: true });
    const { container } = render(<LoginPage />);
    openRegister();
    fillRegistration();
    change('reg-gstin', 'SHORT');
    await act(async () => { submit(container); });
    await act(async () => { submit(container); });
    expect(authClient.register).toHaveBeenCalledWith(expect.objectContaining({ pan: '', gstin: 'SHORT' }));
    expect(setCurrentUserSession).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UI_STRINGS.auth.registrationFailedTitle, UI_STRINGS.auth.serverErrorFallback, 'warning');
  });
});
