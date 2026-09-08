'use client';

// ==============================================================================
// CATEGORY MANAGER — INVITE VENDORS TO AN RFQ
// ==============================================================================
// Category match alone no longer grants a vendor visibility into an RFQ (see
// storeService.vendorCoversRFQ) — it only produces the candidate pool this
// modal fetches and lets the category manager pick from. Modal shell mirrors
// VendorUploadModal.tsx; the checkbox styling mirrors buyer-profile.tsx's
// category-chip pattern.
// ==============================================================================

import React, { useEffect, useState } from 'react';
import { X, Send, CheckCircle2, Loader2, AlertTriangle, Users } from 'lucide-react';
import { useApp } from '@/lib/store';
import { fetchVendorCandidates, inviteVendorsToRFQ } from '@/lib/rfqClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

interface InviteVendorsModalProps {
  isOpen: boolean;
  rfq: RFQItem | null;
  onClose: () => void;
  onInvited?: (updatedRfq: RFQItem, invitedCount: number) => void;
}

const S = UI_STRINGS.inviteVendors;

export default function InviteVendorsModal({ isOpen, rfq, onClose, onInvited }: InviteVendorsModalProps) {
  const { showToast } = useApp();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RFQVendorCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !rfq) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    void fetchVendorCandidates(rfq.id).then((result) => {
      if (result.success) {
        setCandidates(result.candidates);
      } else {
        setError(result.error || S.loadFailed);
      }
      setLoading(false);
    });
  }, [isOpen, rfq]);

  if (!isOpen || !rfq) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invitable = candidates.filter((c) => !c.alreadyInvited);
  const selectableIds = invitable.map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    const result = await inviteVendorsToRFQ(rfq.id, Array.from(selected));
    setSubmitting(false);
    if (result.success) {
      showToast(S.successTitle, formatString(S.successMessage, { count: result.invitedCount, rfqNumber: rfq.rfqNumber }), 'success');
      onInvited?.(result.rfq, result.invitedCount);
      onClose();
    } else {
      showToast(S.failTitle, result.error, 'warning');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-vendors-modal-title"
      data-testid="invite-vendors-modal"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-gray-800">
          <div>
            <h2 id="invite-vendors-modal-title" className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users size={16} className="text-indigo-600 dark:text-indigo-400" /> {S.title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
              {formatString(S.subtitle, { rfqNumber: rfq.rfqNumber })}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label={S.closeAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {loading && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-8 text-center flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {S.loading}
            </p>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertTriangle size={22} className="text-rose-500" />
              <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            </div>
          )}

          {!loading && !error && candidates.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-gray-450 py-8 text-center">{S.noCandidates}</p>
          )}

          {!loading && !error && candidates.length > 0 && (
            <>
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-450">
                  {formatString(S.candidateCount, { count: candidates.length })}
                </span>
                {selectableIds.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {allSelected ? S.deselectAll : S.selectAll}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                      c.alreadyInvited
                        ? 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-700/50 opacity-60 cursor-default'
                        : selected.has(c.id)
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700'
                        : 'bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-800 hover:border-indigo-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={c.alreadyInvited || selected.has(c.id)}
                      disabled={c.alreadyInvited}
                      onChange={() => toggle(c.id)}
                    />
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        c.alreadyInvited || selected.has(c.id)
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'border-slate-300 dark:border-gray-600'
                      }`}
                    >
                      {(c.alreadyInvited || selected.has(c.id)) && <CheckCircle2 size={12} />}
                    </span>
                    <span className="flex-1">
                      <span className="font-bold text-slate-800 dark:text-gray-200 block">{c.name}</span>
                      <span className="text-slate-500 dark:text-gray-450">{c.majorCategory}</span>
                    </span>
                    {c.alreadyInvited && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                        {S.alreadyInvitedBadge}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn btn-secondary text-xs px-4 py-2 font-bold"
          >
            {S.cancelAction}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || selected.size === 0}
            className="btn btn-primary text-xs px-4 py-2 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {formatString(S.inviteAction, { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
