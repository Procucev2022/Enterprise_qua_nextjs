import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VendorDirectoryLoginGate from '@/app/vendors/VendorDirectoryLoginGate';
import { DEFAULT_VENDOR_DIRECTORY_PASSKEY } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

// Module-level mock — required because 'use client' modules produce non-writable
// exports that jest.spyOn cannot redefine at runtime.
jest.mock('@/lib/vendorAuthClient', () => ({
  isVendorDirectoryAuthenticated: jest.fn(() => false),
  getVendorDirectoryAuthToken: jest.fn(() => null),
  authenticateVendorDirectory: jest.fn(),
  logoutVendorDirectory: jest.fn(),
}));

// Import after mock registration so we get the mocked version.
import * as vendorAuthClient from '@/lib/vendorAuthClient';

describe('VendorDirectoryLoginGate', () => {
  const S = UI_STRINGS.vendorDirectoryLogin;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders login gate card with all elements, labels, and demo key helper', () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    expect(screen.getByTestId('vendor-directory-login-gate')).toBeInTheDocument();
    expect(screen.getByText(S.title)).toBeInTheDocument();
    expect(screen.getByText(S.subtitle)).toBeInTheDocument();
    expect(screen.getByTestId('directory-passkey-input')).toBeInTheDocument();
    expect(screen.getByTestId('directory-auth-submit')).toBeInTheDocument();
    expect(screen.getByTestId('use-demo-key-btn')).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_VENDOR_DIRECTORY_PASSKEY)).toBeInTheDocument();
    expect(screen.getByText(S.backToMainLogin)).toBeInTheDocument();
  });

  test('toggles passkey visibility between password and text', () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input');
    expect(input).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByLabelText('Show passkey');
    fireEvent.click(toggleBtn);
    expect(input).toHaveAttribute('type', 'text');

    const hideBtn = screen.getByLabelText('Hide passkey');
    fireEvent.click(hideBtn);
    expect(input).toHaveAttribute('type', 'password');
  });

  test('populates passkey input when clicking Use Demo Key button', () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input') as HTMLInputElement;
    expect(input.value).toBe('');

    fireEvent.click(screen.getByTestId('use-demo-key-btn'));
    expect(input.value).toBe(DEFAULT_VENDOR_DIRECTORY_PASSKEY);
  });

  test('shows error when submitting empty passkey', async () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const submitBtn = screen.getByTestId('directory-auth-submit');
    expect(submitBtn).toBeDisabled();

    // Type spaces
    const input = screen.getByTestId('directory-passkey-input');
    fireEvent.change(input, { target: { value: '   ' } });

    // Submit form directly
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.emptyPasskey);
    });
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  test('clears error message when user modifies the passkey input after an error', async () => {
    const onAuthenticated = jest.fn();
    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toBeInTheDocument();
    });

    // Typing should clear the error
    fireEvent.change(input, { target: { value: 'new-key' } });
    await waitFor(() => {
      expect(screen.queryByTestId('gate-error-banner')).not.toBeInTheDocument();
    });
  });

  test('authenticates successfully and calls onAuthenticated callback', async () => {
    const onAuthenticated = jest.fn();
    (vendorAuthClient.authenticateVendorDirectory as jest.Mock).mockResolvedValue({
      success: true,
      token: 'vdir_test_token',
    });

    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input');
    fireEvent.change(input, { target: { value: DEFAULT_VENDOR_DIRECTORY_PASSKEY } });

    const submitBtn = screen.getByTestId('directory-auth-submit');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
  });

  test('displays error banner when authenticateVendorDirectory returns failure', async () => {
    const onAuthenticated = jest.fn();
    (vendorAuthClient.authenticateVendorDirectory as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Invalid passkey provided.',
    });

    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input');
    fireEvent.change(input, { target: { value: 'wrong-key' } });

    fireEvent.click(screen.getByTestId('directory-auth-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent('Invalid passkey provided.');
    });
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  test('displays error banner with fallback message when auth fails with no error field', async () => {
    const onAuthenticated = jest.fn();
    (vendorAuthClient.authenticateVendorDirectory as jest.Mock).mockResolvedValue({
      success: false,
    });

    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input');
    fireEvent.change(input, { target: { value: 'wrong-key' } });
    fireEvent.click(screen.getByTestId('directory-auth-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.invalidPasskey);
    });
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  test('displays error banner when authenticateVendorDirectory throws an unexpected exception', async () => {
    const onAuthenticated = jest.fn();
    (vendorAuthClient.authenticateVendorDirectory as jest.Mock).mockRejectedValue(new Error('Crash'));

    render(<VendorDirectoryLoginGate onAuthenticated={onAuthenticated} />);

    const input = screen.getByTestId('directory-passkey-input');
    fireEvent.change(input, { target: { value: 'any-key' } });

    fireEvent.click(screen.getByTestId('directory-auth-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('gate-error-banner')).toHaveTextContent(S.invalidPasskey);
    });
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
