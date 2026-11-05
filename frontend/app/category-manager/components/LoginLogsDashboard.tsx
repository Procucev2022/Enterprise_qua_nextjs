'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LogIn,
  Activity,
  Building2,
  Truck,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Download,
  Calendar,
  X,
  ExternalLink,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Globe,
  Laptop,
} from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import type {
  LoginLogEntry,
  LoginLogsSummary,
  LoginLogsFilterParams,
  LoginLogUserType,
  LoginLogStatus,
} from '@/lib/types';
import {
  fetchLoginLogs,
  fetchLoginLogsSummary,
  FALLBACK_SUMMARY,
} from '@/lib/loginLogsClient';

export default function LoginLogsDashboard() {
  const strings = UI_STRINGS.actionCenter.loginLogs;

  // Data states
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [summary, setSummary] = useState<LoginLogsSummary>(FALLBACK_SUMMARY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [realtimeActive, setRealtimeActive] = useState<boolean>(true);

  // Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedUserType, setSelectedUserType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [dateRangePreset, setDateRangePreset] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Pagination & modal states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedLogForDetails, setSelectedLogForDetails] = useState<LoginLogEntry | null>(null);
  const itemsPerPage = 10;

  // Load logs and metrics from client
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const [logsRes, summaryRes] = await Promise.all([
        fetchLoginLogs({
          userType: (selectedUserType !== 'all' ? selectedUserType : undefined) as LoginLogsFilterParams['userType'],
          status: (selectedStatus !== 'all' ? selectedStatus : undefined) as LoginLogsFilterParams['status'],
          search: searchQuery || undefined,
          dateRangePreset: dateRangePreset as LoginLogsFilterParams['dateRangePreset'],
          startDate: dateRangePreset === 'custom' ? customStartDate : undefined,
          endDate: dateRangePreset === 'custom' ? customEndDate : undefined,
          page: 1,
          limit: 100,
        }),
        fetchLoginLogsSummary(),
      ]);

      setLogs(logsRes.logs);
      setSummary(summaryRes);
    } catch {
      // Errors handled gracefully within client
    } finally {
      setIsLoading(false);
      if (showRefreshing) setIsRefreshing(false);
    }
  }, [selectedUserType, selectedStatus, searchQuery, dateRangePreset, customStartDate, customEndDate]);

  // Initial fetch and dependency refresh
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time polling effect (every 15 seconds when active)
  useEffect(() => {
    if (!realtimeActive) return;
    const interval = setInterval(() => {
      loadData(false);
    }, 15000);

    return () => clearInterval(interval);
  }, [realtimeActive, loadData]);

  // Client-side date filter computation
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // User Type filter
    if (selectedUserType !== 'all') {
      result = result.filter((item) => item.userType === selectedUserType);
    }

    // Status filter
    if (selectedStatus !== 'all') {
      result = result.filter((item) => item.status === selectedStatus);
    }

    // Search query across name, email, company, and phone
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.userName.toLowerCase().includes(q) ||
          item.email.toLowerCase().includes(q) ||
          item.companyName.toLowerCase().includes(q) ||
          item.phoneNumber.toLowerCase().includes(q)
      );
    }

    // Date range filters
    const now = new Date();
    if (dateRangePreset === 'today') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      result = result.filter((item) => new Date(item.loginAt).getTime() >= startOfToday);
    } else if (dateRangePreset === 'yesterday') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
      result = result.filter((item) => {
        const time = new Date(item.loginAt).getTime();
        return time >= startOfYesterday && time < startOfToday;
      });
    } else if (dateRangePreset === 'last7') {
      const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => new Date(item.loginAt).getTime() >= sevenDaysAgo);
    } else if (dateRangePreset === 'last30') {
      const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => new Date(item.loginAt).getTime() >= thirtyDaysAgo);
    } else if (dateRangePreset === 'custom') {
      if (customStartDate) {
        const start = new Date(customStartDate).getTime();
        result = result.filter((item) => new Date(item.loginAt).getTime() >= start);
      }
      if (customEndDate) {
        const end = new Date(customEndDate).getTime() + 24 * 60 * 60 * 1000;
        result = result.filter((item) => new Date(item.loginAt).getTime() <= end);
      }
    }

    return result;
  }, [logs, selectedUserType, selectedStatus, searchQuery, dateRangePreset, customStartDate, customEndDate]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(start, start + itemsPerPage);
  }, [filteredLogs, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // CSV Export utility
  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = [
      'ID',
      'User Name',
      'Role',
      'Company Name',
      'Email',
      'Phone Number',
      'Login Time',
      'Logout Time',
      'Duration (Seconds)',
      'Status',
      'IP Address',
      'Device Info',
      'Location',
    ];

    const rows = filteredLogs.map((log) => [
      `"${log.id}"`,
      `"${log.userName.replace(/"/g, '""')}"`,
      `"${log.userType}"`,
      `"${log.companyName.replace(/"/g, '""')}"`,
      `"${log.email}"`,
      `"${log.phoneNumber}"`,
      `"${log.loginAt}"`,
      `"${log.logoutAt || ''}"`,
      `"${log.durationSeconds || 0}"`,
      `"${log.status}"`,
      `"${log.ipAddress || ''}"`,
      `"${(log.deviceInfo || '').replace(/"/g, '""')}"`,
      `"${(log.location || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `login_logs_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '—';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={24} />
              {strings.title}
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                realtimeActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${realtimeActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              {strings.badgeLive}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{strings.subtitle}</p>
        </div>

        {/* Global Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Live tracking toggle */}
          <button
            type="button"
            onClick={() => setRealtimeActive(!realtimeActive)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              realtimeActive
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50'
            }`}
          >
            <Activity size={14} className={realtimeActive ? 'text-emerald-600 animate-pulse' : 'text-slate-400'} />
            <span>{realtimeActive ? strings.actions.realtimeActive : strings.actions.realtimePaused}</span>
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-indigo-600' : 'text-slate-500'} />
            <span>{strings.actions.refresh}</span>
          </button>

          {/* Export CSV button */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download size={14} className="text-slate-500" />
            <span>{strings.actions.exportCsv}</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Total Logins Today */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{strings.stats.totalLoginsToday}</span>
            <LogIn size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.totalToday}</span>
            {summary.todayPeakHour && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Peak: {summary.todayPeakHour}</span>
            )}
          </div>
        </div>

        {/* Active Online Now */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{strings.stats.activeOnlineNow}</span>
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{summary.activeNow}</span>
          </div>
        </div>

        {/* Buyer Logins */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{strings.stats.buyerLogins}</span>
            <Building2 size={16} className="text-sky-600 dark:text-sky-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.buyerLogins}</span>
          </div>
        </div>

        {/* Seller Logins */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{strings.stats.sellerLogins}</span>
            <Truck size={16} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.sellerLogins}</span>
          </div>
        </div>

        {/* Avg Duration */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{strings.stats.avgSessionDuration}</span>
            <Clock size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.avgDurationMinutes}m</span>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={strings.filters.searchPlaceholder}
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* User Type Role Pills */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setSelectedUserType('all');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                selectedUserType === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {strings.filters.allRoles}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedUserType('buyer');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                selectedUserType === 'buyer'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {strings.filters.buyersOnly}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedUserType('vendor');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                selectedUserType === 'vendor'
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-semibold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {strings.filters.sellersOnly}
            </button>
          </div>

          {/* Status Dropdown Filter */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400 hidden sm:block" />
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="py-1.5 px-3 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">{strings.filters.allStatuses}</option>
              <option value="ACTIVE">{strings.filters.activeOnly}</option>
              <option value="LOGGED_OUT">{strings.filters.loggedOut}</option>
              <option value="TIMED_OUT">{strings.filters.timedOut}</option>
            </select>
          </div>
        </div>

        {/* Date Wise Filter Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 mr-2">
            <Calendar size={14} className="text-indigo-600 dark:text-indigo-400" />
            <span>Date Range:</span>
          </div>

          {[
            { id: 'all', label: strings.filters.dateRangeAll },
            { id: 'today', label: strings.filters.dateRangeToday },
            { id: 'yesterday', label: strings.filters.dateRangeYesterday },
            { id: 'last7', label: strings.filters.dateRangeLast7Days },
            { id: 'last30', label: strings.filters.dateRangeLast30Days },
            { id: 'custom', label: strings.filters.dateRangeCustom },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setDateRangePreset(preset.id);
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 text-xs rounded-md border transition-all cursor-pointer ${
                dateRangePreset === preset.id
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 font-semibold'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          ))}

          {/* Custom Date Inputs */}
          {dateRangePreset === 'custom' && (
            <div className="flex items-center gap-2 ml-auto">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setCustomStartDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200"
                aria-label={strings.filters.startDate}
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => {
                  setCustomEndDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200"
                aria-label={strings.filters.endDate}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-3 px-4">{strings.table.colUser}</th>
                <th className="py-3 px-4">{strings.table.colCompany}</th>
                <th className="py-3 px-4">{strings.table.colContact}</th>
                <th className="py-3 px-4">{strings.table.colLoginTime}</th>
                <th className="py-3 px-4">{strings.table.colLogoutTime}</th>
                <th className="py-3 px-4">{strings.table.colTelemetry}</th>
                <th className="py-3 px-4">{strings.table.colStatus}</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                    Loading session logs...
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <ShieldCheck className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    {strings.table.emptyState}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => {
                  const isBuyer = log.userType === 'buyer';
                  const isActive = log.status === 'ACTIVE';

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLogForDetails(log)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    >
                      {/* User & Role */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{log.userName}</div>
                        <span
                          className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            isBuyer
                              ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800/50'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50'
                          }`}
                        >
                          {isBuyer ? 'Buyer' : 'Seller / Vendor'}
                        </span>
                      </td>

                      {/* Company Name */}
                      <td className="py-3 px-4 text-slate-800 dark:text-slate-200 font-medium">
                        {log.companyName}
                      </td>

                      {/* Contact Info (Email & Phone) */}
                      <td className="py-3 px-4 space-y-0.5">
                        <div className="text-slate-900 dark:text-slate-100 font-mono text-[11px]">{log.email}</div>
                        <div className="text-slate-500 dark:text-slate-400 text-[11px] font-mono">{log.phoneNumber}</div>
                      </td>

                      {/* Login Time */}
                      <td className="py-3 px-4">
                        <div className="text-slate-900 dark:text-slate-100 font-medium">{formatDateTime(log.loginAt)}</div>
                      </td>

                      {/* Logout Time / Duration */}
                      <td className="py-3 px-4">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {strings.table.inProgress}
                          </span>
                        ) : (
                          <div>
                            <div className="text-slate-800 dark:text-slate-200">{formatDateTime(log.logoutAt)}</div>
                            <div className="text-slate-400 dark:text-slate-500 text-[10px]">
                              Duration: {formatDuration(log.durationSeconds)}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* IP & Device Telemetry */}
                      <td className="py-3 px-4 space-y-0.5">
                        <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                          <Globe size={11} className="text-slate-400" />
                          <span>{log.ipAddress || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-[10px]">
                          <Laptop size={11} className="text-slate-400" />
                          <span className="truncate max-w-[140px]">{log.deviceInfo || 'Desktop'}</span>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                              : log.status === 'TIMED_OUT'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {isActive
                            ? strings.filters.activeOnly
                            : log.status === 'TIMED_OUT'
                            ? strings.filters.timedOut
                            : strings.filters.loggedOut}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLogForDetails(log);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 transition-colors"
                        >
                          <ExternalLink size={12} />
                          <span>{strings.actions.viewDetails}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <div>
            Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{paginatedLogs.length}</span> of{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">{filteredLogs.length}</span> records
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 cursor-pointer"
              aria-label="Previous Page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 cursor-pointer"
              aria-label="Next Page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Session Details Modal */}
      {selectedLogForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setSelectedLogForDetails(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={strings.actions.closeDetails}
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={22} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{strings.details.title}</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                  {selectedLogForDetails.userName}
                </div>
                <div className="text-slate-600 dark:text-slate-300">{selectedLogForDetails.companyName}</div>
                <div className="font-mono text-indigo-600 dark:text-indigo-400 text-[11px]">
                  {selectedLogForDetails.email} • {selectedLogForDetails.phoneNumber}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.userRole}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 capitalize">
                    {selectedLogForDetails.userType === 'buyer' ? 'Buyer Account' : 'Seller / Vendor'}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.table.colStatus}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedLogForDetails.status}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.loginTimestamp}</div>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatDateTime(selectedLogForDetails.loginAt)}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.logoutTimestamp}</div>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatDateTime(selectedLogForDetails.logoutAt)}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.networkIp}</div>
                  <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedLogForDetails.ipAddress || '127.0.0.1'}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.geoCity}</div>
                  <div className="text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedLogForDetails.location || 'India (National)'}
                  </div>
                </div>
              </div>

              {selectedLogForDetails.userAgent && (
                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.clientUserAgent}</div>
                  <div className="font-mono text-[10px] text-slate-600 dark:text-slate-400 break-all mt-1">
                    {selectedLogForDetails.userAgent}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLogForDetails(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-opacity cursor-pointer"
              >
                {strings.actions.closeDetails}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
