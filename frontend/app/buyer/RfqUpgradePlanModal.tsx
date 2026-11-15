'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { fetchSubscriptionPricing, type SubscriptionPricingResponse } from '@/lib/subscriptionPaymentClient';
import { PLAN_LABEL } from '@/app/buyer/subscription-center';
import {
  getBuyerGstPercent,
  getBuyerPlanPrice,
  getTwelveMonthSavingPercent,
  type BillingDuration,
  type BuyerPlanId,
} from '@/app/buyer/buyerPlanPricing';
import type { SourcingMode } from '@/lib/types';
import {
  AlertCircle,
  Sparkles,
  ShieldCheck,
  CreditCard,
  X,
  Zap,
  Building2,
  QrCode,
  ArrowRight,
} from 'lucide-react';

export interface RfqUpgradePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetMode?: SourcingMode | string;
  remainingCredits?: number;
  onSwitchToMode0?: () => void;
}

const MODE_PLAN_MAP: Record<string, { planId: BuyerPlanId; name: string; modeTitle: string }> = {
  mode_1: {
    planId: 'version_1',
    name: 'Silver Plan (Private Vendor Network)',
    modeTitle: 'Mode 1 (Private Vendor Network)',
  },
  mode_2: {
    planId: 'version_2',
    name: 'Gold Plan (Verified Supplier Network)',
    modeTitle: 'Mode 2 (Procucev Verified Supplier Network)',
  },
  mode_3: {
    planId: 'version_3',
    name: 'Diamond Plan (Double-Blind Autonomous Sourcing)',
    modeTitle: 'Mode 3 (Double-Blind Autonomous Sourcing)',
  },
};

export default function RfqUpgradePlanModal({
  isOpen,
  onClose,
  targetMode = 'mode_1',
  remainingCredits = 0,
  onSwitchToMode0,
}: RfqUpgradePlanModalProps) {
  const { createBuyerPaymentLink } = useApp();
  const [billingDuration, setBillingDuration] = useState<BillingDuration>('12_months');
  // Prices come only from the server. Until the pricing request answers, and when
  // it fails, no amount is shown and the payment button stays disabled.
  const [pricingConfig, setPricingConfig] = useState<SubscriptionPricingResponse | null>(null);
  const [pricingStatus, setPricingStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void fetchSubscriptionPricing().then((config) => {
      if (!isMounted) return;
      if (config?.buyer) {
        setPricingConfig(config);
        setPricingStatus('ready');
      } else {
        setPricingConfig(null);
        setPricingStatus('unavailable');
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  if (!isOpen) return null;

  const modeInfo = MODE_PLAN_MAP[targetMode] || MODE_PLAN_MAP.mode_1;
  const currentPlanId = modeInfo.planId;
  const selectedPlanPricing = getBuyerPlanPrice(pricingConfig, currentPlanId, billingDuration);
  const savingPercent = getTwelveMonthSavingPercent(pricingConfig, currentPlanId);
  const gstPercent = getBuyerGstPercent(pricingConfig);
  const unpricedLabel = pricingStatus === 'loading' ? 'Loading price…' : 'Price unavailable';

  // Derive mode display string
  const modeKey = targetMode === 'mode_1' ? 'Mode 1' : targetMode === 'mode_2' ? 'Mode 2' : targetMode === 'mode_3' ? 'Mode 3' : targetMode;

  const handleProceedToPayment = async () => {
    if (!selectedPlanPricing) return;
    setIsRedirecting(true);
    setError(null);
    try {
      const paymentUrl = await createBuyerPaymentLink(currentPlanId, billingDuration);
      if (!paymentUrl) {
        setIsRedirecting(false);
        setError('Could not initialize secure payment gateway. Please try again.');
        return;
      }
      window.location.href = paymentUrl;
    } catch (err: unknown) {
      setIsRedirecting(false);
      setError(err instanceof Error && err.message ? err.message : 'Payment initiation failed. Please try again.');
    }
  };

  return (
    <div
      data-testid="rfq-upgrade-plan-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 dark:bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in"
    >
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-gray-800 overflow-hidden text-slate-900 dark:text-white my-8">
        {/* Top Header Banner */}
        <div className="relative px-6 py-5 bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-emerald-500/10 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-xs">
                <Sparkles size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                    Upgrade RFQ Sourcing Plan
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                    Quota Reached
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Unlock enterprise sourcing modes and publish unlimited RFQs
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              disabled={isRedirecting}
              aria-label="Close modal"
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Exact required warning banner */}
          <div
            data-testid="rfq-upgrade-warning-banner"
            className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 shadow-xs"
          >
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
                You don&apos;t have credits to publish the RFQ in {modeKey}.
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                Your free trial allocation ({remainingCredits} remaining) is exhausted for advanced sourcing. Upgrade to the{' '}
                <span className="font-bold underline decoration-amber-400">{PLAN_LABEL[currentPlanId]}</span> to publish and manage RFQs in {modeInfo.modeTitle}.
              </p>
            </div>
          </div>

          {pricingStatus === 'unavailable' && (
            <p role="alert" className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl border border-rose-200 dark:border-rose-800">
              Plan prices could not be loaded from the server, so checkout is unavailable. Close this dialog and try again.
            </p>
          )}

          {/* Billing Duration Switcher */}
          <div className="flex items-center justify-between p-1.5 rounded-2xl bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setBillingDuration('12_months')}
              className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                billingDuration === '12_months'
                  ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200 dark:border-gray-700'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>12 Months Plan</span>
              {savingPercent !== null && (
                <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Save {savingPercent}%
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setBillingDuration('6_months')}
              className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                billingDuration === '6_months'
                  ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200 dark:border-gray-700'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>6 Months Plan</span>
            </button>
          </div>

          {/* Upgrade Amount Breakdown Card */}
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-700">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Target Tier Required
                </span>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {PLAN_LABEL[currentPlanId]} &bull; {modeInfo.modeTitle}
                </h4>
              </div>
              <div className="text-right">
                {selectedPlanPricing ? (
                  <div className="text-base font-black text-slate-900 dark:text-white">
                    {selectedPlanPricing.price}{' '}
                    <span className="text-[10px] font-normal text-slate-500 dark:text-gray-400">/ month</span>
                  </div>
                ) : (
                  <span className="text-xs font-bold text-rose-700 dark:text-rose-300">{unpricedLabel}</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600 dark:text-gray-300">
              <div className="flex justify-between items-center">
                <span>Base Subscription ({billingDuration === '12_months' ? '12 Months' : '6 Months'})</span>
                <span className="font-semibold text-slate-900 dark:text-white">{selectedPlanPricing?.baseDurationLabel ?? '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Applicable GST{gstPercent !== null ? ` (${gstPercent}%)` : ''}</span>
                <span className="font-semibold text-slate-900 dark:text-white">{selectedPlanPricing?.gstAmount ?? '—'}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-gray-700 flex justify-between items-center">
                <span className="font-bold text-slate-900 dark:text-white">Total Amount to Upgrade</span>
                <span className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                  {selectedPlanPricing?.totalPriceWithGst ?? '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Options Towards Upgrade */}
          <div className="space-y-2.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
              <CreditCard size={13} className="text-indigo-500" />
              <span>Available Payment Options Towards Upgrade:</span>
            </label>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 flex items-center gap-2.5 shadow-2xs">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <QrCode size={16} />
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Instant UPI &amp; QR</div>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400">GPay, PhonePe, Paytm, BHIM</div>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 flex items-center gap-2.5 shadow-2xs">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0">
                  <CreditCard size={16} />
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Cards &amp; Net Banking</div>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400">Visa, MasterCard, RuPay, 50+ Banks</div>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 flex items-center gap-2.5 shadow-2xs">
                <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
                  <Building2 size={16} />
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Corporate Wire / NEFT</div>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400">Direct RTGS / NEFT invoicing</div>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 flex items-center gap-2.5 shadow-2xs">
                <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
                  <ShieldCheck size={16} />
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Zoho Secure Gateway</div>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400">256-Bit SSL Encrypted</div>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl border border-rose-200 dark:border-rose-800">
              {error}
            </p>
          )}

          {/* Alternative: Switch to Mode 0 (Free Assisted) */}
          {onSwitchToMode0 && (
            <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Zap size={18} className="text-emerald-500 fill-emerald-500 shrink-0" />
                <div>
                  <h5 className="font-bold text-slate-900 dark:text-white text-xs">Don&apos;t want to upgrade yet?</h5>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    Switch to Mode 0 (Assisted Sourcing) — 100% free with unlimited RFQ submissions.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onSwitchToMode0}
                className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer"
              >
                <Zap size={12} className="fill-current" />
                <span>Publish in Mode 0 (Free)</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-gray-800/50 border-t border-slate-200 dark:border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isRedirecting}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel &amp; Keep Editing
          </button>

          <button
            type="button"
            onClick={() => void handleProceedToPayment()}
            disabled={isRedirecting || !selectedPlanPricing}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CreditCard size={15} />
            <span>
              {isRedirecting
                ? 'Connecting to Zoho Secure Checkout…'
                : selectedPlanPricing
                  ? `Proceed to Pay ${selectedPlanPricing.totalPriceWithGst}`
                  : unpricedLabel}
            </span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
