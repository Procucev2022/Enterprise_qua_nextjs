'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  FileCheck,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';
import {
  fetchApprovalSummary,
  fetchApprovals,
  processApprovalAction,
} from '@/lib/approvalClient';
import type { ApprovalRequest, ApprovalSummary } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

const APPROVAL_MODULES = [
  'All Modules',
  'Credit Notes',
  'Account Approvals',
  'Discounts',
  'Trial Periods',
  'Offline Payments',
  'Unit Bookings',
  'Cancellations & Refunds',
  'Packages',
  'Milestones',
];

export default function ApprovalsDashboard() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [summary, setSummary] = useState<ApprovalSummary>({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeModule, setActiveModule] = useState<string>('All Modules');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Action Modal State
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [actionRemarks, setActionRemarks] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const s = await fetchApprovalSummary();
      setSummary(s);
    } catch {
      // safe fallback
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedRequest(null);
    setPendingAction(null);
  }, []);

  const loadApprovals = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetchApprovals({
        module: activeModule === 'All Modules' ? 'all' : activeModule,
        status: statusFilter,
        project: projectFilter,
        search,
      });
      setApprovals(res.data);
      setTotal(res.total);
    } catch {
      showToast('Failed to load approval requests.');
    } finally {
      setIsLoading(false);
    }
  }, [activeModule, statusFilter, projectFilter, search, showToast]);

  useEffect(() => {
    void loadSummary();
    void loadApprovals();
  }, [loadSummary, loadApprovals]);

  const handleActionConfirm = async () => {
    if (!selectedRequest || !pendingAction) return;

    setIsProcessing(true);
    const res = await processApprovalAction(selectedRequest.id, pendingAction, actionRemarks);
    setIsProcessing(false);

    if (res.success) {
      showToast(`Request ${selectedRequest.request_number} ${pendingAction === 'APPROVE' ? 'Approved' : 'Rejected'}.`);
      setSelectedRequest(null);
      setPendingAction(null);
      setActionRemarks('');
      void loadSummary();
      void loadApprovals();
    } else {
      showToast(res.error || 'Failed to process approval.');
    }
  };

  const strings = UI_STRINGS.actionCenter.approvals;

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-xl border border-slate-700 animate-slide-up flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 text-xs font-semibold">
            <span>{strings.pending}</span>
            <Clock size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900 dark:text-amber-100">{summary.pending}</div>
          <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-1">{strings.pendingSubtitle}</div>
        </div>

        <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <span>{strings.approved}</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-900 dark:text-emerald-100">{summary.approved}</div>
          <div className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-1">{strings.approvedSubtitle}</div>
        </div>

        <div className="bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-rose-700 dark:text-rose-300 text-xs font-semibold">
            <span>{strings.rejected}</span>
            <XCircle size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-rose-900 dark:text-rose-100">{summary.rejected}</div>
          <div className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1">{strings.rejectedSubtitle}</div>
        </div>

        <div className="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-sky-700 dark:text-sky-300 text-xs font-semibold">
            <span>{strings.total}</span>
            <ShieldAlert size={16} />
          </div>
          <div className="mt-2 text-2xl font-black text-sky-900 dark:text-sky-100">{summary.total}</div>
          <div className="text-[11px] text-sky-600/80 dark:text-sky-400/80 mt-1">{strings.totalSubtitle}</div>
        </div>
      </div>

      {/* Module Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar border-b border-slate-200 dark:border-slate-800 text-xs">
        {APPROVAL_MODULES.map((mod) => (
          <button
            key={mod}
            type="button"
            onClick={() => setActiveModule(mod)}
            className={`px-3 py-2 font-semibold whitespace-nowrap rounded-lg border-b-2 transition-all ${
              activeModule === mod
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            {mod}
          </button>
        ))}
      </div>

      {/* Control Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs text-xs">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="p-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
          >
            <option value="all">All Projects</option>
            <option value="Tata">Tata Steel</option>
            <option value="JSW">JSW Steel</option>
            <option value="Larsen">L&T Heavy Eng</option>
            <option value="BHEL">BHEL</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
          >
            <option value="all">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by request ID, applicant, maker..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadSummary();
              void loadApprovals();
            }}
            className="p-1.5 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Approvals Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-3.5">Request ID / Time</th>
                <th className="py-3 px-3.5">Module</th>
                <th className="py-3 px-3.5">Unit / Project</th>
                <th className="py-3 px-3.5">Applicant / Customer</th>
                <th className="py-3 px-3.5">Value / Impact</th>
                <th className="py-3 px-3.5">Maker (Requester)</th>
                <th className="py-3 px-3.5">Status</th>
                <th className="py-3 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Loading approval requests...</span>
                  </td>
                </tr>
              ) : approvals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileCheck className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">{strings.noApprovalsFound}</p>
                  </td>
                </tr>
              ) : (
                approvals.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 block">
                        {req.request_number}
                      </span>
                      <span className="text-[10px] text-slate-400">{new Date(req.created_at).toLocaleString()}</span>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                      {req.module}
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap text-slate-800 dark:text-slate-200">
                      {req.project}
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-900 dark:text-white">{req.applicant_name}</div>
                      <div className="text-[10px] text-slate-400">{req.applicant_email}</div>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap font-semibold text-slate-900 dark:text-white">
                      {req.value_impact}
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{req.maker_name}</div>
                      <div className="text-[10px] text-slate-400">{req.maker_role}</div>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          req.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : req.status === 'Rejected'
                            ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>

                    <td className="py-3 px-3.5 whitespace-nowrap text-right">
                      {req.status === 'Pending' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRequest(req);
                              setPendingAction('APPROVE');
                            }}
                            className="px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1"
                          >
                            <Check size={12} />
                            <span>{strings.approveBtn}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRequest(req);
                              setPendingAction('REJECT');
                            }}
                            className="px-2.5 py-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1"
                          >
                            <X size={12} />
                            <span>{strings.rejectBtn}</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">Decided</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Confirmation Modal */}
      {selectedRequest && pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Confirm {pendingAction === 'APPROVE' ? 'Approval' : 'Rejection'}
              </h3>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Close Modal"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Are you sure you want to mark request <span className="font-mono font-bold text-indigo-600">{selectedRequest.request_number}</span> ({selectedRequest.value_impact}) as <span className="font-bold">{pendingAction === 'APPROVE' ? 'Approved' : 'Rejected'}</span>?
            </p>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold text-xs mb-1">
                Executive Remarks (Optional)
              </label>
              <textarea
                rows={2}
                value={actionRemarks}
                onChange={(e) => setActionRemarks(e.target.value)}
                placeholder="Add audit justification or notes..."
                className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleActionConfirm}
                className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg shadow-xs ${
                  pendingAction === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isProcessing ? 'Processing...' : `Confirm ${pendingAction === 'APPROVE' ? 'Approval' : 'Rejection'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { ApprovalsDashboard };
