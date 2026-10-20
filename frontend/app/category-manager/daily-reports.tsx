'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Layers,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  FileCheck,
  Building2,
  Truck,
} from 'lucide-react';
import {
  REPORT_OPTIONS,
  ReportCategoryKey,
  ReportConfig,
  fetchReportData,
  exportReportToExcel,
  exportReportToCsv,
} from '@/lib/reportsClient';
import { RFQ_MODES, RFQ_MODE_LABELS } from '@/lib/constants';

interface DailyReportsProps {
  initialCategory?: ReportCategoryKey;
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DailyDownloadableReports({ initialCategory = 'seller' }: DailyReportsProps) {
  const [activeCategory, setActiveCategory] = useState<ReportCategoryKey>(initialCategory);
  const initialReport = REPORT_OPTIONS.find((r) => r.category === initialCategory);
  const [selectedReportId, setSelectedReportId] = useState<string>(initialReport ? initialReport.id : 'seller_detailed');
  
  // Date range state (default: no dates selected)
  const [datePreset, setDatePreset] = useState<'today' | '7days' | '30days' | 'thisMonth' | 'custom' | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Request sequence counter to guard against race conditions from rapid filter changes
  const requestSeqRef = useRef<number>(0);

  // Data fetching state
  const [loading, setLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<any[]>([]);
  const [appliedMetadata, setAppliedMetadata] = useState<{
    reportConfig: ReportConfig;
    startDate: string;
    endDate: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Table pagination and search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Keep selected report aligned when active category changes
  const categoryReports = useMemo(() => {
    return REPORT_OPTIONS.filter((r) => r.category === activeCategory);
  }, [activeCategory]);

  useEffect(() => {
    if (categoryReports.length > 0 && !categoryReports.some((r) => r.id === selectedReportId)) {
      setSelectedReportId(categoryReports[0].id);
    }
  }, [categoryReports, selectedReportId]);

  const currentReport = useMemo(() => {
    return REPORT_OPTIONS.find((r) => r.id === selectedReportId) || REPORT_OPTIONS[0];
  }, [selectedReportId]);

  // Fetch report data
  const handleGenerateReport = async (overrideStart?: string, overrideEnd?: string) => {
    const currentSeq = ++requestSeqRef.current;
    setLoading(true);
    setStatusMessage(null);
    setCurrentPage(1);

    const sDate = overrideStart !== undefined ? overrideStart : startDate;
    const eDate = overrideEnd !== undefined ? overrideEnd : endDate;
    const requestedConfig = currentReport;

    const result = await fetchReportData(requestedConfig, sDate, eDate);

    // Discard response if another request was triggered subsequently
    if (currentSeq !== requestSeqRef.current) {
      return;
    }

    if (result.success) {
      const sanitizedRows = (result.data || []).map((row: any) => {
        const enriched = { ...row };
        if ('CompanyLocation' in enriched && !enriched.CompanyLocation) {
          enriched.CompanyLocation = enriched.SellerLocation || enriched.DeliveryLocation || 'All India';
        }
        if ('LastLogin' in enriched && !enriched.LastLogin) {
          enriched.LastLogin = enriched.LoginDateTime || enriched.LastLoginDate || '';
        }
        return enriched;
      });
      setReportData(sanitizedRows);
      setAppliedMetadata({
        reportConfig: requestedConfig,
        startDate: sDate,
        endDate: eDate,
      });
      setStatusMessage({
        type: 'success',
        text: `Report loaded successfully (${result.totalRecords ?? (result.data ? result.data.length : 0)} records).`,
      });
    } else {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Failed to generate report.',
      });
      setReportData([]);
    }
    setLoading(false);
  };

  // Preset selection handler
  const handleSelectPreset = (preset: 'today' | '7days' | '30days' | 'thisMonth') => {
    const now = new Date();
    const toDateStr = formatLocalDate(now);
    let fromDateStr = '';

    if (preset === 'today') {
      fromDateStr = toDateStr;
    } else if (preset === '7days') {
      const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      fromDateStr = formatLocalDate(past);
    } else if (preset === '30days') {
      const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      fromDateStr = formatLocalDate(past);
    } else if (preset === 'thisMonth') {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      fromDateStr = formatLocalDate(firstOfMonth);
    }

    setDatePreset(preset);
    setStartDate(fromDateStr);
    setEndDate(toDateStr);
    handleGenerateReport(fromDateStr, toDateStr);
  };

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    setDatePreset('custom');
    handleGenerateReport(val, endDate);
  };

  const handleEndDateChange = (val: string) => {
    setEndDate(val);
    setDatePreset('custom');
    handleGenerateReport(startDate, val);
  };

  const handleClearDates = () => {
    setDatePreset(null);
    setStartDate('');
    setEndDate('');
    handleGenerateReport('', '');
  };

  // Run initial fetch on mount and whenever selected report changes
  useEffect(() => {
    handleGenerateReport(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReportId]);

  // Filtered rows based on search
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return reportData;
    const q = searchQuery.toLowerCase();
    return reportData.filter((row) =>
      Object.values(row).some((val) => String(val || '').toLowerCase().includes(q))
    );
  }, [reportData, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  // Dynamic table headers from data keys
  const tableHeaders = useMemo(() => {
    if (reportData.length === 0) return [];
    return Object.keys(reportData[0]);
  }, [reportData]);

  // Export handlers
  const handleExportExcel = () => {
    if (reportData.length === 0) return;
    const exportConfig = appliedMetadata?.reportConfig || currentReport;
    const exportStart = appliedMetadata ? appliedMetadata.startDate : startDate;
    const exportEnd = appliedMetadata ? appliedMetadata.endDate : endDate;
    const dateSuffix = !exportStart && !exportEnd ? 'All_Time' : `${exportStart || 'all'}_to_${exportEnd || 'all'}`;
    const fileName = `${exportConfig.defaultFileName}_${dateSuffix}`;
    exportReportToExcel(reportData, fileName, exportConfig.label);
  };

  const handleExportCsv = () => {
    if (reportData.length === 0) return;
    const exportConfig = appliedMetadata?.reportConfig || currentReport;
    const exportStart = appliedMetadata ? appliedMetadata.startDate : startDate;
    const exportEnd = appliedMetadata ? appliedMetadata.endDate : endDate;
    const dateSuffix = !exportStart && !exportEnd ? 'All_Time' : `${exportStart || 'all'}_to_${exportEnd || 'all'}`;
    const fileName = `${exportConfig.defaultFileName}_${dateSuffix}`;
    exportReportToCsv(reportData, fileName);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600/10 dark:bg-indigo-500/20 rounded-lg text-indigo-600 dark:text-indigo-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                Daily Downloadable Reports
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Operational auditing, daily activity, seller interactions, and RFQ dispatch reports for Category Managers.
              </p>
            </div>
          </div>
        </div>

        {/* Global Export Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportExcel}
            disabled={loading || reportData.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>Excel (.xlsx)</span>
          </button>
          <button
            onClick={handleExportCsv}
            disabled={loading || reportData.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs sm:text-sm font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>CSV (.csv)</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveCategory('seller')}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
            activeCategory === 'seller'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Seller Reports</span>
        </button>

        <button
          onClick={() => setActiveCategory('rfq')}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
            activeCategory === 'rfq'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          <span>RFQ Reports</span>
        </button>

        <button
          onClick={() => setActiveCategory('buyer')}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
            activeCategory === 'buyer'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Buyer Reports</span>
        </button>
      </div>

      {/* Filter and Configuration Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Sub-report selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Select Specific Report
            </label>
            <select
              value={selectedReportId}
              disabled={loading}
              onChange={(e) => setSelectedReportId(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {categoryReports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {currentReport.description}
            </p>
          </div>

          {/* Quick Date Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Date Filter Preset
              </label>
              {(startDate || endDate || datePreset) && (
                <button
                  type="button"
                  onClick={handleClearDates}
                  disabled={loading}
                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear dates
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { key: 'today', label: 'Today' },
                  { key: '7days', label: '7 Days' },
                  { key: '30days', label: '30 Days' },
                  { key: 'thisMonth', label: 'Month' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectPreset(key)}
                  disabled={loading}
                  className={`px-2 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    datePreset === key
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {datePreset === 'today' && 'Filtering records for today'}
              {datePreset === '7days' && 'Filtering records for last 7 days'}
              {datePreset === '30days' && 'Filtering records for last 30 days'}
              {datePreset === 'thisMonth' && 'Filtering records for this calendar month'}
              {datePreset === 'custom' && 'Custom manual date range active'}
              {!datePreset && 'No dates selected by default'}
            </p>
          </div>

          {/* Custom Date Pickers */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                aria-label="Start Date"
                value={startDate}
                disabled={loading}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                End Date
              </label>
              <input
                type="date"
                aria-label="End Date"
                value={endDate}
                disabled={loading}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Generate Button & Status Alert */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleGenerateReport()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs sm:text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Generating Report...' : 'Refresh / Query Report'}</span>
            </button>
          </div>

          {statusMessage && (
            <div
              className={`flex items-center gap-1.5 text-xs font-medium ${
                statusMessage.type === 'success'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Report Data Table Preview */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
          {/* Table Toolbar */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search report columns..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 w-full sm:w-auto justify-between sm:justify-end">
              <span>
                Showing {filteredData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-
                {Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} records
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs"
              >
                <option value={10}>10 per page</option>
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto min-h-[300px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
                <p className="text-xs sm:text-sm">Fetching and preparing report dataset...</p>
              </div>
            ) : paginatedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <Filter className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-2" />
                <p className="text-xs sm:text-sm font-medium">No records found for the selected date range or query.</p>
                <p className="text-xs text-slate-400 mt-1">Try expanding the date range or clearing the search filter.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    {tableHeaders.map((header) => (
                      <th key={header} className="px-3.5 py-3 font-semibold whitespace-nowrap">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {paginatedRows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {tableHeaders.map((header) => {
                        const val = row[header];
                        const isMode = header === 'SourcingMode';
                        const isLoc = header === 'CompanyLocation';
                        const isLogin = header === 'LastLogin';
                        const displayVal =
                          isLoc && !val
                            ? (row.SellerLocation || row.DeliveryLocation || 'All India')
                            : isLogin
                            ? (val || row.LoginDateTime || row.LastLoginDate || 'Never')
                            : val;
                        return (
                          <td key={header} className="px-3.5 py-2.5 whitespace-nowrap text-xs">
                            {isMode ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {displayVal || 'Mode 0'}
                              </span>
                            ) : (
                              String(displayVal ?? '')
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Table Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>

              <span>
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
    </div>
  );
}
