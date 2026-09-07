'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { fetchEmailGatewayStatus, pollEmailGateway } from '@/lib/emailGatewayClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { formatIndianDateTime } from '@/lib/constants';
import { logger } from '@/lib/logger';
import type { EmailGatewayOutcome, EmailGatewayStatus } from '@/lib/types';
import { Mail, RefreshCw, ShieldCheck, TriangleAlert, Inbox, Zap } from 'lucide-react';

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

/**
 * Live state of the autonomous mailbox gateway.
 *
 * Replaces a simulator: the tab used to hold three hardcoded sample requisitions,
 * an editable From field, a read-only To address and a green "Active & Listening"
 * badge with nothing behind it. Everything rendered here comes from
 * GET /api/rfqs/email-gateway/status, so an unconfigured or failing gateway is
 * shown as exactly that rather than as healthy.
 *
 * There is no extract action on this tab. The gateway raises RFQs on its own and
 * parks them for review; a buyer does not drive it.
 */
export default function EmailGatewayPanel() {
  const { showToast } = useApp();

  const [status, setStatus] = useState<EmailGatewayStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  const loadStatus = useCallback(async () => {
    const result = await fetchEmailGatewayStatus();
    if (result.success && result.data) {
      setStatus(result.data);
      setLoadError(null);
    } else {
      setStatus(null);
      setLoadError(result.error || GATEWAY.statusUnavailable);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCheckNow = async () => {
    if (isChecking) return;
    setIsChecking(true);
    logger.info('Manual email gateway check requested', undefined, 'EMAIL_GATEWAY');
    try {
      const result = await pollEmailGateway();
      if (!result.success || !result.data) {
        // The server explains whether it is switched off, already running, or the
        // mailbox refused the connection, so its wording is shown.
        showToast(GATEWAY.checkFailedTitle, result.error || GATEWAY.pollFailed, 'warning');
        return;
      }
      showToast(
        GATEWAY.checkCompleteTitle,
        formatString(GATEWAY.checkCompleteMessage, {
          considered: result.data.considered,
          ingested: result.data.ingested,
          pending: result.data.pending,
        }),
        'success'
      );
    } finally {
      // Refreshed either way: a failed check still updates lastError.
      await loadStatus();
      setIsChecking(false);
    }
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

  // Driven by the server's connectionState so a configuration fault reads as a
  // connection error rather than as a healthy gateway that simply is not watching.
  const badge = STATE_PRESENTATION[status.connectionState] || STATE_PRESENTATION.NOT_CONFIGURED;
  const isLive = status.connectionState === 'ACTIVE_LISTENING';

  return (
    <div
      data-testid="gateway-panel"
      className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-4 text-xs"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-gray-800 pb-3 flex-wrap">
        {/* The intake address sits in the heading, as in the prototype, so the
            address a buyer sends to is the first thing read. */}
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
          {/* The prototype's lights-out banner, kept as the visual anchor but with
              the claim corrected. It asserted that the system also shortlists
              vendors and circulates the RFQ automatically; it does neither, and
              releasing to vendors is the Category Manager's decision. */}
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

          {/* The intake address, given prominence: it is the one thing a buyer has
              to act on. The IMAP account it is collected from is shown below as an
              operational detail, not as somewhere to send mail. */}
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

          {/* Who may raise a requisition this way. Stated because an unlisted
              sender is silently skipped, and that has to be discoverable. */}
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

          {/* Worked example plus the explicit boundary of this screen, so the
              direction of the flow cannot be misread as the buyer dispatching to
              vendors. */}
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
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              {GATEWAY.nextStepNoVendors}
            </p>
          </div>

          {status.lastError && (
            <div
              data-testid="gateway-last-error"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-[11px] text-rose-800 dark:text-rose-200"
            >
              <strong>{GATEWAY.connectionErrorLabel}:</strong> {status.lastError}
            </div>
          )}

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

      <div className="flex justify-end pt-1 border-t border-slate-200 dark:border-gray-800">
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={isChecking || !status.configured}
          aria-busy={isChecking}
          className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={isChecking ? 'animate-spin' : ''} />
          {isChecking ? GATEWAY.checkingLabel : GATEWAY.checkNowAction}
        </button>
      </div>
    </div>
  );
}
