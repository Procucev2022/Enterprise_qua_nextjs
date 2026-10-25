import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AccountSecurityPanel from '@/app/components/AccountSecurityPanel';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { PASSWORD_MIN_LENGTH } from '@/lib/constants';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/authClient', () => ({
  authClient: {
    changePassword: jest.fn(),
    requestOtp: jest.fn(),
    getSessionUser: jest.fn().mockReturnValue({ email: 'buyer@procucev.com', mobile: '9876543210' }),
  },
}));

// ==============================================================================
// ACCOUNT SECURITY PANEL
// ==============================================================================
// The panel holds one form: change the signed-in account's password.
// Current password field has been removed in favor of direct reset / OTP verification.
// ==============================================================================

const mockShowToast = jest.fn();
const strings = UI_STRINGS.accountSecurity;
const changePassword = authClient.changePassword as jest.Mock;
const requestOtp = authClient.requestOtp as jest.Mock;

const VALID_NEW = 'a-brand-new-secret';

const mount = () => {
  (useApp as jest.Mock).mockReturnValue({
    showToast: mockShowToast,
    user: { email: 'buyer@procucev.com', mobile: '9876543210' },
  });
  return render(<AccountSecurityPanel />);
};

const newField = () => screen.getByPlaceholderText(strings.newPasswordPlaceholder);
const confirmField = () => screen.getByPlaceholderText(strings.confirmPasswordPlaceholder);
const submitButton = () => screen.getByRole('button', { name: strings.updatePasswordAction });

/** Fill new password and confirm new password fields with valid values. */
const fillValid = (next = VALID_NEW) => {
  fireEvent.change(newField(), { target: { value: next } });
  fireEvent.change(confirmField(), { target: { value: next } });
};

beforeEach(() => {
  changePassword.mockResolvedValue({ success: true });
  requestOtp.mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AccountSecurityPanel structure', () => {
  it('renders the password form without current password field', () => {
    mount();

    expect(screen.getByText(strings.passwordSectionLabel)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(strings.currentPasswordPlaceholder)).not.toBeInTheDocument();
    expect(newField()).toBeInTheDocument();
    expect(confirmField()).toBeInTheDocument();
    expect(screen.getByText(strings.policyTitle)).toBeInTheDocument();
    expect(screen.getByText(strings.policyMinLength)).toBeInTheDocument();
    expect(screen.getByText(strings.policyComplexity)).toBeInTheDocument();
  });

  it('does not offer a display name field or a single sign-on summary', () => {
    mount();

    expect(screen.queryByText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/single sign-on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/azure/i)).not.toBeInTheDocument();
  });

  it('publishes the shared minimum length on the new-password field', () => {
    mount();

    expect(newField()).toHaveAttribute('minLength', String(PASSWORD_MIN_LENGTH));
  });
});

describe('AccountSecurityPanel client-side validation', () => {
  it('rejects a new password shorter than the minimum', () => {
    mount();

    fillValid('a'.repeat(PASSWORD_MIN_LENGTH - 1));
    fireEvent.click(submitButton());

    expect(mockShowToast).toHaveBeenCalledWith(
      strings.weakPasswordTitle,
      strings.weakPasswordMessage,
      'warning'
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match', () => {
    mount();

    fireEvent.change(newField(), { target: { value: VALID_NEW } });
    fireEvent.change(confirmField(), { target: { value: 'something-else-entirely' } });
    fireEvent.click(submitButton());

    expect(mockShowToast).toHaveBeenCalledWith(
      strings.passwordMismatchTitle,
      strings.passwordMismatchMessage,
      'warning'
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('prompts to request verification code when none was requested', async () => {
    changePassword.mockResolvedValueOnce({
      success: false,
      error: 'A verification code, reset token, or current password is required to change your password.',
    });
    mount();

    fillValid(VALID_NEW);
    fireEvent.click(submitButton());

    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));
    expect(mockShowToast).toHaveBeenCalledWith(
      strings.codeSentTitle,
      strings.codeSentMessage,
      'success'
    );
  });
});

describe('AccountSecurityPanel OTP verification and API call', () => {
  it('requests OTP and submits new password with verification code', async () => {
    mount();

    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);

    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));
    expect(mockShowToast).toHaveBeenCalledWith(
      strings.codeSentTitle,
      strings.codeSentMessage,
      'success'
    );

    const codeInput = screen.getByPlaceholderText(strings.verificationCodePlaceholder);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fillValid(VALID_NEW);
    fireEvent.click(submitButton());

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
    expect(changePassword).toHaveBeenCalledWith('123456', VALID_NEW, { code: '123456' });
  });

  it('reports the API message and clears fields on success', async () => {
    changePassword.mockResolvedValue({ success: true, message: 'Password updated on the server.' });
    mount();

    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);

    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));

    const codeInput = screen.getByPlaceholderText(strings.verificationCodePlaceholder);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fillValid(VALID_NEW);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.passwordChangedTitle,
        'Password updated on the server.',
        'success'
      )
    );

    expect(newField()).toHaveValue('');
    expect(confirmField()).toHaveValue('');
  });

  it('surfaces the API reason on rejection', async () => {
    changePassword.mockResolvedValue({
      success: false,
      error: 'Invalid or expired verification code',
    });
    mount();

    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);

    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));

    const codeInput = screen.getByPlaceholderText(strings.verificationCodePlaceholder);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fillValid(VALID_NEW);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.changeFailedTitle,
        'Invalid or expired verification code',
        'warning'
      )
    );
  });
});

describe('AccountSecurityPanel in-flight state', () => {
  it('shows progress, disables the button and ignores a second submit', async () => {
    let release: (value: { success: boolean }) => void = () => {};
    changePassword.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        release = resolve;
      })
    );

    mount();
    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);

    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));

    const codeInput = screen.getByPlaceholderText(strings.verificationCodePlaceholder);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fillValid(VALID_NEW);
    fireEvent.click(submitButton());

    const busyButton = await screen.findByRole('button', {
      name: strings.updatingPasswordAction,
    });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');

    fireEvent.submit(busyButton.closest('form') as HTMLFormElement);
    expect(changePassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ success: true });
    });

    expect(await screen.findByRole('button', { name: strings.updatePasswordAction })).toBeEnabled();
  });

  it('rejects empty new password with validation error', () => {
    mount();
    fireEvent.click(submitButton());
    expect(mockShowToast).toHaveBeenCalledWith(
      strings.validationErrorTitle,
      strings.weakPasswordMessage,
      'warning'
    );
  });

  it('handles missing session email when requesting OTP', async () => {
    (authClient.getSessionUser as jest.Mock).mockReturnValueOnce(null);
    mount();
    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);
    expect(mockShowToast).toHaveBeenCalledWith(
      strings.validationErrorTitle,
      'No active account session found. Please sign in again.',
      'warning'
    );
  });

  it('handles requestOtp errors with custom error and fallback error', async () => {
    requestOtp.mockResolvedValueOnce({ success: false, error: 'SMS gateway quota reached' });
    mount();
    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.changeFailedTitle,
        'SMS gateway quota reached',
        'warning'
      );
    });

    // Fallback error when error is falsy
    requestOtp.mockResolvedValueOnce({ success: false, error: '' });
    fireEvent.click(forgotBtn);
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.changeFailedTitle,
        'Failed to dispatch verification code. Please try again.',
        'warning'
      );
    });
  });

  it('strips non-digits in OTP input, exercises Resend Code button, and handles reset token error', async () => {
    mount();
    const forgotBtn = screen.getByRole('button', { name: /Forgot Password\? Reset via Code/i });
    fireEvent.click(forgotBtn);
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));

    const codeInput = screen.getByPlaceholderText(strings.verificationCodePlaceholder);
    fireEvent.change(codeInput, { target: { value: 'ab12cd34' } });
    expect((codeInput as HTMLInputElement).value).toBe('1234');

    // Click Resend Code button
    const resendBtn = screen.getByRole('button', { name: /Resend Code/i });
    fireEvent.click(resendBtn);
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(2));

    // Change password rejected with reset token error (triggers OTP prompt)
    changePassword.mockResolvedValueOnce({ success: false, error: 'Expired reset token provided' });
    fillValid(VALID_NEW);
    // Clear code input to test !verificationCode branch
    fireEvent.change(codeInput, { target: { value: '' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(3));

    // Change password rejected with empty error (fallback message)
    changePassword.mockResolvedValueOnce({ success: false, error: '' });
    fireEvent.change(codeInput, { target: { value: '999999' } });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.changeFailedTitle,
        strings.changeFailedFallback,
        'warning'
      );
    });
  });
});
