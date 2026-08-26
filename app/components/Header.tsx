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
  FileCheck,
  Sun,
  Moon,
} from 'lucide-react';

export default function Header() {
  const {
    currentRole,
    setCurrentRole,
    isLoggedIn,
    currentMode,
    setCurrentMode,
    vendorSubscription,
    setVendorSubscription,
    vendorRfqDownloadsUsed,
    aiFeed,
    theme,
    toggleTheme,
    showToast,
  } = useApp();

  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  // Account Settings Modal State
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [userDisplayName, setUserDisplayName] = useState('Rajesh Sharma (Lead Procurement)');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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

  const handleRoleSelect = (role: UserRole) => {
    setCurrentRole(role);
    setRoleDropdownOpen(false);
    showToast('Role Switched', `Now viewing platform as: ${getRoleTitle(role)}`, 'info');
  };

  const getRoleTitle = (role: UserRole) => {
    switch (role) {
      case 'buyer':
        return 'Larsen & Toubro Limited';
      case 'category_manager':
        return 'Procucev Category Desk';
      case 'vendor':
        return 'Apex Supplies Ltd.';
      case 'admin':
        return 'Procucev Platform Admin';
    }
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'buyer':
        return <Building2 size={16} className="text-indigo-600 dark:text-indigo-400" />;
      case 'category_manager':
        return <SlidersHorizontal size={16} className="text-sky-600 dark:text-cyan-400" />;
      case 'vendor':
        return <Truck size={16} className="text-emerald-600 dark:text-emerald-400" />;
      case 'admin':
        return <Cpu size={16} className="text-purple-600 dark:text-purple-400" />;
    }
  };

  const getUserEmail = () => {
    switch (currentRole) {
      case 'buyer':
        return 'client@procucev.com';
      case 'category_manager':
        return 'catmanager@procucev.com';
      case 'vendor':
        return 'vendor@apex.com';
      case 'admin':
        return 'admin@procucev.com';
    }
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

        {/* Dynamic Mode Indicator: Sourcing Mode for Buyers/CMs vs Vendor Tier for Vendors */}
        <div className="relative">
          {currentRole === 'vendor' ? (
            /* VENDOR ACCESS TIER PILL */
            <button
              onClick={() => {
                setModeDropdownOpen(!modeDropdownOpen);
                setRoleDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/60 hover:border-emerald-500 transition-all text-xs font-medium text-emerald-900 dark:text-emerald-200 shadow-sm"
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
                setRoleDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-900/80 border border-slate-300 dark:border-gray-700/60 hover:border-indigo-500 transition-all text-xs font-medium text-slate-800 dark:text-gray-200 shadow-sm"
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
            <div className="absolute top-full mt-2 w-80 sm:w-96 left-0 sm:left-auto sm:right-0 bg-white dark:bg-gray-900/95 border border-slate-200 dark:border-gray-700 rounded-xl shadow-2xl p-2 z-50 backdrop-blur-xl animate-fade-in">
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
                      className={`w-full text-left p-2.5 rounded-lg transition-all flex items-start gap-2.5 ${
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
                      className={`w-full text-left p-2.5 rounded-lg transition-all flex items-start gap-2.5 ${
                        vendorSubscription === 'connect'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-600 text-emerald-900 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/60 text-slate-700 dark:text-gray-300 border border-transparent'
                      }`}
                    >
                      <CheckCircle2 size={16} className={vendorSubscription === 'connect' ? 'text-emerald-600' : 'text-slate-300'} />
                      <div>
                        <div className="font-bold text-xs">Connect Model ($149 / 3 Months)</div>
                        <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">50 RFQ downloads in 3 months ({vendorRfqDownloadsUsed}/50 used)</div>
                      </div>
                    </button>

                    <button
                      onClick={() => handleVendorSubscriptionSelect('select')}
                      className={`w-full text-left p-2.5 rounded-lg transition-all flex items-start gap-2.5 ${
                        vendorSubscription === 'select'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-600 text-emerald-900 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/60 text-slate-700 dark:text-gray-300 border border-transparent'
                      }`}
                    >
                      <CheckCircle2 size={16} className={vendorSubscription === 'select' ? 'text-emerald-600' : 'text-slate-300'} />
                      <div>
                        <div className="font-bold text-xs">Select Model ($349 / 3 Months)</div>
                        <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Item Catalogue (Max 100 SKUs) + 100 RFQ downloads</div>
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
                        className={`w-full text-left p-2.5 rounded-lg transition-all flex items-start gap-2.5 ${
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

        {/* Role Quick Selector, Theme Toggle & Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all text-xs font-semibold shadow-sm"
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

          {/* Quick Role Switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setRoleDropdownOpen(!roleDropdownOpen);
                setModeDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800/70 border border-slate-300 dark:border-gray-700 hover:border-slate-400 dark:hover:border-gray-600 text-xs font-semibold text-slate-800 dark:text-gray-200 transition-all shadow-sm"
            >
              {getRoleIcon(currentRole)}
              <span className="hidden lg:inline">{getRoleTitle(currentRole)}</span>
              <span className="lg:hidden text-xs">Role</span>
              <ChevronDown size={14} className="text-slate-400 dark:text-gray-400" />
            </button>

            {roleDropdownOpen && (
              <div className="absolute top-full mt-2 w-64 right-0 bg-white dark:bg-gray-900/95 border border-slate-200 dark:border-gray-700 rounded-xl shadow-2xl p-2 z-50 backdrop-blur-xl animate-fade-in">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-gray-800">
                  <p className="text-xs font-semibold text-slate-800 dark:text-gray-300 uppercase tracking-wider">Switch Operational Role</p>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">Preview 4 specification personas</p>
                </div>
                <div className="mt-1 space-y-1">
                  {(['buyer', 'category_manager', 'vendor', 'admin'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => handleRoleSelect(r)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between ${
                        currentRole === r
                          ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-500/30'
                          : 'text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {getRoleIcon(r)}
                        <span>{getRoleTitle(r)}</span>
                      </div>
                      {currentRole === r && <CheckCircle2 size={14} className="text-indigo-600 dark:text-indigo-400" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI Notifications / Live Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setNotifDropdownOpen(!notifDropdownOpen);
                setModeDropdownOpen(false);
                setRoleDropdownOpen(false);
              }}
              className="relative p-2 rounded-lg bg-slate-100 dark:bg-gray-800/70 border border-slate-300 dark:border-gray-700 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-300 transition-all shadow-sm"
              title="Real-time AI Chaser Alerts"
            >
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500" />
            </button>

            {notifDropdownOpen && (
              <div className="absolute top-full mt-2 w-80 sm:w-96 right-0 bg-white dark:bg-gray-900/95 border border-slate-200 dark:border-gray-700 rounded-xl shadow-2xl p-3 z-50 backdrop-blur-xl animate-fade-in max-h-96 overflow-y-auto">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="live-dot" />
                    <span className="text-xs font-bold text-slate-800 dark:text-gray-200">Vendor Follow Up Status</span>
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-gray-400">{aiFeed.length} Events</span>
                </div>
                <div className="mt-2 space-y-2">
                  {aiFeed.slice(0, 6).map((item) => (
                    <div key={item.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 text-xs">
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

          {/* User SSO Badge & Account Settings Trigger */}
          <div className="relative pl-2 border-l border-slate-200 dark:border-gray-800">
            <button
              onClick={() => {
                setAccountModalOpen(true);
                setModeDropdownOpen(false);
                setRoleDropdownOpen(false);
                setNotifDropdownOpen(false);
              }}
              className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-gray-800/80 transition-all border border-transparent hover:border-slate-200 dark:hover:border-gray-700 text-left"
              title="Click to Manage Display Name, Change Password & Account Security"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-gradient-to-br dark:from-indigo-900 dark:to-gray-800 border border-indigo-200 dark:border-indigo-700/50 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-200 shadow-xs">
                {userDisplayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden xl:block text-left">
                <p className="text-xs font-bold text-slate-900 dark:text-gray-200 leading-tight flex items-center gap-1">
                  <span>{userDisplayName}</span>
                  <ChevronDown size={12} className="text-slate-400" />
                </p>
                <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <ShieldCheck size={11} />
                  <span>Azure SSO Verified</span>
                </div>
              </div>
            </button>
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
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-300 font-bold text-sm">
                  {userDisplayName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Account &amp; Security Settings</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">{getUserEmail()} • {getRoleTitle(currentRole)}</p>
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
                    value={userDisplayName}
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
                    <strong className="text-slate-900 dark:text-white">{getRoleTitle(currentRole)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Verified Email</span>
                    <strong className="text-slate-900 dark:text-white font-mono">{getUserEmail()}</strong>
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
