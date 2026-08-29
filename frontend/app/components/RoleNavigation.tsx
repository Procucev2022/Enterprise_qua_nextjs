'use client';

import React from 'react';
import { useApp } from '@/lib/store';
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
  Database,
} from 'lucide-react';

interface RoleNavProps {
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  onLogout: () => void;
}

export default function RoleNavigation({ activeScreen, setActiveScreen }: RoleNavProps) {
  const { currentRole, isLoggedIn, activeBuyerAccount, vendorSubscription } = useApp();

  if (!isLoggedIn) {
    return null;
  }

  return (
    <div className="w-full space-y-2 pb-1">
      {/* Sub-Screen Navigation Bar for Active Role */}
      <div className="flex items-center justify-between gap-3 p-1.5 rounded-2xl bg-white/90 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800/90 shadow-sm backdrop-blur-md overflow-x-auto">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 text-xs">
          {/* Active Workspace Label Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700/60 font-bold text-[11px] text-slate-700 dark:text-gray-300 shrink-0 mr-1">
            {currentRole === 'buyer' && (
              <>
                <Building2 size={13} className="text-indigo-600 dark:text-indigo-400" />
                <span className="hidden sm:inline">Buyer Workspace:</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">{activeBuyerAccount?.organizationName || 'L&T'}</span>
              </>
            )}
            {currentRole === 'category_manager' && (
              <>
                <SlidersHorizontal size={13} className="text-sky-600 dark:text-sky-400" />
                <span className="hidden sm:inline">Category Desk:</span>
                <span className="text-sky-600 dark:text-sky-400 font-extrabold">Mechanical Ops</span>
              </>
            )}
            {currentRole === 'vendor' && (
              <>
                <Truck size={13} className="text-emerald-600 dark:text-emerald-400" />
                <span className="hidden sm:inline">Vendor Portal:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">Apex Supplies</span>
              </>
            )}
            {currentRole === 'admin' && (
              <>
                <Cpu size={13} className="text-purple-600 dark:text-purple-400" />
                <span className="hidden sm:inline">Admin Desk:</span>
                <span className="text-purple-600 dark:text-purple-400 font-extrabold">Compliance & Infra</span>
              </>
            )}
          </div>

          {/* BUYER SCREENS */}
          {currentRole === 'buyer' && (
            <>
              <button
                onClick={() => setActiveScreen('command_center')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'command_center'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Layers size={13} /> Screen 1.1: Command Center
              </button>
              <button
                onClick={() => setActiveScreen('ingestion_wizard')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'ingestion_wizard'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <FileSpreadsheet size={13} /> Screen 1.2: AI Ingestion &amp; Mode Wizard
              </button>
              <button
                onClick={() => setActiveScreen('vendor_evaluation_summary')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_evaluation_summary'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <FileCheck size={13} /> Screen 1.3: Evaluation Summary
              </button>
              <button
                onClick={() => setActiveScreen('vendor_summary')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_summary'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Building2 size={13} /> Screen 1.4: Vendor Directory
              </button>
              <button
                onClick={() => setActiveScreen('subscription_center')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'subscription_center'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Sparkles size={13} className="text-amber-400" /> Screen 1.5: Sourcing Subscriptions
              </button>
              <button
                onClick={() => setActiveScreen('buyer_profile')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'buyer_profile'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Building2 size={13} /> Screen 1.6: Buyer Profile
              </button>
              <button
                onClick={() => setActiveScreen('buyer_directory')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'buyer_directory'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Database size={13} className="text-amber-500" /> Screen 1.7: Buyer DB Sync
              </button>
            </>
          )}

          {/* CATEGORY MANAGER SCREENS */}
          {currentRole === 'category_manager' && (
            <>
              <button
                onClick={() => setActiveScreen('kanban_board')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'kanban_board'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Kanban size={13} /> Screen 2.1: Operational Kanban
              </button>
              <button
                onClick={() => setActiveScreen('spend_dashboard')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'spend_dashboard'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <TrendingUp size={13} /> Screen 2.2: Spend Analytics
              </button>
              <button
                onClick={() => setActiveScreen('buyer_console')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'buyer_console'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Building2 size={13} /> Screen 2.3: Buyer RFQ Console
              </button>
              <button
                onClick={() => setActiveScreen('vendor_evaluation_summary')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_evaluation_summary'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <FileCheck size={13} /> Screen 2.4: Mode 3 Evaluations
              </button>
              <button
                onClick={() => setActiveScreen('vendor_console')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_console'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Building2 size={13} /> Screen 2.5: Vendor Performance
              </button>
              <button
                onClick={() => setActiveScreen('category_summary')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'category_summary'
                    ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Layers size={13} className="text-sky-400" /> Screen 2.6: Categories &amp; Trends
              </button>
            </>
          )}

          {/* VENDOR SCREENS */}
          {currentRole === 'vendor' && (
            <>
              <button
                onClick={() => setActiveScreen('vendor_feed')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_feed'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Truck size={13} /> Screen 3.1: Opportunity Feed
              </button>
              <button
                onClick={() => setActiveScreen('quotation_form')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'quotation_form'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <FileCheck size={13} /> Screen 3.2: Bid Quotes
              </button>
              <button
                onClick={() => setActiveScreen('qualification_form')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'qualification_form'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Award size={13} /> Screen 3.3: 360° AI Self-Evaluation
              </button>
              <button
                onClick={() => setActiveScreen('item_catalogue')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'item_catalogue'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Layers size={13} /> Screen 3.4: Item Catalogue
              </button>
              <button
                onClick={() => setActiveScreen('vendor_subscription')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_subscription'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Sparkles size={13} className="text-emerald-400" /> Screen 3.5: Subscription Plans
              </button>
              <button
                onClick={() => setActiveScreen('vendor_profile')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'vendor_profile'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Truck size={13} className="text-emerald-400" /> Screen 3.6: Vendor Profile
              </button>
            </>
          )}

          {/* ADMIN SCREENS */}
          {currentRole === 'admin' && (
            <>
              <button
                onClick={() => setActiveScreen('infra_control')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'infra_control'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <Server size={13} /> Screen 4.1: Azure Infrastructure &amp; AI
              </button>
              <button
                onClick={() => setActiveScreen('audit_log')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  activeScreen === 'audit_log'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                    : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800/50'
                }`}
              >
                <ShieldCheck size={13} /> Screen 4.2: Immutable Audit Log
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
