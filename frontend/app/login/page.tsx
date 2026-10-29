'use client';

import React, { useEffect, useLayoutEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp, clearSessionCache } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { OTP_CODE_LENGTH, OTP_EXPIRY_MINUTES, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  FORM_SCHEMAS,
  INDIAN_MOBILE_PATTERN,
  validateFormData,
  validatePincode,
  PostOfficeDetail,
  PINCODE_PATTERN,
  isDummyPincode,
} from '@/lib/validationSchemas';
import PasswordInput from '@/app/components/PasswordInput';
import type { UserSession } from '@/lib/types';
import {
  Building2,
  Truck,
  Mail,
  Phone,
  ArrowRight,
  Zap,
  Layers,
  ShieldCheck,
  Users,
  RotateCcw,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';

const AUTH = UI_STRINGS.auth;
const MIN_PASSWORD_LENGTH = 8;
/** Inline so it always wins over any global input padding rule. */
const ICON_PAD: React.CSSProperties = { paddingLeft: 40 };

function sanitizeRedirect(url: string | null | undefined): string {
  if (!url || typeof url !== 'string' || !url.startsWith('/')) return '';
  if (url === '/buyer/rfqs' || url.startsWith('/buyer/rfqs?')) {
    return url.replace('/buyer/rfqs', '/buyer/rfq-summary');
  }
  return url;
}

/** Steps shown in the "Automated from PR to Comparison" strip. */
const PIPELINE_STEPS = [
  { n: 1, title: 'Purchase Requisition', sub: 'Raised by your team' },
  { n: 2, title: 'RFQ to Vendors', sub: 'Triggered from one email' },
  { n: 3, title: 'Quotes Captured', sub: 'OCR from vendor emails' },
  { n: 4, title: 'Comparison', sub: 'Ready to review', highlight: true },
];

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hookRedirect = searchParams?.get('redirect') || searchParams?.get('returnUrl');
  let windowRedirect: string | null = null;
  if (typeof window !== 'undefined' && window.location?.search) {
    try {
      const sp = new URLSearchParams(window.location.search);
      windowRedirect = sp.get('redirect') || sp.get('returnUrl');
    } catch {
      windowRedirect = null;
    }
  }
  const redirectParam = sanitizeRedirect(hookRedirect || windowRedirect);
  const {
    isLoggedIn,
    currentRole,
    currentUserSession,
    setCurrentRole,
    setIsLoggedIn,
    setCurrentUserSession,
    showToast,
    setRemainingFreeRFQs,
    setActiveSubscription,
    setInitialSetupModalOpen,
    initialSetupCompleted,
    addBuyerAccount,
    refreshFromDB,
  } = useApp();

  // ── Measure the real header height so the page fills exactly the remaining viewport ──
  const [headerH, setHeaderH] = useState(74);

  useLayoutEffect(() => {
    const measure = () => {
      // Change this selector if your header is not a <header> tag (e.g. '[data-app-header]').
      const h = document.querySelector('header')?.getBoundingClientRect().height;
      if (h) setHeaderH(Math.round(h));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);

  // Credentials are authenticated server-side; email is pre-filled only if explicitly supplied via deep-link (e.g. from WhatsApp/SMS alerts).
  const emailQuery = searchParams?.get('email') || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('email') : null);
  const emailFromRedirect = (() => {
    try {
      if (redirectParam && redirectParam.includes('email=')) {
        const qIdx = redirectParam.indexOf('?');
        if (qIdx !== -1) {
          const sp = new URLSearchParams(redirectParam.slice(qIdx));
          return sp.get('email');
        }
      }
    } catch {}
    return null;
  })();
  const initialEmail = (emailQuery || emailFromRedirect || '').trim();

  const [loginEmail, setLoginEmail] = useState(initialEmail);

  useEffect(() => {
    if (initialEmail && !loginEmail) {
      setLoginEmail(initialEmail);
    }
  }, [initialEmail]);

  const [loginMobile, setLoginMobile] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  // Single Sign In tab's auth method switcher, used identically by every role —
  // the role comes from the account record after authentication.
  const [loginAuthMode, setLoginAuthMode] = useState<'password' | 'email_otp'>('password');
  const [loginOtpSent, setLoginOtpSent] = useState(false);
  const [loginOtpInput, setLoginOtpInput] = useState('');

  const [regName, setRegName] = useState('');
  const [regOrgName, setRegOrgName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regGstin, setRegGstin] = useState('');
  const [regCity, setRegCity] = useState('');
  const [regState, setRegState] = useState('');
  const [regPincode, setRegPincode] = useState('');
  const [regPincodeError, setRegPincodeError] = useState<string | null>(null);
  const [regPincodeValidating, setRegPincodeValidating] = useState(false);
  const [regPincodePostOffices, setRegPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const regPincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const raw = regPincode.trim();
    if (regPincodeDebounceRef.current) clearTimeout(regPincodeDebounceRef.current);
    if (!raw) {
      setRegPincodeError(null);
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setRegPincodeError('Invalid or dummy PIN code');
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setRegPincodeError('Invalid PIN code format');
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
      return;
    }
    if (/^\d{6}$/.test(raw)) {
      setRegPincodeValidating(true);
      regPincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(raw);
          if (!res.isValid) {
            setRegPincodeError(res.message || 'Invalid PIN code');
            setRegPincodePostOffices([]);
          } else {
            setRegPincodeError(null);
            const pos = res.postOffices || [];
            setRegPincodePostOffices(pos);
            if (pos.length > 0) {
              const primaryPo = pos[0];
              const matchedCity = primaryPo.District || primaryPo.Division || primaryPo.Name || '';
              const matchedState = primaryPo.State || '';
              if (matchedCity) setRegCity(matchedCity);
              if (matchedState) setRegState(matchedState);
            }
          }
        } catch {
          setRegPincodeError(null);
        } finally {
          setRegPincodeValidating(false);
        }
      }, 350);
    } else {
      setRegPincodeError(null);
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
    }
  }, [regPincode]);
  const [selectedRegRole, setSelectedRegRole] = useState<'buyer' | 'vendor'>('buyer');
  const [regStep, setRegStep] = useState<'form' | 'dual_otp'>('form');
  const [regEmailOtp, setRegEmailOtp] = useState('');
  const [regMobileOtp, setRegMobileOtp] = useState('');

  // Someone already signed in should not sit on the sign-in screen.
  useEffect(() => {
    if (isLoggedIn) {
      const targetRoute =
        redirectParam && redirectParam.startsWith('/')
          ? redirectParam
          : ROLE_LANDING_ROUTE[currentRole] || ROLE_LANDING_ROUTE.buyer;

      const destination =
        currentUserSession?.role === 'vendor' && currentUserSession.passwordChangeRequired
          ? (redirectParam ? `/vendor-first-login?redirect=${encodeURIComponent(targetRoute)}` : '/vendor-first-login')
          : currentUserSession?.role === 'buyer' && (currentUserSession.passwordChangeRequired || currentUserSession.onboardingRequired)
          ? (redirectParam ? `/buyer-first-login?redirect=${encodeURIComponent(targetRoute)}` : '/buyer-first-login')
          : targetRoute;
      router.replace(destination);
    }
  }, [isLoggedIn, currentRole, currentUserSession, router, redirectParam]);

  /**
   * Commit a verified session and route to the landing screen for its role.
   * The role always comes from the account record, never the UI selection.
   */
  const establishSession = (user: UserSession) => {
    clearSessionCache();
    setCurrentUserSession(user);
    setIsLoggedIn(true);
    setCurrentRole(user.role);
    if (typeof refreshFromDB === 'function') {
      void refreshFromDB();
    }
    showToast(
      AUTH.welcomeBackTitle,
      formatString(AUTH.signedInAs, {
        userName: user.name,
        userRole: user.role,
        orgName: user.orgName || '',
      }),
      'success'
    );
    const targetRoute =
      redirectParam && redirectParam.startsWith('/')
        ? redirectParam
        : ROLE_LANDING_ROUTE[user.role] || ROLE_LANDING_ROUTE.buyer;

    router.replace(
      user.role === 'vendor' && user.passwordChangeRequired
        ? (redirectParam ? `/vendor-first-login?redirect=${encodeURIComponent(targetRoute)}` : '/vendor-first-login')
        : user.role === 'buyer' && (user.passwordChangeRequired || user.onboardingRequired)
        ? (redirectParam ? `/buyer-first-login?redirect=${encodeURIComponent(targetRoute)}` : '/buyer-first-login')
        : targetRoute
    );
  };

  const fail = (title: string, error?: string) => showToast(title, error || AUTH.serverErrorFallback, 'warning');

  // ── Password sign-in (all roles) ───────────────────────────────────────────
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const email = loginEmail.trim();
    const mobile = loginMobile.trim();

    if (!email || !mobile || !loginPassword) {
      showToast(AUTH.missingFieldsTitle, AUTH.loginFieldsRequired, 'warning');
      return;
    }

    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.loginForm, {
      email,
      mobile,
      password: loginPassword,
    });
    if (!isValid) {
      showToast(AUTH.signInFailedTitle, Object.values(fieldErrors)[0], 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authClient.loginWithPassword(email.toLowerCase(), loginPassword, mobile);
      if (response.success && response.user) {
        if (response.user.role === 'buyer' && !initialSetupCompleted && !redirectParam) {
          setInitialSetupModalOpen(true);
        }
        establishSession(response.user);
      } else {
        fail(AUTH.signInFailedTitle, response.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Email OTP sign-in ──────────────────────────────────────────────────────
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    const rawMobile = loginMobile.trim();
    const mobile = rawMobile.replace(/[\s\-()]/g, '');

    if (!loginEmail.trim() || !mobile) {
      showToast(AUTH.missingFieldsTitle, AUTH.emailAndMobileRequired, 'warning');
      return;
    }
    if (!INDIAN_MOBILE_PATTERN.test(mobile)) {
      showToast(AUTH.otpRequestFailedTitle, AUTH.mobileInvalid, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const email = loginEmail.trim().toLowerCase();
      const response = await authClient.requestOtp(email, mobile);
      if (!response.success) {
        fail(AUTH.otpRequestFailedTitle, response.error);
        return;
      }
      setLoginOtpInput(response.demoCode || '');
      setLoginOtpSent(true);
      showToast(
        AUTH.welcomeBackTitle,
        formatString(AUTH.otpDispatched, {
          email,
          codeLength: OTP_CODE_LENGTH,
          expiryMinutes: OTP_EXPIRY_MINUTES,
        }) + (response.demoCode ? ` (Dev OTP: ${response.demoCode})` : ''),
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendLoginOtp = async () => {
    if (submitting) return;
    const email = loginEmail.trim().toLowerCase();
    const mobile = loginMobile.trim().replace(/[\s\-()]/g, '');
    if (!email || !mobile) {
      showToast(AUTH.missingFieldsTitle, AUTH.emailAndMobileRequired, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const response = await authClient.requestOtp(email, mobile);
      if (!response.success) {
        fail(AUTH.otpRequestFailedTitle, response.error);
        return;
      }
      if (response.demoCode) {
        setLoginOtpInput(response.demoCode);
      }
      showToast(
        'OTP Resent',
        `Fresh verification code dispatched to ${email}` + (response.demoCode ? ` (Dev OTP: ${response.demoCode})` : ''),
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loginOtpInput.trim().length !== OTP_CODE_LENGTH) {
      showToast(AUTH.otpInvalidTitle, AUTH.otpRequired, 'warning');
      return;
    }

    const rawMobile = loginMobile.trim();
    const mobile = rawMobile.replace(/[\s\-()]/g, '');

    setSubmitting(true);
    try {
      const response = await authClient.verifyOtp(
        loginEmail.trim().toLowerCase(),
        loginOtpInput.trim(),
        mobile
      );
      if (response.success && response.user) {
        if (response.user.role === 'buyer' && !initialSetupCompleted && !redirectParam) {
          setInitialSetupModalOpen(true);
        }
        establishSession(response.user);
      } else {
        fail(AUTH.otpInvalidTitle, response.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Registration: Step 1 Validate details & request OTPs ──────────────────
  const handleInitiateRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    const rawMobile = regMobile.trim();
    const mobile = rawMobile.replace(/[\s\-()]/g, '');

    if (
      !regName.trim() ||
      !regOrgName.trim() ||
      !regEmail.trim() ||
      !mobile ||
      !regPassword ||
      !regGstin.trim() ||
      !regCity.trim() ||
      !regState.trim() ||
      !regPincode.trim()
    ) {
      showToast(AUTH.missingFieldsTitle, 'Please fill in all mandatory fields including Company Name, GSTIN, City, State, and Pincode.', 'warning');
      return;
    }
    if (regPassword.length < MIN_PASSWORD_LENGTH) {
      showToast(AUTH.registrationFailedTitle, AUTH.passwordTooShort, 'warning');
      return;
    }
    if (!INDIAN_MOBILE_PATTERN.test(mobile)) {
      showToast(AUTH.registrationFailedTitle, AUTH.mobileInvalid, 'warning');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(regPincode.trim())) {
      showToast(AUTH.registrationFailedTitle, 'PIN Code must be 6 digits and cannot start with 0.', 'warning');
      return;
    }
    if (regPincodeError) {
      showToast(AUTH.registrationFailedTitle, regPincodeError, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const email = regEmail.trim().toLowerCase();
      const response = await authClient.requestOtp(email, mobile, selectedRegRole, true);

      if (!response.success) {
        fail(AUTH.registrationFailedTitle, response.error);
        return;
      }

      setRegStep('dual_otp');
      setRegEmailOtp(response.demoEmailCode || response.demoCode || '');
      setRegMobileOtp(response.demoMobileCode || response.demoCode || '');
      showToast(
        'Verification Codes Sent',
        `6-digit OTPs have been dispatched to ${email} (Email OTP) and mobile +91 ${mobile} (SMS OTP).`,
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendRegOtp = async () => {
    if (submitting) return;
    const email = regEmail.trim().toLowerCase();
    const mobile = regMobile.trim().replace(/[\s\-()]/g, '');
    if (!email || !mobile) {
      showToast(AUTH.missingFieldsTitle, AUTH.registrationFieldsRequired, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const response = await authClient.requestOtp(email, mobile, selectedRegRole, true);
      if (!response.success) {
        fail(AUTH.registrationFailedTitle, response.error);
        return;
      }
      if (response.demoEmailCode || response.demoCode) {
        setRegEmailOtp(response.demoEmailCode || response.demoCode || '');
      }
      if (response.demoMobileCode || response.demoCode) {
        setRegMobileOtp(response.demoMobileCode || response.demoCode || '');
      }
      showToast(
        'OTPs Resent',
        `Fresh separate 6-digit OTPs sent to ${email} and +91 ${mobile}.`,
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Registration: Step 2 Verify Both Email OTP & Mobile OTP and create account ──────────
  const handleVerifyAndCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailOtp = regEmailOtp.trim();
    const mobileOtp = regMobileOtp.trim();

    if (emailOtp.length !== OTP_CODE_LENGTH || mobileOtp.length !== OTP_CODE_LENGTH) {
      showToast('Both OTPs Required', 'Please enter both the 6-digit Email OTP and the 6-digit Mobile SMS OTP.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const email = regEmail.trim().toLowerCase();
      const cleanGstin = regGstin.trim().toUpperCase();
      const derivedPan = cleanGstin.length === 15 ? cleanGstin.slice(2, 12) : '';
      const cleanCity = regCity.trim();
      const cleanState = regState.trim();
      const cleanPincode = regPincode.trim();
      const plantLocation = `${cleanCity}, ${cleanState} (${cleanPincode})`;

      const response = await authClient.register({
        name: regName.trim(),
        email,
        password: regPassword,
        mobile: regMobile.trim(),
        role: selectedRegRole,
        orgName: regOrgName.trim() || regName.trim(),
        city: cleanCity,
        state: cleanState,
        pincode: cleanPincode,
        country: 'India',
        gstin: cleanGstin,
        pan: derivedPan,
        emailOtp,
        mobileOtp,
        code: mobileOtp || emailOtp,
      });

      if (!response.success || !response.user) {
        fail(AUTH.registrationFailedTitle, response.error);
        return;
      }

      if (selectedRegRole === 'buyer') {
        addBuyerAccount({
          organizationName: regOrgName.trim() || response.user.orgName || regName.trim(),
          brandName: regOrgName.trim() || regName.trim(),
          corporateEmail: email,
          contactPerson: regName.trim(),
          contactDesignation: 'Procurement Specialist',
          mobileNumber: regMobile.trim(),
          gstin: cleanGstin,
          pan: derivedPan,
          city: cleanCity,
          state: cleanState,
          pincode: cleanPincode,
          zip_code: cleanPincode,
          country: 'India',
          primaryPlantLocation: plantLocation,
          industrySector: 'Enterprise SCM & Manufacturing',
          sourcingMode: 'mode_2',
          subscriptionPlan: 'free_trial',
          remainingFreeRFQs: 5,
          accountSource: 'web_registration',
          status: 'ACTIVE_VERIFIED',
          supportedMajorCategories: [],
          supportedMinorCategories: [],
          totalRFQsCreated: 0,
          totalSpend: '₹0',
        });

        setActiveSubscription('free_trial');
        setRemainingFreeRFQs(5);
        setInitialSetupModalOpen(true);
      } else if (selectedRegRole === 'vendor') {
        if (typeof refreshFromDB === 'function') {
          void refreshFromDB();
        }
      }

      showToast(
        AUTH.registrationSuccessTitle,
        formatString(AUTH.registrationSuccessMessage, { email }),
        'success'
      );
      establishSession(response.user);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Shared style tokens ────────────────────────────────────────────────────
  const fieldLabel =
    'block text-[10px] font-bold text-[#1E293B] dark:text-gray-300 uppercase tracking-wider mb-0.5';
  const inputBase =
    'text-xs border border-slate-200 dark:border-gray-700 rounded-xl w-full text-slate-800 dark:text-white bg-white dark:bg-gray-800 placeholder:text-slate-500 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#1D5BD8] transition-all';
  const fieldInput = `${inputBase} px-3 py-[clamp(6px,1.2dvh,12px)]`;
  const iconFieldInput = `${inputBase} pl-9 pr-3 py-[clamp(6px,1.2dvh,12px)]`;
  const plainInput = `${inputBase} px-3 py-[clamp(6px,1.2dvh,12px)]`;
  const otpInput = `${inputBase} px-3 py-[clamp(6px,1.2dvh,12px)] font-mono font-bold tracking-widest text-center`;
  const otpIconInput = `${inputBase} pl-9 pr-9 py-[clamp(6px,1.2dvh,12px)] font-mono font-bold tracking-widest text-center`;
  const primaryBtn =
    'w-full text-xs sm:text-sm font-bold py-[clamp(8px,1.4dvh,14px)] px-4 rounded-xl text-white bg-gradient-to-r from-[#1546A5] to-[#2468DC] hover:brightness-110 shadow-md shadow-blue-700/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all';
  const iconClass = 'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none';
  const helperText = 'text-[9.5px] leading-tight text-slate-500 dark:text-gray-400 italic block mt-0.5';

  const otpModeActive = loginAuthMode === 'email_otp';

  const tabClass = (active: boolean) =>
    `pb-1.5 -mb-px text-[13px] sm:text-sm border-b-2 transition-all ${
      active
        ? 'font-bold text-[#0B1B3D] dark:text-white border-[#1D5BD8]'
        : 'font-semibold text-slate-500 dark:text-gray-500 border-transparent hover:text-slate-700 dark:hover:text-gray-300'
    }`;

  const modeClass = (active: boolean) =>
    `flex-1 py-1 rounded-lg text-xs leading-4 transition-all flex items-center justify-center ${
      active
        ? 'bg-white dark:bg-gray-900 text-[#0B1B3D] dark:text-white font-bold shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
        : 'text-slate-600 dark:text-gray-400 font-semibold hover:text-slate-800'
    }`;

  return (
    <div
      className="login-root w-full bg-[#F0F4FA] dark:bg-[#070B14] flex flex-col overflow-x-hidden lg:overflow-hidden"
      style={{ ['--hdr' as any]: `${headerH}px` }}
    >
      <style>{`
        .login-root { min-height: calc(100dvh - var(--hdr)); }
        @media (min-width: 1024px) { .login-root { height: calc(100dvh - var(--hdr)); } }
        /* Spacing that grows with viewport height so content fills the space between header and banner. */
        .fluid-stack > * + * { margin-top: clamp(6px, 1.5dvh, 18px); }
        .fluid-stack-sm > * + * { margin-top: clamp(6px, 1.1dvh, 14px); }
        /* Hide scrollbars on this page; scrolling still works. */
        html, body, .login-root, .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        html::-webkit-scrollbar, body::-webkit-scrollbar,
        .login-root::-webkit-scrollbar, .no-scrollbar::-webkit-scrollbar { display: none; width: 0; height: 0; }
      `}</style>

      {/* ── Main Hero Section: fills all free space, content centered, no extra top/bottom gap ── */}
      <div className="flex-1 min-h-0 flex">
        <div className="max-w-[1280px] mx-auto w-full lg:h-full px-4 sm:px-6 lg:px-10 xl:px-16 py-[clamp(8px,2.5dvh,36px)] flex flex-col lg:flex-row lg:items-stretch justify-between gap-5 lg:gap-10 xl:gap-12">

          {/* ── Left Column: three groups, spaced cleanly ── */}
          <div className="order-2 lg:order-1 flex-1 min-w-0 w-full lg:max-w-[680px] flex flex-col gap-4 lg:gap-[clamp(16px,3.2dvh,36px)] lg:justify-center">
            {/* Group 1: kicker + heading */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-4 h-[2px] bg-[#1D5BD8] rounded-full inline-block shrink-0" />
                <span className="text-[10px] sm:text-[11px] lg:text-[clamp(11px,1.8dvh,15px)] font-black uppercase tracking-[0.12em] text-[#1D5BD8]">
                  Procurement Automation · PR to Comparison
                </span>
              </div>

              <h1 className="text-[26px] leading-[1.12] sm:text-3xl lg:text-[clamp(32px,6.6dvh,68px)] font-black tracking-tight text-[#0B1B3D] dark:text-white">
                Your procurement starts <br className="hidden sm:inline" />
                with a <span className="text-[#1D5BD8]">simple email.</span>
              </h1>
            </div>

            {/* Group 2: email CTA + subtext */}
            <div>
              <div className="text-[10px] sm:text-[11px] lg:text-[clamp(11px,1.7dvh,14px)] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.1em] mb-1">
                Email your requirement to
              </div>
              <a
                href="mailto:RFQ@Procucev.com"
                className="inline-flex max-w-full items-center gap-2.5 lg:gap-3 px-3.5 sm:px-4 py-2 sm:py-2.5 lg:px-[clamp(16px,2.6dvh,30px)] lg:py-[clamp(10px,2dvh,20px)] rounded-xl bg-gradient-to-r from-[#0C2E68] via-[#2457D6] to-[#1E90D6] text-white shadow-lg shadow-blue-900/15 hover:brightness-110 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
                title="Click to email your RFQ requirement"
              >
                <Mail className="w-5 h-5 sm:w-5 sm:h-5 lg:w-[clamp(24px,3.8dvh,38px)] lg:h-[clamp(24px,3.8dvh,38px)] text-white shrink-0" strokeWidth={1.75} />
                <span className="whitespace-nowrap font-extrabold leading-none tracking-tight text-lg sm:text-xl lg:text-[clamp(22px,3.8dvh,38px)]">
                  RFQ@Procucev.com
                </span>
              </a>

              <p className="mt-1.5 text-slate-600 dark:text-slate-300 text-xs sm:text-sm lg:text-[clamp(14px,2.3dvh,21px)] font-normal max-w-[40rem] leading-snug">
                Email it once. QUA AI automates Procurement from Purchase Requisition to Comparison — no portal hopping, no manual chasing.
              </p>
            </div>

            {/* Group 3: pipeline cards */}
            <div className="w-full">
              <div className="text-[10px] sm:text-[11px] lg:text-[clamp(11px,1.7dvh,14px)] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.1em] mb-1.5">
                Automated from PR to Comparison
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                {PIPELINE_STEPS.map((s) => (
                  <div
                    key={s.n}
                    className={
                      s.highlight
                        ? 'bg-gradient-to-br from-[#0F3277] to-[#1B49A3] text-white rounded-xl p-2 sm:p-2.5 lg:py-[clamp(8px,2dvh,24px)] border border-[#113A7E] shadow-sm'
                        : 'bg-white dark:bg-slate-900 rounded-xl p-2 sm:p-2.5 lg:py-[clamp(8px,2dvh,24px)] border border-slate-200/80 dark:border-slate-800 shadow-xs'
                    }
                  >
                    <div
                      className={`w-5 h-5 lg:w-[clamp(20px,3.2dvh,32px)] lg:h-[clamp(20px,3.2dvh,32px)] rounded-full flex items-center justify-center font-bold text-[11px] lg:text-[clamp(11px,1.8dvh,16px)] mb-1 ${
                        s.highlight ? 'bg-[#38C3F2] text-[#0B1B3D]' : 'bg-[#0E2A5C] text-white'
                      }`}
                    >
                      {s.n}
                    </div>
                    <div
                      className={`font-bold text-[11px] lg:text-[clamp(12px,2dvh,17px)] leading-snug ${
                        s.highlight ? 'text-white' : 'text-[#0B1B3D] dark:text-white'
                      }`}
                    >
                      {s.title}
                    </div>
                    <div
                      className={`text-[9.5px] lg:text-[clamp(10.5px,1.6dvh,14px)] mt-0.5 leading-snug ${
                        s.highlight ? 'text-blue-200' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {s.sub}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right Column: Auth Card (first on phones/tablets, right on desktop) ── */}
          <div className="order-1 lg:order-2 w-full max-w-[440px] mx-auto lg:mx-0 lg:w-[370px] xl:w-[390px] lg:shrink-0 bg-white dark:bg-slate-900 rounded-[22px] shadow-[0_20px_45px_-15px_rgba(30,64,175,0.18)] dark:shadow-none border border-slate-200/80 dark:border-slate-800 px-5 py-[clamp(8px,1.4dvh,16px)] sm:px-7 flex flex-col self-center">
            <div>
              {/* Tabs */}
              <div className="flex items-center gap-5 border-b border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => { setAuthTab('login'); setLoginOtpSent(false); }}
                  className={tabClass(authTab === 'login')}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthTab('register'); setLoginOtpSent(false); }}
                  className={tabClass(authTab === 'register')}
                >
                  Create Account
                </button>
              </div>

              <div className="pt-[clamp(8px,1.6dvh,18px)] pb-1 fluid-stack">
                {authTab === 'login' ? (
                  <div className="fluid-stack">
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-[#0B1B3D] dark:text-white tracking-tight">Welcome back</h3>
                      <p className="text-[11px] text-slate-600 dark:text-gray-400 mt-0.5 leading-snug">
                        Sign in with your Procucev account. Credentials are verified against the enterprise user directory.
                      </p>
                    </div>

                    {/* Auth method switcher */}
                    <div className="flex rounded-xl bg-[#EEF2F6] dark:bg-gray-800/80 p-0.5">
                      <button
                        type="button"
                        onClick={() => { setLoginAuthMode('password'); setLoginOtpSent(false); }}
                        className={modeClass(loginAuthMode === 'password')}
                      >
                        Password
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLoginAuthMode('email_otp'); setLoginOtpSent(false); }}
                        className={modeClass(loginAuthMode === 'email_otp')}
                      >
                        Email OTP
                      </button>
                    </div>

                    {!otpModeActive ? (
                      /* PASSWORD SIGN-IN */
                      <form onSubmit={handlePasswordLogin} className="fluid-stack">
                        <div>
                          <label htmlFor="login-email" className={fieldLabel}>Registered Email ID</label>
                          <input
                            id="login-email"
                            type="email"
                            autoComplete="username"
                            placeholder="name@company.com"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            className={fieldInput}
                            required
                          />
                        </div>

                        <div>
                          <label htmlFor="login-mobile" className={fieldLabel}>Registered Mobile Number</label>
                          <input
                            id="login-mobile"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            placeholder="e.g. 9811223344"
                            value={loginMobile}
                            onChange={(e) => setLoginMobile(e.target.value)}
                            className={fieldInput}
                            required
                          />
                          <span className={helperText}>
                            Must match the mobile number on your account record. It is verified together with your email and password.
                          </span>
                        </div>

                        <PasswordInput
                          id="login-password"
                          label="PASSWORD"
                          placeholder="Enter password"
                          value={loginPassword}
                          onChange={setLoginPassword}
                          autoComplete="current-password"
                          required
                          showLeadingIcon={false}
                          labelClassName={fieldLabel}
                          inputClassName={`${inputBase} pl-3 pr-8 py-[clamp(6px,1.2dvh,12px)]`}
                        />

                        <button type="submit" disabled={submitting} className={primaryBtn}>
                          {submitting ? 'Verifying...' : 'Sign In'} <ArrowRight size={14} />
                        </button>
                      </form>
                    ) : !loginOtpSent ? (
                      /* REQUEST OTP */
                      <form onSubmit={handleRequestOtp} className="fluid-stack">
                        <div>
                          <label htmlFor="otp-email" className={fieldLabel}>Registered Email ID</label>
                          <input
                            id="otp-email"
                            type="email"
                            autoComplete="username"
                            placeholder="name@company.com"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            className={fieldInput}
                            required
                          />
                        </div>

                        <div>
                          <label htmlFor="otp-mobile" className={fieldLabel}>Registered Mobile Number</label>
                          <input
                            id="otp-mobile"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            placeholder="e.g. 9811223344"
                            value={loginMobile}
                            onChange={(e) => setLoginMobile(e.target.value)}
                            className={fieldInput}
                            required
                          />
                          <span className={helperText}>
                            A {OTP_CODE_LENGTH}-digit code is emailed to your registered address and expires in{' '}
                            {OTP_EXPIRY_MINUTES} minutes. The code is tied to this email and mobile number pair.
                          </span>
                        </div>

                        <button type="submit" disabled={submitting} className={primaryBtn}>
                          {submitting ? 'Sending...' : 'Request Login OTP'} <ArrowRight size={14} />
                        </button>
                      </form>
                    ) : (
                      /* VERIFY OTP */
                      <form onSubmit={handleVerifyOtp} className="fluid-stack">
                        <div className="p-2 sm:p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[10.5px] text-blue-700 dark:text-blue-300 border border-blue-200/60 break-words">
                          A verification code has been emailed to <strong>{loginEmail}</strong>. Enter it below to sign in.
                        </div>

                        <div>
                          <label htmlFor="otp-code" className={fieldLabel}>Email Verification Code (OTP)</label>
                          <input
                            id="otp-code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder={`${OTP_CODE_LENGTH}-digit code`}
                            value={loginOtpInput}
                            onChange={(e) => setLoginOtpInput(e.target.value)}
                            className={otpInput}
                            maxLength={OTP_CODE_LENGTH}
                            required
                          />
                        </div>

                        <div className="flex justify-between items-center text-xs">
                          <button
                            type="button"
                            onClick={handleResendLoginOtp}
                            disabled={submitting}
                            className="text-[#1D5BD8] font-semibold hover:underline flex items-center gap-1"
                          >
                            <RotateCcw size={12} className={submitting ? 'animate-spin' : ''} />
                            <span>Resend OTP</span>
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button type="button" onClick={() => setLoginOtpSent(false)} className="btn btn-secondary text-xs w-1/3 py-2 rounded-xl">
                            Back
                          </button>
                          <button type="submit" disabled={submitting} className={`${primaryBtn} w-2/3`}>
                            {submitting ? 'Verifying...' : 'Verify & Sign In'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ) : (
                  /* ── REGISTER ── */
                  <div className="fluid-stack">
                    {/* Role Switcher for Registration */}
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-gray-800 rounded-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRegRole('buyer');
                          setRegStep('form');
                        }}
                        className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                          selectedRegRole === 'buyer'
                            ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'
                        }`}
                      >
                        <Building2 size={13} />
                        <span>Buyer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRegRole('vendor');
                          setRegStep('form');
                        }}
                        className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                          selectedRegRole === 'vendor'
                            ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'
                        }`}
                      >
                        <Truck size={13} />
                        <span>Vendor Partner</span>
                      </button>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-slate-800 dark:text-white">
                          {selectedRegRole === 'buyer' ? 'Create Buyer Account' : 'Create Vendor Partner Account'}
                        </h3>
                        <span className="badge badge-amber font-bold text-[10px]">
                          {selectedRegRole === 'buyer' ? '5 Free RFQs' : '5 Free Quotes'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 leading-snug">
                        {selectedRegRole === 'buyer'
                          ? 'Your account is created in the Procucev enterprise user directory and works across every Procucev application.'
                          : 'Join the verified supplier roster and respond to live enterprise RFQs with free quotation credits.'}
                      </p>
                    </div>

                    {regStep === 'form' ? (
                      <form
                        onSubmit={handleInitiateRegister}
                        className="fluid-stack-sm max-h-[clamp(200px,46dvh,420px)] overflow-y-auto no-scrollbar pr-1"
                      >
                        <div>
                          <label htmlFor="reg-name" className={fieldLabel}>
                            {selectedRegRole === 'buyer' ? 'Full Name / Procurement Lead' : 'Authorized Representative Name'}
                          </label>
                          <div className="relative">
                            <Users className={iconClass} size={14} />
                            <input
                              id="reg-name"
                              type="text"
                              autoComplete="name"
                              placeholder={selectedRegRole === 'buyer' ? 'e.g. Navin Chaudhary' : 'e.g. Rajesh Kumar'}
                              value={regName}
                              onChange={(e) => setRegName(e.target.value)}
                              className={iconFieldInput}
                              style={ICON_PAD}
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="reg-org" className={fieldLabel}>
                            {selectedRegRole === 'buyer' ? 'Company Name / Legal Name' : 'Vendor Enterprise / Company Name'} <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <Building2 className={iconClass} size={14} />
                            <input
                              id="reg-org"
                              type="text"
                              autoComplete="organization"
                              placeholder={
                                selectedRegRole === 'buyer'
                                  ? 'e.g. Larsen & Toubro Procurement'
                                  : 'e.g. Precision Engineering Works Pvt Ltd'
                              }
                              value={regOrgName}
                              onChange={(e) => setRegOrgName(e.target.value)}
                              className={iconFieldInput}
                              style={ICON_PAD}
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="reg-gstin" className={fieldLabel}>
                            GSTIN / GST Number <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <FileText className={iconClass} size={14} />
                            <input
                              id="reg-gstin"
                              type="text"
                              placeholder="e.g. 27AAAAA0000A1Z5"
                              value={regGstin}
                              onChange={(e) => setRegGstin(e.target.value.toUpperCase())}
                              className={`${iconFieldInput} font-mono uppercase`}
                              style={ICON_PAD}
                              maxLength={15}
                              required
                            />
                          </div>
                        </div>

                        {/* Pincode + City side by side, State full width */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 items-start">
                          <div>
                            <div className="flex items-center justify-between min-h-[16px]">
                              <label htmlFor="reg-pincode" className={fieldLabel}>
                                Pincode <span className="text-red-500">*</span>
                              </label>
                              {regPincodeValidating && (
                                <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                                  <Loader2 size={10} className="animate-spin" /> Checking
                                </span>
                              )}
                              {!regPincodeValidating && regPincodePostOffices.length > 0 && !regPincodeError && (
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                                  <CheckCircle2 size={10} /> Valid
                                </span>
                              )}
                              {!regPincodeValidating && regPincodeError && regPincode.trim().length >= 6 && (
                                <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                                  <AlertCircle size={10} /> Invalid
                                </span>
                              )}
                            </div>
                            <input
                              id="reg-pincode"
                              type="text"
                              inputMode="numeric"
                              placeholder="e.g. 411001"
                              value={regPincode}
                              onChange={(e) => setRegPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              className={`${plainInput} font-mono ${regPincodeError ? 'border-red-400 dark:border-red-700' : ''}`}
                              maxLength={6}
                              required
                            />
                            {regPincodeError && regPincode.trim().length >= 6 && (
                              <p className="text-[10px] text-rose-500 font-medium mt-1">{regPincodeError}</p>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center min-h-[16px]">
                              <label htmlFor="reg-city" className={fieldLabel}>
                                City <span className="text-red-500">*</span>
                              </label>
                            </div>
                            <input
                              id="reg-city"
                              type="text"
                              placeholder="e.g. Pune"
                              value={regCity}
                              onChange={(e) => setRegCity(e.target.value)}
                              className={plainInput}
                              required
                            />
                          </div>
                          <div className="col-span-2">
                            <div className="flex items-center min-h-[16px]">
                              <label htmlFor="reg-state" className={fieldLabel}>
                                State <span className="text-red-500">*</span>
                              </label>
                            </div>
                            <input
                              id="reg-state"
                              type="text"
                              placeholder="e.g. Maharashtra"
                              value={regState}
                              onChange={(e) => setRegState(e.target.value)}
                              className={plainInput}
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="reg-email" className={fieldLabel}>Corporate Email ID <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <Mail className={iconClass} size={14} />
                            <input
                              id="reg-email"
                              type="email"
                              autoComplete="email"
                              placeholder={selectedRegRole === 'buyer' ? 'buyer@company.com' : 'vendor@supplier.com'}
                              value={regEmail}
                              onChange={(e) => setRegEmail(e.target.value)}
                              className={iconFieldInput}
                              style={ICON_PAD}
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="reg-mobile" className={fieldLabel}>Mobile Number (WhatsApp Enabled) <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <Phone className={iconClass} size={14} />
                            <input
                              id="reg-mobile"
                              type="tel"
                              inputMode="numeric"
                              autoComplete="tel"
                              placeholder="e.g. 9811223344"
                              value={regMobile}
                              onChange={(e) => setRegMobile(e.target.value)}
                              className={iconFieldInput}
                              style={ICON_PAD}
                              required
                            />
                          </div>
                          <span className={helperText}>
                            Stored as +91XXXXXXXXXX and used for WhatsApp and SMS notifications.
                          </span>
                        </div>

                        <PasswordInput
                          id="reg-password"
                          label="Password"
                          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                          value={regPassword}
                          onChange={setRegPassword}
                          autoComplete="new-password"
                          minLength={MIN_PASSWORD_LENGTH}
                          required
                        />

                        <button type="submit" disabled={submitting} className={primaryBtn} aria-label="Create Account">
                          <span>Create Account</span> <ArrowRight size={14} />
                        </button>
                      </form>
                    ) : (
                      /* ── Dual Email & Mobile OTP Verification Step ── */
                      <form onSubmit={handleVerifyAndCompleteRegistration} className="fluid-stack animate-fade-in">
                        <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                            <ShieldCheck size={14} />
                            <span>Dual OTP Identity Verification</span>
                          </div>
                          <p className="text-[11px] text-indigo-600/90 dark:text-indigo-300/80 leading-relaxed">
                            To protect your account, enter both the 6-digit codes sent to your corporate email and mobile number.
                          </p>
                        </div>

                        {/* Email OTP Field */}
                        <div>
                          <label htmlFor="reg-email-otp" className={`${fieldLabel} break-words`}>
                            1. Email Verification Code (OTP) (Sent to {regEmail.toLowerCase()})
                          </label>
                          <div className="relative">
                            <Mail className={iconClass} size={14} />
                            <input
                              id="reg-email-otp"
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              placeholder="6-digit Email OTP"
                              value={regEmailOtp}
                              onChange={(e) => setRegEmailOtp(e.target.value)}
                              className={otpIconInput}
                              style={ICON_PAD}
                              maxLength={OTP_CODE_LENGTH}
                              required
                            />
                          </div>
                        </div>

                        {/* Mobile OTP Field */}
                        <div>
                          <label htmlFor="reg-mobile-otp" className={fieldLabel}>
                            2. Mobile OTP (SMS sent to +91 {regMobile})
                          </label>
                          <div className="relative">
                            <Phone className={iconClass} size={14} />
                            <input
                              id="reg-mobile-otp"
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              placeholder="6-digit Mobile OTP"
                              value={regMobileOtp}
                              onChange={(e) => setRegMobileOtp(e.target.value)}
                              className={otpIconInput}
                              style={ICON_PAD}
                              maxLength={OTP_CODE_LENGTH}
                              required
                            />
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-xs">
                          <button
                            type="button"
                            onClick={handleResendRegOtp}
                            disabled={submitting}
                            className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1"
                          >
                            <RotateCcw size={12} className={submitting ? 'animate-spin' : ''} />
                            <span>Resend Verification Codes</span>
                          </button>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setRegStep('form')}
                            className="btn btn-secondary text-xs w-1/3 py-3 rounded-xl"
                          >
                            Back
                          </button>
                          <button type="submit" disabled={submitting} className={`${primaryBtn} w-2/3`}>
                            {submitting ? 'Activating...' : 'Verify & Activate Account'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Dark Banner ── */}
      <div className="w-full bg-gradient-to-r from-[#0A1A3C] via-[#0D2250] to-[#1A43A0] text-white pt-2.5 pb-2 sm:pt-2.5 sm:pb-2 border-t border-blue-900/40 shrink-0">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-10 xl:px-16">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
            <h2 className="lg:w-[260px] shrink-0 text-sm sm:text-base font-bold text-white leading-tight">
              Enterprise AI Sourcing &amp; Logistics Matching Roster
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-5 flex-1 min-w-0">
              {/* Pillar 1 */}
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#4A2144] text-white/90 flex items-center justify-center shrink-0">
                  <Zap size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-sky-300 leading-snug">Mode 1, 2, and 3 Sourcing Engines</h4>
                  <p className="text-[10px] text-slate-300 mt-0.5 leading-snug">
                    Deploy flexible private rosters, hybrid base networks, or 360-degree AI evaluations dynamically.
                  </p>
                </div>
              </div>

              {/* Pillar 2 */}
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#123A5E] text-white/90 flex items-center justify-center shrink-0">
                  <Layers size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-sky-300 leading-snug">Automated Chaser Outreach</h4>
                  <p className="text-[10px] text-slate-300 mt-0.5 leading-snug">
                    Sequenced SMS, Voice Bot Calls, and WhatsApp follow-ups governed strictly by IST working-hour rules.
                  </p>
                </div>
              </div>

              {/* Pillar 3 */}
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#3E2F85] text-white/90 flex items-center justify-center shrink-0">
                  <ShieldCheck size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-sky-300 leading-snug">OCR Ingestion &amp; Audit Trails</h4>
                  <p className="text-[10px] text-slate-300 mt-0.5 leading-snug">
                    Autonomous quote extraction from incoming emails with secure cryptographic logging.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}