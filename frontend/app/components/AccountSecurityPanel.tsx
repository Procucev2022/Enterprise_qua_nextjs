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

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const strings = UI_STRINGS.accountSecurity;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.changePasswordForm, {
      currentPassword: currentPassword.trim(),
      newPassword,
    });
    if (!isValid) {
      const firstError = Object.values(fieldErrors)[0];
      const isPasswordLength = 'newPassword' in fieldErrors;
      showToast(
        isPasswordLength ? strings.weakPasswordTitle : strings.validationErrorTitle,
        firstError,
        'warning'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast(strings.passwordMismatchTitle, strings.passwordMismatchMessage, 'warning');
      return;
    }

    // Caught here as well as server-side so the round trip is skipped entirely.
    if (newPassword === currentPassword) {
      showToast(strings.validationErrorTitle, strings.passwordSameAsCurrent, 'warning');
      return;
    }

    setIsSaving(true);
    logger.info('Submitting account password change', undefined, 'ACCOUNT_SECURITY');

    try {
      const result = await authClient.changePassword(currentPassword, newPassword);

      if (!result.success) {
        // The API explains precisely which rule failed (wrong current password,
        // inactive account, unreachable database), so its message is shown rather
        // than a generic one.
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

      // Only cleared on success: a rejected attempt keeps what was typed so the
      // buyer can correct one field instead of re-entering all three.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
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
      </div>

      <div className="space-y-3">
        <PasswordInput
          id="current-password"
          label={strings.currentPasswordLabel}
          placeholder={strings.currentPasswordPlaceholder}
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          showLeadingIcon={false}
          labelClassName="text-[10px] font-bold uppercase tracking-wider text-slate-400"
          inputClassName="rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
        />

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
            <li>{strings.policyReuse}</li>
            <li>{strings.policyComplexity}</li>
          </ul>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            className="btn btn-secondary text-xs px-5 py-2 font-bold"
          >
            {isSaving ? strings.updatingPasswordAction : strings.updatePasswordAction}
          </button>
        </div>
      </div>
    </form>
  );
}
