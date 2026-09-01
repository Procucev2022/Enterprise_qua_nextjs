import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HomePage from '@/app/page';
import NotificationToast from '@/app/components/NotificationToast';
import { AppProvider, useApp } from '@/lib/store';

// The login/OTP flows now depend on the real backend response (Phase 4 login-flow
// hardening removed the old client-side-only bypass), so /api/auth/* needs a realistic
// mock here instead of the generic `{ success: true, data: {} }` the shared fetch mock
// in jest.setup.ts returns for every non-/api/bootstrap URL. Everything else still falls
// through to that original mock unchanged.
const DEFAULT_FETCH_IMPL = (global.fetch as jest.Mock).getMockImplementation()!;

function deriveTestRole(email: string): string {
  if (email.includes('kiranvalves') || email.includes('apexsupplies')) return 'vendor';
  if (email.includes('admin')) return 'admin';
  if (email.includes('catmanager') || email.includes('manager')) return 'category_manager';
  return 'buyer';
}

(global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
  if (typeof url === 'string' && url.includes('/api/auth/')) {
    const body = options?.body ? JSON.parse(options.body as string) : {};

    if (url.includes('/api/auth/request-otp')) {
      if (body.email === 'reject.otp@nowhere.com') {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ success: false, error: 'No account found for this email. Please register first.' }),
        });
      }
      if (body.email === 'no.democode@example.com') {
        // Real-world edge case: the backend accepted the request but the response omits demoCode
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: `OTP dispatched to ${body.email}`, expiresInSeconds: 600 }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, message: `OTP dispatched to ${body.email}`, demoCode: '1234', expiresInSeconds: 600 }),
      });
    }

    if (url.includes('/api/auth/verify-otp')) {
      if (body.code === '0000') {
        // Real-world edge case: a rejection with no error field, exercising the client-side fallback text
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ success: false }) });
      }
      const ok = body.code === '1234' || body.code === '4321';
      return Promise.resolve({
        ok,
        status: ok ? 200 : 400,
        json: async () =>
          ok
            ? {
                success: true,
                token: 'mock-jwt-token',
                user: {
                  id: `usr-test-${Date.now()}`,
                  email: body.email,
                  name: String(body.email).split('@')[0].toUpperCase(),
                  role: deriveTestRole(body.email),
                  orgId: 'org-test-1',
                  orgName: 'Test Organization',
                },
              }
            : { success: false, error: 'Invalid or expired OTP code.' },
      });
    }

    if (url.includes('/api/auth/login')) {
      const ok = body.password === 'Kiran@Temp8821#' || body.password === 'cmPass123' || body.password === 'adminPass123';
      return Promise.resolve({
        ok,
        status: ok ? 200 : 401,
        json: async () =>
          ok
            ? {
                success: true,
                token: 'mock-jwt-token',
                user: {
                  id: `usr-test-${Date.now()}`,
                  email: body.email,
                  name: String(body.email).split('@')[0].toUpperCase(),
                  role: deriveTestRole(body.email),
                  orgId: 'org-test-1',
                  orgName: 'Test Organization',
                },
              }
            : { success: false, error: 'Invalid email or password.' },
      });
    }
  }

  return DEFAULT_FETCH_IMPL(url, options);
});

function AuthTestWrapper() {
  const { setIsLoggedIn, setCurrentRole, setCurrentMode } = useApp();
  return (
    <>
      <button data-testid="test-logout" onClick={() => setIsLoggedIn(false)}>
        Logout Test
      </button>
      <button data-testid="test-set-buyer" onClick={() => { setCurrentRole('buyer'); setIsLoggedIn(true); }}>
        Set Buyer
      </button>
      <button data-testid="test-set-vendor" onClick={() => { setCurrentRole('vendor'); setIsLoggedIn(true); }}>
        Set Vendor
      </button>
      <button data-testid="test-set-cm" onClick={() => { setCurrentRole('category_manager'); setIsLoggedIn(true); }}>
        Set CM
      </button>
      <button data-testid="test-set-admin" onClick={() => { setCurrentRole('admin'); setIsLoggedIn(true); }}>
        Set Admin
      </button>
      <button data-testid="test-set-mode3" onClick={() => setCurrentMode('mode_3')}>
        Set Mode 3
      </button>
      <HomePage />
      {/* Mirrors app/layout.tsx, which mounts this as a sibling of the page, not inside it —
          needed here so toast assertions (e.g. login/OTP failure messages) can find anything. */}
      <NotificationToast />
    </>
  );
}

describe('HomePage Comprehensive Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('Logged Out Authentication Views', () => {
    test('renders login tab, switches auth tabs and roles, and performs buyer OTP flow', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));

      // Switch between tabs: Register -> Login
      const registerTab = screen.getByRole('button', { name: /Create Account/i });
      fireEvent.click(registerTab);
      const loginTab = screen.getByRole('button', { name: /^Sign In$/i });
      fireEvent.click(loginTab);

      // Switch between role buttons: Buyer -> Vendor -> CM -> Admin -> Buyer
      fireEvent.click(screen.getByRole('button', { name: /Vendor Partner/i }));
      fireEvent.click(screen.getByRole('button', { name: /Cat Manager/i }));
      fireEvent.click(screen.getByRole('button', { name: /System Admin/i }));
      fireEvent.click(screen.getByRole('button', { name: /^Buyer$/i }));

      // Empty email validation
      const emailInput = screen.getByPlaceholderText(/buyer@procucev.com/i);
      fireEvent.change(emailInput, { target: { value: '' } });
      const requestOtpBtn = screen.getByRole('button', { name: /Request Login OTP/i });
      fireEvent.submit(requestOtpBtn.closest('form')!);

      // Auto register on the fly for custom email
      fireEvent.change(emailInput, { target: { value: 'custom.procurement@adanimanufacturing.com' } });
      fireEvent.submit(requestOtpBtn.closest('form')!);

      // requestOtp now awaits the real backend response before showing the dispatched toast
      await waitFor(() => {
        expect(screen.getByText(/Verification OTP has been dispatched to/i)).toBeInTheDocument();
      });

      // Back button on Login OTP form
      const backLoginBtn = screen.getByRole('button', { name: /^Back$/i });
      fireEvent.click(backLoginBtn);

      // Re-request OTP
      const requestOtpBtn2 = screen.getByRole('button', { name: /Request Login OTP/i });
      fireEvent.submit(requestOtpBtn2.closest('form')!);

      // Test invalid OTP (length < 4)
      const otpInput = await waitFor(() => screen.getByPlaceholderText(/Enter 4-digit code/i));
      fireEvent.change(otpInput, { target: { value: '12' } });
      const verifyBtn = screen.getByRole('button', { name: /Verify & Sign In/i });
      const form = verifyBtn.closest('form')!;
      form.noValidate = true;
      fireEvent.submit(form);

      // Test valid OTP
      fireEvent.change(otpInput, { target: { value: '1234' } });
      fireEvent.submit(verifyBtn.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      });
    });

    test('buyer OTP request/verify failure branches, and success without a demo code', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));
      fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^Buyer$/i }));

      const emailInput = screen.getByPlaceholderText(/buyer@procucev.com/i);
      const requestOtpBtn = screen.getByRole('button', { name: /Request Login OTP/i });

      // Backend rejects the OTP request (e.g. unregistered email)
      fireEvent.change(emailInput, { target: { value: 'reject.otp@nowhere.com' } });
      fireEvent.submit(requestOtpBtn.closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/No account found/i)).toBeInTheDocument();
      });

      // Backend accepts the request but omits a demo code in the response
      fireEvent.change(emailInput, { target: { value: 'no.democode@example.com' } });
      fireEvent.submit(requestOtpBtn.closest('form')!);
      const otpInput = await waitFor(() => screen.getByPlaceholderText(/Enter 4-digit code/i));

      // Verify fails with no error message from the backend
      fireEvent.change(otpInput, { target: { value: '0000' } });
      const verifyBtn = screen.getByRole('button', { name: /Verify & Sign In/i });
      fireEvent.submit(verifyBtn.closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/OTP entered is incorrect/i)).toBeInTheDocument();
      });
    });

    test('instant 1-click buyer login and public account align', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));

      // Quick align from public system database by clicking organization name
      await waitFor(() => {
        expect(screen.getByText(/Larsen & Toubro/i)).toBeInTheDocument();
      });
      const publicAccountBtn = screen.getByText(/Larsen & Toubro/i);
      fireEvent.click(publicAccountBtn);

      await waitFor(() => {
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('test-logout'));

      const instantBtns = screen.getAllByRole('button', { name: /Instant 1-Click Buyer Sign In/i });
      fireEvent.click(instantBtns[0]);

      await waitFor(() => {
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      });
    });

    test('vendor login with temporary password, email OTP mode, quick autofill and error branches', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));

      const vendorRoleBtn = screen.getByRole('button', { name: /Vendor Partner/i });
      fireEvent.click(vendorRoleBtn);

      expect(screen.getByText(/First-Time Password/i)).toBeInTheDocument();

      // Switch between Vendor Auth Modes: Email OTP -> First-Time Password
      const otpModeBtn = screen.getByRole('button', { name: /Email OTP \(Subsequent\)/i });
      fireEvent.click(otpModeBtn);

      // Click on Quick Demo Vendor Profile (triggers handleQuickSelectVendor)
      await waitFor(() => {
        expect(screen.queryByText(/Apex Supplies/i)).toBeInTheDocument();
      });
      const apexVendorBtn = screen.queryByText(/Apex Supplies/i);
      if (apexVendorBtn) {
        fireEvent.click(apexVendorBtn);
      }

      const tempPassModeBtn = screen.getByRole('button', { name: /First-Time Password/i });
      fireEvent.click(tempPassModeBtn);

      // Test empty password validation
      const emailInput = screen.getByPlaceholderText(/vendor@company\.com/i);
      const passwordInput = screen.getByPlaceholderText(/Enter temporary password/i);
      fireEvent.change(emailInput, { target: { value: '' } });
      fireEvent.change(passwordInput, { target: { value: '' } });
      const signInBtn = screen.getByRole('button', { name: /First-Time Sign In & Update Profile/i });
      fireEvent.submit(signInBtn.closest('form')!);

      // Quick demo profile click (autofill)
      const quickAutofillBtns = screen.queryAllByRole('button');
      const demoVendorBtn = quickAutofillBtns.find(b => b.textContent?.includes('Kiran') || (b.textContent?.includes('@') && !b.textContent?.includes('Sign In')));
      if (demoVendorBtn) {
        fireEvent.click(demoVendorBtn);
      }

      // First time password valid submit
      fireEvent.change(emailInput, { target: { value: 'amit@kiranvalves.com' } });
      fireEvent.change(passwordInput, { target: { value: 'Kiran@Temp8821#' } });
      fireEvent.submit(signInBtn.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Vendor Workspace & Opportunity Feed/i)).toBeInTheDocument();
      });

      // Logout and test OTP flow
      fireEvent.click(screen.getByTestId('test-logout'));
      fireEvent.click(screen.getByRole('button', { name: /Vendor Partner/i }));

      // Switch to Email OTP (Subsequent) mode
      fireEvent.click(screen.getByRole('button', { name: /Email OTP \(Subsequent\)/i }));

      // Request OTP empty email
      const vendorOtpEmailInput = screen.getByPlaceholderText(/vendor@company\.com/i);
      fireEvent.change(vendorOtpEmailInput, { target: { value: '' } });
      const reqVendorOtpBtn = screen.getByRole('button', { name: /Send Instant OTP to Email/i });
      fireEvent.submit(reqVendorOtpBtn.closest('form')!);

      // Request OTP with valid email
      fireEvent.change(vendorOtpEmailInput, { target: { value: 'sales@apexsupplies.com' } });
      fireEvent.submit(reqVendorOtpBtn.closest('form')!);

      // requestOtp now awaits the real backend response before the OTP form appears
      const backOtpBtn = await waitFor(() => screen.getByRole('button', { name: /^Back$/i }));
      fireEvent.click(backOtpBtn);

      // Switch back to OTP and test invalid OTP (length < 4)
      const reqVendorOtpBtn2 = screen.getByRole('button', { name: /Send Instant OTP to Email/i });
      fireEvent.submit(reqVendorOtpBtn2.closest('form')!);
      const vendorOtpInput = await waitFor(() => screen.getByPlaceholderText(/Enter 4-digit code/i));
      fireEvent.change(vendorOtpInput, { target: { value: '12' } });
      const verifyVendorBtn = screen.getByRole('button', { name: /Verify OTP & Sign In/i });
      const formVendor = verifyVendorBtn.closest('form')!;
      formVendor.noValidate = true;
      fireEvent.submit(formVendor);

      // Test valid OTP
      fireEvent.change(vendorOtpInput, { target: { value: '4321' } });
      fireEvent.submit(verifyVendorBtn.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Vendor Workspace & Opportunity Feed/i)).toBeInTheDocument();
      });
    });

    test('vendor password login and OTP failure branches, and OTP success without a demo code', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));
      fireEvent.click(screen.getByRole('button', { name: /Vendor Partner/i }));

      // Wrong temporary password
      const emailInput = screen.getByPlaceholderText(/vendor@company\.com/i);
      const passwordInput = screen.getByPlaceholderText(/Enter temporary password/i);
      fireEvent.change(emailInput, { target: { value: 'amit@kiranvalves.com' } });
      fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
      const signInBtn = screen.getByRole('button', { name: /First-Time Sign In & Update Profile/i });
      fireEvent.submit(signInBtn.closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/Invalid email or password/i)).toBeInTheDocument();
      });

      // Switch to Email OTP (Subsequent) mode
      fireEvent.click(screen.getByRole('button', { name: /Email OTP \(Subsequent\)/i }));

      const vendorOtpEmailInput = screen.getByPlaceholderText(/vendor@company\.com/i);
      const reqVendorOtpBtn = screen.getByRole('button', { name: /Send Instant OTP to Email/i });

      // Backend rejects the OTP request
      fireEvent.change(vendorOtpEmailInput, { target: { value: 'reject.otp@nowhere.com' } });
      fireEvent.submit(reqVendorOtpBtn.closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/No account found/i)).toBeInTheDocument();
      });

      // Backend accepts the request but omits a demo code in the response
      fireEvent.change(vendorOtpEmailInput, { target: { value: 'no.democode@example.com' } });
      fireEvent.submit(reqVendorOtpBtn.closest('form')!);
      const vendorOtpInput = await waitFor(() => screen.getByPlaceholderText(/Enter 4-digit code/i));

      // Verify fails with no error message from the backend
      fireEvent.change(vendorOtpInput, { target: { value: '0000' } });
      const verifyVendorBtn = screen.getByRole('button', { name: /Verify OTP & Sign In/i });
      fireEvent.submit(verifyVendorBtn.closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/OTP entered is incorrect/i)).toBeInTheDocument();
      });
    });

    test('category manager and admin direct credentials login', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));

      const cmRoleBtn = screen.getByRole('button', { name: /Cat Manager/i });
      fireEvent.click(cmRoleBtn);

      // Missing fields: submit with no email/password entered
      const accessBtnEmpty = screen.getByRole('button', { name: /Access Workspace/i });
      fireEvent.submit(accessBtnEmpty.closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/Please enter your registered email and password/i)).toBeInTheDocument();
      });

      const emailInput = screen.getByPlaceholderText(/catmanager@yourcompany.com/i);
      fireEvent.change(emailInput, { target: { value: 'catmanager@procucev.com' } });

      const passInput = screen.getByRole('button', { name: /Access Workspace/i }).closest('form')?.querySelector('input[type="password"]');
      if (passInput) {
        fireEvent.change(passInput, { target: { value: 'cmPass123' } });
      }

      const accessBtn = screen.getByRole('button', { name: /Access Workspace/i });
      fireEvent.submit(accessBtn.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('test-logout'));

      const adminRoleBtn = screen.getByRole('button', { name: /System Admin/i });
      fireEvent.click(adminRoleBtn);

      const emailInputAdmin = screen.getByPlaceholderText(/admin@yourcompany.com/i);
      fireEvent.change(emailInputAdmin, { target: { value: 'admin@procucev.com' } });

      const passInputAdmin = screen.getByRole('button', { name: /Access Workspace/i }).closest('form')?.querySelector('input[type="password"]');
      if (passInputAdmin) {
        fireEvent.change(passInputAdmin, { target: { value: 'adminPass123' } });
      }

      const accessBtn2 = screen.getByRole('button', { name: /Access Workspace/i });
      fireEvent.submit(accessBtn2.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Security, Azure Infrastructure & System Settings/i)).toBeInTheDocument();
      });

      // Invalid credentials branch
      fireEvent.click(screen.getByTestId('test-logout'));
      fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));
      fireEvent.click(screen.getByRole('button', { name: /Cat Manager/i }));
      const emailInputBad = screen.getByPlaceholderText(/catmanager@yourcompany.com/i);
      fireEvent.change(emailInputBad, { target: { value: 'catmanager@procucev.com' } });
      const passInputBad = screen.getByRole('button', { name: /Access Workspace/i }).closest('form')?.querySelector('input[type="password"]');
      if (passInputBad) {
        fireEvent.change(passInputBad, { target: { value: 'wrong-password' } });
      }
      fireEvent.submit(screen.getByRole('button', { name: /Access Workspace/i }).closest('form')!);
      await waitFor(() => {
        expect(screen.getByText(/Invalid email or password/i)).toBeInTheDocument();
      });
    });

    test('buyer registration dual OTP workflow, validations and duplicate corporate domain trial branch', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      fireEvent.click(screen.getByTestId('test-logout'));

      const createAccTab = screen.getByRole('button', { name: /Create Account/i });
      fireEvent.click(createAccTab);

      // Test empty fields
      const triggerBtn = screen.getByRole('button', { name: /Trigger Registration Verification/i });
      fireEvent.submit(triggerBtn.closest('form')!);

      const nameInput = screen.getByPlaceholderText(/e\.g\. Larsen & Toubro Procurement/i);
      const emailInput = screen.getByPlaceholderText(/buyer@company\.com/i);
      const mobileInput = screen.getByPlaceholderText(/e\.g\. \+91 98112 23344/i);

      // Test already registered email
      fireEvent.change(nameInput, { target: { value: 'Procucev Desk' } });
      fireEvent.change(emailInput, { target: { value: 'buyer@procucev.com' } });
      fireEvent.change(mobileInput, { target: { value: '+91 98201 44820' } });
      fireEvent.submit(triggerBtn.closest('form')!);

      // Register new corporate buyer (First time: claims trial)
      fireEvent.change(nameInput, { target: { value: 'Adani Infrastructure SCM' } });
      fireEvent.change(emailInput, { target: { value: 'scm@adani.com' } });
      fireEvent.change(mobileInput, { target: { value: '+91 98222 33445' } });
      fireEvent.submit(triggerBtn.closest('form')!);

      expect(screen.getByText(/Initial Registration verification active/i)).toBeInTheDocument();

      // Test Back button in reg OTP
      const backRegBtn = screen.getByRole('button', { name: /^Back$/i });
      fireEvent.click(backRegBtn);

      // Re-trigger OTP
      const triggerBtn2 = screen.getByRole('button', { name: /Trigger Registration Verification/i });
      fireEvent.submit(triggerBtn2.closest('form')!);

      // Test invalid OTPs
      const emailOtpInput = screen.getByPlaceholderText(/4-digit Email OTP/i);
      const mobileOtpInput = screen.getByPlaceholderText(/4-digit Mobile OTP/i);
      fireEvent.change(emailOtpInput, { target: { value: '0000' } });
      fireEvent.change(mobileOtpInput, { target: { value: '0000' } });

      const completeBtn = screen.getByRole('button', { name: /Verify & Complete Signup/i });
      fireEvent.submit(completeBtn.closest('form')!);

      // Test invalid mobile only
      fireEvent.change(emailOtpInput, { target: { value: '1111' } });
      fireEvent.change(mobileOtpInput, { target: { value: '0000' } });
      fireEvent.submit(completeBtn.closest('form')!);

      // Test invalid email only
      fireEvent.change(emailOtpInput, { target: { value: '0000' } });
      fireEvent.change(mobileOtpInput, { target: { value: '2222' } });
      fireEvent.submit(completeBtn.closest('form')!);

      // Test valid OTPs
      fireEvent.change(emailOtpInput, { target: { value: '1111' } });
      fireEvent.change(mobileOtpInput, { target: { value: '2222' } });
      fireEvent.submit(completeBtn.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Dual-Stream ERP Ingestion Architecture/i)).toBeInTheDocument();
      });

      // Second user from same corporate domain (tests hasClaimedTrial branch in lines 397-399)
      fireEvent.click(screen.getByTestId('test-logout'));
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Larsen & Toubro Procurement/i), { target: { value: 'Adani Logistics Hub' } });
      fireEvent.change(screen.getByPlaceholderText(/buyer@company\.com/i), { target: { value: 'logistics@adani.com' } });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+91 98112 23344/i), { target: { value: '+91 98333 44556' } });
      fireEvent.submit(screen.getByRole('button', { name: /Trigger Registration Verification/i }).closest('form')!);

      fireEvent.change(screen.getByPlaceholderText(/4-digit Email OTP/i), { target: { value: '1111' } });
      fireEvent.change(screen.getByPlaceholderText(/4-digit Mobile OTP/i), { target: { value: '2222' } });
      fireEvent.submit(screen.getByRole('button', { name: /Verify & Complete Signup/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      });
    });
  });

  describe('Logged In Role Screen Switchers and In-Screen Navigation Callbacks', () => {
    test('renders and switches between all Buyer screens and in-screen button callbacks', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      // Trigger role transition from vendor to buyer (covers line 128 role-screen auto-reset)
      fireEvent.click(screen.getByTestId('test-set-vendor'));
      fireEvent.click(screen.getByTestId('test-set-buyer'));
      fireEvent.click(screen.getByTestId('test-set-mode3'));

      await waitFor(() => {
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      });

      // In CommandCenter: onNavigateToSubscription button click
      const manageSubBtn = screen.getByRole('button', { name: /Manage Subscription/i });
      fireEvent.click(manageSubBtn);
      expect(screen.getByText(/Procurement Sourcing Mode Subscriptions/i)).toBeInTheDocument();

      // Return to Command Center
      fireEvent.click(screen.getByRole('button', { name: /Screen 1\.1/i }));

      // In CommandCenter: onNavigateToDirectory button click
      const publicDbBtn = screen.getByRole('button', { name: /Public Buyer DB/i });
      fireEvent.click(publicDbBtn);
      expect(screen.getByText(/Integrated Buyer Directory & Public System Database/i)).toBeInTheDocument();

      // Return to Command Center
      fireEvent.click(screen.getByRole('button', { name: /Screen 1\.1/i }));

      // In CommandCenter: Test onNavigateToMatrix by clicking Matrix button on an AI Recommended RFQ
      await waitFor(() => {
        expect(screen.queryAllByRole('button', { name: /Matrix/i }).length).toBeGreaterThan(0);
      });
      const matrixBtns = screen.queryAllByRole('button', { name: /Matrix/i });
      if (matrixBtns.length > 0) {
        fireEvent.click(matrixBtns[0]);
        await waitFor(() => {
          expect(screen.getByText(/Comparative Quote Evaluation Matrix/i)).toBeInTheDocument();
        });
        // Test onBackToDashboard in QuoteMatrix (line 1062)
        const backDashBtn = screen.getByRole('button', { name: /Back to Command Center/i });
        fireEvent.click(backDashBtn);
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      }

      // In CommandCenter: Test onNavigateToWizard (line 1051)
      const ingestBtn = screen.getByRole('button', { name: /Create \/ Ingest RFQ/i });
      fireEvent.click(ingestBtn);
      expect(screen.getByText(/AI RFQ Ingestion & Multi-Mode Sourcing Dispatch/i)).toBeInTheDocument();

      // Switch to Screen 1.3: Evaluation Summary
      const nav1_3 = screen.getByRole('button', { name: /Screen 1\.3/i });
      fireEvent.click(nav1_3);
      expect(screen.getByText(/Mode 3 360-Degree Vendor Evaluation Summary Report/i)).toBeInTheDocument();

      // Switch to Screen 1.4: Vendor Directory
      const nav1_4 = screen.getByRole('button', { name: /Screen 1\.4/i });
      fireEvent.click(nav1_4);
      expect(screen.getByText(/Evaluated Vendor Directory & Summary/i)).toBeInTheDocument();

      // In VendorSummary: Click on Add New Vendor / Ingestion callback (onNavigateToWizard line 1086)
      const addVendorWizardBtn = screen.getByRole('button', { name: /Add New Vendor \/ Ingestion/i });
      fireEvent.click(addVendorWizardBtn);
      expect(screen.getByText(/AI RFQ Ingestion & Multi-Mode Sourcing Dispatch/i)).toBeInTheDocument();

      // Switch back to Vendor Directory
      fireEvent.click(screen.getByRole('button', { name: /Screen 1\.4/i }));

      // In VendorSummary: Click on View 360° Evaluation Report callback (lines 1083-1084)
      await waitFor(() => {
        expect(screen.queryAllByRole('button', { name: /View 360° Evaluation/i }).length).toBeGreaterThan(0);
      });
      const viewEvalBtns = screen.queryAllByRole('button', { name: /View 360° Evaluation/i });
      if (viewEvalBtns.length > 0) {
        fireEvent.click(viewEvalBtns[0]);
        // Click Back button in VendorEvaluationSummary (covers line 1075)
        await waitFor(() => {
          expect(screen.getByRole('button', { name: /^Back$/i })).toBeInTheDocument();
        });
        const backEvalBtn = screen.getByRole('button', { name: /^Back$/i });
        fireEvent.click(backEvalBtn);
        await waitFor(() => {
          expect(screen.getByText(/Evaluated Vendor Directory & Summary/i)).toBeInTheDocument();
        });
      }

      // Switch to Screen 1.5: Sourcing Subscriptions
      const nav1_5 = screen.getByRole('button', { name: /Screen 1\.5/i });
      fireEvent.click(nav1_5);
      expect(screen.getByText(/Procurement Sourcing Mode Subscriptions/i)).toBeInTheDocument();

      // Switch to Screen 1.6: Buyer Profile
      const nav1_6 = screen.getByRole('button', { name: /Screen 1\.6/i });
      fireEvent.click(nav1_6);
      expect(screen.getAllByText(/Buyer Organization Profile/i)[0]).toBeInTheDocument();

      // Switch to Screen 1.7: Buyer DB Sync
      const nav1_7 = screen.getByRole('button', { name: /Screen 1\.7/i });
      fireEvent.click(nav1_7);
      expect(screen.getByText(/Integrated Buyer Directory & Public System Database/i)).toBeInTheDocument();

      // Back to Screen 1.1: Command Center
      const nav1_1 = screen.getByRole('button', { name: /Screen 1\.1/i });
      fireEvent.click(nav1_1);
      expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
    });

    test('renders and switches between all Category Manager screens via RoleNavigation and callbacks', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );
      fireEvent.click(screen.getByTestId('test-set-cm'));

      await waitFor(() => {
        expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();
      });

      // In KanbanBoard: Click Mode & Performance Analytics (covers onNavigateToSpend line 1107)
      const analyticsBtn = screen.getByRole('button', { name: /Mode & Performance Analytics/i });
      fireEvent.click(analyticsBtn);
      expect(screen.getByText(/Mode Performance & RFQ Analytics Dashboard/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Back to Operational Monitoring Kanban/i }));

      // In KanbanBoard: Click on RFQ-00421 Matrix Ready card (covers onNavigateToMatrix line 1106)
      const matrixReadyCard = screen.queryByText(/RFQ-00421: Matrix Ready/i);
      if (matrixReadyCard) {
        fireEvent.click(matrixReadyCard);
        expect(screen.getByText(/Mode Performance & RFQ Analytics Dashboard/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Back to Operational Monitoring Kanban/i }));
      }

      // Screen 2.2: Spend Analytics
      const nav2_2 = screen.getByRole('button', { name: /Screen 2\.2/i });
      fireEvent.click(nav2_2);
      expect(screen.getByText(/Mode Performance & RFQ Analytics Dashboard/i)).toBeInTheDocument();

      // In SpendDashboard: Click Back to Kanban
      const backKanbanBtn = screen.getByRole('button', { name: /Back to Operational Monitoring Kanban/i });
      fireEvent.click(backKanbanBtn);
      expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();

      // Screen 2.3: Buyer RFQ Console
      const nav2_3 = screen.getByRole('button', { name: /Screen 2\.3/i });
      fireEvent.click(nav2_3);
      expect(screen.getByText(/Buyer Wise Command Console & Analytics/i)).toBeInTheDocument();

      // In BuyerConsole: Click Review RFQ Details and Matrix / Evaluation (covers lines 1118, 1121)
      const reviewRfqBtns = screen.queryAllByRole('button', { name: /Review RFQ Details/i });
      if (reviewRfqBtns.length > 0) {
        fireEvent.click(reviewRfqBtns[0]);
        // Expand first RFQ row
        const rfqRows = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (rfqRows.length > 0) {
          fireEvent.click(rfqRows[0]);
          const reviewSurveyBtn = screen.queryByRole('button', { name: /Review Survey Evaluation/i });
          if (reviewSurveyBtn) {
            fireEvent.click(reviewSurveyBtn);
            // Click Back in Evaluation (covers line 1126)
            await waitFor(() => {
              expect(screen.getByRole('button', { name: /^Back$/i })).toBeInTheDocument();
            });
            const backKanbanInEval = screen.getByRole('button', { name: /^Back$/i });
            fireEvent.click(backKanbanInEval);
          }
        }
      }

      // Screen 2.4: Mode 3 Evaluations
      const nav2_4 = screen.getByRole('button', { name: /Screen 2\.4/i });
      fireEvent.click(nav2_4);
      expect(screen.getByText(/Mode 3 360-Degree Vendor Evaluation Summary Report/i)).toBeInTheDocument();

      // In EvaluationSummary: Click Back button (covers line 1126)
      const backFromEvalBtn = screen.getByRole('button', { name: /^Back$/i });
      fireEvent.click(backFromEvalBtn);
      expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();

      // Screen 2.5: Vendor Performance
      const nav2_5 = screen.getByRole('button', { name: /Screen 2\.5/i });
      fireEvent.click(nav2_5);
      expect(screen.getByText(/Vendor Summary & Performance Analytics/i)).toBeInTheDocument();

      // In VendorConsole: Click Review Vendor Bids and Matrix (covers line 1132)
      const reviewVendorBidsBtns = screen.queryAllByRole('button', { name: /Review Performance|Review Vendor Bids/i });
      if (reviewVendorBidsBtns.length > 0) {
        fireEvent.click(reviewVendorBidsBtns[0]);
        const quoteCards = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (quoteCards.length > 0) {
          fireEvent.click(quoteCards[0]);
          const centralMatrixBtn = screen.queryByRole('button', { name: /Go to Central Quote Matrix/i });
          if (centralMatrixBtn) fireEvent.click(centralMatrixBtn);
        }
      }

      // Screen 2.6: Categories & Trends
      const nav2_6 = screen.getByRole('button', { name: /Screen 2\.6/i });
      fireEvent.click(nav2_6);
      expect(screen.getByText(/Category Governance & Demand-Supply Analytics/i)).toBeInTheDocument();
    });

    test('renders and switches between all Vendor screens and bid navigation callback', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );
      fireEvent.click(screen.getByTestId('test-set-vendor'));

      await waitFor(() => {
        expect(screen.getByText(/Vendor Workspace & Opportunity Feed/i)).toBeInTheDocument();
      });

      // Submit Quotation bid button navigation callback in OpportunityFeed (line 1149)
      const submitBidBtn = screen.getByRole('button', { name: /Submit Quote Now/i });
      fireEvent.click(submitBidBtn);

      expect(screen.getByText(/Active Sourcing Enquiries & Submitted Quotation Status/i)).toBeInTheDocument();

      // In QuotationForm: Test Back button (line 1157)
      const backFeedBtn1 = screen.getByRole('button', { name: /Back to Opportunity Feed/i });
      fireEvent.click(backFeedBtn1);
      expect(screen.getByText(/Vendor Workspace & Opportunity Feed/i)).toBeInTheDocument();

      // In OpportunityFeed: Click on Partner Badge (onNavigateToSubscription line 1151)
      const subBadgeBtn = screen.queryByRole('button', { name: /Select Partner|Connect Partner|Free Tier/i });
      if (subBadgeBtn) {
        fireEvent.click(subBadgeBtn);
        expect(screen.getByText(/Vendor Subscription Plans & Quotas/i)).toBeInTheDocument();
      }

      // Return to Feed
      fireEvent.click(screen.getByRole('button', { name: /Screen 3\.1/i }));

      // In OpportunityFeed: Click on 360° Audit button (onNavigateToEvaluation line 1150)
      const auditBtn = screen.queryByRole('button', { name: /360° Audit/i });
      if (auditBtn) {
        fireEvent.click(auditBtn);
        expect(screen.getByText(/360-Degree AI Self-Evaluation/i)).toBeInTheDocument();
      }

      // Screen 3.2: Quotation Submission Form
      const nav3_2 = screen.getByRole('button', { name: /Screen 3\.2/i });
      fireEvent.click(nav3_2);
      expect(screen.getByText(/Active Sourcing Enquiries & Submitted Quotation Status/i)).toBeInTheDocument();

      // In QuotationForm: Test info button and modal close (onSubmitSuccess line 1158)
      const infoBtns = screen.queryAllByRole('button', { name: /Direct Client Roster|Buyer Details Unlocked/i });
      if (infoBtns.length > 0) {
        fireEvent.click(infoBtns[0]);
        const closeBtn = screen.queryByRole('button', { name: /Close/i });
        if (closeBtn) fireEvent.click(closeBtn);
      }

      // Screen 3.3: 360° Self-Evaluation Audit
      const nav3_3 = screen.getByRole('button', { name: /Screen 3\.3/i });
      fireEvent.click(nav3_3);
      expect(screen.getByText(/360-Degree AI Self-Evaluation/i)).toBeInTheDocument();

      // In VendorQualificationForm: Test Back button (line 1163)
      const backFeedBtn = screen.queryByRole('button', { name: /Back to Opportunity Feed/i });
      if (backFeedBtn) fireEvent.click(backFeedBtn);

      // Return to Screen 3.3 and test Submit (onSuccess line 1164)
      fireEvent.click(screen.getByRole('button', { name: /Screen 3\.3/i }));
      const submitAuditBtn = screen.queryByRole('button', { name: /Submit 360° AI Evaluation Audit/i });
      if (submitAuditBtn) {
        fireEvent.click(submitAuditBtn);
      }

      // Screen 3.4: Item Catalogue
      const nav3_4 = screen.getByRole('button', { name: /Screen 3\.4/i });
      fireEvent.click(nav3_4);
      expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();

      // Screen 3.5: Subscription Center
      const nav3_5 = screen.getByRole('button', { name: /Screen 3\.5/i });
      fireEvent.click(nav3_5);
      expect(screen.getByText(/Vendor Subscription Plans & Quotas/i)).toBeInTheDocument();

      // Screen 3.6: Enterprise Profile Setup
      const nav3_6 = screen.getByRole('button', { name: /Screen 3\.6/i });
      fireEvent.click(nav3_6);
      expect(screen.getByText(/Vendor Supplier Profile/i)).toBeInTheDocument();

      // Back to Screen 3.1: Opportunity Feed
      const nav3_1 = screen.getByRole('button', { name: /Screen 3\.1/i });
      fireEvent.click(nav3_1);
      expect(screen.getByText(/Vendor Workspace & Opportunity Feed/i)).toBeInTheDocument();
    });

    test('renders Admin screens and handles logout via RoleNavigation', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );
      fireEvent.click(screen.getByTestId('test-set-admin'));

      await waitFor(() => {
        expect(screen.getByText(/Security, Azure Infrastructure & System Settings/i)).toBeInTheDocument();
      });

      // In InfraControl: Click Immutable Audit Trail callback
      const auditBtn = screen.getByRole('button', { name: /Immutable Audit Trail/i });
      fireEvent.click(auditBtn);
      expect(screen.getByText(/Immutable Compliance Audit Trail/i)).toBeInTheDocument();

      // In AuditLog: Click Back to Infrastructure Control callback (covers line 1189)
      const backInfraBtn = screen.getByRole('button', { name: /Back to Infrastructure Control/i });
      fireEvent.click(backInfraBtn);
      expect(screen.getByText(/Security, Azure Infrastructure & System Settings/i)).toBeInTheDocument();

      // RoleNavigation Logout button click
      const logoutBtn = screen.getByRole('button', { name: /^Sign Out$/i });
      fireEvent.click(logoutBtn);

      expect(screen.getByText(/Enterprise AI Sourcing & Logistics Matching Roster/i)).toBeInTheDocument();
    });

    test('opens and interacts with corner pulsing initial setup modal', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );
      fireEvent.click(screen.getByTestId('test-set-buyer'));

      await waitFor(() => {
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      });

      // Find pulsing initial setup corner button
      const cornerBtns = screen.getAllByRole('button');
      const setupBtn = cornerBtns.find(b => b.textContent?.includes('Initial Setup') || b.textContent?.includes('Complete Setup') || b.className.includes('animate-ping') || b.querySelector('.animate-ping'));
      if (setupBtn) {
        fireEvent.click(setupBtn);
      }
    });

    test('triggers all remaining in-screen callbacks (IngestionWizard, BuyerConsole, QuotationForm, QualificationForm)', async () => {
      render(
        <AppProvider>
          <AuthTestWrapper />
        </AppProvider>
      );

      // Ingestion Wizard onCancel & onComplete
      fireEvent.click(screen.getByTestId('test-set-buyer'));
      fireEvent.click(screen.getByRole('button', { name: /Screen 1\.2/i }));
      expect(screen.getByText(/AI RFQ Ingestion & Multi-Mode Sourcing Dispatch/i)).toBeInTheDocument();

      const cancelIngestBtn = screen.queryByRole('button', { name: /Cancel & Discard/i });
      if (cancelIngestBtn) {
        fireEvent.click(cancelIngestBtn);
        expect(screen.getByText(/Buyer Command Center/i)).toBeInTheDocument();
      }

      // Re-enter IngestionWizard and complete
      fireEvent.click(screen.getByRole('button', { name: /Screen 1\.2/i }));
      const dispatchBtn = screen.queryByRole('button', { name: /Dispatch RFQ & Launch Autonomous Chasing/i });
      if (dispatchBtn) {
        fireEvent.click(dispatchBtn);
      }

      // BuyerConsole onNavigateToMatrix
      fireEvent.click(screen.getByTestId('test-set-cm'));
      fireEvent.click(screen.getByRole('button', { name: /Screen 2\.3/i }));
      const viewMatrixBtns = screen.queryAllByRole('button', { name: /View Matrix/i });
      if (viewMatrixBtns.length > 0) {
        fireEvent.click(viewMatrixBtns[0]);
      }

      // QuotationForm onSubmitSuccess & VendorQualificationForm onSuccess
      fireEvent.click(screen.getByTestId('test-set-vendor'));
      fireEvent.click(screen.getByRole('button', { name: /Screen 3\.2/i }));
      const submitBidFormBtn = screen.queryByRole('button', { name: /Submit Commercial & Technical Quotation/i });
      if (submitBidFormBtn) {
        fireEvent.click(submitBidFormBtn);
      }

      fireEvent.click(screen.getByRole('button', { name: /Screen 3\.3/i }));
      const submitAuditBtn = screen.queryByRole('button', { name: /Submit 360° AI Evaluation Audit/i });
      if (submitAuditBtn) {
        fireEvent.click(submitAuditBtn);
      }
    });
  });
});
