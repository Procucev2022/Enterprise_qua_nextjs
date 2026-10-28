'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import PasswordInput from '@/app/components/PasswordInput';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { PASSWORD_MIN_LENGTH } from '@/lib/constants';
import { FORM_SCHEMAS, validateFormData } from '@/lib/validationSchemas';
import { logger } from '@/lib/logger';
import { ShieldCheck } from 'lucide-react';

/**
 * Change the signed-in account's password.
 *
 * Lives on the buyer profile page as Section 4, and is also rendered inside the
 * header overlay for vendor, category manager and admin, which have no profile
 * page of their own — one implementation, one set of rules, wherever it appears.
 *
 * The account is never named in the request. POST /api/auth/change-password
 * resolves it from the session token, so this form cannot be pointed at anybody
 * else's credential, and the current password is re-verified server-side on every
 * attempt even though the caller is already authenticated.
 *
 * Client-side checks here are for fast feedback only; the same three rules
 * (present, long enough, actually different) are enforced again by the API, which
 * is the authority.
 */
export default function AccountSecurityPanel() {
  const { showToast } = useApp();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const strings = UI_STRINGS.accountSecurity;

  const handleRequestVerificationCode = async () => {
    const user = authClient.getSessionUser();
    if (!user?.email) {
      showToast(strings.validationErrorTitle, 'No active account session found. Please sign in again.', 'warning');
      return;
    }

    setIsSendingOtp(true);
    try {
      const result = await authClient.requestOtp(user.email, user.mobile || '');
      if (result.success) {
        setShowOtpInput(true);
        showToast(
          strings.codeSentTitle,
          strings.codeSentMessage,
          'success'
        );
      } else {
        showToast(
          strings.changeFailedTitle,
          result.error || 'Failed to dispatch verification code. Please try again.',
          'warning'
        );
      }
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const trimmedNew = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedNew) {
      showToast(strings.validationErrorTitle, strings.weakPasswordMessage, 'warning');
      return;
    }

    if (trimmedNew.length < PASSWORD_MIN_LENGTH) {
      showToast(strings.weakPasswordTitle, strings.weakPasswordMessage, 'warning');
      return;
    }

    if (trimmedNew !== trimmedConfirm) {
      showToast(strings.passwordMismatchTitle, strings.passwordMismatchMessage, 'warning');
      return;
    }

    setIsSaving(true);
    logger.info('Submitting account password change', undefined, 'ACCOUNT_SECURITY');

    try {
      const result = await authClient.changePassword(
        verificationCode.trim(),
        trimmedNew,
        verificationCode.trim() ? { code: verificationCode.trim() } : undefined
      );

      if (!result.success) {
        // If the server requires verification code and it wasn't entered yet, prompt for OTP:
        if (
          !verificationCode.trim() &&
          (result.error?.includes('verification code') || result.error?.includes('reset token'))
        ) {
          setShowOtpInput(true);
          await handleRequestVerificationCode();
          return;
        }

        logger.warn(
          'Account password change rejected',
          { reason: result.error },
          'ACCOUNT_SECURITY'
        );
        showToast(
          strings.changeFailedTitle,
          result.error || strings.changeFailedFallback,
          'warning'
        );
        return;
      }

      setNewPassword('');
      setConfirmPassword('');
      setVerificationCode('');
      setShowOtpInput(false);
      logger.info('Account password changed', undefined, 'ACCOUNT_SECURITY');
      showToast(
        strings.passwordChangedTitle,
        result.message || strings.passwordChangedFallback,
        'success'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleChangePassword} className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />{' '}
          {strings.passwordSectionLabel}
        </span>
        <button
          type="button"
          onClick={handleRequestVerificationCode}
          disabled={isSendingOtp}
          className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {isSendingOtp ? strings.sendingCodeAction : 'Forgot Password? Reset via Code'}
        </button>
      </div>

      <div className="space-y-3">
        {showOtpInput && (
          <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="verification-code" className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                {strings.verificationCodeLabel}
              </label>
              <button
                type="button"
                onClick={handleRequestVerificationCode}
                disabled={isSendingOtp}
                className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {isSendingOtp ? strings.sendingCodeAction : strings.resendCodeAction}
              </button>
            </div>
            <input
              id="verification-code"
              type="text"
              maxLength={6}
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
              placeholder={strings.verificationCodePlaceholder}
              className="w-full px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-xs font-mono font-bold tracking-widest bg-white dark:bg-gray-950 text-slate-900 dark:text-white"
            />
            <p className="text-[10px] text-indigo-600 dark:text-indigo-400">
              Enter the 6-digit verification code sent to your registered email and mobile.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PasswordInput
            id="new-password"
            label={strings.newPasswordLabel}
            placeholder={strings.newPasswordPlaceholder}
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            showLeadingIcon={false}
            labelClassName="text-[10px] font-bold uppercase tracking-wider text-slate-400"
            inputClassName="rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
          />
          <PasswordInput
            id="confirm-password"
            label={strings.confirmPasswordLabel}
            placeholder={strings.confirmPasswordPlaceholder}
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            showLeadingIcon={false}
            labelClassName="text-[10px] font-bold uppercase tracking-wider text-slate-400"
            inputClassName="rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
          />
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500 dark:text-gray-400 space-y-1">
          <p className="font-bold text-slate-700 dark:text-gray-300">{strings.policyTitle}</p>
          <ul className="list-disc list-inside text-[10px] space-y-0.5 text-slate-500 dark:text-gray-400">
            <li>{strings.policyMinLength}</li>
            <li>{strings.policyComplexity}</li>
          </ul>
        </div>

        <div className="flex justify-end gap-2.5 items-center">
          <button
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            className="btn btn-secondary text-xs px-5 py-2 font-bold cursor-pointer"
          >
            {isSaving ? strings.updatingPasswordAction : strings.updatePasswordAction}
          </button>
        </div>
      </div>
    </form>
  );
}
