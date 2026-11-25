'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Calendar,
  X,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Users,
  FileText,
  Clock,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  fetchDashboardMetrics,
  fetchDashboardRecords,
} from '@/lib/categoryManagerDashboardClient';
import type {
  CategoryManagerDashboardKPI,
  CategoryManagerDashboardCharts,
  CategoryManagerDashboardRecordType,
  CategoryManagerDashboardPopupRecord,
} from '@/lib/types';

type PresetType = 'today' | 'this_week' | 'this_month' | 'custom' | 'all';

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

export default function DashboardView() {
  const strings = UI_STRINGS.categoryManagerDashboard;

  // Filter state
  const [preset, setPreset] = useState<PresetType>('this_month');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Native input refs for full-box click triggering
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  // Data state
  const [kpi, setKpi] = useState<CategoryManagerDashboardKPI>({
    totalRfqs: 0,
    openRfqs: 0,
    rfqsWithoutQuotes: 0,
    buyerSubscriptions: 0,
    vendorSubscriptions: 0,
    totalBuyers: 0,
    totalVendors: 0,
    buyerRegistration: 0,
    vendorRegistration: 0,
    totalLogins: 0,
  });

  const [charts, setCharts] = useState<CategoryManagerDashboardCharts>({
    months: [],
    totalRfqsAndSubs: [],
    newRegistrations: [],
    activityRfqsVsQuotes: [],
  });

  const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Modal drilldown state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [activeMetricType, setActiveMetricType] = useState<CategoryManagerDashboardRecordType | null>(null);
  const [modalRecords, setModalRecords] = useState<CategoryManagerDashboardPopupRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState<boolean>(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [modalSearch, setModalSearch] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'createdAt', direction: 'desc' });

  // Fallback dynamic last 6 months in case charts.months has not loaded yet
  const fallbackMonths = useMemo(() => {
    const allMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(allMonths[d.getMonth()]);
    }
    return months;
  }, []);

  const displayMonths = charts.months && charts.months.length > 0 ? charts.months : fallbackMonths;

  // Fetch KPI & Charts metrics from backend
  const fetchMetrics = useCallback(async () => {
    setIsLoadingMetrics(true);
    setMetricsError(null);
    try {
      const res = await fetchDashboardMetrics({
        preset: preset !== 'custom' && preset !== 'all' ? preset : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      if (res.success && res.kpi && res.charts) {
        setKpi(res.kpi);
        setCharts(res.charts);
      } else {
        const errText = res.error || strings.errors.metricsLoadFailed;
        console.error('[DashboardView] Metrics fetch error:', res.status, errText);
        setMetricsError(errText);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DashboardView] Metrics network exception:', msg);
      setMetricsError(msg);
    } finally {
      setIsLoadingMetrics(false);
    }
  }, [preset, startDate, endDate, strings.errors.metricsLoadFailed]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Fetch popup records on KPI card click
  const handleCardClick = async (type: CategoryManagerDashboardRecordType) => {
    setActiveMetricType(type);
    setIsModalOpen(true);
    setIsLoadingRecords(true);
    setRecordsError(null);
    setModalSearch('');

    try {
      const res = await fetchDashboardRecords({
        type,
        preset: preset !== 'custom' && preset !== 'all' ? preset : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      if (res.success && Array.isArray(res.records)) {
        setModalRecords(res.records);
      } else {
        const errText = res.error || strings.errors.recordsLoadFailed;
        console.error('[DashboardView] Records fetch error:', res.status, errText);
        setRecordsError(errText);
        setModalRecords([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DashboardView] Records network exception:', msg);
      setRecordsError(msg);
      setModalRecords([]);
    } finally {
      setIsLoadingRecords(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setActiveMetricType(null);
    setModalRecords([]);
    setRecordsError(null);
  };

  // Close modal on Escape key press
  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  // Preset button actions
  const handleSelectPreset = (newPreset: PresetType) => {
    setPreset(newPreset);
    setStartDate('');
    setEndDate('');
  };

  // Custom date triggers
  const handleStartDateClick = () => {
    if (startInputRef.current) {
      if (typeof startInputRef.current.showPicker === 'function') {
        startInputRef.current.showPicker();
      } else {
        startInputRef.current.focus();
      }
    }
  };

  const handleEndDateClick = () => {
    if (endInputRef.current) {
      if (typeof endInputRef.current.showPicker === 'function') {
        endInputRef.current.showPicker();
      } else {
        endInputRef.current.focus();
      }
    }
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartDate(e.target.value);
    setPreset('custom');
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndDate(e.target.value);
    setPreset('custom');
  };

  // Filtered & sorted modal records
  const filteredAndSortedRecords = useMemo(() => {
    let result = [...modalRecords];

    if (modalSearch.trim()) {
      const q = modalSearch.toLowerCase().trim();
      result = result.filter((item) =>
        Object.values(item).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
      );
    }

    if (sortConfig.key) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal === bVal) return 0;
        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }

    return result;
  }, [modalRecords, modalSearch, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const renderSortArrow = (key: string) => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 opacity-60 group-hover:opacity-100" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-teal-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-teal-600" />
    );
  };

  // Helper to resolve card title
  const getModalTitle = (type: CategoryManagerDashboardRecordType | null): string => {
    if (!type) return '';
    const map: Record<CategoryManagerDashboardRecordType, string> = {
      total_rfqs: strings.kpi.totalRfqs,
      open_rfqs: strings.kpi.openRfqs,
      rfqs_without_quotes: strings.kpi.rfqsWithoutQuotes,
      buyer_subscriptions: strings.kpi.buyerSubscriptions,
      vendor_subscriptions: strings.kpi.vendorSubscriptions,
      total_buyers: strings.kpi.totalBuyers,
      total_vendors: strings.kpi.totalVendors,
      buyer_registration: strings.kpi.buyerRegistration,
      vendor_registration: strings.kpi.vendorRegistration,
      total_logins: strings.kpi.totalLogins,
    };
    return map[type] || 'Records';
  };

  const handleCardKeyDown = (e: React.KeyboardEvent, type: CategoryManagerDashboardRecordType) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(type);
    }
  };

  const row1Cards = useMemo(() => [
    { type: 'total_rfqs' as const, label: strings.kpi.totalRfqs, count: kpi.totalRfqs, isDark: true, bgClass: 'bg-[#0B1528]', testId: 'kpi-card-total-rfqs' },
    { type: 'open_rfqs' as const, label: strings.kpi.openRfqs, count: kpi.openRfqs, isDark: false, bgClass: 'bg-white', testId: 'kpi-card-open-rfqs' },
    { type: 'rfqs_without_quotes' as const, label: strings.kpi.rfqsWithoutQuotes, count: kpi.rfqsWithoutQuotes, isDark: false, bgClass: 'bg-white', textColor: 'text-[#881337]', testId: 'kpi-card-rfqs-without-quotes' },
    { type: 'buyer_subscriptions' as const, label: strings.kpi.buyerSubscriptions, count: kpi.buyerSubscriptions, isDark: false, bgClass: 'bg-white', textColor: 'text-[#065F46]', testId: 'kpi-card-buyer-subscriptions' },
    { type: 'vendor_subscriptions' as const, label: strings.kpi.vendorSubscriptions, count: kpi.vendorSubscriptions, isDark: false, bgClass: 'bg-white', textColor: 'text-[#92400E]', testId: 'kpi-card-vendor-subscriptions' },
  ], [strings, kpi]);

  const row2Cards = useMemo(() => [
    { type: 'total_buyers' as const, label: strings.kpi.totalBuyers, count: kpi.totalBuyers, isDark: true, bgClass: 'bg-[#0B2545]', testId: 'kpi-card-total-buyers' },
    { type: 'total_vendors' as const, label: strings.kpi.totalVendors, count: kpi.totalVendors, isDark: false, bgClass: 'bg-white', textColor: 'text-[#0F766E]', testId: 'kpi-card-total-vendors' },
    { type: 'buyer_registration' as const, label: strings.kpi.buyerRegistration, count: kpi.buyerRegistration, isDark: false, bgClass: 'bg-white', testId: 'kpi-card-buyer-registration' },
    { type: 'vendor_registration' as const, label: strings.kpi.vendorRegistration, count: kpi.vendorRegistration, isDark: false, bgClass: 'bg-white', textColor: 'text-[#881337]', testId: 'kpi-card-vendor-registration' },
    { type: 'total_logins' as const, label: strings.kpi.totalLogins, count: kpi.totalLogins, isDark: true, bgClass: 'bg-[#131B45]', testId: 'kpi-card-total-logins' },
  ], [strings, kpi]);

  const renderKpiCard = (card: {
    type: CategoryManagerDashboardRecordType;
    label: string;
    count: number;
    isDark: boolean;
    bgClass: string;
    textColor?: string;
    testId: string;
  }) => (
    <div
      key={card.type}
      role="button"
      tabIndex={0}
      onClick={() => handleCardClick(card.type)}
      onKeyDown={(e) => handleCardKeyDown(e, card.type)}
      className={`flex flex-col justify-between p-4 ${card.bgClass} rounded-2xl shadow-sm hover:shadow-md cursor-pointer transition-all border ${
        card.isDark ? 'border-transparent text-white' : 'border-slate-200/80'
      }`}
      data-testid={card.testId}
    >
      <span className={`text-[11px] font-semibold tracking-wider uppercase ${card.isDark ? 'text-slate-300' : 'text-slate-500'}`}>
        {card.label}
      </span>
      <span className={`text-2xl sm:text-3xl font-bold tracking-tight mt-3 ${
        card.isDark ? 'text-white' : (card.textColor || 'text-slate-900')
      }`}>
        {isLoadingMetrics ? '...' : card.count.toLocaleString()}
      </span>
    </div>
  );

  // Scaler helper for SVG line charts
  const renderLineChart = (
    seriesList: { label: string; color: string; values: number[] }[],
    months: string[]
  ) => {
    const width = 380;
    const height = 180;
    const paddingX = 35;
    const paddingY = 25;

    const allValues = seriesList.flatMap((s) => s.values);
    const maxVal = Math.max(...allValues, 10);
    const chartWidth = width - paddingX * 2;
    const chartHeight = height - paddingY * 2;

    const getX = (index: number) => {
      if (months.length <= 1) return paddingX + chartWidth / 2;
      return paddingX + (index / (months.length - 1)) * chartWidth;
    };

    const getY = (val: number) => {
      const clamped = Math.max(0, val);
      return height - paddingY - (clamped / maxVal) * chartHeight;
    };

    return (
      <div className="w-full flex flex-col">
        {/* SVG Chart */}
        <div className="w-full h-48">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
              const y = paddingY + chartHeight * (1 - pct);
              const labelVal = Math.round(maxVal * pct);
              return (
                <g key={idx}>
                  <line
                    x1={paddingX}
                    y1={y}
                    x2={width - paddingX}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray={pct === 0 ? '0' : '2 3'}
                    strokeWidth="1"
                  />
                  <text x={paddingX - 6} y={y + 3} textAnchor="end" className="text-[10px] fill-slate-400">
                    {labelVal >= 1000 ? `${(labelVal / 1000).toFixed(1)}k` : labelVal}
                  </text>
                </g>
              );
            })}

            {/* Series Lines */}
            {seriesList.map((series, sIdx) => {
              const points = series.values.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');
              return (
                <g key={sIdx}>
                  <polyline
                    fill="none"
                    stroke={series.color}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points}
                  />
                  {series.values.map((v, i) => (
                    <circle
                      key={i}
                      cx={getX(i)}
                      cy={getY(v)}
                      r="3"
                      fill={series.color}
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                  ))}
                </g>
              );
            })}

            {/* X Axis Month Labels */}
            {months.map((m, i) => (
              <text
                key={i}
                x={getX(i)}
                y={height - 6}
                textAnchor="middle"
                className="text-[10px] fill-slate-500 font-medium"
              >
                {m}
              </text>
            ))}
          </svg>
        </div>

        {/* Circular Dot Legend */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-3 pt-3 border-t border-slate-100">
          {seriesList.map((series, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: series.color }} />
              <span className="text-xs font-medium text-slate-600">{series.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full min-h-[calc(100vh-80px)] p-4 sm:p-6 space-y-6 bg-slate-50/60">
      {/* Top Filter Bar (NO Dashboard Page Heading per spec) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 w-full">
        {/* Preset Buttons */}
        <div className="inline-flex items-center p-1 bg-white rounded-xl border border-slate-200/90 shadow-sm">
          <button
            type="button"
            onClick={() => handleSelectPreset('today')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              preset === 'today'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
            data-testid="filter-preset-today"
          >
            {strings.filters.today}
          </button>
          <button
            type="button"
            onClick={() => handleSelectPreset('this_week')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              preset === 'this_week'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
            data-testid="filter-preset-this-week"
          >
            {strings.filters.thisWeek}
          </button>
          <button
            type="button"
            onClick={() => handleSelectPreset('this_month')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              preset === 'this_month'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
            data-testid="filter-preset-this-month"
          >
            {strings.filters.thisMonth}
          </button>
        </div>

        {/* Start Date Button */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleStartDateClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleStartDateClick();
          }}
          className={`relative inline-flex items-center justify-between gap-2 px-3 py-1.5 min-w-[130px] bg-white rounded-xl border cursor-pointer select-none transition-all shadow-sm ${
            startDate ? 'border-slate-800 text-slate-900' : 'border-slate-200/90 text-slate-600 hover:border-slate-300'
          }`}
          data-testid="start-date-container"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-medium">{startDate || strings.filters.startDate}</span>
          </div>
          <input
            ref={startInputRef}
            type="date"
            value={startDate}
            onChange={handleStartDateChange}
            className="absolute inset-0 opacity-0 cursor-pointer pointer-events-none"
            tabIndex={-1}
            data-testid="start-date-input"
          />
        </div>

        {/* End Date Button */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleEndDateClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleEndDateClick();
          }}
          className={`relative inline-flex items-center justify-between gap-2 px-3 py-1.5 min-w-[130px] bg-white rounded-xl border cursor-pointer select-none transition-all shadow-sm ${
            endDate ? 'border-slate-800 text-slate-900' : 'border-slate-200/90 text-slate-600 hover:border-slate-300'
          }`}
          data-testid="end-date-container"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-medium">{endDate || strings.filters.endDate}</span>
          </div>
          <input
            ref={endInputRef}
            type="date"
            value={endDate}
            onChange={handleEndDateChange}
            className="absolute inset-0 opacity-0 cursor-pointer pointer-events-none"
            tabIndex={-1}
            data-testid="end-date-input"
          />
        </div>
      </div>

      {/* Metrics Error Banner */}
      {metricsError && (
        <div
          className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs"
          data-testid="metrics-error-banner"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>
              <strong>{strings.errors.errorPrefix}</strong> {metricsError}
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchMetrics()}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-rose-300 rounded-lg text-rose-700 hover:bg-rose-100 font-medium transition-colors"
            data-testid="retry-metrics-btn"
          >
            <RefreshCw className="w-3 h-3" />
            {strings.errors.retry}
          </button>
        </div>
      )}

      {/* KPI Cards: Row 1 (5 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {row1Cards.map(renderKpiCard)}
      </div>

      {/* KPI Cards: Row 2 (5 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {row2Cards.map(renderKpiCard)}
      </div>

      {/* Bottom Row: 3 Separate White Rounded Chart Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 w-full">
        {/* Card 1: Total RFQs & Subscriptions (Monthly) */}
        <div className="flex flex-col p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">{strings.charts.totalRfqsAndSubs}</h2>
          {renderLineChart(
            [
              {
                label: strings.charts.rfqs,
                color: '#0B1728',
                values: charts.totalRfqsAndSubs.map((item) => item.rfqs),
              },
              {
                label: strings.charts.buyerSubs,
                color: '#0F766E',
                values: charts.totalRfqsAndSubs.map((item) => item.buyerSubs),
              },
              {
                label: strings.charts.vendorSubs,
                color: '#B45309',
                values: charts.totalRfqsAndSubs.map((item) => item.vendorSubs),
              },
            ],
            displayMonths
          )}
        </div>

        {/* Card 2: New Registrations (Monthly) */}
        <div className="flex flex-col p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">{strings.charts.newRegistrations}</h2>
          {renderLineChart(
            [
              {
                label: strings.charts.newBuyers,
                color: '#0F766E',
                values: charts.newRegistrations.map((item) => item.newBuyers),
              },
              {
                label: strings.charts.newVendors,
                color: '#881337',
                values: charts.newRegistrations.map((item) => item.newVendors),
              },
            ],
            displayMonths
          )}
        </div>

        {/* Card 3: Activity: RFQs Raised vs. Quotes (Monthly) */}
        <div className="flex flex-col p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">{strings.charts.activityRfqsVsQuotes}</h2>
          {renderLineChart(
            [
              {
                label: strings.charts.rfqsRaisedByClients,
                color: '#0F766E',
                values: charts.activityRfqsVsQuotes.map((item) => item.rfqsRaised),
              },
              {
                label: strings.charts.noOfVendorQuotes,
                color: '#881337',
                values: charts.activityRfqsVsQuotes.map((item) => item.vendorQuotes),
              },
            ],
            displayMonths
          )}
        </div>
      </div>

      {/* Drill-down High Density Popup Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm cursor-pointer"
          role="dialog"
          aria-modal="true"
          data-testid="drilldown-modal"
          onClick={handleCloseModal}
        >
          <div
            className="flex flex-col w-full max-w-5xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide">
                  {getModalTitle(activeMetricType)}
                </h3>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-200 text-slate-700">
                  {filteredAndSortedRecords.length} {strings.modal.recordsFound}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                data-testid="modal-close-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Toolbar: Search */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 bg-white">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={strings.modal.searchPlaceholder}
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-800"
                  data-testid="modal-search-input"
                />
              </div>
            </div>

            {/* Modal Table Container */}
            <div className="flex-1 overflow-auto p-4">
              {isLoadingRecords ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                  <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
                  <span className="text-xs text-slate-500 font-medium">Loading records...</span>
                </div>
              ) : recordsError ? (
                <div className="flex flex-col items-center justify-center py-16 text-rose-500 space-y-2" data-testid="records-error-message">
                  <AlertTriangle className="w-8 h-8 text-rose-500 stroke-[1.5]" />
                  <span className="text-sm font-semibold">{recordsError}</span>
                </div>
              ) : filteredAndSortedRecords.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
                  <FileText className="w-10 h-10 text-slate-300 stroke-[1.5]" />
                  <span className="text-sm font-medium text-slate-500">{strings.modal.noRecords}</span>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-semibold select-none">
                      {/* Conditional Columns depending on Metric category */}
                      {(activeMetricType === 'total_rfqs' ||
                        activeMetricType === 'open_rfqs' ||
                        activeMetricType === 'rfqs_without_quotes') && (
                        <>
                          <th
                            className="py-2.5 px-3 cursor-pointer group"
                            onClick={() => handleSort('rfqNumber')}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>RFQ No.</span>
                              {renderSortArrow('rfqNumber')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('title')}>
                            <div className="flex items-center gap-1.5">
                              <span>Title</span>
                              {renderSortArrow('title')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('category')}>
                            <div className="flex items-center gap-1.5">
                              <span>Category</span>
                              {renderSortArrow('category')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('status')}>
                            <div className="flex items-center gap-1.5">
                              <span>Status</span>
                              {renderSortArrow('status')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('quotesCount')}>
                            <div className="flex items-center gap-1.5">
                              <span>Quotes</span>
                              {renderSortArrow('quotesCount')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('createdAt')}>
                            <div className="flex items-center gap-1.5">
                              <span>Created</span>
                              {renderSortArrow('createdAt')}
                            </div>
                          </th>
                        </>
                      )}

                      {(activeMetricType === 'buyer_subscriptions' ||
                        activeMetricType === 'total_buyers' ||
                        activeMetricType === 'buyer_registration') && (
                        <>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('name')}>
                            <div className="flex items-center gap-1.5">
                              <span>Buyer / Contact</span>
                              {renderSortArrow('name')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('email')}>
                            <div className="flex items-center gap-1.5">
                              <span>Email</span>
                              {renderSortArrow('email')}
                            </div>
                          </th>
                          <th
                            className="py-2.5 px-3 cursor-pointer group"
                            onClick={() => handleSort('organizationName')}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Organization</span>
                              {renderSortArrow('organizationName')}
                            </div>
                          </th>
                          <th
                            className="py-2.5 px-3 cursor-pointer group"
                            onClick={() => handleSort('subscriptionPlan')}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Plan</span>
                              {renderSortArrow('subscriptionPlan')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('location')}>
                            <div className="flex items-center gap-1.5">
                              <span>Location</span>
                              {renderSortArrow('location')}
                            </div>
                          </th>
                        </>
                      )}

                      {(activeMetricType === 'vendor_subscriptions' ||
                        activeMetricType === 'total_vendors' ||
                        activeMetricType === 'vendor_registration') && (
                        <>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('name')}>
                            <div className="flex items-center gap-1.5">
                              <span>Supplier</span>
                              {renderSortArrow('name')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('email')}>
                            <div className="flex items-center gap-1.5">
                              <span>Email</span>
                              {renderSortArrow('email')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('category')}>
                            <div className="flex items-center gap-1.5">
                              <span>Category</span>
                              {renderSortArrow('category')}
                            </div>
                          </th>
                          <th
                            className="py-2.5 px-3 cursor-pointer group"
                            onClick={() => handleSort('subscriptionPlan')}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Plan</span>
                              {renderSortArrow('subscriptionPlan')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('location')}>
                            <div className="flex items-center gap-1.5">
                              <span>Location</span>
                              {renderSortArrow('location')}
                            </div>
                          </th>
                        </>
                      )}

                      {activeMetricType === 'total_logins' && (
                        <>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('userName')}>
                            <div className="flex items-center gap-1.5">
                              <span>User Name</span>
                              {renderSortArrow('userName')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('email')}>
                            <div className="flex items-center gap-1.5">
                              <span>Internal Email</span>
                              {renderSortArrow('email')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('loginAt')}>
                            <div className="flex items-center gap-1.5">
                              <span>Login Timestamp</span>
                              {renderSortArrow('loginAt')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('durationSeconds')}>
                            <div className="flex items-center gap-1.5">
                              <span>Duration (s)</span>
                              {renderSortArrow('durationSeconds')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('status')}>
                            <div className="flex items-center gap-1.5">
                              <span>Status</span>
                              {renderSortArrow('status')}
                            </div>
                          </th>
                          <th className="py-2.5 px-3 cursor-pointer group" onClick={() => handleSort('deviceInfo')}>
                            <div className="flex items-center gap-1.5">
                              <span>Device / IP</span>
                              {renderSortArrow('deviceInfo')}
                            </div>
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAndSortedRecords.map((item, index) => (
                      <tr key={item.id || index} className="hover:bg-slate-50 transition-colors">
                        {(activeMetricType === 'total_rfqs' ||
                          activeMetricType === 'open_rfqs' ||
                          activeMetricType === 'rfqs_without_quotes') && (
                          <>
                            <td className="py-2 px-3 font-semibold text-slate-900">{item.rfqNumber}</td>
                            <td className="py-2 px-3 text-slate-700 max-w-xs truncate">{item.title}</td>
                            <td className="py-2 px-3 text-slate-600">{item.category}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  item.status === 'OPEN'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-700">{item.quotesCount}</td>
                            <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                              {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '-'}
                            </td>
                          </>
                        )}

                        {(activeMetricType === 'buyer_subscriptions' ||
                          activeMetricType === 'total_buyers' ||
                          activeMetricType === 'buyer_registration') && (
                          <>
                            <td className="py-2 px-3 font-medium text-slate-900">{item.name}</td>
                            <td className="py-2 px-3 text-slate-600">{item.email}</td>
                            <td className="py-2 px-3 text-slate-700">{item.organizationName}</td>
                            <td className="py-2 px-3">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                                {item.subscriptionPlan}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600">{item.location}</td>
                          </>
                        )}

                        {(activeMetricType === 'vendor_subscriptions' ||
                          activeMetricType === 'total_vendors' ||
                          activeMetricType === 'vendor_registration') && (
                          <>
                            <td className="py-2 px-3 font-medium text-slate-900">
                              <div>{item.name}</div>
                              {item.companyName && item.companyName !== item.name && (
                                <div className="text-[10px] text-slate-500 font-normal">{item.companyName}</div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{item.email}</td>
                            <td className="py-2 px-3 text-slate-700">{item.category}</td>
                            <td className="py-2 px-3">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800">
                                {item.subscriptionPlan}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600">{item.location}</td>
                          </>
                        )}

                        {activeMetricType === 'total_logins' && (
                          <>
                            <td className="py-2 px-3 font-medium text-slate-900">{item.userName}</td>
                            <td className="py-2 px-3 text-slate-600">{item.email}</td>
                            <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                              {item.loginAt ? new Date(item.loginAt).toLocaleString() : '-'}
                            </td>
                            <td className="py-2 px-3 text-slate-700">{item.durationSeconds}s</td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  item.status === 'ACTIVE'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-500">{item.deviceInfo}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end px-6 py-3 border-t border-slate-200/80 bg-slate-50/50">
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors shadow-sm"
                data-testid="modal-footer-close-btn"
              >
                {strings.modal.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
