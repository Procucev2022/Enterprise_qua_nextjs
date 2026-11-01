'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Globe,
  MessageSquare,
  Mail,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
} from 'lucide-react';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RegisteredClient } from '@/lib/types';

export interface RegistrationsDashboardProps {
  onTotalCountChange?: (count: number) => void;
}

export default function RegistrationsDashboard({ onTotalCountChange }: RegistrationsDashboardProps) {
  const strings = UI_STRINGS.actionCenter.registrationsDashboard;

  const [clients, setClients] = useState<RegisteredClient[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [search, setSearch] = useState<string>('');
  const [sourceType, setSourceType] = useState<string>('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);

  // Action loading states
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (sourceType !== 'all') params.append('sourceType', sourceType);
      params.append('limit', String(pageSize));
      params.append('offset', String((currentPage - 1) * pageSize));

      const res = await fetch(`/api/internal-tasks/registrations?${params.toString()}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setClients(json.data);
        setTotalCount(json.total ?? json.data.length);
        if (onTotalCountChange) onTotalCountChange(json.total ?? json.data.length);
      } else {
        setError(json.error || strings.noClientsFound);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : strings.actionError;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [search, sourceType, currentPage, pageSize, onTotalCountChange, strings.noClientsFound, strings.actionError]);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

  const handleAction = async (id: string, action: 'accept' | 'reject') => {
    setProcessingId(id);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/internal-tasks/registrations/${encodeURIComponent(id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.success) {
        setClients((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: action === 'accept' ? 'Accepted' : 'Rejected',
                  isApproved: action === 'accept',
                }
              : c
          )
        );
        setActionFeedback({
          message: action === 'accept' ? strings.acceptSuccess : strings.rejectSuccess,
          type: 'success',
        });
      } else {
        setActionFeedback({ message: json.error || strings.actionError, type: 'error' });
      }
    } catch {
      setActionFeedback({ message: strings.actionError, type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (isoString?: string): string => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return isoString;
    }
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / pageSize)), [totalCount, pageSize]);

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6 space-y-4">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight text-orange-600 dark:text-orange-500">
            {strings.title}
          </h2>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {formatString(strings.totalCountBadge, { count: String(totalCount) })}
          </span>
        </div>

        {/* Source Type Filter Dropdown */}
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="source-type-select" className="font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {strings.sourceTypeLabel}
          </label>
          <select
            id="source-type-select"
            value={sourceType}
            onChange={(e) => {
              setSourceType(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={strings.sourceTypeLabel}
            className="h-8.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer min-w-[120px]"
          >
            <option value="all">{strings.allSources}</option>
            <option value="Web App">{strings.webApp}</option>
            <option value="WhatsApp">{strings.whatsapp}</option>
            <option value="Email">{strings.email}</option>
          </select>
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
          }`}
        >
          <span>{actionFeedback.message}</span>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Search Bar Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder={strings.searchPlaceholder}
            aria-label={strings.searchPlaceholder}
            className="w-full pl-9 pr-3 h-9 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
      </div>

      {/* Data Table */}
      <div className="w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colUserName}</th>
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colCompanyName}</th>
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colPhoneNumber}</th>
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colUserEmail}</th>
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colRegDate}</th>
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colStatus}</th>
              <th className="py-3 px-3.5 whitespace-nowrap">{strings.colSourceType}</th>
              <th className="py-3 px-3.5 text-center whitespace-nowrap">{strings.colActions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                    <span>{strings.loadingClients}</span>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-rose-500 font-semibold">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-6 h-6" />
                    <span>{error}</span>
                  </div>
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 font-semibold">
                  {strings.noClientsFound}
                </td>
              </tr>
            ) : (
              clients.map((client, index) => {
                // Alternating peach and soft blue stripes matching reference image
                const isEven = index % 2 === 0;
                const rowBg = isEven
                  ? 'bg-[#fff5ee] dark:bg-slate-800/40' // Soft seashell/apricot tint
                  : 'bg-[#f0f7ff] dark:bg-slate-800/70'; // Soft sky blue tint

                const isNew = client.status === 'New' || client.status === 'Pending';
                const isAccepted = client.status === 'Accepted';

                return (
                  <tr
                    key={client.id}
                    className={`${rowBg} hover:opacity-90 transition-opacity text-slate-800 dark:text-slate-200`}
                  >
                    <td className="py-2.5 px-3.5 font-semibold text-slate-900 dark:text-white max-w-[150px] truncate" title={client.userName}>
                      {client.userName}
                    </td>
                    <td className="py-2.5 px-3.5 font-semibold text-slate-700 dark:text-slate-300 max-w-[180px] truncate" title={client.companyName}>
                      {client.companyName}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {client.phoneNumber}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-400 max-w-[180px] truncate" title={client.userEmail}>
                      {client.userEmail}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {formatDate(client.regDate)}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          isAccepted
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : isNew
                            ? 'text-slate-800 dark:text-slate-200'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {client.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-medium">
                        {client.sourceType === 'WhatsApp' ? (
                          <MessageSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : client.sourceType === 'Email' ? (
                          <Mail className="w-4 h-4 text-sky-500 shrink-0" />
                        ) : (
                          <Globe className="w-4 h-4 text-sky-600 shrink-0" />
                        )}
                        <span className="text-slate-700 dark:text-slate-300">{client.sourceType}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                      {isNew ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAction(client.id, 'accept')}
                            disabled={processingId === client.id}
                            title={strings.acceptTooltip}
                            aria-label={`${strings.acceptTooltip} for ${client.userName}`}
                            className="p-1 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors disabled:opacity-40 cursor-pointer"
                          >
                            <CheckCircle className="w-5 h-5 fill-emerald-600 text-white" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAction(client.id, 'reject')}
                            disabled={processingId === client.id}
                            title={strings.rejectTooltip}
                            aria-label={`${strings.rejectTooltip} for ${client.userName}`}
                            className="p-1 rounded-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-40 cursor-pointer"
                          >
                            <XCircle className="w-5 h-5 fill-rose-600 text-white" />
                          </button>
                        </div>
                      ) : isAccepted ? (
                        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40">
                          {strings.statusAccepted}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40">
                          {strings.statusRejected}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-center gap-3 pt-2 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage <= 1 || loading}
            aria-label="First page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronsLeft className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1 || loading}
            aria-label="Previous page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
          </button>

          <span className="px-3 py-1 font-semibold text-slate-700 dark:text-slate-300">
            {currentPage}
          </span>

          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages || loading}
            aria-label="Next page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage >= totalPages || loading}
            aria-label="Last page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronsRight className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        {/* Page Size Dropdown */}
        <div className="flex items-center gap-1.5 ml-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            aria-label="Select page size"
            className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer text-xs"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>
    </div>
  );
}

