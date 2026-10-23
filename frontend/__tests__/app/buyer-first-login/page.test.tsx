import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BuyerFirstLoginPage from '@/app/buyer-first-login/page';
import { authClient } from '@/lib/authClient';
import * as storeModule from '@/lib/store';
import { ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/store');
jest.mock('@/lib/authClient', () => ({
  authClient: {
    requestOtp: jest.fn(),
    completeBuyerOnboarding: jest.fn(),
  },
}));

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockSetCurrentUserSession = jest.fn();
const mockSetIsLoggedIn = jest.fn();
const mockShowToast = jest.fn();

let mockCurrentUserSession: Record<string, unknown> | null = {
  email: 'buyer@example.com',
  name: 'Buyer Admin',
  orgName: 'Acme Corp',
  role: 'buyer',
  onboardingRequired: true,
  passwordChangeRequired: true,
};

describe('BuyerFirstLoginPage', () => {
  beforeEach(() => {
    mockCurrentUserSession = {
      email: 'buyer@example.com',
      name: 'Buyer Admin',
      orgName: 'Acme Corp',
      role: 'buyer',
      onboardingRequired: true,
      passwordChangeRequired: true,
    };
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: mockCurrentUserSession,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the onboarding dialog for authenticated buyers requiring setup', () => {
    render(<BuyerFirstLoginPage />);
    expect(screen.getByRole('dialog', { name: UI_STRINGS.auth.buyerOnboarding.title })).toBeInTheDocument();
  });

  it('redirects unauthenticated visitors to login', async () => {
    mockCurrentUserSession = null;
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: null,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });

    render(<BuyerFirstLoginPage />);
    expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects buyers who do not need onboarding or password change', async () => {
    mockCurrentUserSession = {
      email: 'buyer@example.com',
      role: 'buyer',
      onboardingRequired: false,
      passwordChangeRequired: false,
    };
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: mockCurrentUserSession,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });

    render(<BuyerFirstLoginPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
    });
  });

  it('redirects users with non-buyer roles', async () => {
    mockCurrentUserSession = {
      email: 'vendor@example.com',
      role: 'vendor',
      onboardingRequired: true,
    };
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: mockCurrentUserSession,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });

    render(<BuyerFirstLoginPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
    });
  });

  describe('Email OTP flow', () => {
    it('dispatches email OTP successfully', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: true });
      render(<BuyerFirstLoginPage />);

      const sendBtn = screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendEmailOtpBtn });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(authClient.requestOtp).toHaveBeenCalledWith('buyer@example.com', '9999999999', 'buyer');
        expect(mockShowToast).toHaveBeenCalledWith(
          UI_STRINGS.auth.buyerOnboarding.title,
          UI_STRINGS.auth.buyerOnboarding.otpSentMessage,
          'info'
        );
      });
      expect(screen.getByRole('button', { name: 'Resend OTP' })).toBeInTheDocument();
    });

    it('shows error when email OTP dispatch fails with message', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: false, error: 'SMTP failed' });
      render(<BuyerFirstLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendEmailOtpBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('SMTP failed');
      });
    });

    it('shows fallback error when email OTP dispatch fails without message', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: false });
      render(<BuyerFirstLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendEmailOtpBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to dispatch email verification OTP.');
      });
    });

    it('shows fallback error when email OTP dispatch throws', async () => {
      (authClient.requestOtp as jest.Mock).mockRejectedValue(new Error('Network error'));
      render(<BuyerFirstLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendEmailOtpBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to dispatch email verification OTP.');
      });
    });

    it('returns early when currentUserSession has no email', async () => {
      mockCurrentUserSession = { role: 'buyer', onboardingRequired: true };
      (storeModule.useApp as jest.Mock).mockReturnValue({
        currentUserSession: mockCurrentUserSession,
        setCurrentUserSession: mockSetCurrentUserSession,
        setIsLoggedIn: mockSetIsLoggedIn,
        showToast: mockShowToast,
      });
      render(<BuyerFirstLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendEmailOtpBtn }));
      expect(authClient.requestOtp).not.toHaveBeenCalled();
    });
  });

  describe('SMS OTP flow', () => {
    it('warns when mobile is placeholder 9999999999 or ends with it', () => {
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '9999999999' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.placeholderPhoneWarning
      );
      expect(authClient.requestOtp).not.toHaveBeenCalled();
    });

    it('warns when mobile is invalid Indian mobile number', () => {
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '1234567890' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(UI_STRINGS.auth.mobileInvalid);
      expect(authClient.requestOtp).not.toHaveBeenCalled();
    });

    it('dispatches SMS OTP successfully for valid mobile number', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: true });
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '9876543210' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      await waitFor(() => {
        expect(authClient.requestOtp).toHaveBeenCalledWith(
          'buyer@example.com',
          '9876543210',
          'buyer',
          true
        );
        expect(mockShowToast).toHaveBeenCalledWith(
          UI_STRINGS.auth.buyerOnboarding.title,
          UI_STRINGS.auth.buyerOnboarding.otpSentMessage,
          'info'
        );
      });
      expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    });

    it('shows error when SMS OTP dispatch returns error message', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: false, error: 'SMS service limit' });
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '9876543210' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('SMS service limit');
      });
    });

    it('shows fallback error when SMS OTP dispatch fails without error message', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: false });
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '9876543210' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to dispatch SMS verification OTP.');
      });
    });

    it('shows fallback error when SMS OTP dispatch throws', async () => {
      (authClient.requestOtp as jest.Mock).mockRejectedValue(new Error('SMS Gateway Down'));
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '9876543210' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to dispatch SMS verification OTP.');
      });
    });
  });

  describe('Form submission and validation', () => {
    const fillValidForm = () => {
      fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), { target: { value: '9876543210' } });
      fireEvent.change(screen.getByPlaceholderText('6-digit Email OTP'), { target: { value: '123456' } });
      fireEvent.change(screen.getByPlaceholderText('6-digit SMS OTP'), { target: { value: '654321' } });
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.currentPasswordLabel), {
        target: { value: 'TempPass@123' },
      });
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.newPasswordLabel), {
        target: { value: 'NewSecurePass@2026' },
      });
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.confirmPasswordLabel), {
        target: { value: 'NewSecurePass@2026' },
      });
      fireEvent.change(screen.getByPlaceholderText('e.g. Acme Industrial Ltd'), {
        target: { value: 'Acme Global Ltd' },
      });
      fireEvent.change(screen.getByPlaceholderText('Procurement Officer'), {
        target: { value: 'John Buyer' },
      });
      fireEvent.change(screen.getByPlaceholderText('e.g. Mumbai'), {
        target: { value: 'Pune' },
      });
      fireEvent.change(screen.getByPlaceholderText('e.g. 400001'), {
        target: { value: '411001' },
      });
    };

    it('rejects submission with placeholder phone number', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), { target: { value: '9999999999' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.placeholderPhoneWarning
      );
      expect(authClient.completeBuyerOnboarding).not.toHaveBeenCalled();
    });

    it('rejects submission with invalid phone number format', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), { target: { value: '1234567890' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(UI_STRINGS.auth.mobileInvalid);
    });

    it('rejects submission when email OTP is missing or incomplete', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText('6-digit Email OTP'), { target: { value: '1234' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(UI_STRINGS.auth.otpRequired);
    });

    it('rejects submission when SMS OTP is missing or incomplete', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText('6-digit SMS OTP'), { target: { value: '12' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit SMS verification code');
    });

    it('rejects submission when new password is too short', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.newPasswordLabel), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.confirmPasswordLabel), {
        target: { value: 'short' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(UI_STRINGS.auth.passwordTooShort);
    });

    it('rejects submission when passwords mismatch', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.confirmPasswordLabel), {
        target: { value: 'MismatchPass@2026' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.passwordMismatch
      );
    });

    it('rejects submission when new password equals temporary password', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.currentPasswordLabel), {
        target: { value: 'SamePass@2026' },
      });
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.newPasswordLabel), {
        target: { value: 'SamePass@2026' },
      });
      fireEvent.change(screen.getByLabelText(UI_STRINGS.auth.buyerOnboarding.confirmPasswordLabel), {
        target: { value: 'SamePass@2026' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Choose a new password that is different from your temporary password.'
      );
    });

    it('rejects submission when company name is empty', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText('e.g. Acme Industrial Ltd'), {
        target: { value: '   ' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent('Company name is required.');
    });

    it('successfully submits onboarding payload and redirects to buyer dashboard', async () => {
      const updatedUser = {
        email: 'buyer@example.com',
        role: 'buyer',
        onboardingRequired: false,
        passwordChangeRequired: false,
        name: 'John Buyer',
        orgName: 'Acme Global Ltd',
      };
      (authClient.completeBuyerOnboarding as jest.Mock).mockResolvedValue({
        success: true,
        user: updatedUser,
        token: 'new-jwt-token',
      });

      render(<BuyerFirstLoginPage />);
      fillValidForm();

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      await waitFor(() => {
        expect(authClient.completeBuyerOnboarding).toHaveBeenCalledWith({
          emailOtp: '123456',
          mobile: '9876543210',
          mobileOtp: '654321',
          currentPassword: 'TempPass@123',
          newPassword: 'NewSecurePass@2026',
          companyName: 'Acme Global Ltd',
          contactName: 'John Buyer',
          city: 'Pune',
          pincode: '411001',
          state: undefined,
          gstin: undefined,
          pan: undefined,
        });
        expect(mockSetCurrentUserSession).toHaveBeenCalledWith(updatedUser);
        expect(mockSetIsLoggedIn).toHaveBeenCalledWith(true);
        expect(mockShowToast).toHaveBeenCalledWith(
          UI_STRINGS.auth.buyerOnboarding.successTitle,
          UI_STRINGS.auth.buyerOnboarding.successMessage,
          'success'
        );
        expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
      });
    });

    it('shows error when completeBuyerOnboarding returns error', async () => {
      (authClient.completeBuyerOnboarding as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Invalid email OTP verification code',
      });

      render(<BuyerFirstLoginPage />);
      fillValidForm();

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid email OTP verification code');
      });
    });

    it('shows error when completeBuyerOnboarding throws', async () => {
      (authClient.completeBuyerOnboarding as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<BuyerFirstLoginPage />);
      fillValidForm();

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('An error occurred during verification. Please try again.');
      });
    });
  });
});
