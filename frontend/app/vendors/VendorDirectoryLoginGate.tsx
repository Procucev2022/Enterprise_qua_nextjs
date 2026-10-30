'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  AlertCircle,
  Building2,
  Mail,
  KeyRound,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { VENDOR_DIRECTORY_AUTH_CONFIG } from '@/lib/constants';
import { requestVendorDirectoryOtp, verifyVendorDirectoryOtp } from '@/lib/vendorAuthClient';

/**
 * Formats a remaining OTP validity / resend countdown duration into a human-readable string.
 * Examples:
 *  - 300 -> '5m 00s'
 *  - 299 -> '4m 59s'
 *  - 65  -> '1m 05s'
 *  - 59  -> '59s'
 *  - 9   -> '9s'
 *  - 0   -> '0s'
 */
export function formatOtpTimer(seconds: number): string {
  if (seconds <= 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  }
  return `${secs}s`;
}

interface VendorDirectoryLoginGateProps {
  onAuthenticated: () => void;
  initialEmail?: string;
  sessionExpired?: boolean;
}

const S = UI_STRINGS.vendorDirectoryLogin;

export default function VendorDirectoryLoginGate({
  onAuthenticated,
  initialEmail = '',
  sessionExpired = false,
}: VendorDirectoryLoginGateProps) {
  const [step, setStep] = useState<'EMAIL' | 'OTP'>('EMAIL');
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    sessionExpired ? S.sessionExpiredNotice : null
  );
  const [resendCountdown, setResendCountdown] = useState(0);

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const startResendCountdown = useCallback(
    (seconds: number = VENDOR_DIRECTORY_AUTH_CONFIG.OTP_TTL_SECONDS) => {
      setResendCountdown(seconds);
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      countdownTimerRef.current = setInterval(() => {
        setResendCountdown((prev) => {
          if (prev <= 1) {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    []
  );

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError(S.emptyEmail);
      return;
    }

    if (!cleanEmail.endsWith('@procucev.com')) {
      setError(S.procucevEmailRequired);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await requestVendorDirectoryOtp(cleanEmail);
      if (res.success) {
        setStep('OTP');
        setOtp('');
        startResendCountdown(res.expiresInSeconds || VENDOR_DIRECTORY_AUTH_CONFIG.OTP_TTL_SECONDS);
      } else {
        setError(res.error || S.networkError);
      }
    } catch {
      setError(S.networkError);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = otp.trim();

    if (!cleanOtp) {
      setError(S.emptyOtp);
      return;
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      setError(S.invalidOtp);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyVendorDirectoryOtp(email, cleanOtp);
      if (res.success) {
        onAuthenticated();
      } else {
        setError(res.error || S.invalidOtp);
      }
    } catch {
      setError(S.networkError);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setStep('EMAIL');
    setOtp('');
    setError(null);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    setResendCountdown(0);
  };

  return (
    <div
      data-testid="vendor-directory-login-gate"
      className="min-h-[82vh] flex items-center justify-center px-4 py-12 relative overflow-hidden"
    >
      {/* Background Ambient Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 sm:w-[520px] h-96 sm:h-[520px] bg-gradient-to-br from-indigo-500/10 via-blue-500/10 to-teal-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-lg relative z-10">
        {/* Gate Card */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-10 transition-all">
          {/* Header Badge */}
          <div className="flex items-center justify-between mb-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>{S.badge}</span>
            </div>
            <div className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
              <Lock size={12} />
              <span>{S.securedAccess}</span>
            </div>
          </div>

          {/* Title & Description */}
          <div className="text-left mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/25 mb-4">
              <Building2 size={28} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {step === 'EMAIL' ? S.title : S.otpStepTitle}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {step === 'EMAIL'
                ? S.subtitle
                : formatString(S.otpStepSubtitle, { email: email.trim().toLowerCase() })}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              data-testid="gate-error-banner"
              role="alert"
              className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs sm:text-sm flex items-start gap-3 animate-in fade-in duration-200"
            >
              <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="leading-snug">{error}</div>
            </div>
          )}


          {/* STEP 1: Enter Procucev Email */}
          {step === 'EMAIL' && (
            <form onSubmit={handleRequestOtp} className="space-y-5">
              <div>
                <label
                  htmlFor="directory-email-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2"
                >
                  {S.emailLabel}
                </label>
                <div className="relative">
                  <input
                    id="directory-email-input"
                    data-testid="directory-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder={S.emailPlaceholder}
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    autoComplete="email"
                    disabled={loading}
                    required
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Must end in <strong className="text-indigo-600 dark:text-indigo-400 font-semibold">@procucev.com</strong>
                </p>
              </div>

              {/* Submit Email Button */}
              <button
                type="submit"
                data-testid="directory-request-otp-submit"
                disabled={loading || !email.trim()}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-700 hover:via-indigo-700 hover:to-indigo-800 text-white font-semibold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/35 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{S.sendingOtp}</span>
                  </>
                ) : (
                  <>
                    <span>{S.sendOtpButton}</span>
                    <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* STEP 2: Enter 6-digit OTP */}
          {step === 'OTP' && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="directory-otp-input"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
                  >
                    {S.otpLabel}
                  </label>
                  <button
                    type="button"
                    onClick={handleChangeEmail}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 font-semibold"
                  >
                    <ArrowLeft size={12} />
                    <span>{S.changeEmail}</span>
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <KeyRound size={16} />
                  </div>
                  <input
                    id="directory-otp-input"
                    data-testid="directory-otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setOtp(val);
                      if (error) setError(null);
                    }}
                    placeholder={S.otpPlaceholder}
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 font-mono text-base tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    autoComplete="one-time-code"
                    disabled={loading}
                    autoFocus
                    required
                  />
                </div>
              </div>

              {/* Resend OTP Action */}
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-500 dark:text-slate-400">
                  {resendCountdown > 0
                    ? formatString(S.resendIn, {
                        time: formatOtpTimer(resendCountdown),
                        seconds: formatOtpTimer(resendCountdown),
                      })
                    : S.didNotReceiveOtp}
                </span>
                <button
                  type="button"
                  data-testid="resend-otp-btn"
                  disabled={resendCountdown > 0 || loading}
                  onClick={() => handleRequestOtp()}
                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  <span>{S.resendOtp}</span>
                </button>
              </div>

              {/* Submit OTP Button */}
              <button
                type="submit"
                data-testid="directory-verify-otp-submit"
                disabled={loading || otp.trim().length !== 6}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-700 hover:via-indigo-700 hover:to-indigo-800 text-white font-semibold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/35 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{S.verifyingOtp}</span>
                  </>
                ) : (
                  <>
                    <span>{S.verifyButton}</span>
                    <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Restriction Notice */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
              {S.directoryNotice}
            </p>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-3.5 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400 font-medium">
                {S.mainLoginDesc}
              </span>
              <Link
                href="/login"
                className="font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <span>{S.backToMainLogin}</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
