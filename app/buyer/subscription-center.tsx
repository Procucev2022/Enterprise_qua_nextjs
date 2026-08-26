'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { Sparkles, ShieldCheck, Check, Zap, Layers, AlertCircle, RefreshCw } from 'lucide-react';

export default function SubscriptionCenter() {
  const {
    activeSubscription,
    setActiveSubscription,
    remainingFreeRFQs,
    setRemainingFreeRFQs,
    showToast,
  } = useApp();

  const handleSubscribe = (plan: 'version_1' | 'version_2' | 'version_3') => {
    setActiveSubscription(plan);
    const planName =
      plan === 'version_1'
        ? 'Version 1: Client Roster Plan'
        : plan === 'version_2'
        ? 'Version 2: Hybrid Sourcing Plan'
        : 'Version 3: Autonomous AI Sourcing Plan';

    showToast(
      'Subscription Activated!',
      `Successfully subscribed to ${planName}. All associated features are now unlocked.`,
      'success'
    );
  };

  const handleResetTrial = () => {
    setActiveSubscription('free_trial');
    setRemainingFreeRFQs(5);
    showToast(
      'Trial Restored',
      'Free trial reset: 5 remaining Version 1 RFQs granted.',
      'info'
    );
  };

  const plans = [
    {
      id: 'version_1' as const,
      name: 'Version 1 Sourcing',
      subtext: 'Roster-Based Chasing',
      price: '$199',
      billing: 'per user / month',
      description: 'Streamline procurement across your pre-approved roster with automated working-hour follow-up pipelines.',
      colorClass: 'from-indigo-650 to-indigo-750 text-indigo-600 border-indigo-200 dark:border-indigo-900',
      shadowClass: 'shadow-indigo-500/10',
      badge: 'Basic Roster',
      features: [
        'Direct Sourcing from uploaded Excel/Manual buyer rosters',
        'SMS outreach sent exactly 5 mins after email dispatch',
        'Automatic Call chasing placed after 6 working hours',
        'WhatsApp chaser interactive prompts after 12 working hours',
        'Skips Sundays and operates strictly 8 AM - 7 PM IST Mon-Sat',
        'OCR Quote extraction parsed directly from incoming vendor emails',
        'Automatic halt of chasing sequence upon quote ingestion',
      ],
    },
    {
      id: 'version_2' as const,
      name: 'Version 2 Sourcing',
      subtext: 'Hybrid Sourced Network',
      price: '$499',
      billing: 'per user / month',
      description: 'Expand your pool to Procucev Base Network suppliers. Evaluate vendors immediately post-quote.',
      colorClass: 'from-sky-600 to-blue-600 text-sky-600 border-sky-200 dark:border-sky-900',
      shadowClass: 'shadow-sky-500/10',
      badge: 'Recommended',
      features: [
        'All features in Version 1 included',
        'RFQ broadcast matches Procucev Pool network partners',
        'Intelligent RFQ Category matching & Location proximity filter',
        'Automatic classification of Buyer Upload vs. Network pool',
        'Vendor evaluation triggers unlocked strictly after quote receipt',
        'Interactive evaluation surveys to verify quality metrics post-bid',
        'Real-time proximity-based targeted pool preview in Wizard',
      ],
    },
    {
      id: 'version_3' as const,
      name: 'Version 3 Sourcing',
      subtext: 'Autonomous Sourcing Desk',
      price: '$999',
      billing: 'per user / month',
      description: 'Fully autonomous category manager desk. Full 360-degree audits and matrices active immediately.',
      colorClass: 'from-purple-600 to-indigo-650 text-purple-600 border-purple-200 dark:border-purple-900',
      shadowClass: 'shadow-purple-500/10',
      badge: 'Enterprise AI',
      features: [
        'All features in Version 1 & 2 included',
        'Immediate 360-degree Vendor Audits active for all pool partners',
        'Detailed remarks & documents OCR checked against each criteria',
        'Interactive Comparative Quote Evaluation Matrices',
        'Automatic PO generation & contract digital signature creation',
        'Immutable Compliance Audit Log (SHA-256 integrity checkers)',
        'Autonomous category agent operational monitoring Kanban desk',
      ],
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            Procurement Sourcing Mode Subscriptions
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
            Compare subscription models, check trial quotas, and activate Version 1, 2, or 3 features.
          </p>
        </div>
        <button
          onClick={handleResetTrial}
          className="btn btn-secondary btn-sm flex items-center gap-1 shrink-0"
        >
          <RefreshCw size={12} /> Reset to Trial (5 Free V1 RFQs)
        </button>
      </div>

      {/* Trial Quota Info Alert */}
      {activeSubscription === 'free_trial' ? (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-3 shadow-sm">
          <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
          <div className="space-y-1">
            <span className="font-extrabold block">🎁 Active Free Trial Status</span>
            <p>
              Your account has access to <strong>Version 1 (Roster Sourcing)</strong> for exactly <strong>{remainingFreeRFQs} remaining RFQs</strong>.
              Sourcing via Version 2 (Hybrid Pool) or Version 3 (AI Autonomous) requires activating their respective subscriptions.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-3 shadow-sm">
          <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={16} />
          <div className="space-y-1">
            <span className="font-extrabold block">✅ Active Premium Plan: {activeSubscription === 'version_1' ? 'Version 1' : activeSubscription === 'version_2' ? 'Version 2' : 'Version 3'}</span>
            <p>
              Thank you for subscribing! Your platform Sourcing Mode is now active. All dispatches, follow-up chasers, and evaluation matrices associated with this plan are unlocked.
            </p>
          </div>
        </div>
      )}

      {/* Plan Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {plans.map((p) => {
          const isActive = activeSubscription === p.id;
          const isTrialActive = activeSubscription === 'free_trial' && p.id === 'version_1';
          const buttonLabel = isActive
            ? 'Active Subscription'
            : isTrialActive
            ? 'Active Free Trial'
            : `Subscribe to ${p.name.split(' ')[0]} ${p.name.split(' ')[1]}`;

          return (
            <div
              key={p.id}
              className={`rounded-3xl border bg-white dark:bg-gray-900 flex flex-col justify-between overflow-hidden transition-all shadow-md relative ${
                isActive || isTrialActive
                  ? 'border-brand-500 ring-2 ring-brand-500/20 scale-[1.01]'
                  : 'border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-700'
              }`}
            >
              {/* Highlight Ribbon */}
              {(isActive || isTrialActive) && (
                <div className="absolute top-0 right-0 bg-brand-500 text-white font-mono text-[9px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                  Active
                </div>
              )}

              {/* Card Body */}
              <div className="p-6 space-y-5">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500">
                    {p.subtext}
                  </span>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{p.name}</h3>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{p.price}</span>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500 font-medium">{p.billing}</span>
                </div>

                <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed min-h-[48px]">
                  {p.description}
                </p>

                <hr className="border-slate-100 dark:border-gray-800/80" />

                {/* Features List */}
                <div className="space-y-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500 block">
                    Core Benefits & Features:
                  </span>
                  <ul className="space-y-2">
                    {p.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-650 dark:text-gray-300">
                        <Check size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Card Footer Button */}
              <div className="p-6 bg-slate-50 dark:bg-gray-950/40 border-t border-slate-150 dark:border-gray-800/60">
                <button
                  onClick={() => handleSubscribe(p.id)}
                  disabled={isActive || isTrialActive}
                  className={`btn w-full text-xs font-bold py-2 flex items-center justify-center gap-1.5 ${
                    isActive || isTrialActive
                      ? 'btn-secondary border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 cursor-default opacity-85'
                      : 'btn-primary'
                  }`}
                >
                  {(isActive || isTrialActive) ? <ShieldCheck size={13} /> : <Zap size={13} />}
                  {buttonLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
