'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApp, clearSessionCache } from '@/lib/store';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ROLE_SIDEBAR_NAV, LOGIN_ROUTE, RFQ_MODES, RFQ_MODE_LABELS, hasUnlimitedAccess } from '@/lib/constants';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import NotificationBell from '@/app/components/NotificationBell';
import AccountSecurityPanel from '@/app/components/AccountSecurityPanel';
import { deriveInitials, resolveSessionOrgName } from '@/lib/accountIdentity';
import type { UserRole } from '@/lib/types';
import {
  ShieldCheck,
  ChevronDown,
  Sun,
  Moon,
  LogOut,
  Key,
  Clock,
  Building2,
  LogIn,
} from 'lucide-react';

/**
 * Presentation metadata per role. Deliberately contains no identity data: the
 * name, email and organisation shown in the profile dropdown come from the
 * signed-in session record, so nothing on screen is invented.
 */
interface RoleChrome {
  designation: string;
  authLabel: string;
  avatarGradient: string;
  badge: string;
  badgeClass: string;
}

const ROLE_CHROME: Record<UserRole, RoleChrome> = {
  buyer: {
    designation: 'Enterprise Buyer',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-indigo-600 to-indigo-800 text-white',
    badge: 'Buyer',
    badgeClass:
      'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  },
  category_manager: {
    designation: 'Category Manager',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-sky-600 to-blue-700 text-white',
    badge: 'Category Desk',
    badgeClass:
      'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  },
  vendor: {
    designation: 'Vendor Partner',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-emerald-600 to-teal-700 text-white',
    badge: 'Vendor',
    badgeClass:
      'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  admin: {
    designation: 'Platform Administrator',
    authLabel: 'Verified against enterprise user directory',
    avatarGradient: 'from-purple-600 to-indigo-800 text-white',
    badge: 'Admin',
    badgeClass:
      'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  },
};

/** Human label for the authentication method recorded on the session. */
function authMethodLabel(method?: string): string | null {
  if (method === 'PASSWORD') return 'Password verified';
  if (method === 'EMAIL_OTP') return 'Email OTP verified';
  return null;
}

/** Format remaining session duration as MM:SS (or HH:MM:SS if > 1hr). */
export function formatSessionCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function Header() {
  const {
    currentRole,
    setCurrentRole,
    isLoggedIn,
    setIsLoggedIn,
    theme,
    toggleTheme,
    showToast,
    addAuditLog,
    activeBuyerAccount,
    currentUserSession,
    setCurrentUserSession,
    remainingFreeRFQs,
    activeSubscription,
    vendorFreeCreditsRemaining,
    vendorSubscription,
  } = useApp();

  const router = useRouter();
  const pathname = usePathname();

  const [userProfileDropdownOpen, setUserProfileDropdownOpen] = useState(false);

  // Visibility of the Account & Security overlay. The forms inside it live in
  // AccountSecurityPanel, which owns its own field state.
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  // Everything shown about the user comes from the verified session record.
  const chrome = ROLE_CHROME[currentRole] || ROLE_CHROME.buyer;
  const sessionName = currentUserSession?.name?.trim() || '';
  const sessionEmail = currentUserSession?.email || '';
  const initials = deriveInitials(sessionName, sessionEmail);
  const authLabel = authMethodLabel(currentUserSession?.authMethod) || chrome.authLabel;
  const moduleCount = ROLE_SIDEBAR_NAV[currentRole]?.length ?? 0;

  // The organisation on the verified session record is authoritative; see
  // resolveSessionOrgName for why the active buyer account is only a conditional
  // fallback.
  const currentOrgName = resolveSessionOrgName(currentUserSession, activeBuyerAccount);

  // Session timeout state: 3 hours for category manager (10800s), standard 30 minutes for other roles (1800s)
  const SESSION_DURATION_SECONDS = currentRole === 'category_manager' ? 3 * 60 * 60 : 30 * 60;
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState<number>(SESSION_DURATION_SECONDS);

  const handleLogout = useCallback(() => {
    setUserProfileDropdownOpen(false);
    clearSessionCache();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('procucev_session_expires_at');
      localStorage.removeItem('procucev_session_role');
    }
    addAuditLog('User logged out of session', undefined, sessionEmail || undefined);
    setIsLoggedIn(false);
    setCurrentUserSession(null);
    setCurrentRole('buyer');
    authClient.logout(sessionEmail || undefined).catch(() => {});
    showToast(UI_STRINGS.auth.loggedOutTitle, UI_STRINGS.auth.loggedOutMessage, 'info');
    router.replace(LOGIN_ROUTE);
  }, [addAuditLog, router, sessionEmail, setCurrentRole, setCurrentUserSession, setIsLoggedIn, showToast]);

  const handleAutoLogout = useCallback(() => {
    setUserProfileDropdownOpen(false);
    clearSessionCache();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('procucev_session_expires_at');
      localStorage.removeItem('procucev_session_role');
    }
    addAuditLog('Session expired - automatic logout', undefined, sessionEmail || undefined);
    setIsLoggedIn(false);
    setCurrentUserSession(null);
    setCurrentRole('buyer');
    authClient.logout(sessionEmail || undefined).catch(() => {});
    showToast('Session Expired', 'Your session has expired. You have been logged out automatically for security.', 'warning');
    router.replace(LOGIN_ROUTE);
  }, [addAuditLog, router, sessionEmail, setCurrentRole, setCurrentUserSession, setIsLoggedIn, showToast]);

  const handleExtendSession = useCallback(() => {
    if (typeof window !== 'undefined') {
      const newExpiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
      localStorage.setItem('procucev_session_expires_at', String(newExpiresAt));
      localStorage.setItem('procucev_session_role', currentRole);
    }
    setSessionSecondsLeft(SESSION_DURATION_SECONDS);
    const durationLabel = currentRole === 'category_manager' ? '3 hours' : '30 minutes';
    showToast('Session Extended', `Your session has been extended by ${durationLabel}.`, 'info');
  }, [SESSION_DURATION_SECONDS, currentRole, showToast]);

  useEffect(() => {
    if (!isLoggedIn) return;

    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('procucev_session_expires_at');
      const storedRole = localStorage.getItem('procucev_session_role');
      const now = Date.now();
      let expiresAt = stored ? Number(stored) : NaN;
      const roleChanged = Boolean(storedRole && storedRole !== currentRole);
      if (!expiresAt || isNaN(expiresAt) || expiresAt <= now || roleChanged) {
        expiresAt = now + SESSION_DURATION_SECONDS * 1000;
        localStorage.setItem('procucev_session_expires_at', String(expiresAt));
        localStorage.setItem('procucev_session_role', currentRole);
      }
      setSessionSecondsLeft(Math.max(0, Math.floor((expiresAt - now) / 1000)));
    }

    const interval = setInterval(() => {
      if (typeof window === 'undefined') return;
      const stored = localStorage.getItem('procucev_session_expires_at');
      const now = Date.now();
      const expiresAt = stored ? Number(stored) : now + SESSION_DURATION_SECONDS * 1000;
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setSessionSecondsLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        handleAutoLogout();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoggedIn, handleAutoLogout, SESSION_DURATION_SECONDS, currentRole]);

  if (!isLoggedIn) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0b0f19] transition-colors">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-10 xl:px-16 py-1.5 sm:py-2 flex items-center justify-between gap-3">
          {/* Brand & Logo: Procucev | QUA AI | version pill */}
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <img
              src="/procucev-logo.png"
              alt="Procucev Logo"
              className="h-6 sm:h-8 lg:h-9 w-auto object-contain shrink-0"
            />
            <div className="h-6 sm:h-7 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />
            <img
              src="/qua-ai-logo.jpeg"
              alt="Qua AI Logo"
              className="h-8 sm:h-10 lg:h-11 w-auto object-contain shrink-0"
            />
            <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#EEF2FA] dark:bg-slate-800 text-[#0B1B3D] dark:text-slate-200 border border-[#CBD5E8] dark:border-slate-700 shrink-0">
              QUA AI 2.0
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {pathname !== '/login' && (
              <Link
                href="/login"
                className="px-3 sm:px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all text-xs sm:text-sm font-semibold shadow-xs flex items-center gap-1.5"
                title={UI_STRINGS.headerNav.signIn}
              >
                <LogIn size={15} />
                <span>{UI_STRINGS.headerNav.signIn}</span>
              </Link>
            )}
            <button
              onClick={toggleTheme}
              className="px-2.5 sm:px-3 py-1 rounded-xl bg-white dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-[#0B1B3D] dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-xs"
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
            <a
              href="mailto:support@procucev.com"
              className="px-2.5 sm:px-3 py-1 rounded-xl bg-white dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-[#0B1B3D] dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-xs"
            >
              <span className="sm:hidden">{UI_STRINGS.headerNav.support}</span>
              <span className="hidden sm:inline">{UI_STRINGS.headerNav.needSupport}</span>
            </a>
          </div>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b0f19]/95 backdrop-blur-xl transition-colors">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Logo */}
        <div className="flex items-center gap-3 py-1">
          <div className="bg-white dark:bg-white/95 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 shadow-sm flex items-center gap-3">
            <img src="/procucev-logo.png" alt="Procucev Logo" className="h-10 sm:h-11 w-auto object-contain shrink-0" />
            <div className="h-7 w-[1px] bg-slate-200 shrink-0" />
            <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-10 sm:h-11 w-auto object-contain rounded shrink-0" />
          </div>
          <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 shrink-0 self-center hidden sm:inline-block">
            QUA AI 2.0
          </span>
        </div>

        {/* The buyer/CM "Sourcing Mode" and vendor "Access Tier" quick-switchers
            that used to render here have been removed entirely, not just
            gated: sourcing mode is a per-RFQ decision made in the RFQ
            creation modal, and vendor tier changes go through the real,
            payment-gated vendor-subscription screen. A global, always-visible
            header toggle that could flip either independent of any specific
            RFQ or payment had no legitimate purpose once real per-mode
            entitlement existed — it was pure surface area for confusion/
            misuse, not a feature worth preserving. */}

        {/* Right Section: Buyer Credits / Active Plan, Theme Toggle, Notifications, and Sleek Corner User Profile Box */}
        <div className="flex items-center gap-2 sm:gap-3">
          {currentRole === 'category_manager' && (
            <Link
              href="/vendors"
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-xs"
              title={UI_STRINGS.headerNav.vendorDirectory}
            >
              <Building2 size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>{UI_STRINGS.headerNav.vendorDirectory}</span>
            </Link>
          )}
          {/* Buyer Credits / Active Plan Display */}
          {currentRole === 'buyer' && (
            <>
              {(!activeSubscription || activeSubscription === 'free_trial') ? (
                <div
                  className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-slate-50/80 dark:bg-gray-900/80 border border-slate-200 dark:border-gray-800 shadow-xs"
                  title={`Sourcing Credits: Total 5, Used ${Math.max(0, 5 - (remainingFreeRFQs ?? 5))}, Remaining ${remainingFreeRFQs ?? 5}`}
                >
                  <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300">Sourcing Credits:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                    Total: 5
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                    Used: {Math.max(0, 5 - (remainingFreeRFQs ?? 5))}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                    Remaining: {remainingFreeRFQs ?? 5}
                  </span>
                </div>
              ) : (
                <div
                  className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 shadow-xs"
                  title={`Active Plan: ${activeSubscription === 'version_1' ? RFQ_MODE_LABELS[RFQ_MODES.MODE_1] : activeSubscription === 'version_2' ? RFQ_MODE_LABELS[RFQ_MODES.MODE_2] : activeSubscription === 'version_3' ? RFQ_MODE_LABELS[RFQ_MODES.MODE_3] : activeSubscription}`}
                >
                  <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">Active Plan:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-600 text-white shadow-xs">
                    {activeSubscription === 'version_1' ? RFQ_MODE_LABELS[RFQ_MODES.MODE_1] : activeSubscription === 'version_2' ? RFQ_MODE_LABELS[RFQ_MODES.MODE_2] : activeSubscription === 'version_3' ? RFQ_MODE_LABELS[RFQ_MODES.MODE_3] : activeSubscription}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Vendor Free RFQ Download Credits Display */}
          {currentRole === 'vendor' && (
            <div
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-xl border shadow-xs transition-colors ${
                (vendorFreeCreditsRemaining ?? 0) > 0
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800'
              }`}
              title={`Free RFQ Credits: ${vendorFreeCreditsRemaining ?? 0} remaining`}
            >
              <span
                className={`text-[11px] font-bold ${
                  (vendorFreeCreditsRemaining ?? 0) > 0
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-rose-800 dark:text-rose-300'
                }`}
              >
                Free RFQ Credits:
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                  (vendorFreeCreditsRemaining ?? 0) > 0
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {vendorFreeCreditsRemaining ?? 0}
              </span>
            </div>
          )}

          {/* Active Session Countdown & Auto Logout Indicator */}
          <div
            data-testid="header-session-timer"
            onClick={handleExtendSession}
            title={`Active Session: ${formatSessionCountdown(sessionSecondsLeft)} remaining. Click to extend by ${currentRole === 'category_manager' ? '3 hrs' : '30 mins'}.`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleExtendSession();
              }
            }}
            className={`cursor-pointer select-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold shadow-xs transition-all ${
              sessionSecondsLeft <= 60
                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700 animate-pulse'
                : sessionSecondsLeft <= 300
                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                : 'bg-slate-100 dark:bg-gray-800 border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700'
            }`}
          >
            <Clock
              size={14}
              className={`${
                sessionSecondsLeft <= 60
                  ? 'text-rose-600 dark:text-rose-400 animate-spin'
                  : sessionSecondsLeft <= 300
                  ? 'text-amber-500 fill-amber-500/20'
                  : 'text-indigo-600 dark:text-indigo-400'
              }`}
            />
            <span className="hidden sm:inline text-[11px] font-semibold text-slate-500 dark:text-gray-400">
              Session:
            </span>
            <span className="font-mono text-xs font-bold">
              {formatSessionCountdown(sessionSecondsLeft)}
            </span>
          </div>

          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-sm"
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          >
            {theme === 'light' ? (
              <>
                <Sun size={15} className="text-amber-500 fill-amber-500" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon size={15} className="text-indigo-400 fill-indigo-400" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>

          {/* Notifications — real per-recipient inbox for vendor/buyer, AI chaser feed for CM/admin */}
          <NotificationBell />

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SLEEK CORNER USER PROFILE BOX & PERSONA SWITCHER */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="relative pl-1 border-l border-slate-200 dark:border-gray-800">
            <button
              onClick={() => setUserProfileDropdownOpen(!userProfileDropdownOpen)}
              className="flex items-center gap-2.5 p-1.5 pr-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-gray-800/80 transition-all border border-slate-200/80 dark:border-gray-700/60 bg-slate-50/50 dark:bg-gray-900/50 shadow-xs text-left group"
              title="Signed-in account details"
            >
              {/* Dynamic Avatar with Active Indicator */}
              <div
                className={`w-9 h-9 rounded-xl bg-gradient-to-br ${chrome.avatarGradient} flex items-center justify-center text-xs font-black shadow-sm shrink-0 relative`}
              >
                {initials}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900" />
              </div>

              {/* User Identity Details */}
              <div className="hidden lg:block text-left max-w-[150px]">
                <p className="text-xs font-black text-slate-900 dark:text-white leading-tight truncate">
                  {sessionName || sessionEmail}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate leading-tight mt-0.5 font-medium">
                  {currentOrgName}
                </p>
              </div>

              <ChevronDown
                size={14}
                className={`text-slate-400 group-hover:text-slate-600 dark:group-hover:text-gray-200 transition-transform ${
                  userProfileDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Corner Box Popover: User Details & Role Persona Switcher */}
            {userProfileDropdownOpen && (
              <div className="absolute top-full mt-2 w-84 sm:w-96 right-0 bg-white dark:bg-gray-900 border-2 border-slate-200 dark:border-gray-700 rounded-3xl shadow-2xl p-4 z-50 backdrop-blur-2xl animate-scale-up space-y-4">
                {/* Active Persona Header Card */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/50 dark:from-gray-800/80 dark:to-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${chrome.avatarGradient} flex items-center justify-center text-sm font-black shadow-md shrink-0`}
                      >
                        {initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs font-black text-slate-900 dark:text-white">
                            {sessionName || sessionEmail}
                          </h4>
                          <span
                            className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${chrome.badgeClass}`}
                          >
                            {chrome.badge}
                          </span>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-600 dark:text-gray-300 mt-0.5">
                          {chrome.designation}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Active Login Details & Organization Box */}
                  <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900/90 border border-slate-200/80 dark:border-gray-800 text-[11px] space-y-1.5">
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px]">
                      <span>Organization:</span>
                      <strong className="text-slate-900 dark:text-white">{currentOrgName}</strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px]">
                      <span>User Name (Login ID):</span>
                      <strong className="mono font-bold text-indigo-600 dark:text-indigo-400">
                        {sessionEmail}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px] pt-1 border-t border-slate-100 dark:border-gray-800/80">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <ShieldCheck size={12} /> {authLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Workspace Summary (read-only, derived from the session) */}
                <div className="px-1 flex items-center justify-between text-[10px]">
                  <span className="font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                    Active Workspace
                  </span>
                  <span className="font-mono text-slate-500 dark:text-gray-400">
                    {chrome.designation} · {moduleCount} modules
                  </span>
                </div>
                {/* Session Actions Footer */}
                <div className="pt-2 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between gap-2 text-xs">
                  {currentRole !== 'buyer' && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserProfileDropdownOpen(false);
                        setAccountModalOpen(true);
                      }}
                      className="btn btn-ghost btn-xs font-bold text-slate-600 dark:text-gray-300 flex items-center gap-1"
                    >
                      <Key size={12} /> {UI_STRINGS.accountSecurity.menuLabel}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="btn btn-ghost btn-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1"
                  >
                    <LogOut size={12} /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>

    {/* Account Settings & Security Modal */}
    {accountModalOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-security-modal-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setAccountModalOpen(false);
          }
        }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in"
      >
        <div className="relative bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden space-y-0 my-auto">
          {/* Modal Header */}
          <div className="p-5 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-950/40">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${chrome.avatarGradient} flex items-center justify-center font-black text-sm`}
              >
                {initials}
              </div>
              <div>
                <h3
                  id="account-security-modal-title"
                  className="text-base font-extrabold text-slate-900 dark:text-white"
                >
                  {UI_STRINGS.accountSecurity.panelTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  {sessionEmail} • {currentOrgName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAccountModalOpen(false)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 cursor-pointer"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 max-h-[75vh] overflow-y-auto">
            <AccountSecurityPanel />
          </div>

          {/* Modal Footer */}
          <div className="p-4 border-t border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/40 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setAccountModalOpen(false)}
              className="btn btn-secondary text-xs px-5 font-bold cursor-pointer"
            >
              {UI_STRINGS.accountSecurity.closeAction}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
}
