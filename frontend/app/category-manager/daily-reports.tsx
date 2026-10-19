'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Activity,
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

export default function DailyDownloadableReports({ initialCategory = 'seller' }: DailyReportsProps) {
  const [activeCategory, setActiveCategory] = useState<ReportCategoryKey>(initialCategory);
  const initialReport = REPORT_OPTIONS.find((r) => r.category === initialCategory);
  const [selectedReportId, setSelectedReportId] = useState<string>(initialReport ? initialReport.id : 'seller_detailed');
  
  // Date range state
  const [datePreset, setDatePreset] = useState<'today' | '7days' | '30days' | 'thisMonth' | 'custom'>('30days');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Data fetching state
  const [loading, setLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<any[]>([]);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Table pagination and search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Set default dates on preset change
  useEffect(() => {
    const now = new Date();
    const toDateStr = now.toISOString().split('T')[0];

    if (datePreset === 'today') {
      setStartDate(toDateStr);
      setEndDate(toDateStr);
    } else if (datePreset === '7days') {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(toDateStr);
    } else if (datePreset === '30days') {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(toDateStr);
    } else if (datePreset === 'thisMonth') {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(firstOfMonth.toISOString().split('T')[0]);
      setEndDate(toDateStr);
    }
  }, [datePreset]);

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
  const handleGenerateReport = async () => {
    setLoading(true);
    setStatusMessage(null);
    setCurrentPage(1);

    const result = await fetchReportData(currentReport, startDate, endDate);

    if (result.success) {
      if (currentReport.category === 'daily_activity' && result.summary) {
        setSummaryData(result.summary);
        setReportData([]);
      } else {
        setReportData(result.data || []);
        setSummaryData(null);
      }
      setStatusMessage({
        type: 'success',
        text: `Report loaded successfully (${result.totalRecords ?? (result.data ? result.data.length : 'Summary ready')} records).`,
      });
    } else {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Failed to generate report.',
      });
      setReportData([]);
      setSummaryData(null);
    }
    setLoading(false);
  };

  // Run initial fetch on mount
  useEffect(() => {
    handleGenerateReport();
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
    if (reportData.length === 0 && !summaryData) return;
    const rowsToExport = summaryData
      ? [summaryData]
      : reportData;
    const fileName = `${currentReport.defaultFileName}_${startDate || 'all'}_to_${endDate || 'all'}`;
    exportReportToExcel(rowsToExport, fileName, currentReport.label);
  };

  const handleExportCsv = () => {
    if (reportData.length === 0 && !summaryData) return;
    const rowsToExport = summaryData
      ? [summaryData]
      : reportData;
    const fileName = `${currentReport.defaultFileName}_${startDate || 'all'}_to_${endDate || 'all'}`;
    exportReportToCsv(rowsToExport, fileName);
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
            disabled={loading || (reportData.length === 0 && !summaryData)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>Excel (.xlsx)</span>
          </button>
          <button
            onClick={handleExportCsv}
            disabled={loading || (reportData.length === 0 && !summaryData)}
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
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
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
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
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
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
            activeCategory === 'buyer'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Buyer Reports</span>
        </button>

        <button
          onClick={() => setActiveCategory('daily_activity')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
            activeCategory === 'daily_activity'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Daily Operations Overview</span>
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
              onChange={(e) => setSelectedReportId(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Date Filter Preset
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['today', '7days', '30days', 'thisMonth'] as const).map((preset) => (
                <button
                  key={preset}
                  onClick={() => setDatePreset(preset)}
                  className={`px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
                    datePreset === preset
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {preset === 'today' && 'Today'}
                  {preset === '7days' && '7 Days'}
                  {preset === '30days' && '30 Days'}
                  {preset === 'thisMonth' && 'Month'}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date Pickers */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setDatePreset('custom');
                  setStartDate(e.target.value);
                }}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setDatePreset('custom');
                  setEndDate(e.target.value);
                }}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Generate Button & Status Alert */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateReport}
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

      {/* Daily Activity Summary Cards (when daily_activity selected) */}
      {currentReport.category === 'daily_activity' && summaryData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">RFQs Dispatched</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {summaryData.rfqsCreated ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Quotes Received</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {summaryData.quotesReceived ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">New Buyers Onboarded</p>
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
              {summaryData.newBuyersRegistered ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">New Vendors Registered</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
              {summaryData.newVendorsRegistered ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Audit Trail Events</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {summaryData.totalAuditEvents ?? 0}
            </p>
          </div>
        </div>
      )}

      {/* Report Data Table Preview */}
      {currentReport.category !== 'daily_activity' && (
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
                        return (
                          <td key={header} className="px-3.5 py-2.5 whitespace-nowrap text-xs">
                            {isMode ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {val || 'Mode 0'}
                              </span>
                            ) : (
                              String(val ?? '')
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
      )}
    </div>
  );
}
