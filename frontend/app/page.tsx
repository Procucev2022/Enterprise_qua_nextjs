'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem, VendorOpportunity, UserRole, VendorEvaluationRecord } from '@/lib/types';
import { authClient } from '@/lib/authClient';
import RoleNavigation from '@/app/components/RoleNavigation';

// Buyer Screens
import CommandCenter from '@/app/buyer/command-center';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import VendorEvaluationSummary from '@/app/buyer/vendor-evaluation-summary';
import VendorSummary from '@/app/buyer/vendor-summary';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import QuoteMatrix from '@/app/buyer/quote-matrix';
import BuyerAccountTable from '@/app/buyer/buyer-account-table';
import InitialSetupModal from '@/app/buyer/initial-setup-modal';

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
  Database,
  Link2,
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
    currentUserSession,
    setCurrentUserSession,
    rfqs, 
    vendorOpportunities, 
    showToast,
    setRemainingFreeRFQs,
    setActiveSubscription,
    setSelectedRFQForMatrix,
    buyerAccounts,
    activeBuyerAccount,
    alignActiveBuyerAccount,
    addBuyerAccount,
    initialSetupModalOpen,
    setInitialSetupModalOpen,
    initialSetupCompleted,
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

  // Synchronize activeScreen when currentRole changes
  useEffect(() => {
    if (currentRole === 'buyer') {
      const validBuyerScreens = ['command_center', 'quote_matrix', 'ingestion_wizard', 'vendor_evaluation_summary', 'vendor_summary', 'subscription_center', 'buyer_profile', 'buyer_directory'];
      if (!validBuyerScreens.includes(activeScreen)) {
        setActiveScreen('command_center');
      }
    } else if (currentRole === 'category_manager') {
      const validCatScreens = ['kanban_board', 'spend_dashboard', 'buyer_console', 'vendor_evaluation_summary', 'vendor_console', 'category_summary'];
      if (!validCatScreens.includes(activeScreen)) {
        setActiveScreen('kanban_board');
      }
    } else if (currentRole === 'vendor') {
      const validVendorScreens = ['vendor_feed', 'quotation_form', 'qualification_form', 'item_catalogue', 'vendor_subscription', 'vendor_profile'];
      if (!validVendorScreens.includes(activeScreen)) {
        setActiveScreen('vendor_feed');
      }
    } else if (currentRole === 'admin') {
      const validAdminScreens = ['infra_control', 'audit_log'];
      if (!validAdminScreens.includes(activeScreen)) {
        setActiveScreen('infra_control');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  // Shared screen navigation helpers
  const navigateToCommandCenter = () => setActiveScreen('command_center');
  const navigateToSpendDashboard = (rfq?: any) => {
    if (rfq) setSelectedRFQForMatrix(rfq);
    setActiveScreen('spend_dashboard');
  };
  const navigateToVendorFeed = () => setActiveScreen('vendor_feed');

  // Navigate to vendor bid submission form
  const handleNavigateToBidForm = (opp: VendorOpportunity) => {
    setSelectedVendorOpp(opp);
    setActiveScreen('quotation_form');
  };

  // Logout handler
  const handleLogout = () => {
    const emailToLogout = loginEmail || currentUserSession?.email;
    setIsLoggedIn(false);
    setCurrentUserSession(null);
    authClient.logout(emailToLogout).catch(() => {});
    setLoginOtpSent(false);
    setRegOtpSent(false);
    setLoginOtpInput('');
    setRegEmailOtpInput('');
    setRegMobileOtpInput('');
    showToast('Logged Out', 'Successfully logged out of the secure workspace.', 'info');
  };

  // Request Successive Login OTP (Sent strictly to Email)
  const handleRequestLoginOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim()) {
      showToast('Error', 'Please enter your registered Email ID.', 'warning');
      return;
    }

    const emailKey = loginEmail.trim().toLowerCase();
    const buyer = registeredBuyers[emailKey] || {
      name: emailKey.split('@')[0] || 'Enterprise Buyer',
      email: emailKey,
      mobile: '+91 98201 44820',
    };

    // The backend is authoritative here: an unregistered email is rejected,
    // not silently created — register() is the only path that creates accounts.
    const response = await authClient.requestOtp(emailKey, 'buyer');
    if (!response.success) {
      showToast('OTP Request Failed', response.error || 'Unable to send an OTP for this email.', 'warning');
      return;
    }

    setRegisteredBuyers((prev) => ({ ...prev, [emailKey]: buyer }));
    setSimulatedLoginOtp(response.demoCode || '');
    setLoginOtpInput(response.demoCode || '');
    setLoginOtpSent(true);

    showToast(
      'OTP Dispatched',
      `Login OTP sent to ${buyer.email}.${response.demoCode ? ` (Demo Code: ${response.demoCode})` : ''}`,
      'success'
    );
  };

  // Verify Login OTP and sign in
  const handleVerifyLoginOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailKey = loginEmail.trim().toLowerCase();
    const response = await authClient.verifyOtp(emailKey, loginOtpInput);

    if (response.success && response.user) {
      setCurrentUserSession(response.user);
      setIsLoggedIn(true);
      setCurrentRole(response.user.role);
      setActiveScreen('command_center');
      if (!initialSetupCompleted) {
        setInitialSetupModalOpen(true);
      }
      showToast('Welcome Back', 'Logged in successfully as Enterprise Buyer.', 'success');
    } else {
      showToast('Invalid OTP', response.error || 'The OTP entered is incorrect. Please verify and try again.', 'warning');
    }
  };

  // Instant 1-Click Buyer Demo Login
  const handleInstantBuyerLogin = () => {
    const sessionUser = {
      id: 'usr-buyer-001',
      email: 'buyer@procucev.com',
      name: 'Procucev Buyer Desk',
      role: 'buyer' as UserRole,
      orgId: 'org-procucev-01',
      orgName: 'Procucev Heavy Engineering',
      authMethod: 'INSTANT_DEMO' as const,
    };
    setCurrentUserSession(sessionUser);
    setIsLoggedIn(true);
    setCurrentRole('buyer');
    setActiveScreen('command_center');
    if (!initialSetupCompleted) {
      setInitialSetupModalOpen(true);
    }
    showToast('Welcome Back', 'Instant 1-Click login as Enterprise Buyer (buyer@procucev.com).', 'success');
  };

  // Vendor Login States & Authentication Flow
  const { buyerVendors } = useApp();
  const [vendorAuthMode, setVendorAuthMode] = useState<'temp_password' | 'email_otp'>('temp_password');
  const [vendorLoginEmail, setVendorLoginEmail] = useState('amit@kiranvalves.com');
  const [vendorLoginPassword, setVendorLoginPassword] = useState('Kiran@Temp8821#');
  const [vendorOtpSent, setVendorOtpSent] = useState(false);
  const [vendorOtpInput, setVendorOtpInput] = useState('');
  const [simulatedVendorOtp, setSimulatedVendorOtp] = useState('');

  // Handle Vendor First-Time Password Login
  const handleVendorPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorLoginEmail.trim() || !vendorLoginPassword.trim()) {
      showToast('Missing Fields', 'Please enter your registered Vendor Email and Temporary Password.', 'warning');
      return;
    }

    const response = await authClient.loginWithPassword(vendorLoginEmail, vendorLoginPassword);
    if (response.success && response.user) {
      setCurrentUserSession(response.user);
      setIsLoggedIn(true);
      setCurrentRole(response.user.role);
      setActiveScreen('vendor_feed');
      showToast(
        'First-Time Login Verified',
        `Welcome ${vendorLoginEmail}! Please update your enterprise profile and category specializations.`,
        'success'
      );
    } else {
      showToast('Login Failed', response.error || 'Invalid email or password.', 'warning');
    }
  };

  // Request Vendor Email OTP (For subsequent logins)
  const handleRequestVendorOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorLoginEmail.trim()) {
      showToast('Missing Email', 'Please enter your registered Vendor Email ID.', 'warning');
      return;
    }

    const response = await authClient.requestOtp(vendorLoginEmail.trim().toLowerCase(), 'vendor');
    if (!response.success) {
      showToast('OTP Request Failed', response.error || 'Unable to send an OTP for this email.', 'warning');
      return;
    }

    setSimulatedVendorOtp(response.demoCode || '');
    setVendorOtpInput(response.demoCode || '');
    setVendorOtpSent(true);
    showToast(
      'OTP Dispatched',
      `Login OTP dispatched to ${vendorLoginEmail}.${response.demoCode ? ` (Demo Code: ${response.demoCode})` : ''}`,
      'success'
    );
  };

  // Verify Vendor Email OTP
  const handleVerifyVendorOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const response = await authClient.verifyOtp(vendorLoginEmail, vendorOtpInput);

    if (response.success && response.user) {
      setCurrentUserSession(response.user);
      setIsLoggedIn(true);
      setCurrentRole(response.user.role);
      setActiveScreen('vendor_feed');
      showToast('Authentication Successful', `Logged in via Email OTP as ${vendorLoginEmail}.`, 'success');
    } else {
      showToast('Invalid OTP', response.error || 'The OTP entered is incorrect. Please verify and try again.', 'warning');
    }
  };

  // Quick Select Vendor from Buyer's Roster
  const handleQuickSelectVendor = (v: { email: string; tempPassword?: string; name: string }) => {
    setVendorLoginEmail(v.email);
    if (v.tempPassword) {
      setVendorLoginPassword(v.tempPassword);
    }
    setVendorOtpSent(false);
    showToast('Vendor Selected', `Selected ${v.name} (${v.email}) for portal access.`, 'info');
  };

  // Password login for Category Manager / Admin roles, verified against the real backend
  const [roleLoginEmail, setRoleLoginEmail] = useState('');
  const handleDirectRoleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = roleLoginEmail.trim().toLowerCase();
    if (!email || !loginPassword.trim()) {
      showToast('Missing Fields', 'Please enter your registered email and password.', 'warning');
      return;
    }

    const response = await authClient.loginWithPassword(email, loginPassword);
    if (!response.success || !response.user) {
      showToast('Login Failed', response.error || 'Invalid email or password.', 'warning');
      return;
    }

    setCurrentUserSession(response.user);
    setIsLoggedIn(true);
    setCurrentRole(response.user.role);

    if (response.user.role === 'category_manager') {
      setActiveScreen('kanban_board');
      showToast('Logged In', 'Successfully signed in as Category Manager.', 'success');
    } else if (response.user.role === 'admin') {
      setActiveScreen('infra_control');
      showToast('Logged In', 'Successfully signed in as Infrastructure Admin.', 'success');
    } else {
      setActiveScreen('command_center');
      showToast('Logged In', 'Successfully signed in.', 'success');
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

      // Automatically sync newly registered buyer into backend master table
      addBuyerAccount({
        organizationName: regName.trim(),
        brandName: regName.trim(),
        corporateEmail: emailKey,
        contactPerson: regName.trim(),
        contactDesignation: 'Procurement Specialist',
        mobileNumber: regMobile.trim(),
        gstin: '27AAACP' + Math.floor(1000 + Math.random() * 9000) + 'A1Z' + Math.floor(1 + Math.random() * 9),
        industrySector: 'Enterprise SCM & Manufacturing',
        sourcingMode: 'mode_2',
        subscriptionPlan: hasClaimedTrial ? 'free_trial' : 'free_trial',
        remainingFreeRFQs: hasClaimedTrial ? 0 : 5,
        accountSource: 'web_registration',
        status: 'ACTIVE_VERIFIED',
        primaryPlantLocation: 'Mumbai Logistics Hub, MH',
        supportedMajorCategories: ['Engineering Spares - Mechanical', 'Engineering Spares - Electrical', 'Civil Works'],
        supportedMinorCategories: ['Pumps & Accessories', 'Hoses, Valves & Fittings', 'Panels'],
        totalRFQsCreated: 0,
        totalSpend: '$0',
      });

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
        setInitialSetupModalOpen(true);
        showToast(
          'Registration Successful',
          `Welcome ${regName}! Initial setup popup opened to ingest 1-3 year historical purchase data.`,
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

                          <div className="relative flex py-1 items-center">
                            <div className="flex-grow border-t border-slate-200 dark:border-gray-800"></div>
                            <span className="flex-shrink mx-2 text-[10px] uppercase font-bold text-slate-400">or</span>
                            <div className="flex-grow border-t border-slate-200 dark:border-gray-800"></div>
                          </div>

                          <button
                            type="button"
                            onClick={handleInstantBuyerLogin}
                            className="btn btn-secondary w-full text-xs font-bold py-2 flex items-center justify-center gap-1.5 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                          >
                            <Sparkles size={13} /> Instant 1-Click Buyer Sign In
                          </button>

                          {/* Quick Align from Existing Public System Database */}
                          <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-gray-800">
                            <label className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                              <Database size={11} /> Or Align Existing Public System Account:
                            </label>
                            <div className="grid grid-cols-1 gap-1.5 max-h-[145px] overflow-y-auto pr-1">
                              {buyerAccounts.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => {
                                    alignActiveBuyerAccount(b.id);
                                    setIsLoggedIn(true);
                                    setCurrentRole('buyer');
                                    setActiveScreen('command_center');
                                  }}
                                  className="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-gray-800 hover:border-amber-400 dark:hover:border-amber-600 bg-slate-50/80 dark:bg-gray-800/40 hover:bg-amber-50/40 text-left transition-all group"
                                >
                                  <div>
                                    <div className="text-[11px] font-bold text-slate-800 dark:text-white group-hover:text-amber-700 dark:group-hover:text-amber-300">
                                      {b.organizationName}
                                    </div>
                                    <div className="text-[9px] text-slate-400 mono truncate max-w-[200px]">
                                      {b.corporateEmail} • {b.industrySector}
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 shrink-0">
                                    {b.sourcingMode === 'mode_1' ? 'Mode 1' : b.sourcingMode === 'mode_2' ? 'Mode 2' : 'Mode 3'}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
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
                  ) : selectedRole === 'vendor' ? (
                    /* DEDICATED VENDOR LOGIN: FIRST-TIME TEMP PASSWORD OR EMAIL OTP */
                    <div className="space-y-3 animate-fade-in">
                      {/* Vendor Auth Method Switcher */}
                      <div className="flex rounded-xl bg-slate-100 dark:bg-gray-800/80 p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => { setVendorAuthMode('temp_password'); setVendorOtpSent(false); }}
                          className={`flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1 ${
                            vendorAuthMode === 'temp_password'
                              ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Lock size={12} /> First-Time Password
                        </button>
                        <button
                          type="button"
                          onClick={() => { setVendorAuthMode('email_otp'); setVendorOtpSent(false); }}
                          className={`flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1 ${
                            vendorAuthMode === 'email_otp'
                              ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Mail size={12} /> Email OTP (Subsequent)
                        </button>
                      </div>

                      {/* Info Callout */}
                      <div className="p-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-900/40 text-[11px] text-purple-900 dark:text-purple-200 leading-relaxed">
                        {vendorAuthMode === 'temp_password' ? (
                          <span>
                            <strong>First-Time Login:</strong> Enter your registered Email ID and the temporary password dispatched in your buyer onboarding invitation email.
                          </span>
                        ) : (
                          <span>
                            <strong>Subsequent Logins:</strong> Enter your Email ID to receive a secure 4-digit authentication OTP directly to your inbox.
                          </span>
                        )}
                      </div>

                      {vendorAuthMode === 'temp_password' ? (
                        /* FIRST-TIME PASSWORD FORM */
                        <form onSubmit={handleVendorPasswordLogin} className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Vendor User Name (Email ID)</label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-3 text-slate-400" size={14} />
                              <input
                                type="email"
                                placeholder="vendor@company.com"
                                value={vendorLoginEmail}
                                onChange={(e) => setVendorLoginEmail(e.target.value)}
                                className="pl-9 text-xs"
                                required
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">First-Time Temporary Password</label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-3 text-slate-400" size={14} />
                              <input
                                type="password"
                                placeholder="Enter temporary password"
                                value={vendorLoginPassword}
                                onChange={(e) => setVendorLoginPassword(e.target.value)}
                                className="pl-9 text-xs font-mono"
                                required
                              />
                            </div>
                          </div>

                          <button type="submit" className="btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
                            <ArrowRight size={14} /> First-Time Sign In & Update Profile
                          </button>
                        </form>
                      ) : (
                        /* EMAIL OTP FORM FOR SUBSEQUENT LOGINS */
                        <div>
                          {!vendorOtpSent ? (
                            <form onSubmit={handleRequestVendorOtp} className="space-y-3">
                              <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Vendor User Name (Email ID)</label>
                                <div className="relative">
                                  <Mail className="absolute left-3 top-3 text-slate-400" size={14} />
                                  <input
                                    type="email"
                                    placeholder="vendor@company.com"
                                    value={vendorLoginEmail}
                                    onChange={(e) => setVendorLoginEmail(e.target.value)}
                                    className="pl-9 text-xs"
                                    required
                                  />
                                </div>
                              </div>

                              <button type="submit" className="btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
                                <Mail size={14} /> Send Instant OTP to Email
                              </button>
                            </form>
                          ) : (
                            <form onSubmit={handleVerifyVendorOtp} className="space-y-3 animate-scale-up">
                              <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-150/40">
                                📨 OTP code dispatched to <strong>{vendorLoginEmail}</strong>. (Simulated Demo Code: <strong className="underline">{simulatedVendorOtp}</strong>)
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Enter 4-Digit Email OTP</label>
                                <div className="relative">
                                  <Key className="absolute left-3 top-3 text-slate-400" size={14} />
                                  <input
                                    type="text"
                                    placeholder="Enter 4-digit code"
                                    value={vendorOtpInput}
                                    onChange={(e) => setVendorOtpInput(e.target.value)}
                                    className="pl-9 text-xs font-mono font-bold tracking-widest text-center"
                                    maxLength={4}
                                    required
                                  />
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setVendorOtpSent(false)}
                                  className="btn btn-secondary text-xs w-1/3 py-2.5"
                                >
                                  Back
                                </button>
                                <button type="submit" className="btn btn-primary text-xs w-2/3 py-2.5 font-bold">
                                  Verify OTP & Sign In
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}

                      {/* Quick Select from Uploaded Vendors Roster */}
                      <div className="pt-2 border-t border-slate-100 dark:border-gray-800 space-y-1.5">
                        <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider flex items-center justify-between">
                          <span>Quick Demo Vendor Profiles</span>
                          <span className="text-indigo-600 font-bold">1-Click Autofill</span>
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-y-auto pr-0.5">
                          {buyerVendors.slice(0, 4).map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => handleQuickSelectVendor(v)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-800/40 hover:border-indigo-400 text-left transition-all text-[10px]"
                            >
                              <div className="font-bold text-slate-800 dark:text-white truncate">{v.name}</div>
                              <div className="text-[9px] text-slate-400 truncate">{v.email}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* CATEGORY MANAGER / ADMIN PASSWORD LOGIN */
                    <form onSubmit={handleDirectRoleLogin} className="space-y-3 animate-fade-in">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">Email / Username</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 text-slate-400" size={14} />
                          <input
                            type="email"
                            value={roleLoginEmail}
                            onChange={(e) => setRoleLoginEmail(e.target.value)}
                            placeholder={
                              selectedRole === 'category_manager'
                                ? 'e.g. catmanager@yourcompany.com'
                                : 'e.g. admin@yourcompany.com'
                            }
                            className="pl-9 text-xs font-mono"
                            required
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
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-800 dark:text-white">Create Buyer Account</h3>
                      <span className="badge badge-amber font-bold text-[10px]">5 Free RFQs</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                      Start with a Free Account including <strong>5 Free RFQs</strong> with unrestricted access across <strong>Version 1, Version 2, and Version 3</strong>.
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
                onNavigateToDirectory={() => setActiveScreen('buyer_directory')}
              />
            )}
            {activeScreen === 'quote_matrix' && (
              <QuoteMatrix
                onBackToDashboard={navigateToCommandCenter}
              />
            )}
            {activeScreen === 'ingestion_wizard' && (
              <IngestionWizard
                onComplete={navigateToCommandCenter}
                onCancel={navigateToCommandCenter}
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
            {activeScreen === 'buyer_directory' && (
              <BuyerAccountTable />
            )}
          </>
        )}

        {/* ROLE 2: CATEGORY MANAGER */}
        {currentRole === 'category_manager' && (
          <>
            {activeScreen === 'kanban_board' && (
              <KanbanBoard
                onNavigateToMatrix={navigateToSpendDashboard}
                onNavigateToSpend={navigateToSpendDashboard}
              />
            )}
            {activeScreen === 'spend_dashboard' && (
              <SpendDashboard
                onBackToKanban={() => setActiveScreen('kanban_board')}
              />
            )}
            {activeScreen === 'buyer_console' && (
              <BuyerConsole
                onNavigateToMatrix={navigateToSpendDashboard}
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
                onNavigateToMatrix={navigateToSpendDashboard}
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
                onNavigateToEvaluation={() => setActiveScreen('qualification_form')}
                onNavigateToSubscription={() => setActiveScreen('vendor_subscription')}
              />
            )}
            {activeScreen === 'quotation_form' && (
              <QuotationForm
                opportunity={selectedVendorOpp}
                onBack={navigateToVendorFeed}
                onSubmitSuccess={navigateToVendorFeed}
              />
            )}
            {activeScreen === 'qualification_form' && (
              <VendorQualificationForm
                onBack={navigateToVendorFeed}
                onSuccess={navigateToVendorFeed}
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

        {/* ── Persistent Blinking / Pulsing Corner Action Badge for Initial Setup ── */}
        {currentRole === 'buyer' && isLoggedIn && !initialSetupCompleted && (
          <div className="fixed bottom-16 right-4 sm:right-6 z-40 animate-scale-up max-w-sm sm:max-w-md">
            <button
              type="button"
              onClick={() => setInitialSetupModalOpen(true)}
              className="relative group p-4 rounded-2xl bg-gradient-to-r from-amber-600 via-indigo-600 to-purple-700 text-white shadow-2xl shadow-indigo-600/40 hover:shadow-indigo-600/70 border-2 border-amber-300 dark:border-amber-400 transition-all duration-300 transform hover:-translate-y-1 flex items-center gap-3.5 text-left"
            >
              {/* Pulsing beacon / radar ring animation */}
              <div className="relative flex items-center justify-center shrink-0">
                <span className="animate-ping absolute inline-flex h-10 w-10 rounded-full bg-amber-400 opacity-75"></span>
                <div className="relative w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shadow-md">
                  <Sparkles size={20} />
                </div>
              </div>

              <div className="flex-1 min-w-0 pr-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-sm border border-white/30">
                    Mandatory Action
                  </span>
                  <span className="text-[10px] font-bold text-amber-200 animate-pulse">
                    ● Click to Reopen
                  </span>
                </div>
                <h4 className="text-xs font-black text-white mt-1 group-hover:underline flex items-center gap-1">
                  Complete Initial Setup: 1-3 Yr PO Data & Vendors <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                </h4>
                <p className="text-[10px] text-indigo-100/90 mt-0.5 line-clamp-2 leading-relaxed">
                  Required to understand existing vendors, contact details & map 1st & 2nd set categories for daily procurement.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Global Initial Setup & Historical Purchase Data Ingestion Modal */}
        <InitialSetupModal />

        {/* Global Live Support Chat Widget for Buyer & Vendor */}
        <SupportChatWidget />
      </div>
    </div>
  );
}
