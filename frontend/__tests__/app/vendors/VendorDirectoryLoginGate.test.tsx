import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VendorDirectoryLoginGate, { formatOtpTimer } from '@/app/vendors/VendorDirectoryLoginGate';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/vendorAuthClient', () => ({
  requestVendorDirectoryOtp: jest.fn(),
  verifyVendorDirectoryOtp: jest.fn(),
}));

import * as vendorAuthClient from '@/lib/vendorAuthClient';

describe('VendorDirectoryLoginGate', () => {
  const S = UI_STRINGS.vendorDirectoryLogin;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });
  });

  test('renders step 1 (email input, labels, badges, and platform login link)', () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    expect(screen.getByTestId('vendor-directory-login-gate')).toBeInTheDocument();
    expect(screen.getByText(S.title)).toBeInTheDocument();
    expect(screen.getByText(S.subtitle)).toBeInTheDocument();
    expect(screen.getByTestId('directory-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('directory-request-otp-submit')).toBeInTheDocument();
    expect(screen.getByText(S.backToMainLogin)).toBeInTheDocument();
  });

  test('displays sessionExpiredNotice when sessionExpired prop is true', () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} sessionExpired={true} />);

    expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.sessionExpiredNotice);
  });

  test('validates email input: rejects empty and non-procucev emails', async () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const emailInput = screen.getByTestId('directory-email-input');
    const form = emailInput.closest('form')!;

    // Empty email
    act(() => {
      fireEvent.submit(form);
    });
    expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.emptyEmail);

    // Non-procucev email
    act(() => {
      fireEvent.change(emailInput, { target: { value: 'user@gmail.com' } });
      fireEvent.submit(form);
    });
    expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.procucevEmailRequired);

    // Clears error on input change
    act(() => {
      fireEvent.change(emailInput, { target: { value: 'cm@procucev.com' } });
    });
    expect(screen.queryByTestId('gate-error-banner')).not.toBeInTheDocument();
  });

  test('handles failed OTP request with server error banner', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: false,
      error: S.accessDeniedNotice,
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const emailInput = screen.getByTestId('directory-email-input');
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: 'unknown@procucev.com' } });
      fireEvent.submit(emailInput.closest('form')!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.accessDeniedNotice);
    });
  });

  test('handles exception thrown by requestVendorDirectoryOtp', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockRejectedValue(new Error('Network down'));

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const emailInput = screen.getByTestId('directory-email-input');
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: 'cm@procucev.com' } });
      fireEvent.submit(emailInput.closest('form')!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.networkError);
    });
  });

  test('transitions to step 2 on successful OTP request and starts countdown', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: true,
      message: 'OTP sent',
      expiresInSeconds: 300,
      demoCode: '123456',
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} initialEmail="cm@procucev.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('directory-request-otp-submit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('directory-otp-input')).toBeInTheDocument();
    });

    expect(screen.getByText(S.otpStepTitle)).toBeInTheDocument();

    // Countdown active
    expect(screen.getByTestId('resend-otp-btn')).toBeDisabled();
    expect(screen.getByText(/Resend code in 5m 00s/i)).toBeInTheDocument();

    // Advance 1 second - shows 4m 59s
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/Resend code in 4m 59s/i)).toBeInTheDocument();

    // Advance to under 60 seconds (241 seconds -> 58 seconds left)
    act(() => {
      jest.advanceTimersByTime(241000);
    });
    expect(screen.getByText(/Resend code in 58s/i)).toBeInTheDocument();

    // Advance remaining time to complete countdown
    act(() => {
      jest.advanceTimersByTime(59000);
    });

    expect(screen.getByTestId('resend-otp-btn')).not.toBeDisabled();
    expect(screen.getByText(S.didNotReceiveOtp)).toBeInTheDocument();
  });

  test('validates OTP in step 2 and handles input formatting', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: true,
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} initialEmail="cm@procucev.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('directory-request-otp-submit'));
    });
    await waitFor(() => screen.getByTestId('directory-otp-input'));

    const otpInput = screen.getByTestId('directory-otp-input') as HTMLInputElement;

    // Non-digit strip
    act(() => {
      fireEvent.change(otpInput, { target: { value: 'abc123xy' } });
    });
    expect(otpInput.value).toBe('123');

    // Submit with short OTP
    act(() => {
      fireEvent.submit(otpInput.closest('form')!);
    });
    expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.invalidOtp);

    // Empty OTP validation
    act(() => {
      fireEvent.change(otpInput, { target: { value: '' } });
      fireEvent.submit(otpInput.closest('form')!);
    });
    expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.emptyOtp);
  });

  test('allows changing email from step 2 back to step 1', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: true,
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} initialEmail="cm@procucev.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('directory-request-otp-submit'));
    });
    await waitFor(() => screen.getByTestId('directory-otp-input'));

    act(() => {
      fireEvent.click(screen.getByText(S.changeEmail));
    });

    expect(screen.getByTestId('directory-email-input')).toBeInTheDocument();
    expect(screen.queryByTestId('directory-otp-input')).not.toBeInTheDocument();
  });

  test('handles resend OTP action when countdown finishes', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: true,
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} initialEmail="cm@procucev.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('directory-request-otp-submit'));
    });
    await waitFor(() => screen.getByTestId('directory-otp-input'));

    act(() => {
      jest.advanceTimersByTime(301000);
    });

    const resendBtn = screen.getByTestId('resend-otp-btn');
    expect(resendBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(vendorAuthClient.requestVendorDirectoryOtp).toHaveBeenCalledTimes(2);
  });

  describe('formatOtpTimer helper', () => {
    test('formats times >= 60 seconds into mins and secs', () => {
      expect(formatOtpTimer(300)).toBe('5m 00s');
      expect(formatOtpTimer(299)).toBe('4m 59s');
      expect(formatOtpTimer(65)).toBe('1m 05s');
      expect(formatOtpTimer(60)).toBe('1m 00s');
    });

    test('formats times < 60 seconds into plain seconds', () => {
      expect(formatOtpTimer(59)).toBe('59s');
      expect(formatOtpTimer(30)).toBe('30s');
      expect(formatOtpTimer(9)).toBe('9s');
      expect(formatOtpTimer(0)).toBe('0s');
      expect(formatOtpTimer(-10)).toBe('0s');
    });
  });

  test('handles failed OTP verification and exceptions in step 2', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({ success: true });
    (vendorAuthClient.verifyVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Invalid or expired OTP',
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} initialEmail="cm@procucev.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('directory-request-otp-submit'));
    });
    await waitFor(() => screen.getByTestId('directory-otp-input'));

    const otpInput = screen.getByTestId('directory-otp-input');
    await act(async () => {
      fireEvent.change(otpInput, { target: { value: '999999' } });
      fireEvent.submit(otpInput.closest('form')!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent('Invalid or expired OTP');
    });

    // Thrown exception
    (vendorAuthClient.verifyVendorDirectoryOtp as jest.Mock).mockRejectedValue(new Error('Network error'));
    await act(async () => {
      fireEvent.submit(otpInput.closest('form')!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.networkError);
    });
  });

  test('successfully verifies OTP and calls onAuthenticated callback', async () => {
    (vendorAuthClient.requestVendorDirectoryOtp as jest.Mock).mockResolvedValue({ success: true });
    (vendorAuthClient.verifyVendorDirectoryOtp as jest.Mock).mockResolvedValue({
      success: true,
      token: 'valid_jwt_token',
    });

    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} initialEmail="cm@procucev.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('directory-request-otp-submit'));
    });
    await waitFor(() => screen.getByTestId('directory-otp-input'));

    const otpInput = screen.getByTestId('directory-otp-input');
    await act(async () => {
      fireEvent.change(otpInput, { target: { value: '123456' } });
      fireEvent.submit(otpInput.closest('form')!);
    });

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
  });
});
