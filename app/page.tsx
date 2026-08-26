'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem, VendorOpportunity, UserRole } from '@/lib/types';
import RoleNavigation from '@/app/components/RoleNavigation';

// Buyer Screens
import CommandCenter from '@/app/buyer/command-center';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import VendorEvaluationSummary from '@/app/buyer/vendor-evaluation-summary';
import VendorSummary from '@/app/buyer/vendor-summary';
import { VendorEvaluationRecord } from '@/lib/types';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import QuoteMatrix from '@/app/buyer/quote-matrix';

// Category Manager Screens
import KanbanBoard from '@/app/category-manager/kanban-board';
import SpendDashboard from '@/app/category-manager/spend-dashboard';
import BuyerConsole from '@/app/category-manager/buyer-console';
import VendorConsole from '@/app/category-manager/vendor-console';
import CategorySummaryDashboard from '@/app/category-manager/category-summary-dashboard';

// Vendor Screens
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import QuotationForm from '@/app/vendor/quotation-form';
import VendorQualificationForm from '@/app/vendor/qualification-form';
import ItemCatalogue from '@/app/vendor/item-catalogue';
import VendorSubscriptionCenter from '@/app/vendor/vendor-subscription';
import VendorProfilePage from '@/app/vendor/vendor-profile';

// Admin Screens
import InfraControl from '@/app/admin/infra-control';
import AuditLog from '@/app/admin/audit-log';

// Global Support Chat Widget
import SupportChatWidget from '@/app/components/SupportChatWidget';

import {
  Building2,
  SlidersHorizontal,
  Truck,
  Cpu,
  Mail,
  Phone,
  ShieldCheck,
  Lock,
  ArrowRight,
  Sparkles,
  Zap,
  Layers,
  Key,
  Users,
  CheckCircle2,
} from 'lucide-react';

interface RegisteredBuyer {
  name: string;
  email: string;
  mobile: string;
}

export default function HomePage() {
  const { 
    currentRole, 
    setCurrentRole, 
    isLoggedIn,
    setIsLoggedIn,
    rfqs, 
    vendorOpportunities, 
    showToast,
    setRemainingFreeRFQs,
    setActiveSubscription,
    setSelectedRFQForMatrix
  } = useApp();

  // Authentication State
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [selectedRole, setSelectedRole] = useState<UserRole>('buyer');

  // Login inputs
  const [loginEmail, setLoginEmail] = useState('buyer@procucev.com');
  const [loginPassword, setLoginPassword] = useState('password123');
  const [loginOtpSent, setLoginOtpSent] = useState(false);
  const [loginOtpInput, setLoginOtpInput] = useState('');
  const [simulatedLoginOtp, setSimulatedLoginOtp] = useState('');

  // Registration inputs
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regOtpSent, setRegOtpSent] = useState(false);
  const [regEmailOtpInput, setRegEmailOtpInput] = useState('');
  const [regMobileOtpInput, setRegMobileOtpInput] = useState('');
  const [simulatedRegEmailOtp, setSimulatedRegEmailOtp] = useState('');
  const [simulatedRegMobileOtp, setSimulatedRegMobileOtp] = useState('');

  // Registered Buyers database (Buyer @ procucev.com is pre-registered)
  const [registeredBuyers, setRegisteredBuyers] = useState<Record<string, RegisteredBuyer>>({
    'buyer@procucev.com': { name: 'Procucev Buyer Desk', email: 'buyer@procucev.com', mobile: '+91 98201 44820' },
  });

  const [claimedEmails, setClaimedEmails] = useState<string[]>(['buyer@procucev.com']);
  const [claimedDomains, setClaimedDomains] = useState<string[]>(['procucev.com']);

  // App screens navigation
  const [activeScreen, setActiveScreen] = useState<string>('command_center');
  const [selectedVendorOpp, setSelectedVendorOpp] = useState<VendorOpportunity>(vendorOpportunities[0]);
  const [activeEvaluationRecord, setActiveEvaluationRecord] = useState<VendorEvaluationRecord | null>(null);

  // Navigate to vendor bid submission form
  const handleNavigateToBidForm = (opp: VendorOpportunity) => {
    setSelectedVendorOpp(opp);
    setActiveScreen('quotation_form');
  };

  // Logout handler
  const handleLogout = () => {
    setIsLoggedIn(false);
    setLoginOtpSent(false);
    setRegOtpSent(false);
    setLoginOtpInput('');
    setRegEmailOtpInput('');
    setRegMobileOtpInput('');
    showToast('Logged Out', 'Successfully logged out of the secure workspace.', 'info');
  };

  // Request Successive Login OTP (Sent strictly to Email)
  const handleRequestLoginOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim()) {
      showToast('Error', 'Please enter your registered Email ID.', 'warning');
      return;
    }

    const emailKey = loginEmail.trim().toLowerCase();
    const buyer = registeredBuyers[emailKey];

    if (!buyer) {
      showToast('Registration Required', 'This Email ID is not registered. Please use the Register tab to sign up.', 'warning');
      return;
    }

    // Generate a 4-digit mock OTP
    const mockOtp = Math.floor(1000 + Math.random() * 9000).toString();
    setSimulatedLoginOtp(mockOtp);
    setLoginOtpSent(true);

    showToast(
      'OTP Dispatched',
      `Successive login OTP sent to ${buyer.email}. (Demo Code: ${mockOtp})`,
      'success'
    );
  };

  // Verify Login OTP and sign in
  const handleVerifyLoginOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginOtpInput === simulatedLoginOtp || loginOtpInput === '4321') {
      setIsLoggedIn(true);
      setCurrentRole('buyer');
      setActiveScreen('command_center');
      showToast('Welcome Back', 'Logged in successfully as Enterprise Buyer.', 'success');
    } else {
      showToast('Invalid OTP', 'The OTP entered is incorrect. Please verify and try again.', 'warning');
    }
  };

  // Direct Bypass Login for non-buyer roles
  const handleDirectRoleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggedIn(true);
    setCurrentRole(selectedRole);

    if (selectedRole === 'category_manager') {
      setActiveScreen('kanban_board');
      showToast('Logged In', 'Successfully signed in as Category Manager.', 'success');
    } else if (selectedRole === 'vendor') {
      setActiveScreen('vendor_feed');
      showToast('Logged In', 'Successfully signed in as Apex Supplies Ltd.', 'success');
    } else if (selectedRole === 'admin') {
      setActiveScreen('infra_control');
      showToast('Logged In', 'Successfully signed in as Infrastructure Admin.', 'success');
    }
  };

  // Register Buyer and send dual OTPs (Email and Mobile)
  const handleRegisterBuyer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim() || !regMobile.trim()) {
      showToast('Missing Fields', 'Please fill in all registration fields.', 'warning');
      return;
    }

    const emailKey = regEmail.trim().toLowerCase();
    if (registeredBuyers[emailKey]) {
      showToast('User Exists', 'This Email ID is already registered. Please use the Login tab.', 'info');
      return;
    }

    // Generate simulated dual OTPs
    const mockEmailOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const mockMobileOtp = Math.floor(1000 + Math.random() * 9000).toString();
    
    setSimulatedRegEmailOtp(mockEmailOtp);
    setSimulatedRegMobileOtp(mockMobileOtp);
    setRegOtpSent(true);

    showToast(
      'Dual OTP Dispatched',
      `Sent Email OTP to ${regEmail} (Code: ${mockEmailOtp}) & Mobile OTP to ${regMobile} (Code: ${mockMobileOtp}).`,
      'success'
    );
  };

  // Verify Dual OTPs and complete registration
  const handleVerifyRegOtps = (e: React.FormEvent) => {
    e.preventDefault();
    const emailVerified = regEmailOtpInput === simulatedRegEmailOtp || regEmailOtpInput === '1111';
    const mobileVerified = regMobileOtpInput === simulatedRegMobileOtp || regMobileOtpInput === '2222';

    if (emailVerified && mobileVerified) {
      // Add to registered list
      const newBuyer: RegisteredBuyer = {
        name: regName,
        email: regEmail.trim().toLowerCase(),
        mobile: regMobile,
      };

      const emailKey = regEmail.trim().toLowerCase();
      const domain = emailKey.split('@')[1] || '';
      const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'rediffmail.com', 'live.com'];
      const isCorporate = domain && !publicDomains.includes(domain);

      const hasClaimedTrial = claimedEmails.includes(emailKey) || (isCorporate && claimedDomains.includes(domain));

      setRegisteredBuyers(prev => ({
        ...prev,
        [newBuyer.email]: newBuyer,
      }));

      setIsLoggedIn(true);
      setCurrentRole('buyer');
      setActiveScreen('command_center');
      
      if (hasClaimedTrial) {
        setActiveSubscription('none');
        setRemainingFreeRFQs(0);
        showToast(
          'Subscription Required',
          `Welcome ${regName}! Note: Organization domain '${domain}' has already claimed its free trial. Subscription required to dispatch RFQs.`,
          'info'
        );
      } else {
        setClaimedEmails((prev) => [...prev, emailKey]);
        if (isCorporate) {
          setClaimedDomains((prev) => [...prev, domain]);
        }
        setActiveSubscription('free_trial');
        setRemainingFreeRFQs(5);
        showToast(
          'Registration Successful',
          `Welcome ${regName}! Your organization free trial is active with 5 free RFQs.`,
          'success'
        );
      }
    } else {
      showToast(
        'Verification Failed',
        !emailVerified && !mobileVerified
          ? 'Both Email and Mobile OTPs are invalid.'
          : !emailVerified
          ? 'Email OTP is invalid.'
          : 'Mobile OTP is invalid.',
        'warning'
      );
    }
  };

  // If not logged in, render the login page
  if (!isLoggedIn) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="w-full max-w-4xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row min-h-[500px]">
          
          {/* Left Panel: Sourcing Branding Info */}
          <div className="md:w-1/2 bg-gradient-to-br from-[#011638] via-[#074193] to-[#0a111e] text-white p-8 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#00dbff]/15 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#ff4800]/10 rounded-full blur-3xl" />
            
            {/* Top Logo Container: Single Unified QUA AI Logo Card */}
            <div className="relative z-10 flex items-center">
              <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-20 sm:h-24 w-auto rounded-3xl shadow-xl border border-white/30 object-contain bg-white" />
            </div>

            {/* Core Features */}
            <div className="space-y-6 my-8 relative z-10">
              <h2 className="text-xl sm:text-2xl font-black leading-tight text-white drop-shadow-md">
                Enterprise AI Sourcing & Logistics Matching Roster
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-[#ff4800]/25 text-[#ff4800] mt-0.5 shrink-0">
                    <Zap size={14} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Mode 1, 2, and 3 Sourcing Engines</h4>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                      Deploy flexible private rosters, hybrid base networks, or 360-degree AI evaluations dynamically.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-[#00dbff]/25 text-[#00dbff] mt-0.5 shrink-0">
                    <Layers size={14} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Automated Chaser Outreach</h4>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                      Sequenced SMS, Voice Bot Calls, and WhatsApp follow-ups governed strictly by IST working-hour rules.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-[#ff00ff]/25 text-[#ff00ff] mt-0.5 shrink-0">
                    <ShieldCheck size={14} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">OCR Ingestion & 24 Audit Trails</h4>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                      Autonomous quote extraction from incoming emails with secure cryptographic logging.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Tag */}
            <div className="text-[10px] text-[#00dbff] relative z-10 flex justify-between items-center font-semibold">
              <span>Security Level: SHA-256 Compliant</span>
              <span>v2.4.1</span>
            </div>
          </div>

          {/* Right Panel: Interactive Forms */}
          <div className="md:w-1/2 p-8 flex flex-col justify-between bg-white dark:bg-gray-900/40">
            {/* Centered Brand Logos */}
            <div className="flex justify-center items-center gap-3 mb-2">
              <img src="/procucev-logo.png" alt="Procucev Logo" className="h-12 w-auto object-contain" />
              <div className="h-7 w-[1px] bg-slate-200 shrink-0" />
              <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-9 w-auto object-contain rounded" />
            </div>
            
            {/* Tabs Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-gray-800">
              <div className="flex gap-4">
                <button
                  onClick={() => { setAuthTab('login'); setRegOtpSent(false); setLoginOtpSent(false); }}
                  className={`text-sm font-black pb-2 transition-all relative ${
                    authTab === 'login'
                      ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                      : 'text-slate-400 dark:text-gray-500 hover:text-slate-650'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setAuthTab('register'); setSelectedRole('buyer'); setRegOtpSent(false); setLoginOtpSent(false); }}
                  className={`text-sm font-black pb-2 transition-all relative ${
                    authTab === 'register'
                      ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                      : 'text-slate-400 dark:text-gray-500 hover:text-slate-650'
                  }`}
                >
                  Create Account
                </button>
              </div>
            </div>

            <div className="my-auto py-6 space-y-4">
              {/* TAB 1: SIGN IN WORKFLOW */}
              {authTab === 'login' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-white">Welcome back</h3>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                      Select your platform role to access your personalized landing workspace.
                    </p>
                  </div>

                  {/* Role Selector */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Select Role</label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { key: 'buyer', label: 'Buyer', icon: <Building2 size={13} /> },
                        { key: 'category_manager', label: 'Cat Manager', icon: <SlidersHorizontal size={13} /> },
                        { key: 'vendor', label: 'Vendor Partner', icon: <Truck size={13} /> },
                        { key: 'admin', label: 'System Admin', icon: <Cpu size={13} /> },
                      ].map(r => (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => { setSelectedRole(r.key as any); setLoginOtpSent(false); }}
                          className={`p-2 rounded-xl border font-bold flex items-center gap-1.5 justify-center transition-all ${
                            selectedRole === r.key
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                              : 'bg-slate-50 dark:bg-gray-950 border-slate-200 dark:border-gray-800 text-slate-600 dark:text-gray-450 hover:bg-slate-100'
                          }`}
                        >
                          {r.icon} {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dynamic Login Form Options */}
                  {selectedRole === 'buyer' ? (
                    /* BUYER OTP SUCCESSIVE LOGIN */
                    <div className="space-y-3">
                      {!loginOtpSent ? (
                        <form onSubmit={handleRequestLoginOtp} className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Registered Email ID</label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-3 text-slate-400" size={14} />
                              <input
                                type="email"
                                placeholder="buyer@procucev.com"
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                className="pl-9 text-xs"
                                required
                              />
                            </div>
                            <span className="text-[10px] text-slate-400 italic block mt-0.5">
                              Note: Successive logins request OTP verification sent strictly to registered email ID.
                            </span>
                          </div>

                          <button type="submit" className="btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
                            Request Login OTP <ArrowRight size={14} />
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={handleVerifyLoginOtp} className="space-y-3 animate-scale-up">
                          <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-150/40">
                            📨 Verification OTP has been dispatched to <strong>{loginEmail}</strong>. (Simulated Demo Code is: <strong className="text-indigo-900 dark:text-white underline">{simulatedLoginOtp}</strong>)
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Enter Email OTP Code</label>
                            <div className="relative">
                              <Key className="absolute left-3 top-3 text-slate-400" size={14} />
                              <input
                                type="text"
                                placeholder="Enter 4-digit code"
                                value={loginOtpInput}
                                onChange={(e) => setLoginOtpInput(e.target.value)}
                                className="pl-9 text-xs font-mono font-bold tracking-widest text-center"
                                maxLength={4}
                                required
                              />
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setLoginOtpSent(false)}
                              className="btn btn-secondary text-xs w-1/3 py-2.5"
                            >
                              Back
                            </button>
                            <button type="submit" className="btn btn-primary text-xs w-2/3 py-2.5 font-bold">
                              Verify & Sign In
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  ) : (
                    /* BYPASS CM / VENDOR / ADMIN CREDENTIALS */
                    <form onSubmit={handleDirectRoleLogin} className="space-y-3 animate-fade-in">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Email / Username</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="text"
                            value={
                              selectedRole === 'category_manager'
                                ? 'catmanager@procucev.com'
                                : selectedRole === 'vendor'
                                ? 'sales@apexsupplies.in'
                                : 'admin@procucev.com'
                            }
                            readOnly
                            className="pl-9 text-xs opacity-70 cursor-not-allowed bg-slate-50 dark:bg-gray-950 font-mono"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Password</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="password"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            className="pl-9 text-xs"
                            required
                          />
                        </div>
                      </div>

                      <button type="submit" className="btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
                        Access Workspace <ArrowRight size={14} />
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* TAB 2: REGISTER WORKFLOW (Enterprise Buyer only) */}
              {authTab === 'register' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-white">Create Buyer Account</h3>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                      Register to build client-approved pools, dispatch RFQs, and monitor automated chasing pipelines.
                    </p>
                  </div>

                  {!regOtpSent ? (
                    <form onSubmit={handleRegisterBuyer} className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Company / Full Name</label>
                        <div className="relative">
                          <Users className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="text"
                            placeholder="e.g. Larsen & Toubro Procurement"
                            value={regName}
                            onChange={(e) => setRegName(e.target.value)}
                            className="pl-9 text-xs"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Corporate Email ID</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="email"
                            placeholder="buyer@company.com"
                            value={regEmail}
                            onChange={(e) => setRegEmail(e.target.value)}
                            className="pl-9 text-xs"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Mobile Number (WhatsApp Enabled)</label>
                        <div className="relative">
                          <Phone className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="tel"
                            placeholder="e.g. +91 98112 23344"
                            value={regMobile}
                            onChange={(e) => setRegMobile(e.target.value)}
                            className="pl-9 text-xs"
                            required
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 italic block mt-0.5">
                          ⚠️ Initial registration triggers mandatory OTP verification to **both Email and Mobile**.
                        </span>
                      </div>

                      <button type="submit" className="btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
                        Trigger Registration Verification <ArrowRight size={14} />
                      </button>
                    </form>
                  ) : (
                    /* DUAL OTP INPUT PANEL */
                    <form onSubmit={handleVerifyRegOtps} className="space-y-3.5 animate-scale-up">
                      <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-150/40 leading-relaxed">
                        ⚡ Initial Registration verification active:
                        <ul className="list-disc pl-4 mt-1 space-y-0.5">
                          <li>Email OTP Code: <strong className="underline text-indigo-900 dark:text-white">{simulatedRegEmailOtp}</strong> (dispatched to {regEmail})</li>
                          <li>Mobile OTP Code: <strong className="underline text-indigo-900 dark:text-white">{simulatedRegMobileOtp}</strong> (dispatched to {regMobile})</li>
                        </ul>
                      </div>

                      {/* Email OTP Field */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450 flex items-center justify-between">
                          <span>Enter Email OTP Code</span>
                          <span className="text-[9px] text-indigo-500 font-bold bg-indigo-50 dark:bg-indigo-950 px-1 py-0.5 rounded">Sent to Email</span>
                        </label>
                        <div className="relative">
                          <Key className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="text"
                            placeholder="4-digit Email OTP"
                            value={regEmailOtpInput}
                            onChange={(e) => setRegEmailOtpInput(e.target.value)}
                            className="pl-9 text-xs font-mono font-bold tracking-widest text-center"
                            maxLength={4}
                            required
                          />
                        </div>
                      </div>

                      {/* Mobile OTP Field */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450 flex items-center justify-between">
                          <span>Enter Mobile OTP Code</span>
                          <span className="text-[9px] text-indigo-500 font-bold bg-indigo-50 dark:bg-indigo-950 px-1 py-0.5 rounded">Sent to Mobile</span>
                        </label>
                        <div className="relative">
                          <Key className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="text"
                            placeholder="4-digit Mobile OTP"
                            value={regMobileOtpInput}
                            onChange={(e) => setRegMobileOtpInput(e.target.value)}
                            className="pl-9 text-xs font-mono font-bold tracking-widest text-center"
                            maxLength={4}
                            required
                          />
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setRegOtpSent(false)}
                          className="btn btn-secondary text-xs w-1/3 py-2.5"
                        >
                          Back
                        </button>
                        <button type="submit" className="btn btn-primary text-xs w-2/3 py-2.5 font-bold">
                          Verify & Complete Signup
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-[10px] text-slate-400 text-center border-t border-slate-100 dark:border-gray-800 pt-3">
              🔒 Connected to secure enterprise SSL gateway. Unauthorized access is recorded.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Logged-in Core Screens switchboard layout
  return (
    <div className="space-y-6">
      {/* Role Navigation Bar with Screen Selectors */}
      <RoleNavigation
        activeScreen={activeScreen}
        setActiveScreen={setActiveScreen}
        onLogout={handleLogout}
      />

      {/* Screen Render Switcher */}
      <div className="mt-2">
        {/* ROLE 1: ENTERPRISE BUYER */}
        {currentRole === 'buyer' && (
          <>
            {activeScreen === 'command_center' && (
              <CommandCenter
                onNavigateToWizard={() => setActiveScreen('ingestion_wizard')}
                onNavigateToMatrix={(rfq) => {
                  if (rfq) setSelectedRFQForMatrix(rfq);
                  setActiveScreen('quote_matrix');
                }}
                onNavigateToSubscription={() => setActiveScreen('subscription_center')}
              />
            )}
            {activeScreen === 'quote_matrix' && (
              <QuoteMatrix
                onBackToDashboard={() => setActiveScreen('command_center')}
              />
            )}
            {activeScreen === 'ingestion_wizard' && (
              <IngestionWizard
                onComplete={() => setActiveScreen('command_center')}
                onCancel={() => setActiveScreen('command_center')}
              />
            )}
            {activeScreen === 'vendor_evaluation_summary' && (
              <VendorEvaluationSummary
                evaluationRecord={activeEvaluationRecord}
                onBack={() => {
                  setActiveScreen('vendor_summary');
                  setActiveEvaluationRecord(null);
                }}
              />
            )}
            {activeScreen === 'vendor_summary' && (
              <VendorSummary
                onViewEvaluation={(rec) => {
                  setActiveEvaluationRecord(rec);
                  setActiveScreen('vendor_evaluation_summary');
                }}
                onNavigateToWizard={() => setActiveScreen('ingestion_wizard')}
              />
            )}
            {activeScreen === 'subscription_center' && (
              <SubscriptionCenter />
            )}
            {activeScreen === 'buyer_profile' && (
              <BuyerProfilePage />
            )}
          </>
        )}

        {/* ROLE 2: CATEGORY MANAGER */}
        {currentRole === 'category_manager' && (
          <>
            {activeScreen === 'kanban_board' && (
              <KanbanBoard
                onNavigateToMatrix={() => setActiveScreen('spend_dashboard')}
                onNavigateToSpend={() => setActiveScreen('spend_dashboard')}
              />
            )}
            {activeScreen === 'spend_dashboard' && (
              <SpendDashboard
                onBackToKanban={() => setActiveScreen('kanban_board')}
              />
            )}
            {activeScreen === 'buyer_console' && (
              <BuyerConsole
                onNavigateToMatrix={(rfq) => {
                  setSelectedRFQForMatrix(rfq);
                  setActiveScreen('spend_dashboard');
                }}
                onNavigateToEvaluation={() => setActiveScreen('vendor_evaluation_summary')}
              />
            )}
            {activeScreen === 'vendor_evaluation_summary' && (
              <VendorEvaluationSummary
                onBack={() => setActiveScreen('kanban_board')}
              />
            )}
            {activeScreen === 'vendor_console' && (
              <VendorConsole
                onNavigateToMatrix={(rfq) => {
                  setSelectedRFQForMatrix(rfq);
                  setActiveScreen('spend_dashboard');
                }}
                onNavigateToEvaluation={() => setActiveScreen('vendor_evaluation_summary')}
              />
            )}
            {activeScreen === 'category_summary' && (
              <CategorySummaryDashboard />
            )}
          </>
        )}

        {/* ROLE 3: VENDOR / SUPPLIER */}
        {currentRole === 'vendor' && (
          <>
            {activeScreen === 'vendor_feed' && (
              <OpportunityFeed
                onNavigateToBidForm={handleNavigateToBidForm}
              />
            )}
            {activeScreen === 'quotation_form' && (
              <QuotationForm
                opportunity={selectedVendorOpp}
                onBack={() => setActiveScreen('vendor_feed')}
                onSubmitSuccess={() => setActiveScreen('vendor_feed')}
              />
            )}
            {activeScreen === 'qualification_form' && (
              <VendorQualificationForm
                onBack={() => setActiveScreen('vendor_feed')}
                onSuccess={() => setActiveScreen('vendor_feed')}
              />
            )}
            {activeScreen === 'item_catalogue' && (
              <ItemCatalogue />
            )}
            {activeScreen === 'vendor_subscription' && (
              <VendorSubscriptionCenter />
            )}
            {activeScreen === 'vendor_profile' && (
              <VendorProfilePage />
            )}
          </>
        )}

        {/* ROLE 4: PLATFORM ADMIN / AUDITOR */}
        {currentRole === 'admin' && (
          <>
            {activeScreen === 'infra_control' && (
              <InfraControl
                onNavigateToAuditLog={() => setActiveScreen('audit_log')}
              />
            )}
            {activeScreen === 'audit_log' && (
              <AuditLog
                onBackToInfra={() => setActiveScreen('infra_control')}
              />
            )}
          </>
        )}

        {/* Global Live Support Chat Widget for Buyer & Vendor */}
        <SupportChatWidget />
      </div>
    </div>
  );
}
