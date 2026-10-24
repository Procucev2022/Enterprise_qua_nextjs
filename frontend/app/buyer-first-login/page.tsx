'use client';

import React, { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldCheck,
  Mail,
  Phone,
  Lock,
  Building,
  CheckCircle2,
  FileText,
  Users,
  MapPin,
  Loader2,
} from 'lucide-react';
import PasswordInput from '@/app/components/PasswordInput';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { PASSWORD_MIN_LENGTH, ROLE_LANDING_ROUTE } from '@/lib/constants';
import {
  INDIAN_MOBILE_PATTERN,
  INDIAN_PINCODE_PATTERN,
  GSTIN_PATTERN,
  validatePincode,
  PINCODE_PATTERN,
  isDummyPincode,
} from '@/lib/validationSchemas';
import { UI_STRINGS } from '@/lib/uiStrings';

function sanitizeRedirect(url: string | null | undefined): string {
  if (!url || typeof url !== 'string' || !url.startsWith('/')) return '';
  if (url === '/buyer/rfqs' || url.startsWith('/buyer/rfqs?')) {
    return url.replace('/buyer/rfqs', '/buyer/rfq-summary');
  }
  return url;
}

function BuyerFirstLoginContent() {
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
  const { currentUserSession, setCurrentUserSession, setIsLoggedIn, showToast } = useApp();

  const [emailOtp, setEmailOtp] = useState('');
  const [mobile, setMobile] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [companyName, setCompanyName] = useState(currentUserSession?.orgName || '');
  const [contactName, setContactName] = useState(currentUserSession?.name || '');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');

  const [pincodeValidating, setPincodeValidating] = useState(false);
  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const pincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [sendingSmsOtp, setSendingSmsOtp] = useState(false);

  useEffect(() => {
    if (!currentUserSession) {
      router.replace(redirectParam ? `/login?redirect=${encodeURIComponent(redirectParam)}` : '/login');
    } else if (
      currentUserSession.role !== 'buyer' ||
      (!currentUserSession.onboardingRequired && !currentUserSession.passwordChangeRequired)
    ) {
      router.replace(redirectParam || ROLE_LANDING_ROUTE.buyer);
    }
  }, [currentUserSession, router, redirectParam]);

  useEffect(() => {
    return () => {
      if (pincodeDebounceRef.current) {
        clearTimeout(pincodeDebounceRef.current);
      }
    };
  }, []);

  const handlePincodeChange = (rawVal: string) => {
    const val = rawVal.replace(/\D/g, '').slice(0, 6);
    setPincode(val);

    if (pincodeDebounceRef.current) {
      clearTimeout(pincodeDebounceRef.current);
    }

    if (!val) {
      setPincodeError(null);
      setPincodeValidating(false);
      return;
    }

    if (val.startsWith('0')) {
      setPincodeError('PIN code cannot start with 0');
      setPincodeValidating(false);
      return;
    }

    if (isDummyPincode(val)) {
      setPincodeError('Invalid or dummy PIN code');
      setPincodeValidating(false);
      return;
    }

    if (/^\d{6}$/.test(val)) {
      setPincodeValidating(true);
      pincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(val);
          if (!res.isValid) {
            setPincodeError(res.message || 'Invalid PIN code');
          } else {
            setPincodeError(null);
            const pos = res.postOffices || [];
            if (pos.length > 0) {
              const po = pos[0];
              const matchedCity = po.District || po.Division || po.Name || '';
              const matchedState = po.State || '';
              if (matchedCity) setCity(matchedCity);
              if (matchedState) setState(matchedState);
            }
          }
        } catch {
          setPincodeError(null);
        } finally {
          setPincodeValidating(false);
        }
      }, 350);
    } else {
      setPincodeError(null);
      setPincodeValidating(false);
    }
  };

  const handleGstinChange = (raw: string) => {
    const upper = raw.toUpperCase().slice(0, 15);
    setGstin(upper);
    if (upper.length === 15) {
      setPan(upper.slice(2, 12));
    }
  };

  const handleSendEmailOtp = async () => {
    if (!currentUserSession?.email) return;
    setSendingEmailOtp(true);
    setError('');
    try {
      const res = await authClient.requestOtp(currentUserSession.email, '9999999999', 'buyer');
      if (res.success) {
        setEmailOtpSent(true);
        showToast(UI_STRINGS.auth.buyerOnboarding.title, UI_STRINGS.auth.buyerOnboarding.otpSentMessage, 'info');
      } else {
        setError(res.error || 'Failed to dispatch email verification OTP.');
      }
    } catch {
      setError('Failed to dispatch email verification OTP.');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleSendSmsOtp = async () => {
    const cleaned = mobile.replace(/\D/g, '');
    if (!cleaned || cleaned.endsWith('9999999999') || cleaned === '9999999999') {
      setError(UI_STRINGS.auth.buyerOnboarding.placeholderPhoneWarning);
      return;
    }
    if (!INDIAN_MOBILE_PATTERN.test(cleaned)) {
      setError(UI_STRINGS.auth.mobileInvalid);
      return;
    }

    setSendingSmsOtp(true);
    setError('');
    try {
      const res = await authClient.requestOtp(currentUserSession?.email || '', cleaned, 'buyer', true);
      if (res.success) {
        setSmsOtpSent(true);
        showToast(UI_STRINGS.auth.buyerOnboarding.title, UI_STRINGS.auth.buyerOnboarding.otpSentMessage, 'info');
      } else {
        setError(res.error || 'Failed to dispatch SMS verification OTP.');
      }
    } catch {
      setError('Failed to dispatch SMS verification OTP.');
    } finally {
      setSendingSmsOtp(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');

    const cleaned = mobile.replace(/\D/g, '');
    if (!cleaned || cleaned.endsWith('9999999999') || cleaned === '9999999999') {
      setError(UI_STRINGS.auth.buyerOnboarding.placeholderPhoneWarning);
      return;
    }
    if (!INDIAN_MOBILE_PATTERN.test(cleaned)) {
      setError(UI_STRINGS.auth.mobileInvalid);
      return;
    }
    if (!emailOtp.trim() || emailOtp.length !== 6) {
      setError(UI_STRINGS.auth.otpRequired);
      return;
    }
    if (!mobileOtp.trim() || mobileOtp.length !== 6) {
      setError('Enter the 6-digit SMS verification code sent to your phone.');
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(UI_STRINGS.auth.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(UI_STRINGS.auth.buyerOnboarding.passwordMismatch);
      return;
    }
    if (currentPassword === newPassword) {
      setError('Choose a new password that is different from your temporary password.');
      return;
    }
    if (!companyName.trim()) {
      setError(UI_STRINGS.auth.buyerOnboarding.companyNameRequired);
      return;
    }
    const cleanGstin = gstin.trim().toUpperCase();
    if (!cleanGstin) {
      setError(UI_STRINGS.auth.buyerOnboarding.gstinRequired);
      return;
    }
    if (!GSTIN_PATTERN.test(cleanGstin)) {
      setError(UI_STRINGS.auth.buyerOnboarding.gstinInvalid);
      return;
    }
    const cleanPincode = pincode.trim();
    if (!cleanPincode) {
      setError(UI_STRINGS.auth.buyerOnboarding.pincodeRequired);
      return;
    }
    if (!INDIAN_PINCODE_PATTERN.test(cleanPincode)) {
      setError(UI_STRINGS.auth.buyerOnboarding.pincodeInvalid);
      return;
    }
    if (!city.trim()) {
      setError(UI_STRINGS.auth.buyerOnboarding.cityRequired);
      return;
    }
    if (!state.trim()) {
      setError(UI_STRINGS.auth.buyerOnboarding.stateRequired);
      return;
    }

    const derivedPan = cleanGstin.length === 15 ? cleanGstin.slice(2, 12) : (pan.trim() || undefined);

    setSaving(true);
    try {
      const result = await authClient.completeBuyerOnboarding({
        emailOtp: emailOtp.trim(),
        mobile: cleaned,
        mobileOtp: mobileOtp.trim(),
        currentPassword,
        newPassword,
        companyName: companyName.trim(),
        contactName: contactName.trim() || undefined,
        city: city.trim(),
        state: state.trim(),
        pincode: cleanPincode,
        address: address.trim() || undefined,
        gstin: cleanGstin,
        pan: derivedPan,
      });

      if (!result.success || !result.user || !result.token) {
        setError(result.error || 'Failed to complete profile verification. Please try again.');
        return;
      }

      setCurrentUserSession(result.user);
      setIsLoggedIn(true);
      showToast(
        UI_STRINGS.auth.buyerOnboarding.successTitle,
        UI_STRINGS.auth.buyerOnboarding.successMessage,
        'success'
      );
      router.replace(redirectParam || ROLE_LANDING_ROUTE.buyer);
    } catch {
      setError('An error occurred during verification. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (
    !currentUserSession ||
    currentUserSession.role !== 'buyer' ||
    (!currentUserSession.onboardingRequired && !currentUserSession.passwordChangeRequired)
  ) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-500">
        Please sign in to continue.
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="buyer-first-login-heading"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 px-4 py-8"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8 shadow-2xl space-y-6 my-auto"
      >
        <div className="space-y-2 text-center border-b border-slate-100 dark:border-gray-800 pb-4">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300 shadow-inner">
            <ShieldCheck size={28} />
          </span>
          <h1 id="buyer-first-login-heading" className="text-2xl font-bold text-slate-900 dark:text-white">
            {UI_STRINGS.auth.buyerOnboarding.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 max-w-md mx-auto">
            {UI_STRINGS.auth.buyerOnboarding.subtitle}
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-xs font-medium text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="space-y-5">
          {/* Section 1: Email Verification */}
          <div className="rounded-xl border border-slate-200/80 dark:border-gray-800 p-4 bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Mail size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>{UI_STRINGS.auth.buyerOnboarding.step1Title}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {UI_STRINGS.auth.buyerOnboarding.step1Desc} ({currentUserSession.email})
            </p>
            <div className="flex gap-2 items-center">
              <input
                id="email-otp-input"
                type="text"
                maxLength={6}
                value={emailOtp}
                onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit Email OTP"
                className="flex-1 rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 py-2 text-sm text-slate-900 dark:text-white tracking-widest font-mono"
                required
              />
              <button
                type="button"
                onClick={handleSendEmailOtp}
                disabled={sendingEmailOtp}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 transition-colors border border-indigo-200 dark:border-indigo-800 disabled:opacity-50"
              >
                {sendingEmailOtp ? 'Sending…' : emailOtpSent ? 'Resend OTP' : UI_STRINGS.auth.buyerOnboarding.sendEmailOtpBtn}
              </button>
            </div>
          </div>

          {/* Section 2: Phone Verification */}
          <div className="rounded-xl border border-slate-200/80 dark:border-gray-800 p-4 bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Phone size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>{UI_STRINGS.auth.buyerOnboarding.step2Title}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {UI_STRINGS.auth.buyerOnboarding.step2Desc}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="new-mobile-input" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.mobileLabel}
                </label>
                <div className="flex gap-2">
                  <input
                    id="new-mobile-input"
                    type="tel"
                    maxLength={10}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit mobile"
                    className="flex-1 rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleSendSmsOtp}
                    disabled={sendingSmsOtp}
                    className="px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 transition-colors border border-indigo-200 dark:border-indigo-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    {sendingSmsOtp ? 'Sending…' : smsOtpSent ? 'Resend' : UI_STRINGS.auth.buyerOnboarding.sendSmsOtpBtn}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="sms-otp-input" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.mobileOtpLabel}
                </label>
                <input
                  id="sms-otp-input"
                  type="text"
                  maxLength={6}
                  value={mobileOtp}
                  onChange={(e) => setMobileOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit SMS OTP"
                  className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white tracking-widest font-mono"
                  required
                />
              </div>
            </div>
          </div>

          {/* Section 3: Password Change */}
          <div className="rounded-xl border border-slate-200/80 dark:border-gray-800 p-4 bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Lock size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>{UI_STRINGS.auth.buyerOnboarding.step3Title}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {UI_STRINGS.auth.buyerOnboarding.step3Desc}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PasswordInput
                id="temporary-password"
                label={UI_STRINGS.auth.buyerOnboarding.currentPasswordLabel}
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
                required
              />
              <PasswordInput
                id="new-password"
                label={UI_STRINGS.auth.buyerOnboarding.newPasswordLabel}
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                required
              />
              <PasswordInput
                id="confirm-password"
                label={UI_STRINGS.auth.buyerOnboarding.confirmPasswordLabel}
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          {/* Section 4: Organisation & Statutory Profile */}
          <div className="rounded-xl border border-slate-200/80 dark:border-gray-800 p-4 bg-slate-50/50 dark:bg-gray-950/40 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Building size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>{UI_STRINGS.auth.buyerOnboarding.step4Title}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {UI_STRINGS.auth.buyerOnboarding.step4Desc}
            </p>

            <div className="space-y-3">
              {/* Full Name */}
              <div className="space-y-1">
                <label htmlFor="contact-name" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.contactNameLabel}
                </label>
                <div className="relative">
                  <Users className="absolute left-3 top-2.5 text-slate-400 dark:text-gray-500" size={14} />
                  <input
                    id="contact-name"
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.contactNamePlaceholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Company Name / Legal Name */}
              <div className="space-y-1">
                <label htmlFor="company-name" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.companyNameLabel} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Building size={14} className="absolute left-3 top-2.5 text-slate-400 dark:text-gray-500" />
                  <input
                    id="company-name"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.companyNamePlaceholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white"
                    required
                  />
                </div>
              </div>

              {/* GSTIN / GST Number */}
              <div className="space-y-1">
                <label htmlFor="buyer-gstin" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.gstinLabel} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-2.5 text-slate-400 dark:text-gray-500" />
                  <input
                    id="buyer-gstin"
                    type="text"
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => handleGstinChange(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.gstinPlaceholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white font-mono uppercase tracking-wider"
                    required
                  />
                </div>
              </div>

              {/* Pincode, City, State Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between min-h-[16px]">
                    <label htmlFor="buyer-pincode" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                      {UI_STRINGS.auth.buyerOnboarding.pincodeLabel} <span className="text-red-500">*</span>
                    </label>
                    {pincodeValidating && (
                      <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Checking
                      </span>
                    )}
                    {!pincodeValidating && pincode.length === 6 && !pincodeError && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> Valid
                      </span>
                    )}
                  </div>
                  <input
                    id="buyer-pincode"
                    type="text"
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => handlePincodeChange(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.pincodePlaceholder}
                    className={`w-full rounded-lg border bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white font-mono ${
                      pincodeError ? 'border-red-400 dark:border-red-700' : 'border-slate-300 dark:border-gray-700'
                    }`}
                    required
                  />
                  {pincodeError && (
                    <p className="text-[10px] text-rose-500 font-medium">{pincodeError}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="buyer-city" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    {UI_STRINGS.auth.buyerOnboarding.cityLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="buyer-city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.cityPlaceholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="buyer-state" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    {UI_STRINGS.auth.buyerOnboarding.stateLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="buyer-state"
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.statePlaceholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                    required
                  />
                </div>
              </div>

              {/* Address / Street */}
              <div className="space-y-1">
                <label htmlFor="buyer-address" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.addressLabel}
                </label>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-2.5 text-slate-400 dark:text-gray-500" />
                  <input
                    id="buyer-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={UI_STRINGS.auth.buyerOnboarding.addressPlaceholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 cursor-pointer"
        >
          {saving ? (
            <span>{UI_STRINGS.auth.buyerOnboarding.submittingBtn}</span>
          ) : (
            <>
              <CheckCircle2 size={18} />
              <span>{UI_STRINGS.auth.buyerOnboarding.submitBtn}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default function BuyerFirstLoginPage() {
  return (
    <Suspense fallback={null}>
      <BuyerFirstLoginContent />
    </Suspense>
  );
}
