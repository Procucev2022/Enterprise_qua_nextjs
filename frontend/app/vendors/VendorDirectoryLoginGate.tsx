'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  KeyRound,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  AlertCircle,
  Building2,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import { DEFAULT_VENDOR_DIRECTORY_PASSKEY } from '@/lib/constants';
import { authenticateVendorDirectory } from '@/lib/vendorAuthClient';

interface VendorDirectoryLoginGateProps {
  onAuthenticated: () => void;
}

const S = UI_STRINGS.vendorDirectoryLogin;

export default function VendorDirectoryLoginGate({ onAuthenticated }: VendorDirectoryLoginGateProps) {
  const [passkey, setPasskey] = useState('');
  const [showPasskey, setShowPasskey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkey.trim()) {
      setError(S.emptyPasskey);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authenticateVendorDirectory(passkey);
      if (result.success) {
        onAuthenticated();
      } else {
        setError(result.error || S.invalidPasskey);
      }
    } catch {
      setError(S.invalidPasskey);
    } finally {
      setLoading(false);
    }
  };

  const handleUseDemoKey = () => {
    setPasskey(DEFAULT_VENDOR_DIRECTORY_PASSKEY);
    setError(null);
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
              {S.title}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {S.subtitle}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              data-testid="gate-error-banner"
              className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs sm:text-sm flex items-start gap-3 animate-in fade-in duration-200"
            >
              <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="leading-snug">{error}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="directory-passkey-input"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2"
              >
                {S.passkeyLabel}
              </label>
              <div className="relative">
                <input
                  id="directory-passkey-input"
                  data-testid="directory-passkey-input"
                  type={showPasskey ? 'text' : 'password'}
                  value={passkey}
                  onChange={(e) => {
                    setPasskey(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder={S.passkeyPlaceholder}
                  className="w-full pl-11 pr-12 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPasskey(!showPasskey)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label={showPasskey ? 'Hide passkey' : 'Show passkey'}
                  tabIndex={0}
                >
                  {showPasskey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Quick Demo Key Pre-fill */}
            <div className="flex items-center justify-between text-xs mt-3">
              <span className="text-slate-500 dark:text-slate-400">
                {S.quickAccessHint}{' '}
                <code className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  {DEFAULT_VENDOR_DIRECTORY_PASSKEY}
                </code>
              </span>
              <button
                type="button"
                data-testid="use-demo-key-btn"
                onClick={handleUseDemoKey}
                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold inline-flex items-center gap-1 transition-colors"
              >
                <Sparkles size={12} />
                <span>{S.useDemoKey}</span>
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              data-testid="directory-auth-submit"
              disabled={loading || !passkey.trim()}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-700 hover:via-indigo-700 hover:to-indigo-800 text-white font-semibold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/35 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 group cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{S.authenticating}</span>
                </>
              ) : (
                <>
                  <span>{S.submitButton}</span>
                  <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

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
