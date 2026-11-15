'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { buildAuditCsvDataUrl, fetchAuditVerification } from '@/lib/auditClient';
import { logger } from '@/lib/logger';
import type { AuditLogEntry, AuditVerificationReport } from '@/lib/types';
import { formatString, UI_STRINGS } from '@/lib/uiStrings';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleHelp,
  Copy,
  Download,
  Hash,
  Search,
  ShieldCheck,
} from 'lucide-react';

interface AuditLogProps {
  onBackToInfra: () => void;
}

type VerificationState = 'loading' | 'ready' | 'error';

function identityLabel(log: AuditLogEntry): string {
  return log.user || log.userEmail || UI_STRINGS.screens.auditLogs.unknownUser;
}

export default function AuditLog({ onBackToInfra }: AuditLogProps) {
  const { auditLogs, showToast } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogForDetail, setSelectedLogForDetail] = useState<AuditLogEntry | null>(null);
  const [verification, setVerification] = useState<AuditVerificationReport | null>(null);
  const [verificationState, setVerificationState] = useState<VerificationState>('loading');
  const [verificationError, setVerificationError] = useState('');
  const [verificationAttempt, setVerificationAttempt] = useState(0);

  useEffect(() => {
    let isActive = true;
    setVerificationState('loading');
    setVerificationError('');

    fetchAuditVerification()
      .then((report) => {
        if (!isActive) return;
        setVerification(report);
        setVerificationState('ready');
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setVerification(null);
        setVerificationError(error instanceof Error ? error.message : UI_STRINGS.screens.auditLogs.verificationUnavailable);
        setVerificationState('error');
      });

    return () => {
      isActive = false;
    };
  }, [verificationAttempt]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredLogs = useMemo(() => auditLogs.filter((log) => {
    const identity = identityLabel(log).toLowerCase();
    return !normalizedSearch ||
      log.action.toLowerCase().includes(normalizedSearch) ||
      identity.includes(normalizedSearch) ||
      (log.rfqNumber || '').toLowerCase().includes(normalizedSearch) ||
      log.shaSignature.toLowerCase().includes(normalizedSearch);
  }), [auditLogs, normalizedSearch]);

  const issueIds = useMemo(
    () => new Set((verification?.compromisedEntries || []).map((entry) => entry.id).filter((id): id is string => Boolean(id))),
    [verification]
  );
  const fullChainVerified = verificationState === 'ready' && verification?.complete === true && verification.valid === true;
  const totalRecordedEvents = verification?.expectedCount ?? auditLogs.length;
  const strings = UI_STRINGS.screens.auditLogs;

  const getRowStatus = (log: AuditLogEntry): 'verified' | 'issue' | 'unverified' => {
    if (fullChainVerified) return 'verified';
    if (issueIds.has(log.id)) return 'issue';
    return 'unverified';
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(strings.hashCopiedTitle, strings.hashCopiedMessage, 'info');
    } catch (error: unknown) {
      logger.error('Clipboard access failed while copying an audit signature', { error }, 'AUDIT_VERIFICATION');
      showToast(strings.hashCopiedTitle, UI_STRINGS.screens.auditLogs.copyFailed, 'warning');
    }
  };

  const verificationMessage = verificationState === 'loading'
    ? strings.verificationLoading
    : verificationState === 'error'
      ? verificationError || strings.verificationUnavailable
      : verification?.valid === true && verification.complete
        ? formatString(strings.verificationVerified, { count: verification.expectedCount ?? verification.verifiedCount })
        : verification?.valid === false
          ? formatString(strings.verificationIssues, { count: verification.compromisedEntries.length })
          : formatString(strings.verificationIncomplete, {
            reason: verification?.reason || strings.verificationNotComplete,
          });

  const selectedStatus = selectedLogForDetail ? getRowStatus(selectedLogForDetail) : 'unverified';
  const selectedDetailMessage = selectedStatus === 'verified'
    ? strings.verifiedDetail
    : selectedStatus === 'issue'
      ? strings.issueDetail
      : strings.unverifiedDetail;

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <button
            onClick={onBackToInfra}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white mb-2 transition-colors font-medium"
          >
            <ArrowLeft size={14} /> {strings.backToInfrastructure}
          </button>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{strings.title}</h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">{strings.subtitle}</p>
        </div>

        <a
          href={buildAuditCsvDataUrl(filteredLogs)}
          download={strings.downloadFilename}
          className="btn btn-secondary btn-sm"
          aria-label={strings.exportCsv}
        >
          <Download size={14} /> {strings.exportCsv}
        </a>
      </div>

      <section
        className={`glass-panel p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs border bg-white dark:bg-gray-900/80 shadow-sm ${
          verification?.valid === false
            ? 'border-rose-300 dark:border-rose-900'
            : fullChainVerified
              ? 'border-emerald-200 dark:border-emerald-900'
              : 'border-slate-200 dark:border-slate-800'
        }`}
        aria-live="polite"
      >
        <div className="relative w-full sm:w-80">
          <input
            type="text"
            placeholder={strings.searchPlaceholder}
            aria-label={strings.searchPlaceholder}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-8 text-xs"
          />
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-gray-300 text-[11px] self-end sm:self-auto">
          <span>
            {strings.totalRecordedEvents}:{' '}
            <span className="mono font-bold text-slate-900 dark:text-white">{totalRecordedEvents}</span>
          </span>
          <span className={`font-semibold flex items-center gap-1 ${fullChainVerified ? 'text-emerald-700 dark:text-emerald-300' : verification?.valid === false ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {fullChainVerified ? <CheckCircle2 size={13} /> : verification?.valid === false ? <AlertTriangle size={13} /> : <CircleHelp size={13} />}
            {verificationMessage}
          </span>
          {verificationState !== 'loading' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setVerificationAttempt((attempt) => attempt + 1)}
            >
              {strings.verifyAgain}
            </button>
          )}
        </div>
      </section>

      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-gray-800 shadow-xl bg-white dark:bg-gray-900/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-900/90 text-slate-700 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800 text-[11px] uppercase tracking-wider">
                <th className="p-3.5 pl-4">{strings.timestamp}</th>
                <th className="p-3.5">{strings.userIdentity}</th>
                <th className="p-3.5">{strings.actionDescription}</th>
                <th className="p-3.5">{strings.shaSignature}</th>
                <th className="p-3.5 text-center pr-4">{strings.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/70 text-slate-700 dark:text-gray-300">
              {filteredLogs.map((log) => {
                const rowStatus = getRowStatus(log);
                const identity = identityLabel(log);
                const identityParts = identity.split(' ');
                return (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLogForDetail(log)}
                    className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="p-3.5 pl-4 mono text-slate-600 dark:text-gray-300 font-semibold text-[11px] whitespace-nowrap">
                      {log.timestamp}
                    </td>
                    <td className="p-3.5 font-medium text-slate-900 dark:text-white text-xs">
                      <span className="text-indigo-700 dark:text-indigo-300 font-bold">{identityParts[0]}</span>
                      <span className="text-slate-500 dark:text-gray-400 text-[11px] block">{identityParts.slice(1).join(' ')}</span>
                    </td>
                    <td className="p-3.5 text-xs text-slate-800 dark:text-gray-200">
                      <div className="font-semibold">{log.action}</div>
                      {log.rfqNumber && (
                        <span className="inline-block mt-0.5 mono text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-gray-800 text-indigo-700 dark:text-indigo-300 font-bold">
                          {log.rfqNumber}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 mono text-[11px] text-slate-500 dark:text-gray-400">
                      <div className="flex items-center gap-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                        <Hash size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span>{log.shaSignature.slice(0, 10)}...{log.shaSignature.slice(-6)}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-center pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${
                        rowStatus === 'verified'
                          ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                          : rowStatus === 'issue'
                            ? 'bg-rose-50 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}>
                        {rowStatus === 'verified' ? <CheckCircle2 size={11} /> : rowStatus === 'issue' ? <AlertTriangle size={11} /> : <CircleHelp size={11} />}
                        {rowStatus === 'verified' ? strings.statusVerified : rowStatus === 'issue' ? strings.statusIssue : strings.statusNotVerified}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                <tr>
                  <td className="p-8 text-center text-slate-500 dark:text-gray-400" colSpan={5}>{strings.noEvents}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedLogForDetail && (
        <div className="modal-overlay">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-indigo-500/40 rounded-2xl text-slate-900 dark:text-white space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-gray-800">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600 dark:text-indigo-400" /> {strings.detailsTitle}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLogForDetail(null)}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
                aria-label={strings.close}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase font-bold">{strings.eventAction}</span>
                <p className="font-bold text-slate-900 dark:text-white mt-0.5">{selectedLogForDetail.action}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase">{strings.recordedTime}</span>
                  <p className="mono text-slate-700 dark:text-gray-200">{selectedLogForDetail.timestamp}</p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase">{strings.originIp}</span>
                  <p className="mono text-slate-700 dark:text-gray-200">{selectedLogForDetail.ipAddress || strings.notAvailable}</p>
                </div>
              </div>

              <div>
                <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase font-bold">{strings.hashFingerprint}</span>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 mono text-indigo-700 dark:text-indigo-300 break-all select-all text-[11px] mt-1 flex items-center justify-between gap-2">
                  <span>{selectedLogForDetail.shaSignature}</span>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(selectedLogForDetail.shaSignature)}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-800 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    title={strings.copyHash}
                    aria-label={strings.copyHash}
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              <div className={`p-3 rounded-lg text-[11px] flex items-center gap-2 ${selectedStatus === 'verified' ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200' : selectedStatus === 'issue' ? 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200' : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200'}`}>
                {selectedStatus === 'verified' ? <CheckCircle2 size={16} /> : selectedStatus === 'issue' ? <AlertTriangle size={16} /> : <CircleHelp size={16} />}
                <span>{selectedDetailMessage}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setSelectedLogForDetail(null)} className="btn btn-secondary btn-sm">{strings.close}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
