import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BuyerFirstLoginPage from '@/app/buyer-first-login/page';
import { authClient } from '@/lib/authClient';
import * as storeModule from '@/lib/store';
import { ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import { validatePincode } from '@/lib/validationSchemas';

jest.mock('@/lib/store');
jest.mock('@/lib/authClient', () => ({
  authClient: {
    requestOtp: jest.fn(),
    completeBuyerOnboarding: jest.fn(),
  },
}));
jest.mock('@/lib/validationSchemas', () => {
  const actual = jest.requireActual('@/lib/validationSchemas');
  return {
    ...actual,
    validatePincode: jest.fn(),
  };
});

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
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
    mockSearchParams = new URLSearchParams();
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
    (validatePincode as jest.Mock).mockResolvedValue({
      isValid: true,
      postOffices: [{ District: 'Pune', State: 'Maharashtra' }],
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

  it.each([
    ['/buyer/rfqs', '/buyer/rfq-summary'],
    ['/buyer/rfqs?source=email', '/buyer/rfq-summary?source=email'],
  ])('preserves the normalized legacy return URL when login is required (%s)', async (returnUrl, destination) => {
    mockSearchParams = new URLSearchParams({ returnUrl });
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: null,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });

    render(<BuyerFirstLoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent(destination)}`);
    });
    expect(screen.queryByRole('dialog', { name: UI_STRINGS.auth.buyerOnboarding.title })).not.toBeInTheDocument();
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
    it('warns when mobile is empty when requesting SMS OTP', () => {
      render(<BuyerFirstLoginPage />);
      const mobileInput = screen.getByPlaceholderText('10-digit mobile');
      fireEvent.change(mobileInput, { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.placeholderPhoneWarning
      );
      expect(authClient.requestOtp).not.toHaveBeenCalled();
    });

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
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.companyNamePlaceholder), {
        target: { value: 'Acme Global Ltd' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.contactNamePlaceholder), {
        target: { value: 'John Buyer' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.gstinPlaceholder), {
        target: { value: '27AAAAA0000A1Z5' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder), {
        target: { value: '411001' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.cityPlaceholder), {
        target: { value: 'Pune' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.statePlaceholder), {
        target: { value: 'Maharashtra' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.addressPlaceholder), {
        target: { value: 'Plot 42, MIDC Hinjewadi' },
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
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.companyNamePlaceholder), {
        target: { value: '   ' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.companyNameRequired
      );
    });

    it('rejects submission when GSTIN is empty', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.gstinPlaceholder), {
        target: { value: '   ' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.gstinRequired
      );
    });

    it('rejects submission when GSTIN is invalid format', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.gstinPlaceholder), {
        target: { value: 'INVALID123' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.gstinInvalid
      );
    });

    it('rejects submission when pincode is empty', () => {
      const { container } = render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder), {
        target: { value: '' },
      });

      const form = container.querySelector('form');
      fireEvent.submit(form!);

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.pincodeRequired
      );
    });

    it('rejects submission when pincode is invalid format', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder), {
        target: { value: '012345' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.pincodeInvalid
      );
    });

    it('rejects submission when city is empty', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.cityPlaceholder), {
        target: { value: '   ' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.cityRequired
      );
    });

    it('rejects submission when state is empty', () => {
      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.statePlaceholder), {
        target: { value: '   ' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.auth.buyerOnboarding.stateRequired
      );
    });

    it('updates GSTIN to uppercase and automatically derives PAN when 15 characters are entered', () => {
      render(<BuyerFirstLoginPage />);
      const gstinInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.gstinPlaceholder);
      fireEvent.change(gstinInput, { target: { value: '27aaaaa0000a1z5' } });
      expect(gstinInput).toHaveValue('27AAAAA0000A1Z5');
    });

    it('clears pincode error when value is less than 6 digits', () => {
      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '411' } });
      expect(screen.queryByText('Invalid PIN code')).not.toBeInTheDocument();
    });

    it('handles pincode lookup and auto-populates city and state', async () => {
      (validatePincode as jest.Mock).mockResolvedValueOnce({
        isValid: true,
        postOffices: [{ District: 'Pune', State: 'Maharashtra' }],
      });

      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '411001' } });

      await waitFor(() => {
        expect(validatePincode).toHaveBeenCalledWith('411001');
      }, { timeout: 1000 });
      await waitFor(() => {
        expect(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.cityPlaceholder)).toHaveValue('Pune');
        expect(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.statePlaceholder)).toHaveValue('Maharashtra');
      });
    });

    it('displays error immediately when dummy pincode is entered', () => {
      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '999999' } });

      expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();
    });

    it('displays error when pincode lookup returns invalid result', async () => {
      (validatePincode as jest.Mock).mockResolvedValue({
        isValid: false,
        message: 'Invalid test postal code',
      });

      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '411999' } });

      await waitFor(() => {
        expect(validatePincode).toHaveBeenCalledWith('411999');
      }, { timeout: 2000 });

      await waitFor(() => {
        expect(screen.getByText('Invalid test postal code')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('handles pincode lookup network exception gracefully', async () => {
      (validatePincode as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '411001' } });

      await waitFor(() => {
        expect(validatePincode).toHaveBeenCalledWith('411001');
      }, { timeout: 1000 });
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
          state: 'Maharashtra',
          pincode: '411001',
          address: 'Plot 42, MIDC Hinjewadi',
          gstin: '27AAAAA0000A1Z5',
          pan: 'AAAAA0000A',
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

    it('redirects to redirect param upon completing onboarding when redirect param is present', async () => {
      mockSearchParams = new URLSearchParams('redirect=/buyer/rfq-summary');
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
        expect(mockReplace).toHaveBeenCalledWith('/buyer/rfq-summary');
      });
    });

    it('displays error immediately when pincode starts with 0', () => {
      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '012345' } });

      expect(screen.getByText('PIN code cannot start with 0')).toBeInTheDocument();
    });

    it('clears pincode error when input is emptied', () => {
      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '012345' } });
      expect(screen.getByText('PIN code cannot start with 0')).toBeInTheDocument();

      fireEvent.change(pincodeInput, { target: { value: '' } });
      expect(screen.queryByText('PIN code cannot start with 0')).not.toBeInTheDocument();
    });

    it('handles pincode lookup with postOffices that have Division and State', async () => {
      (validatePincode as jest.Mock).mockResolvedValueOnce({
        isValid: true,
        postOffices: [{ Division: 'Pune Division', State: 'Maharashtra' }],
      });

      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '411002' } });

      await waitFor(() => {
        expect(validatePincode).toHaveBeenCalledWith('411002');
      }, { timeout: 1000 });
      await waitFor(() => {
        expect(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.cityPlaceholder)).toHaveValue('Pune Division');
      });
    });

    it('handles pincode lookup when postOffices array is empty', async () => {
      (validatePincode as jest.Mock).mockResolvedValueOnce({
        isValid: true,
        postOffices: [],
      });

      render(<BuyerFirstLoginPage />);
      const pincodeInput = screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder);
      fireEvent.change(pincodeInput, { target: { value: '411003' } });

      await waitFor(() => {
        expect(validatePincode).toHaveBeenCalledWith('411003');
      }, { timeout: 1000 });
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

    it('shows fallback error when completeBuyerOnboarding returns missing user or token', async () => {
      (authClient.completeBuyerOnboarding as jest.Mock).mockResolvedValue({
        success: true,
        user: null,
        token: null,
      });

      render(<BuyerFirstLoginPage />);
      fillValidForm();

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to complete profile verification. Please try again.');
      });
    });

    it('successfully submits onboarding payload when optional contact name and address are omitted', async () => {
      const updatedUser = {
        email: 'buyer@example.com',
        role: 'buyer',
        onboardingRequired: false,
        passwordChangeRequired: false,
      };
      (authClient.completeBuyerOnboarding as jest.Mock).mockResolvedValue({
        success: true,
        user: updatedUser,
        token: 'new-jwt-token',
      });

      render(<BuyerFirstLoginPage />);
      fillValidForm();
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.contactNamePlaceholder), {
        target: { value: '' },
      });
      fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.auth.buyerOnboarding.addressPlaceholder), {
        target: { value: '' },
      });

      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.auth.buyerOnboarding.submitBtn }));

      await waitFor(() => {
        expect(authClient.completeBuyerOnboarding).toHaveBeenCalledWith(
          expect.objectContaining({
            contactName: undefined,
            address: undefined,
          })
        );
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
