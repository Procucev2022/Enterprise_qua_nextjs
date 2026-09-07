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
  authClient: { changePassword: jest.fn() },
}));

// ==============================================================================
// ACCOUNT SECURITY PANEL
// ==============================================================================
// The panel holds one form: change the signed-in account's password. It posts to
// POST /api/auth/change-password, which identifies the account from the session
// token, so nothing about which account is being changed is asserted here — only
// that the credential pair is sent and every outcome is reported accurately.
//
// It previously showed a display-name field and a single sign-on summary card.
// Both are gone: the display name had no endpoint behind it, and the SSO card
// described a tenant integration that is not in place.
// ==============================================================================

const mockShowToast = jest.fn();
const strings = UI_STRINGS.accountSecurity;
const changePassword = authClient.changePassword as jest.Mock;

const VALID_NEW = 'a-brand-new-secret';

const mount = () => {
  (useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
  return render(<AccountSecurityPanel />);
};

const currentField = () => screen.getByPlaceholderText(strings.currentPasswordPlaceholder);
const newField = () => screen.getByPlaceholderText(strings.newPasswordPlaceholder);
const confirmField = () => screen.getByPlaceholderText(strings.confirmPasswordPlaceholder);
const submitButton = () => screen.getByRole('button', { name: strings.updatePasswordAction });

/** Fill all three fields with a valid, self-consistent set of values. */
const fillValid = (current = 'the-old-secret', next = VALID_NEW) => {
  fireEvent.change(currentField(), { target: { value: current } });
  fireEvent.change(newField(), { target: { value: next } });
  fireEvent.change(confirmField(), { target: { value: next } });
};

beforeEach(() => {
  changePassword.mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AccountSecurityPanel structure', () => {
  it('renders the password form and its requirements', () => {
    mount();

    expect(screen.getByText(strings.passwordSectionLabel)).toBeInTheDocument();
    expect(currentField()).toBeInTheDocument();
    expect(newField()).toBeInTheDocument();
    expect(confirmField()).toBeInTheDocument();
    expect(screen.getByText(strings.policyTitle)).toBeInTheDocument();
    expect(screen.getByText(strings.policyMinLength)).toBeInTheDocument();
    expect(screen.getByText(strings.policyReuse)).toBeInTheDocument();
    expect(screen.getByText(strings.policyComplexity)).toBeInTheDocument();
  });

  // Both were removed because neither was backed by anything real.
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
  it('requires the current password and does not call the API', async () => {
    mount();

    fireEvent.change(newField(), { target: { value: VALID_NEW } });
    fireEvent.change(confirmField(), { target: { value: VALID_NEW } });
    fireEvent.click(submitButton());

    expect(mockShowToast).toHaveBeenCalledWith(
      strings.validationErrorTitle,
      strings.currentPasswordRequired,
      'warning'
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only current password as missing', () => {
    mount();

    fillValid('   ');
    fireEvent.click(submitButton());

    expect(mockShowToast).toHaveBeenCalledWith(
      strings.validationErrorTitle,
      strings.currentPasswordRequired,
      'warning'
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than the minimum', () => {
    mount();

    fillValid('the-old-secret', 'a'.repeat(PASSWORD_MIN_LENGTH - 1));
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

    fireEvent.change(currentField(), { target: { value: 'the-old-secret' } });
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

  // Caught before the request so an obviously pointless round trip is skipped;
  // the API enforces the same rule for any other client.
  it('rejects reusing the current password', () => {
    mount();

    fillValid(VALID_NEW, VALID_NEW);
    fireEvent.click(submitButton());

    expect(mockShowToast).toHaveBeenCalledWith(
      strings.validationErrorTitle,
      strings.passwordSameAsCurrent,
      'warning'
    );
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe('AccountSecurityPanel API call', () => {
  it('sends only the credential pair, never an account identifier', async () => {
    mount();

    fillValid('the-old-secret', VALID_NEW);
    fireEvent.click(submitButton());

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
    expect(changePassword).toHaveBeenCalledWith('the-old-secret', VALID_NEW);
  });

  it('reports the API message and clears the fields on success', async () => {
    changePassword.mockResolvedValue({ success: true, message: 'Password updated on the server.' });
    mount();

    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.passwordChangedTitle,
        'Password updated on the server.',
        'success'
      )
    );

    expect(currentField()).toHaveValue('');
    expect(newField()).toHaveValue('');
    expect(confirmField()).toHaveValue('');
  });

  it('falls back to local copy when the API succeeds without a message', async () => {
    changePassword.mockResolvedValue({ success: true });
    mount();

    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.passwordChangedTitle,
        strings.passwordChangedFallback,
        'success'
      )
    );
  });

  // The API distinguishes a wrong current password from an unreachable database,
  // so its wording is surfaced rather than a generic failure.
  it('surfaces the API reason on rejection and keeps what was typed', async () => {
    changePassword.mockResolvedValue({
      success: false,
      error: 'Your current password is not correct, so the password was not changed.',
    });
    mount();

    fillValid('wrong-old-secret', VALID_NEW);
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.changeFailedTitle,
        'Your current password is not correct, so the password was not changed.',
        'warning'
      )
    );

    // Nothing is cleared, so a single field can be corrected and resubmitted.
    expect(currentField()).toHaveValue('wrong-old-secret');
    expect(newField()).toHaveValue(VALID_NEW);
    expect(confirmField()).toHaveValue(VALID_NEW);
  });

  it('falls back to local copy when the API fails without a reason', async () => {
    changePassword.mockResolvedValue({ success: false });
    mount();

    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        strings.changeFailedTitle,
        strings.changeFailedFallback,
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
    fillValid();
    fireEvent.click(submitButton());

    // In flight: the label changes and the control is disabled.
    const busyButton = await screen.findByRole('button', {
      name: strings.updatingPasswordAction,
    });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');

    // A second submit while the first is pending must not issue another request.
    fireEvent.submit(busyButton.closest('form') as HTMLFormElement);
    expect(changePassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ success: true });
    });

    expect(await screen.findByRole('button', { name: strings.updatePasswordAction })).toBeEnabled();
  });
});
