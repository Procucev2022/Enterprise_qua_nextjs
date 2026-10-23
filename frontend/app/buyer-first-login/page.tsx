'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Mail, Phone, Lock, Building, CheckCircle2 } from 'lucide-react';
import PasswordInput from '@/app/components/PasswordInput';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { PASSWORD_MIN_LENGTH, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { INDIAN_MOBILE_PATTERN } from '@/lib/validationSchemas';
import { UI_STRINGS } from '@/lib/uiStrings';

export default function BuyerFirstLoginPage() {
  const router = useRouter();
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
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [sendingSmsOtp, setSendingSmsOtp] = useState(false);

  useEffect(() => {
    if (!currentUserSession) {
      router.replace('/login');
    } else if (
      currentUserSession.role !== 'buyer' ||
      (!currentUserSession.onboardingRequired && !currentUserSession.passwordChangeRequired)
    ) {
      router.replace(ROLE_LANDING_ROUTE.buyer);
    }
  }, [currentUserSession, router]);

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
      setError('Company name is required.');
      return;
    }

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
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        pincode: pincode.trim() || undefined,
        gstin: gstin.trim() || undefined,
        pan: pan.trim() || undefined,
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
      router.replace(ROLE_LANDING_ROUTE.buyer);
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

          {/* Section 4: Organisation Profile */}
          <div className="rounded-xl border border-slate-200/80 dark:border-gray-800 p-4 bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Building size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>{UI_STRINGS.auth.buyerOnboarding.step4Title}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="company-name" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.companyNameLabel}
                </label>
                <input
                  id="company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Industrial Ltd"
                  className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="contact-name" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.contactNameLabel}
                </label>
                <input
                  id="contact-name"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Procurement Officer"
                  className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="buyer-city" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.cityLabel}
                </label>
                <input
                  id="buyer-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mumbai"
                  className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="buyer-pincode" className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  {UI_STRINGS.auth.buyerOnboarding.pincodeLabel}
                </label>
                <input
                  id="buyer-pincode"
                  type="text"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="e.g. 400001"
                  className="w-full rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
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
