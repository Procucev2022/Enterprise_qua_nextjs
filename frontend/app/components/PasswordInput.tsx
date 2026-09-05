'use client';

import React, { useId, useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';

interface PasswordInputProps {
  /** Visible field label. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Browser autofill hint: current-password when signing in, new-password when registering. */
  autoComplete?: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
  id?: string;
  /** Optional helper text rendered beneath the field. */
  hint?: string;
  /** Override the label styling to match the surrounding form. */
  labelClassName?: string;
  /** Extra input classes appended after the icon-gutter classes. */
  inputClassName?: string;
  /** Hide the leading lock icon for compact forms that already have a heading. */
  showLeadingIcon?: boolean;
}

/**
 * Password field with a reveal toggle.
 *
 * The input keeps its leading lock icon and gains a trailing eye button that
 * switches the field between masked and plain text. Both gutters are reserved
 * via the `has-leading-icon` / `has-trailing-icon` classes, because the global
 * input rules outrank Tailwind padding utilities.
 */
export default function PasswordInput({
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  required = false,
  minLength,
  id,
  hint,
  labelClassName = 'text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450',
  inputClassName = 'text-xs',
  showLeadingIcon = true,
}: PasswordInputProps) {
  const generatedId = useId();
  const fieldId = id || `password-${generatedId}`;
  const [revealed, setRevealed] = useState(false);

  const toggleLabel = revealed ? UI_STRINGS.auth.hidePassword : UI_STRINGS.auth.showPassword;
  const gutterClasses = `${showLeadingIcon ? 'has-leading-icon ' : ''}has-trailing-icon`;

  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className={labelClassName}>
        {label}
      </label>

      <div className="relative">
        {showLeadingIcon && (
          <Lock
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            size={14}
            aria-hidden="true"
          />
        )}

        <input
          id={fieldId}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${gutterClasses} ${inputClassName}`}
          required={required}
          minLength={minLength}
        />

        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={toggleLabel}
          aria-pressed={revealed}
          title={toggleLabel}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
        >
          {revealed ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </button>
      </div>

      {hint && <span className="text-[10px] text-slate-400 italic block mt-0.5">{hint}</span>}
    </div>
  );
}
