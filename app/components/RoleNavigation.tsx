'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { UserRole } from '@/lib/types';
import {
  Building2,
  SlidersHorizontal,
  Truck,
  Cpu,
  Layers,
  Sparkles,
  Kanban,
  TrendingUp,
  FileSpreadsheet,
  FileCheck,
  ShieldCheck,
  Server,
  FileText,
  Award,
  LogOut,
} from 'lucide-react';

interface RoleNavProps {
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  onLogout: () => void;
}

export default function RoleNavigation({ activeScreen, setActiveScreen, onLogout }: RoleNavProps) {
  const { currentRole, setCurrentRole, isLoggedIn } = useApp();

  if (!isLoggedIn) {
    return null;
  }

  const handleRoleChange = (role: UserRole) => {
    setCurrentRole(role);
    if (role === 'buyer') {
      setActiveScreen('command_center');
    } else if (role === 'category_manager') {
      setActiveScreen('kanban_board');
    } else if (role === 'vendor') {
      setActiveScreen('vendor_feed');
    } else if (role === 'admin') {
      setActiveScreen('infra_control');
    }
  };

  return (
    <div className="w-full space-y-3 pb-2">
      {/* 4 Core Roles Selector Bar */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-gray-800/80 shadow-sm backdrop-blur-md overflow-x-auto">
        <button
          onClick={() => handleRoleChange('buyer')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${
            currentRole === 'buyer'
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800/60'
          }`}
        >
          <Building2 size={16} />
          <span>1. Buyer (Larsen &amp; Toubro)</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${currentRole === 'buyer' ? 'bg-indigo-900/40 text-indigo-100' : 'bg-slate-100 dark:bg-black/30 text-slate-500 dark:text-indigo-200'}`}>
            6 Screens
          </span>
        </button>

        <button
          onClick={() => handleRoleChange('category_manager')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${
            currentRole === 'category_manager'
              ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-sky-600/30'
              : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800/60'
          }`}
        >
          <SlidersHorizontal size={16} />
          <span>2. Category Manager</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${currentRole === 'category_manager' ? 'bg-sky-900/40 text-sky-100' : 'bg-slate-100 dark:bg-black/30 text-slate-500 dark:text-cyan-200'}`}>
            6 Screens
          </span>
        </button>

        <button
          onClick={() => handleRoleChange('vendor')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${
            currentRole === 'vendor'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800/60'
          }`}
        >
          <Truck size={16} />
          <span>3. Vendor (Apex Supplies Ltd.)</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${currentRole === 'vendor' ? 'bg-emerald-900/40 text-emerald-100' : 'bg-slate-100 dark:bg-black/30 text-slate-500 dark:text-emerald-200'}`}>
            6 Screens
          </span>
        </button>

        <button
          onClick={() => handleRoleChange('admin')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap ${
            currentRole === 'admin'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-700 text-white shadow-md shadow-purple-600/30'
              : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800/60'
          }`}
        >
          <Cpu size={16} />
          <span>4. Admin & Auditor</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${currentRole === 'admin' ? 'bg-purple-900/40 text-purple-100' : 'bg-slate-100 dark:bg-black/30 text-slate-500 dark:text-purple-200'}`}>
            2 Screens
          </span>
        </button>

        <div className="flex-grow min-w-[20px]" />

        <button
          onClick={onLogout}
          className="flex items-center gap-1 px-3 py-2 rounded-xl font-bold text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 transition-all border border-transparent hover:border-rose-200 dark:hover:border-rose-900/40 shrink-0 mr-1"
        >
          <LogOut size={13} />
          <span>Logout</span>
        </button>
      </div>

      {/* Sub-Screen Navigation Pills */}
      <div className="flex items-center gap-2 px-1 text-xs overflow-x-auto">
        <span className="text-[11px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider hidden sm:inline">
          Screens:
        </span>

        {currentRole === 'buyer' && (
          <>
            <button
              onClick={() => setActiveScreen('command_center')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'command_center'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Layers size={13} /> Screen 1.1: Buyer Command Center
            </button>
            <button
              onClick={() => setActiveScreen('ingestion_wizard')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'ingestion_wizard'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <FileSpreadsheet size={13} /> Screen 1.2: AI Ingestion & Mode Wizard
            </button>
            <button
              onClick={() => setActiveScreen('vendor_evaluation_summary')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_evaluation_summary'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <FileCheck size={13} /> Screen 1.3: Mode 3 Evaluation Summary
            </button>
            <button
              onClick={() => setActiveScreen('vendor_summary')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_summary'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Building2 size={13} /> Screen 1.4: Vendor Directory & Evaluations
            </button>
            <button
              onClick={() => setActiveScreen('subscription_center')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'subscription_center'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Sparkles size={13} className="text-indigo-500" /> Screen 1.5: Sourcing Subscriptions
            </button>
            <button
              onClick={() => setActiveScreen('buyer_profile')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'buyer_profile'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Building2 size={13} className="text-indigo-500" /> Screen 1.6: Buyer Profile & Scope
            </button>
          </>
        )}

        {currentRole === 'category_manager' && (
          <>
            <button
              onClick={() => setActiveScreen('kanban_board')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'kanban_board'
                  ? 'bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Kanban size={13} /> Screen 2.1: Operational Monitoring Kanban
            </button>
            <button
              onClick={() => setActiveScreen('spend_dashboard')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'spend_dashboard'
                  ? 'bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <TrendingUp size={13} /> Screen 2.2: Spend & Performance Analytics
            </button>
            <button
              onClick={() => setActiveScreen('buyer_console')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'buyer_console'
                  ? 'bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Building2 size={13} /> Screen 2.3: Buyer RFQ summary & analytics
            </button>
            <button
              onClick={() => setActiveScreen('vendor_evaluation_summary')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_evaluation_summary'
                  ? 'bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <FileCheck size={13} /> Screen 2.4: Mode 3 Vendor Survey Evaluation
            </button>
            <button
              onClick={() => setActiveScreen('vendor_console')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_console'
                  ? 'bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Building2 size={13} /> Screen 2.5: Vendor performance & analytics
            </button>
            <button
              onClick={() => setActiveScreen('category_summary')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'category_summary'
                  ? 'bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Layers size={13} className="text-sky-500" /> Screen 2.6: Categories Summary & Trends
            </button>
          </>
        )}

        {currentRole === 'vendor' && (
          <>
            <button
              onClick={() => setActiveScreen('vendor_feed')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_feed'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Truck size={13} /> Screen 3.1: Vendor Workspace & Opportunity Feed
            </button>
            <button
              onClick={() => setActiveScreen('quotation_form')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'quotation_form'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <FileCheck size={13} /> Screen 3.2: Submitted Bids & Quotes Received
            </button>
            <button
              onClick={() => setActiveScreen('qualification_form')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'qualification_form'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Award size={13} /> Screen 3.3: Mode 3 Qualification Survey
            </button>
            <button
              onClick={() => setActiveScreen('item_catalogue')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'item_catalogue'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Layers size={13} /> Screen 3.4: Item Catalogue
            </button>
            <button
              onClick={() => setActiveScreen('vendor_subscription')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_subscription'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Sparkles size={13} className="text-emerald-500" /> Screen 3.5: Subscription Plans
            </button>
            <button
              onClick={() => setActiveScreen('vendor_profile')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'vendor_profile'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Truck size={13} className="text-emerald-500" /> Screen 3.6: Vendor Profile & Scope
            </button>
          </>
        )}

        {currentRole === 'admin' && (
          <>
            <button
              onClick={() => setActiveScreen('infra_control')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'infra_control'
                  ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <Server size={13} /> Screen 4.1: Azure Infrastructure & AI Settings
            </button>
            <button
              onClick={() => setActiveScreen('audit_log')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                activeScreen === 'audit_log'
                  ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
              }`}
            >
              <ShieldCheck size={13} /> Screen 4.2: Immutable Compliance Audit Log
            </button>
          </>
        )}
      </div>
    </div>
  );
}
