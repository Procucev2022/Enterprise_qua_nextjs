'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { SOURCING_MODES } from '@/lib/mock-data';
import { SourcingMode, UserRole } from '@/lib/types';
import {
  ShieldCheck,
  ChevronDown,
  Bell,
  Layers,
  Sparkles,
  User,
  CheckCircle2,
  Cpu,
  Building2,
  Truck,
  SlidersHorizontal,
  Sun,
  Moon,
  LogOut,
  Key,
  Mail,
  Check,
  ArrowRight,
  UserCheck,
  Building,
} from 'lucide-react';

interface UserPersona {
  role: UserRole;
  name: string;
  designation: string;
  organization: string;
  email: string;
  authMethod: string;
  avatarGradient: string;
  initials: string;
  screensCount: number;
  badge: string;
  badgeClass: string;
  scopeSummary: string;
}

const USER_PERSONAS: Record<UserRole, UserPersona> = {
  buyer: {
    role: 'buyer',
    name: 'Rajesh Sharma',
    designation: 'Chief Procurement Officer (CPO)',
    organization: 'Larsen & Toubro Limited',
    email: 'buyer@procucev.com',
    authMethod: 'Azure AD SSO • Enterprise Gateway',
    avatarGradient: 'from-indigo-600 to-indigo-800 text-white',
    initials: 'RS',
    screensCount: 7,
    badge: 'Enterprise Buyer',
    badgeClass: 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    scopeSummary: '5 Free RFQs Available across all versions • 7 Modules',
  },
  category_manager: {
    role: 'category_manager',
    name: 'Priya Sen',
    designation: 'Lead Category Manager (Mechanical)',
    organization: 'Procucev Category Desk',
    email: 'catmanager@procucev.com',
    authMethod: 'Internal SSO • Level 3 Approver',
    avatarGradient: 'from-sky-600 to-blue-700 text-white',
    initials: 'PS',
    screensCount: 6,
    badge: 'Category Desk',
    badgeClass: 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    scopeSummary: 'Autonomous AI Kanban Desk & Analytics • 6 Modules',
  },
  vendor: {
    role: 'vendor',
    name: 'Rajesh Nair',
    designation: 'Managing Director',
    organization: 'Apex Supplies Ltd.',
    email: 'rajesh@apexsupplies.in',
    authMethod: 'Password + Email OTP Verified',
    avatarGradient: 'from-emerald-600 to-teal-700 text-white',
    initials: 'RN',
    screensCount: 6,
    badge: '⭐ Premium Vendor',
    badgeClass: 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-700',
    scopeSummary: 'Empanelled by L&T • 360° AI Self-Evaluation • 6 Modules',
  },
  admin: {
    role: 'admin',
    name: 'Arun Mehta',
    designation: 'Chief Compliance Officer',
    organization: 'Platform Governance & Security',
    email: 'admin@procucev.com',
    authMethod: 'MFA Hardware Key Verified',
    avatarGradient: 'from-purple-600 to-indigo-800 text-white',
    initials: 'AM',
    screensCount: 2,
    badge: 'Admin & Auditor',
    badgeClass: 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    scopeSummary: 'SHA-256 Compliance Logs & Azure Health • 2 Modules',
  },
};

export default function Header() {
  const {
    currentRole,
    setCurrentRole,
    isLoggedIn,
    setIsLoggedIn,
    currentMode,
    setCurrentMode,
    vendorSubscription,
    setVendorSubscription,
    vendorRfqDownloadsUsed,
    aiFeed,
    theme,
    toggleTheme,
    showToast,
    addAuditLog,
    activeBuyerAccount,
  } = useApp();

  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [userProfileDropdownOpen, setUserProfileDropdownOpen] = useState(false);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  // Account Settings Modal State
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const activePersona = USER_PERSONAS[currentRole] || USER_PERSONAS.buyer;
  const currentOrgName = currentRole === 'buyer' && activeBuyerAccount?.organizationName 
    ? activeBuyerAccount.organizationName 
    : activePersona.organization;

  const handleUpdateDisplayName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDisplayName.trim()) {
      showToast('Validation Error', 'Display Name cannot be empty.', 'warning');
      return;
    }
    showToast('Profile Updated', `Account display name set to: ${userDisplayName}`, 'success');
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword.trim()) {
      showToast('Validation Error', 'Please enter your current password.', 'warning');
      return;
    }
    if (newPassword.length < 8) {
      showToast('Weak Password', 'New password must be at least 8 characters long.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Password Mismatch', 'New password and confirmation do not match.', 'warning');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    showToast('Password Changed Successfully', 'Your account credentials have been updated and encrypted with Azure KeyVault.', 'success');
  };

  const activeModeObj = SOURCING_MODES.find((m) => m.id === currentMode) || SOURCING_MODES[1];

  const handleModeSelect = (modeId: SourcingMode) => {
    setCurrentMode(modeId);
    setModeDropdownOpen(false);
    const selected = SOURCING_MODES.find((m) => m.id === modeId);
    showToast('Sourcing Mode Updated', `Active platform mode switched to: ${selected?.name}`, 'info');
  };

  const handleVendorSubscriptionSelect = (tier: 'premium' | 'connect' | 'select') => {
    setVendorSubscription(tier);
    setModeDropdownOpen(false);
    const tierName = tier === 'premium' ? 'Premium (Client Uploaded)' : tier === 'connect' ? 'Connect Model ($149)' : 'Select Model ($349)';
    showToast('Vendor Tier Switched', `Active vendor access model set to: ${tierName}`, 'success');
  };

  const handleSwitchPersona = (role: UserRole) => {
    setCurrentRole(role);
    setUserProfileDropdownOpen(false);
    const persona = USER_PERSONAS[role];
    addAuditLog(`Switched operational demo persona to ${persona.name} (${persona.organization})`, undefined, persona.email);
    showToast(
      'Session Switched',
      `Now logged in as ${persona.name} (${persona.organization}) • ${persona.email}`,
      'success'
    );
  };

  const handleLogout = () => {
    setUserProfileDropdownOpen(false);
    setIsLoggedIn(false);
    addAuditLog('User logged out of session');
    showToast('Logged Out', 'You have been safely signed out.', 'info');
  };

  if (!isLoggedIn) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-[#0b0f19]/90 backdrop-blur-xl transition-colors">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand & Logo */}
          <div className="flex items-center gap-3 py-1">
            <div className="bg-white dark:bg-white/95 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 shadow-sm flex items-center gap-3">
              <img src="/procucev-logo.png" alt="Procucev Logo" className="h-10 sm:h-11 w-auto object-contain shrink-0" />
              <div className="h-7 w-[1px] bg-slate-200 shrink-0" />
              <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-10 sm:h-11 w-auto object-contain rounded shrink-0" />
            </div>
            <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 shrink-0 self-center">
              QUA AI 2.0
            </span>
          </div>

          {/* Minimal Login Header Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-sm"
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
            <a
              href="mailto:support@procucev.com"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 transition-all"
            >
              Need Support?
            </a>
          </div>
        </div>
      </header>
    );
  }

  return (
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

        {/* Dynamic Mode Indicator: Sourcing Mode for Buyers/CMs vs Vendor Tier for Vendors */}
        <div className="relative">
          {currentRole === 'vendor' ? (
            /* VENDOR ACCESS TIER PILL */
            <button
              onClick={() => {
                setModeDropdownOpen(!modeDropdownOpen);
                setUserProfileDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/60 hover:border-emerald-500 transition-all text-xs font-medium text-emerald-900 dark:text-emerald-200 shadow-sm"
              title="Vendor Subscription Access Model"
            >
              <Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-700 dark:text-emerald-400 font-bold hidden md:inline">Vendor Model:</span>
              <span className="font-extrabold px-2 py-0.5 rounded bg-emerald-600 text-white shadow-xs">
                {vendorSubscription === 'premium'
                  ? 'Premium Model (Client Uploaded)'
                  : vendorSubscription === 'connect'
                  ? 'Connect Model ($149 / 3mo)'
                  : 'Select Model ($349 / 3mo)'}
              </span>
              <ChevronDown size={14} className={`text-emerald-600 dark:text-emerald-400 transition-transform ${modeDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            /* BUYER / CM SOURCING MODE PILL */
            <button
              onClick={() => {
                setModeDropdownOpen(!modeDropdownOpen);
                setUserProfileDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-gray-900/80 border border-slate-300 dark:border-gray-700/60 hover:border-indigo-500 transition-all text-xs font-medium text-slate-800 dark:text-gray-200 shadow-sm"
              title="Switch Sourcing Mode"
            >
              <Layers size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span className="text-slate-500 dark:text-gray-400 hidden md:inline">Sourcing Mode:</span>
              <span className="font-extrabold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                {activeModeObj.code}: {activeModeObj.shortLabel}
              </span>
              <ChevronDown size={14} className={`text-slate-400 dark:text-gray-400 transition-transform ${modeDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
          )}

          {/* Mode Dropdown Menu */}
          {modeDropdownOpen && (
            <div className="absolute top-full mt-2 w-80 sm:w-96 left-0 sm:left-auto sm:right-0 bg-white dark:bg-gray-900/95 border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl p-2 z-50 backdrop-blur-xl animate-fade-in">
              {currentRole === 'vendor' ? (
                /* Vendor Subscription Tier Options */
                <>
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-gray-800">
                    <p className="text-xs font-bold text-slate-800 dark:text-gray-300 uppercase tracking-wider">Vendor Access Tiers &amp; Quotas</p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400">Controls direct RFQ downloads and marketplace listing</p>
                  </div>
                  <div className="mt-1 space-y-1">
                    <button
                      onClick={() => handleVendorSubscriptionSelect('premium')}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                        vendorSubscription === 'premium'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-600 text-emerald-900 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/60 text-slate-700 dark:text-gray-300 border border-transparent'
                      }`}
                    >
                      <CheckCircle2 size={16} className={vendorSubscription === 'premium' ? 'text-emerald-600' : 'text-slate-300'} />
                      <div>
                        <div className="font-bold text-xs">Premium Model (Client Uploaded)</div>
                        <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Free for uploaded vendors • Unlimited direct buyer RFQ access</div>
                      </div>
                    </button>

                    <button
                      onClick={() => handleVendorSubscriptionSelect('connect')}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                        vendorSubscription === 'connect'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-600 text-emerald-900 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/60 text-slate-700 dark:text-gray-300 border border-transparent'
                      }`}
                    >
                      <CheckCircle2 size={16} className={vendorSubscription === 'connect' ? 'text-emerald-600' : 'text-slate-300'} />
                      <div>
                        <div className="font-bold text-xs">Connect Model ($149 / 3 Months)</div>
                        <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">50 RFQ downloads in 3 months ({vendorRfqDownloadsUsed}/50 used) • $0 Self-Evaluation Fee</div>
                      </div>
                    </button>

                    <button
                      onClick={() => handleVendorSubscriptionSelect('select')}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                        vendorSubscription === 'select'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-600 text-emerald-900 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/60 text-slate-700 dark:text-gray-300 border border-transparent'
                      }`}
                    >
                      <CheckCircle2 size={16} className={vendorSubscription === 'select' ? 'text-emerald-600' : 'text-slate-300'} />
                      <div>
                        <div className="font-bold text-xs">Select Model ($349 / 3 Months)</div>
                        <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Item Catalogue (Max 100 SKUs) + 100 RFQs • $0 Self-Evaluation Fee</div>
                      </div>
                    </button>
                  </div>
                </>
              ) : (
                /* Buyer / CM Sourcing Mode Options */
                <>
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-gray-800">
                    <p className="text-xs font-semibold text-slate-800 dark:text-gray-300 uppercase tracking-wider">Select Sourcing Mode</p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400">Controls automated vendor pool dispatch logic</p>
                  </div>
                  <div className="mt-1 space-y-1">
                    {SOURCING_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => handleModeSelect(mode.id)}
                        className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                          currentMode === mode.id
                            ? 'bg-indigo-50 dark:bg-indigo-600/20 border border-indigo-300 dark:border-indigo-500/40 text-indigo-900 dark:text-white'
                            : 'hover:bg-slate-50 dark:hover:bg-gray-800/60 text-slate-700 dark:text-gray-300 border border-transparent'
                        }`}
                      >
                        <div className="mt-0.5">
                          {currentMode === mode.id ? (
                            <CheckCircle2 size={16} className="text-indigo-600 dark:text-indigo-400" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-slate-400 dark:border-gray-600" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-slate-900 dark:text-gray-100">{mode.name}</div>
                          <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 leading-relaxed">{mode.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right Section: Theme Toggle, Notifications, and Sleek Corner User Profile Box */}
        <div className="flex items-center gap-2 sm:gap-3">
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

          {/* AI Notifications / Live Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setNotifDropdownOpen(!notifDropdownOpen);
                setModeDropdownOpen(false);
                setUserProfileDropdownOpen(false);
              }}
              className="relative p-2 rounded-xl bg-slate-100 dark:bg-gray-800/70 border border-slate-300 dark:border-gray-700 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-300 transition-all shadow-sm"
              title="Real-time AI Chaser Alerts"
            >
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500" />
            </button>

            {notifDropdownOpen && (
              <div className="absolute top-full mt-2 w-80 sm:w-96 right-0 bg-white dark:bg-gray-900/95 border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl p-3 z-50 backdrop-blur-xl animate-fade-in max-h-96 overflow-y-auto">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="live-dot" />
                    <span className="text-xs font-bold text-slate-800 dark:text-gray-200">Vendor Follow Up Status</span>
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-gray-400">{aiFeed.length} Events</span>
                </div>
                <div className="mt-2 space-y-2">
                  {aiFeed.slice(0, 6).map((item) => (
                    <div key={item.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 text-xs">
                      <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px] mb-1">
                        <span className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                          {item.type === 'call' || item.channel === 'call' ? (
                            <span className="text-purple-600 dark:text-purple-400 font-bold">📞 Call</span>
                          ) : item.type === 'whatsapp' || item.channel === 'whatsapp' ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">💬 WhatsApp</span>
                          ) : item.type === 'sms' || item.channel === 'sms' ? (
                            <span className="text-sky-600 dark:text-cyan-400 font-bold">📱 SMS</span>
                          ) : (
                            <Sparkles size={11} className="text-indigo-500" />
                          )}
                          <span className="text-slate-800 dark:text-gray-200">{item.title}</span>
                        </span>
                        <span className="mono">{item.timestamp}</span>
                      </div>
                      <p className="text-slate-700 dark:text-gray-300 text-[11px] leading-relaxed">{item.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SLEEK CORNER USER PROFILE BOX & PERSONA SWITCHER */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="relative pl-1 border-l border-slate-200 dark:border-gray-800">
            <button
              onClick={() => {
                setUserProfileDropdownOpen(!userProfileDropdownOpen);
                setModeDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2.5 p-1.5 pr-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-gray-800/80 transition-all border border-slate-200/80 dark:border-gray-700/60 bg-slate-50/50 dark:bg-gray-900/50 shadow-xs text-left group"
              title="Click to Switch Persona / User Login Details"
            >
              {/* Dynamic Avatar with Active Indicator */}
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${activePersona.avatarGradient} flex items-center justify-center text-xs font-black shadow-sm shrink-0 relative`}>
                {activePersona.initials}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900" />
              </div>

              {/* User Identity Details */}
              <div className="hidden lg:block text-left max-w-[150px]">
                <p className="text-xs font-black text-slate-900 dark:text-white leading-tight truncate">
                  {activePersona.name}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate leading-tight mt-0.5 font-medium">
                  {currentOrgName}
                </p>
              </div>

              <ChevronDown size={14} className={`text-slate-400 group-hover:text-slate-600 dark:group-hover:text-gray-200 transition-transform ${userProfileDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Corner Box Popover: User Details & Role Persona Switcher */}
            {userProfileDropdownOpen && (
              <div className="absolute top-full mt-2 w-84 sm:w-96 right-0 bg-white dark:bg-gray-900 border-2 border-slate-200 dark:border-gray-700 rounded-3xl shadow-2xl p-4 z-50 backdrop-blur-2xl animate-scale-up space-y-4">
                {/* Active Persona Header Card */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/50 dark:from-gray-800/80 dark:to-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${activePersona.avatarGradient} flex items-center justify-center text-sm font-black shadow-md shrink-0`}>
                        {activePersona.initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs font-black text-slate-900 dark:text-white">{activePersona.name}</h4>
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${activePersona.badgeClass}`}>
                            {activePersona.badge}
                          </span>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-600 dark:text-gray-300 mt-0.5">{activePersona.designation}</p>
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
                      <strong className="mono font-bold text-indigo-600 dark:text-indigo-400">{activePersona.email}</strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px] pt-1 border-t border-slate-100 dark:border-gray-800/80">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <ShieldCheck size={12} /> {activePersona.authMethod}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Persona Switcher Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                      Switch Active User / Demo Persona
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">4 Specification Roles</span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {(['buyer', 'category_manager', 'vendor', 'admin'] as UserRole[]).map((r) => {
                      const p = USER_PERSONAS[r];
                      const isSelected = currentRole === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => handleSwitchPersona(r)}
                          className={`w-full text-left p-2.5 rounded-2xl transition-all flex items-center justify-between border ${
                            isSelected
                              ? 'bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-600 ring-2 ring-indigo-500/20'
                              : 'bg-slate-50/60 dark:bg-gray-800/40 border-slate-200/70 dark:border-gray-800 hover:bg-slate-100 dark:hover:bg-gray-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${p.avatarGradient} flex items-center justify-center text-[11px] font-black shrink-0`}>
                              {p.initials}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-slate-900 dark:text-white">{p.name}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${p.badgeClass}`}>
                                  {p.badge}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 dark:text-gray-400 font-mono mt-0.5">
                                {p.email} · {p.screensCount} Screens
                              </p>
                            </div>
                          </div>

                          {isSelected ? (
                            <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                              <Check size={12} />
                            </div>
                          ) : (
                            <ArrowRight size={14} className="text-slate-300 dark:text-gray-600" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Session Actions Footer */}
                <div className="pt-2 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setUserProfileDropdownOpen(false);
                      setAccountModalOpen(true);
                    }}
                    className="btn btn-ghost btn-xs font-bold text-slate-600 dark:text-gray-300 flex items-center gap-1"
                  >
                    <Key size={12} /> Account &amp; Security
                  </button>

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

      {/* Account Settings & Security Modal */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden space-y-0">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-950/40">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${activePersona.avatarGradient} flex items-center justify-center font-black text-sm`}>
                  {activePersona.initials}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Account &amp; Security Settings</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">{activePersona.email} • {currentOrgName}</p>
                </div>
              </div>
              <button
                onClick={() => setAccountModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {/* Section 1: Display Name & Profile Details */}
              <form onSubmit={handleUpdateDisplayName} className="space-y-3 pb-5 border-b border-slate-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    <User size={14} className="text-indigo-600 dark:text-indigo-400" /> Account Display Name
                  </label>
                  <span className="text-[10px] text-slate-400">Visible across RFQ logs &amp; audits</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue={activePersona.name}
                    onChange={(e) => setUserDisplayName(e.target.value)}
                    placeholder="Enter your full display name..."
                    className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    className="btn btn-primary text-xs px-4 py-2 font-bold shrink-0"
                  >
                    Save Name
                  </button>
                </div>
              </form>

              {/* Section 2: Password Update */}
              <form onSubmit={handleChangePassword} className="space-y-4 pb-5 border-b border-slate-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" /> Change Security Password
                  </label>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">Azure SSO Active</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 characters"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500 dark:text-gray-400 space-y-1">
                    <p className="font-bold text-slate-700 dark:text-gray-300">Password Policy Requirements:</p>
                    <ul className="list-disc list-inside text-[10px] space-y-0.5 text-slate-500 dark:text-gray-400">
                      <li>At least 8 characters long</li>
                      <li>Includes at least 1 uppercase letter &amp; 1 special symbol (@, #, $, etc.)</li>
                      <li>Encrypted with Azure KeyVault 256-bit AES protection</li>
                    </ul>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="btn btn-secondary text-xs px-5 py-2 font-bold"
                    >
                      Update Password
                    </button>
                  </div>
                </div>
              </form>

              {/* Section 3: SSO & Security Info */}
              <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-900 dark:text-indigo-200">Organization &amp; Single Sign-On</span>
                  <span className="badge badge-purple text-[10px] font-mono">Azure AD Tenant</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-gray-300">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Connected Entity</span>
                    <strong className="text-slate-900 dark:text-white">{currentOrgName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Verified Email</span>
                    <strong className="text-slate-900 dark:text-white font-mono">{activePersona.email}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/40 flex items-center justify-end">
              <button
                onClick={() => setAccountModalOpen(false)}
                className="btn btn-secondary text-xs px-5 font-bold"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
