'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { fetchEmailGatewayStatus } from '@/lib/emailGatewayClient';
import { createRFQ, extractLineItemsFromDocument } from '@/lib/rfqClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { formatIndianDateTime } from '@/lib/constants';
import { logger } from '@/lib/logger';
import type { EmailGatewayOutcome, EmailGatewayStatus, ExtractedEntity, RFQItem } from '@/lib/types';
import {
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Inbox,
  Zap,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Send,
  Layers,
  Calendar,
} from 'lucide-react';

const GATEWAY = UI_STRINGS.emailGateway;

/** Connection state -> badge label and styling. */
const STATE_PRESENTATION: Record<string, { label: string; className: string }> = {
  ACTIVE_LISTENING: { label: GATEWAY.activeListeningLabel, className: 'badge-emerald' },
  CONNECTION_ERROR: { label: GATEWAY.connectionErrorLabel_state, className: 'badge-rose' },
  SWITCHED_OFF: { label: GATEWAY.offLabel, className: 'badge-purple' },
  NOT_CONFIGURED: { label: GATEWAY.notConfiguredLabel, className: 'badge-purple' },
};

/** Ledger status -> buyer-facing label and badge styling. */
const OUTCOME_PRESENTATION: Record<EmailGatewayOutcome, { label: string; className: string }> = {
  INGESTED: {
    label: GATEWAY.outcomeIngested,
    className: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  },
  SENDER_NOT_ALLOWED: {
    label: GATEWAY.outcomeSenderNotAllowed,
    className: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  },
  NO_LINE_ITEMS: {
    label: GATEWAY.outcomeNoLineItems,
    className: 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300',
  },
  UNREADABLE: {
    label: GATEWAY.outcomeUnreadable,
    className: 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300',
  },
  FAILED: {
    label: GATEWAY.outcomeFailed,
    className: 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
  },
};

const SAMPLE_REQUISITIONS = {
  pumps: {
    subject: 'URGENT: Requisition for Centrifugal Water Pumps & Industrial Valves',
    body: `Please raise RFQ for immediate delivery to Navi Mumbai Site:
1. Centrifugal Water Pump 500 GPM (15 HP Motor, SS316 Impeller, ANSI Flanged, 150 PSI) - Qty: 12 Units - Due: 2026-09-15
2. Flanged Gate Valve 4-inch Class 150 (ASTM A216 WCB Cast Carbon Steel Body) - Qty: 24 Units - Due: 2026-09-18

Please categorize under appropriate mechanical minor categories and dispatch standard RFQ emails.`,
  },
  electrical: {
    subject: 'URGENT: HT Switchgear Panels & Step-Down Power Transformers',
    body: `Requisition for Substation Expansion Project:
1. 11kV Indoor Vacuum Circuit Breaker (VCB) Switchgear Panel (630A, 25kA/3s) - Qty: 4 Panels - Due: 2026-09-20
2. 33/11kV 5 MVA Oil Immersed Power Transformer (ONAN, Copper Wound, OLTC) - Qty: 2 Units - Due: 2026-10-01

Please match with certified electrical OEMs and issue RFQs.`,
  },
  steel: {
    subject: 'URGENT: Structural Steel PEB & High-Grade TMT Rebars',
    body: `Dear Procurement Team,

Requisition for Civil & Warehouse Extension:
1. Primary Steel Pre-Engineered Building (PEB Structure) - Qty: 140 Metric Tons - Due: 2026-10-05
2. Fe500D High Strength TMT Rebar (16mm & 25mm) - Qty: 85 Metric Tons - Due: 2026-09-25

Please dispatch standard emails to civil vendors.`,
  },
};

interface EmailGatewayPanelProps {
  onRFQCreated?: (rfq: RFQItem) => void;
}

export default function EmailGatewayPanel({ onRFQCreated }: EmailGatewayPanelProps) {
  const { showToast, activeBuyerAccount, adoptCreatedRFQ, setCurrentRole, setActiveTab } = useApp();

  const [status, setStatus] = useState<EmailGatewayStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Email composer state
  const [emailSender, setEmailSender] = useState<string>('project.procurement@lt-heavy.com');
  const [emailGatewayTo, setEmailGatewayTo] = useState<string>('navinchaudhary.dev@gmail.com');
  const [emailSubject, setEmailSubject] = useState<string>(SAMPLE_REQUISITIONS.pumps.subject);
  const [emailBody, setEmailBody] = useState<string>(SAMPLE_REQUISITIONS.pumps.body);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdRFQ, setCreatedRFQ] = useState<RFQItem | null>(null);

  const loadStatus = useCallback(async () => {
    const result = await fetchEmailGatewayStatus();
    if (result.success && result.data) {
      setStatus(result.data);
      setLoadError(null);
      if (result.data.gatewayAddress) {
        setEmailGatewayTo(result.data.gatewayAddress);
      }
    } else {
      setStatus(null);
      setLoadError(result.error || GATEWAY.statusUnavailable);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Sync active buyer account email when available
  useEffect(() => {
    if (activeBuyerAccount?.corporateEmail) {
      setEmailSender(activeBuyerAccount.corporateEmail);
    }
  }, [activeBuyerAccount]);

  const handleApplySample = (sampleKey: 'pumps' | 'electrical' | 'steel') => {
    const sample = SAMPLE_REQUISITIONS[sampleKey];
    setEmailSubject(sample.subject);
    setEmailBody(sample.body);
    setCreatedRFQ(null);
  };

  const handleSubmitRequisition = async () => {
    if (!emailBody.trim()) {
      showToast('Missing Requirement', 'Please provide email body and line-item specs.', 'warning');
      return;
    }
    setIsSubmitting(true);
    logger.info('Submitting requisition via email gateway UI', { sender: emailSender, subject: emailSubject }, 'EMAIL_GATEWAY');

    try {
      const extractRes = await extractLineItemsFromDocument({
        fileName: 'inbound-requisition.txt',
        documentText: emailBody,
        mimeType: 'text/plain',
      });

      let items: ExtractedEntity[] = [];
      let category = 'Engineering Spares - Mechanical';
      let budget = 2500000;
      let targetDeliveryDate = '2026-09-18';

      if (extractRes.success && extractRes.data && extractRes.data.extractedEntities && extractRes.data.extractedEntities.length > 0) {
        items = extractRes.data.extractedEntities;
        category = extractRes.data.category || category;
        budget = extractRes.data.estimatedBudget || budget;
        targetDeliveryDate = extractRes.data.targetDeliveryDate || targetDeliveryDate;
      } else {
        // Structured fallback from requirement text
        items = [
          {
            id: `item-${Date.now()}-1`,
            itemName: emailSubject.replace(/^URGENT:\s*/i, '') || 'Custom Requisition Requirement',
            technicalSpecs: emailBody.slice(0, 160).replace(/\n/g, ' '),
            quantity: 12,
            unit: 'Units',
            category: category,
            majorCategory: category,
            minorCategory: 'General Industrial Equipment',
            targetDate: targetDeliveryDate,
            confidence: 0.95,
          },
        ];
      }

      const saveRes = await createRFQ({
        title: emailSubject || 'Inbound Email Requisition',
        category,
        sourcingMode: 'mode_1',
        status: 'Parsing',
        source: 'email_gateway',
        sourceFileName: 'inbound-email.eml',
        sourceEmail: emailSender,
        budget,
        targetDeliveryDate,
        deliveryLocation: 'Enterprise Logistics Hub (Navi Mumbai CIF Site)',
        deliveryPincode: '400707',
        extractedEntities: items,
        attachments: [],
      });

      if (!saveRes.success) {
        showToast('Ingestion Error', saveRes.error || 'Failed to save RFQ to database.', 'warning');
        return;
      }

      adoptCreatedRFQ(saveRes.rfq);
      setCreatedRFQ(saveRes.rfq);
      showToast(
        'Requisition Ingested Successfully',
        `RFQ ${saveRes.rfq.rfqNumber} has been added to the database and is now on the Category Manager Kanban Board.`,
        'success'
      );
      if (onRFQCreated) {
        onRFQCreated(saveRes.rfq);
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      showToast('Ingestion Failed', errMessage, 'warning');
    } finally {
      setIsSubmitting(false);
      await loadStatus();
    }
  };

  const handleNavigateToKanban = () => {
    setCurrentRole('category_manager');
    setActiveTab('kanban_board');
  };

  if (isLoading) {
    return (
      <div
        data-testid="gateway-loading"
        className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 flex items-center gap-2"
      >
        <RefreshCw size={14} className="animate-spin" /> {GATEWAY.title}
      </div>
    );
  }

  if (!status) {
    return (
      <div
        data-testid="gateway-error"
        className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-1"
      >
        <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
          <TriangleAlert size={14} /> {GATEWAY.title}
        </p>
        <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">{loadError}</p>
      </div>
    );
  }

  const badge = STATE_PRESENTATION[status.connectionState] || STATE_PRESENTATION.NOT_CONFIGURED;
  const isLive = status.connectionState === 'ACTIVE_LISTENING';

  return (
    <div
      data-testid="gateway-panel"
      className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-4 text-xs"
    >
      {/* Header Banner */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-gray-800 pb-3 flex-wrap">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold">
          <Mail size={16} /> {GATEWAY.title}
          {status.gatewayAddress && (
            <span className="font-mono font-semibold">({status.gatewayAddress})</span>
          )}
        </div>
        <span className={`badge ${badge.className} flex items-center gap-1`}>
          {isLive && <span className="live-dot" style={{ width: 6, height: 6 }} />}
          {badge.label}
        </span>
      </div>

      {!status.configured ? (
        <div
          data-testid="gateway-setup"
          className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 space-y-1.5"
        >
          <p className="font-bold">{GATEWAY.setupTitle}</p>
          <p className="text-[11px] leading-relaxed">{GATEWAY.setupBody}</p>
          <p className="text-[10px] opacity-80">{GATEWAY.setupHint}</p>
        </div>
      ) : (
        <>
          {/* Lights-Out Ingestion Notice */}
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
              <Zap size={14} className="text-amber-600 dark:text-amber-400" />
              {GATEWAY.lightsOutTitle}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
              {formatString(GATEWAY.howItWorksAddressed, {
                address: status.gatewayAddress || GATEWAY.gatewayAddressHint,
              })}
            </p>
          </div>

          {/* Success Banner when RFQ is Created */}
          {createdRFQ && (
            <div
              data-testid="created-rfq-banner"
              className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-100 space-y-2 animate-fade-in"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-bold flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200 text-sm">
                  <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                  {GATEWAY.createdSuccessTitle}
                </p>
                <span className="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100">
                  {createdRFQ.rfqNumber}
                </span>
              </div>
              <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/90">
                {GATEWAY.createdSuccessSubtitle}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200 dark:border-emerald-800/60 text-[11px]">
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-700/80 dark:text-emerald-300/80">Title</span>
                  <div className="font-semibold truncate">{createdRFQ.title}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-700/80 dark:text-emerald-300/80">Category</span>
                  <div className="font-semibold truncate">{createdRFQ.category}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-700/80 dark:text-emerald-300/80">Line Items</span>
                  <div className="font-semibold font-mono">{createdRFQ.extractedEntities?.length || 0} Items</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-700/80 dark:text-emerald-300/80">Status</span>
                  <div className="font-bold text-amber-700 dark:text-amber-300">{createdRFQ.status} (Held for CM)</div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleNavigateToKanban}
                  className="btn btn-primary btn-xs font-bold flex items-center gap-1.5"
                >
                  <Sparkles size={12} /> {GATEWAY.viewInKanbanAction} <ArrowRight size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedRFQ(null)}
                  className="btn btn-secondary btn-xs font-bold"
                >
                  {GATEWAY.sendAnotherAction}
                </button>
              </div>
            </div>
          )}

          {/* Requisition Composer Form */}
          <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="font-bold text-slate-700 dark:text-gray-300 text-xs">
                {GATEWAY.sampleSelectorTitle}
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleApplySample('pumps')}
                  className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold text-[10px] border border-indigo-200/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
                >
                  {GATEWAY.samplePumps}
                </button>
                <button
                  type="button"
                  onClick={() => handleApplySample('electrical')}
                  className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-semibold text-[10px] border border-amber-200/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors"
                >
                  {GATEWAY.sampleElectrical}
                </button>
                <button
                  type="button"
                  onClick={() => handleApplySample('steel')}
                  className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px] border border-emerald-200/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
                >
                  {GATEWAY.sampleSteel}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
                  {GATEWAY.fromPlantEngineerLabel}
                </label>
                <input
                  type="text"
                  value={emailSender}
                  onChange={(e) => setEmailSender(e.target.value)}
                  placeholder="project.procurement@lt-heavy.com"
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
                  {GATEWAY.toGatewayLabel}
                </label>
                <input
                  type="text"
                  value={emailGatewayTo}
                  readOnly
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-100 dark:bg-gray-950/80 text-slate-600 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
                {GATEWAY.subjectInputLabel}
              </label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="URGENT: Requisition Requirement..."
                className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
                {GATEWAY.bodyInputLabel}
              </label>
              <textarea
                rows={5}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Paste or write line items, quantities, and specifications..."
                className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1">
                <Zap size={11} /> {GATEWAY.nextStepNoVendors}
              </p>
              <button
                type="button"
                onClick={handleSubmitRequisition}
                disabled={isSubmitting || !emailBody.trim()}
                className="btn btn-primary btn-sm font-bold flex items-center gap-2 shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" /> {GATEWAY.submittingAction}
                  </>
                ) : (
                  <>
                    <Zap size={13} /> {GATEWAY.submitAction}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Intake Address Prominent Box */}
          <div
            data-testid="gateway-intake-address"
            className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50"
          >
            <p className="text-[10px] uppercase font-bold tracking-wider text-indigo-700 dark:text-indigo-300">
              {GATEWAY.gatewayAddressLabel}
            </p>
            <p className="font-mono text-sm font-bold text-indigo-900 dark:text-indigo-200 break-all">
              {status.gatewayAddress}
            </p>
            <p className="text-[10px] text-indigo-700/70 dark:text-indigo-300/70">
              {GATEWAY.gatewayAddressHint}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <span>
              <strong className="text-slate-500 dark:text-gray-400">{GATEWAY.mailboxAccountLabel}:</strong>{' '}
              <span className="font-mono">{status.mailboxUser}</span>
            </span>
            <span>
              <strong className="text-slate-500 dark:text-gray-400">{GATEWAY.checkedEveryLabel}:</strong>{' '}
              {Math.round(status.pollIntervalMs / 1000)}s
            </span>
            <span>
              <strong className="text-slate-500 dark:text-gray-400">{GATEWAY.lastCheckedLabel}:</strong>{' '}
              {status.lastPollAt ? formatIndianDateTime(status.lastPollAt) : GATEWAY.neverChecked}
            </span>
            <span>
              <strong className="text-slate-500 dark:text-gray-400">{GATEWAY.reviewStatusLabel}:</strong>{' '}
              <span className="font-semibold">{status.ingestedStatus}</span>
            </span>
          </div>

          {/* Who may raise a requisition */}
          <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1">
            <p className="font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-emerald-600 dark:text-emerald-400" />
              {status.allowedSenders.length > 0
                ? GATEWAY.allowedSendersLabel
                : status.allowedDomains.length > 0
                  ? GATEWAY.allowedDomainsLabel
                  : GATEWAY.allowedSendersLabel}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 font-mono">
              {status.allowedSenders.length > 0
                ? status.allowedSenders.join(', ')
                : status.allowedDomains.length > 0
                  ? status.allowedDomains.join(', ')
                  : GATEWAY.allowedAnyAccount}
            </p>
          </div>

          {/* Worked Example */}
          <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5">
            <p className="font-bold text-slate-700 dark:text-gray-300">{GATEWAY.exampleTitle}</p>
            <div className="text-[11px] font-mono space-y-0.5 text-slate-600 dark:text-gray-300">
              <p>
                <span className="text-slate-400">{GATEWAY.exampleFromLabel}:</span> {GATEWAY.exampleFromValue}
              </p>
              <p>
                <span className="text-slate-400">{GATEWAY.exampleToLabel}:</span>{' '}
                <strong className="text-indigo-600 dark:text-indigo-300">{status.gatewayAddress}</strong>
              </p>
              <p>
                <span className="text-slate-400">{GATEWAY.exampleSubjectLabel}:</span>{' '}
                {GATEWAY.exampleSubjectValue}
              </p>
              <p>
                <span className="text-slate-400">{GATEWAY.exampleBodyLabel}:</span> {GATEWAY.exampleBodyValue}
              </p>
            </div>
            <p className="font-bold text-slate-700 dark:text-gray-300 pt-1.5">{GATEWAY.nextStepsTitle}</p>
            <ol className="list-decimal list-inside text-[10px] space-y-0.5 text-slate-500 dark:text-gray-400">
              <li>{GATEWAY.nextStepExtract}</li>
              <li>{GATEWAY.nextStepReview}</li>
            </ol>
          </div>

          {status.lastError && (
            <div
              data-testid="gateway-last-error"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-[11px] text-rose-800 dark:text-rose-200"
            >
              <strong>{GATEWAY.connectionErrorLabel}:</strong> {status.lastError}
            </div>
          )}

          {/* Recent Inbound Messages Ledger */}
          <div className="space-y-2">
            <p className="font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <Inbox size={12} /> {GATEWAY.recentTitle}
            </p>
            {status.recent.length === 0 ? (
              <p className="text-[11px] text-slate-400">{GATEWAY.recentEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {status.recent.map((entry) => {
                  const presentation = OUTCOME_PRESENTATION[entry.status] || OUTCOME_PRESENTATION.FAILED;
                  return (
                    <li
                      key={entry.message_id}
                      className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800 dark:text-gray-200 truncate">
                          {entry.subject || entry.message_id}
                        </span>
                        <span
                          className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${presentation.className}`}
                        >
                          {entry.rfq_number ? `${presentation.label} · ${entry.rfq_number}` : presentation.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-gray-400 font-mono">
                        {entry.from_address} · {formatIndianDateTime(entry.processed_at)}
                      </p>
                      {entry.detail && (
                        <p className="text-[10px] text-slate-500 dark:text-gray-400">{entry.detail}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
