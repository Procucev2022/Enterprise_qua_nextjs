'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useApp } from '@/lib/store';
import { fetchBuyerProfile } from '@/lib/buyerProfileClient';
import {
  checkBuyerProfileCompletion,
  ProfileCompletionResult,
  ProfileFieldIssue,
  ProfileSectionKey,
  PROFILE_SECTIONS,
} from '@/lib/buyerProfileCompletion';
import type { BuyerProfile } from '@/lib/types';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  ShieldCheck,
  Sliders,
  Sparkles,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';

interface BuyerProfileCompletionModalProps {
  /** Optional override for controlled display (useful for unit testing) */
  forceOpen?: boolean;
  /** Optional callback when modal is closed/dismissed */
  onClose?: () => void;
  /** Optional initial profile for tests or parent-controlled data */
  initialProfile?: Partial<BuyerProfile> | null;
}

const SECTION_ICONS: Record<ProfileSectionKey, LucideIcon> = {
  organization: ShieldCheck,
  address: MapPin,
  contact: User,
  categories: Sliders,
};

export default function BuyerProfileCompletionModal({
  forceOpen,
  onClose,
  initialProfile,
}: BuyerProfileCompletionModalProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    isLoggedIn,
    currentRole,
    activeBuyerAccount,
    currentUserSession,
    initialSetupModalOpen,
  } = useApp();

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [profileData, setProfileData] = useState<Partial<BuyerProfile> | null>(
    initialProfile || null
  );
  const [hasDismissed, setHasDismissed] = useState<boolean>(false);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(true);

  // Compute profile completion status
  const completion: ProfileCompletionResult = useMemo(() => {
    // Merge freshest profile data with activeBuyerAccount fallback
    const mergedData = {
      ...(activeBuyerAccount || {}),
      ...(profileData || {}),
    };
    return checkBuyerProfileCompletion(mergedData);
  }, [profileData, activeBuyerAccount]);

  // Load latest profile from API if logged in as buyer
  const loadProfileForAssessment = useCallback(async () => {
    if (!isLoggedIn || currentRole !== 'buyer') {
      setIsEvaluating(false);
      return;
    }

    try {
      const res = await fetchBuyerProfile();
      if (res.success && res.data) {
        setProfileData(res.data);
      }
    } catch {
      // Retain fallback data from activeBuyerAccount
    } finally {
      setIsEvaluating(false);
    }
  }, [isLoggedIn, currentRole]);

  useEffect(() => {
    void loadProfileForAssessment();
  }, [loadProfileForAssessment]);

  // Listen for real-time profile updates (e.g. from saveBuyerProfile)
  useEffect(() => {
    const handleProfileUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<BuyerProfile>;
      if (customEvent.detail) {
        setProfileData(customEvent.detail);
      } else {
        void loadProfileForAssessment();
      }
    };

    window.addEventListener('buyer-profile-updated', handleProfileUpdate);
    return () => {
      window.removeEventListener('buyer-profile-updated', handleProfileUpdate);
    };
  }, [loadProfileForAssessment]);

  // Determine visibility
  useEffect(() => {
    // If explicitly forced open (e.g. test)
    if (forceOpen !== undefined) {
      setIsOpen(forceOpen);
      return;
    }

    // Never show if not logged in or not a buyer
    if (!isLoggedIn || currentRole !== 'buyer') {
      setIsOpen(false);
      return;
    }

    // Do not open simultaneously with Initial Setup modal
    if (initialSetupModalOpen) {
      setIsOpen(false);
      return;
    }

    // Do not show while on the profile editing page itself to avoid modal blocking the form
    if (pathname === '/buyer/profile') {
      setIsOpen(false);
      return;
    }

    // If profile is already complete, do not show
    if (completion.isComplete) {
      setIsOpen(false);
      return;
    }

    // If dismissed in this in-memory session, keep closed
    if (hasDismissed) {
      setIsOpen(false);
      return;
    }

    // Display reminder popup if mandatory fields are missing, invalid, or categories not updated
    if (!isEvaluating && !completion.isComplete) {
      setIsOpen(true);
    }
  }, [forceOpen, isLoggedIn, currentRole, pathname, completion.isComplete, hasDismissed, isEvaluating, initialSetupModalOpen]);

  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    setHasDismissed(true);
    if (onClose) onClose();
  }, [onClose]);

  const handleNavigateToProfile = (anchor?: string) => {
    setIsOpen(false);
    const targetUrl = anchor ? `/buyer/profile#${anchor}` : '/buyer/profile';
    router.push(targetUrl);
    if (onClose) onClose();
  };

  // Keyboard accessibility: Escape key to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleDismiss]);

  if (!isOpen || (completion.isComplete && !forceOpen)) {
    return null;
  }

  const { completionPercentage, completedCount, totalCount, issues } = completion;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="buyer-profile-reminder-title"
      aria-describedby="buyer-profile-reminder-desc"
      data-testid="buyer-profile-completion-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in"
    >
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-auto animate-scale-up min-w-0">
        {/* Top Gradient Banner Header */}
        <div className="relative bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 text-white p-4 sm:p-5 overflow-hidden">
          {/* Subtle Decorative Background Circles */}
          <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute right-12 -top-12 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0 border border-white/30 shadow-xs">
                <Sparkles size={20} className="text-amber-300" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-sans shadow-xs">
                    Action Recommended
                  </span>
                  <span className="text-[10px] text-indigo-100 font-medium">
                    Profile Onboarding
                  </span>
                </div>
                <h2
                  id="buyer-profile-reminder-title"
                  className="text-base sm:text-lg font-black tracking-tight text-white"
                >
                  Complete Your Buyer Profile
                </h2>
                <p
                  id="buyer-profile-reminder-desc"
                  className="text-xs text-white/90 mt-1 leading-relaxed max-w-md"
                >
                  Complete your profile and product categories to receive more relevant, faster, and better competitive quotations from verified suppliers.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss reminder"
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          {/* Progress Bar Container */}
          <div className="mt-4 pt-3 border-t border-white/20">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5 text-white">
              <span>Profile Completion</span>
              <span className="mono font-black text-white">{completionPercentage}% Completed</span>
            </div>
            <div className="w-full h-2 rounded-full bg-black/20 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  completionPercentage >= 80
                    ? 'bg-emerald-400'
                    : completionPercentage >= 50
                      ? 'bg-amber-400'
                      : 'bg-rose-400'
                }`}
                style={{ width: `${Math.max(5, completionPercentage)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-white/80 mt-1">
              <span>
                {completedCount} of {totalCount} mandatory fields completed
              </span>
              <span>
                {issues.length} {issues.length === 1 ? 'item needs' : 'items need'} attention
              </span>
            </div>
          </div>
        </div>

        {/* Modal Body: Missing / Incomplete Items Checklist */}
        <div className="p-4 sm:p-5 space-y-3.5 max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-500" />
              <span>Pending Profile Information &amp; Categories</span>
            </h3>
            <span className="text-[10px] text-slate-400 font-semibold">
              Mandatory Requirements
            </span>
          </div>

          <div className="space-y-2">
            {issues.map((issue: ProfileFieldIssue) => {
              const SectionIcon = SECTION_ICONS[issue.section];
              return (
                <div
                  key={issue.field}
                  className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-800/40 hover:bg-slate-100/80 dark:hover:bg-gray-800/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 mt-0.5 border border-indigo-100 dark:border-indigo-900/40">
                      <SectionIcon size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {issue.label}
                        </span>
                        <span
                          className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded-full tracking-wider ${
                            issue.status === 'missing'
                              ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40'
                              : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40'
                          }`}
                        >
                          {issue.status === 'missing' ? 'Missing' : 'Needs Correction'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 leading-tight">
                        {issue.issue}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleNavigateToProfile(issue.sectionAnchor)}
                    className="self-end sm:self-auto text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
                  >
                    <span>Update</span>
                    <ArrowRight size={11} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Value Proposition Note */}
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Why complete this?</strong> Verified company and statutory details build supplier trust. Added product categories ensure suppliers receive relevant RFQs and deliver competitive quotes promptly.
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-900/60 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleDismiss}
            data-testid="buyer-profile-reminder-dismiss-btn"
            className="btn btn-secondary btn-sm justify-center font-bold text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-800"
          >
            <Clock size={13} />
            <span>Remind Me Later</span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigateToProfile(issues[0]?.sectionAnchor)}
            data-testid="buyer-profile-reminder-complete-btn"
            className="btn btn-primary btn-sm justify-center font-bold shadow-md shadow-indigo-500/20"
          >
            <span>Complete Profile Now</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
