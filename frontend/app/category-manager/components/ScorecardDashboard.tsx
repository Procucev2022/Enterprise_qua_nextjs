'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trophy,
  Filter,
  Download,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  TrendingUp,
  CreditCard,
  PhoneCall,
  UserCheck,
  ChevronDown,
  X,
  Target,
  Award,
} from 'lucide-react';
import { fetchScorecardData } from '@/lib/scorecardClient';
import type { ScorecardData, TeamScorecardRow } from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

type PeriodType = 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'financial_year' | 'custom';
type PillarType = 'all' | 'operations' | 'revenue' | 'sales';
type ViewMode = 'team' | 'individual';

function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '₹0';
  if (Math.abs(val) >= 10000000) {
    return `₹${(val / 10000000).toFixed(2)} Cr`;
  }
  if (Math.abs(val) >= 100000) {
    return `₹${(val / 100000).toFixed(2)} L`;
  }
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || isNaN(rate)) return 'N/A';
  return `${Math.round(rate)}%`;
}

export function ScorecardDashboard() {
  const strings = UI_STRINGS.actionCenter.scorecard;

  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [selectedExecutiveId, setSelectedExecutiveId] = useState<string>('all');
  const [period, setPeriod] = useState<PeriodType>('this_month');
  const [selectedPillar, setSelectedPillar] = useState<PillarType>('all');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  const [scorecardData, setScorecardData] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Drilldown modal for executive
  const [drilldownExecutive, setDrilldownExecutive] = useState<TeamScorecardRow | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchScorecardData({
        period,
        startDate: period === 'custom' ? customStartDate : undefined,
        endDate: period === 'custom' ? customEndDate : undefined,
        project: selectedProject,
        pillar: selectedPillar,
        executiveId: viewMode === 'individual' && selectedExecutiveId !== 'all' ? selectedExecutiveId : undefined,
      });

      if (data) {
        setScorecardData(data);
      } else {
        setScorecardData(null);
      }
    } catch {
      setError(strings.noDataFound);
    } finally {
      setLoading(false);
    }
  }, [period, customStartDate, customEndDate, selectedProject, selectedPillar, viewMode, selectedExecutiveId, strings.noDataFound]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Export CSV
  const handleExport = useCallback(() => {
    if (!scorecardData || !scorecardData.teamScores.length) return;

    const headers = [
      strings.rank,
      strings.executive,
      'Email',
      'Role',
      'Project',
      'Tasks Completed',
      'Tasks Assigned',
      'Task Completion %',
      'Tickets Resolved',
      'Tickets Assigned',
      'Ticket Resolution %',
      'Registrations Done',
      'Registrations Target',
      'Site Visits Done',
      'Site Visits Planned',
      'Loans Disbursed',
      'Loans Target',
      'Loan Realized (INR)',
      'Dues Collected (INR)',
      'Total Dues (INR)',
      'Leads Contacted',
      'Lead -> Visit Rate %',
      'Visit -> Deal Rate %',
      'Deals Closed',
      strings.scoreCol,
      strings.performanceStatusCol,
    ];

    const rows = scorecardData.teamScores.map((row) => [
      row.rank,
      `"${row.name.replace(/"/g, '""')}"`,
      `"${row.email}"`,
      `"${row.role}"`,
      `"${row.project}"`,
      row.operations.tasksCompleted,
      row.operations.tasksAssigned,
      formatRate(row.operations.taskCompletionRate),
      row.operations.ticketsResolved,
      row.operations.ticketsAssigned,
      formatRate(row.operations.ticketResolutionRate),
      row.operations.registrationsCompleted,
      row.operations.registrationsTarget,
      row.operations.siteVisitsCompleted,
      row.operations.siteVisitsPlanned,
      row.revenue.loansDisbursed,
      row.revenue.loansTarget,
      row.revenue.loanAmountRealized,
      row.revenue.duesCollected,
      row.revenue.totalDues,
      row.sales.leadsContacted,
      formatRate(row.sales.leadToVisitRate),
      formatRate(row.sales.visitToDealRate),
      row.sales.dealsClosed,
      row.score,
      `"${row.performanceStatus}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `scorecard_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [scorecardData, strings]);

  const operations = scorecardData?.pillarSummary.operations;
  const revenue = scorecardData?.pillarSummary.revenue;
  const sales = scorecardData?.pillarSummary.sales;

  // Filtered rows for team or individual view
  const visibleRows = useMemo(() => {
    if (!scorecardData) return [];
    if (viewMode === 'individual' && selectedExecutiveId !== 'all') {
      return scorecardData.teamScores.filter((e) => e.id === selectedExecutiveId);
    }
    return scorecardData.teamScores;
  }, [scorecardData, viewMode, selectedExecutiveId]);

  return (
    <div className="space-y-6">
      {/* Top Filter Bar 1: View Toggle, Periods, Project Filter, Export */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setViewMode('team');
                setSelectedExecutiveId('all');
              }}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'team' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {strings.teamLeaderboard}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('individual')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'individual' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {strings.individualExecutive}
            </button>
          </div>

          {/* Individual Executive Selector (shown if in individual view) */}
          {viewMode === 'individual' && scorecardData && (
            <select
              aria-label={strings.individualExecutive}
              value={selectedExecutiveId}
              onChange={(e) => setSelectedExecutiveId(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Executives</option>
              {scorecardData.teamScores.map((exec) => (
                <option key={exec.id} value={exec.id}>
                  {exec.name} ({exec.role})
                </option>
              ))}
            </select>
          )}

          {/* Period Presets */}
          <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 text-xs font-medium">
            {(
              [
                { id: 'today', label: strings.today },
                { id: 'this_week', label: strings.thisWeek },
                { id: 'this_month', label: strings.thisMonth },
                { id: 'last_month', label: strings.lastMonth },
                { id: 'this_quarter', label: strings.thisQuarter },
                { id: 'financial_year', label: strings.financialYear },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPeriod(p.id);
                  setShowCustomPicker(false);
                }}
                className={`px-2.5 py-1 rounded transition-colors ${
                  period === p.id && !showCustomPicker
                    ? 'bg-purple-700 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date Range Badge / Custom Picker Button */}
          <button
            type="button"
            onClick={() => setShowCustomPicker(!showCustomPicker)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>{scorecardData?.dateRange.label || 'Select Date Range'}</span>
          </button>

          {/* Custom Date Inputs Popover */}
          {showCustomPicker && (
            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 text-xs">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 bg-white text-xs"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 bg-white text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  if (customStartDate && customEndDate) {
                    setPeriod('custom');
                    setShowCustomPicker(false);
                  }
                }}
                className="px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs"
              >
                Apply
              </button>
            </div>
          )}

          {/* Project Filter */}
          <select
            aria-label={strings.allProjects}
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">{strings.allProjects}</option>
            <option value="Tata Steel Mechanical">Tata Steel Mechanical</option>
            <option value="JSW Heavy Valves">JSW Heavy Valves</option>
            <option value="L&T Construction">L&T Construction</option>
            <option value="Godrej Consumer">Godrej Consumer</option>
          </select>
        </div>

        {/* Right side: Export */}
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>{strings.exportBtn}</span>
        </button>
      </div>

      {/* Top Filter Bar 2: Pillar Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          {(
            [
              { id: 'all', label: `${strings.allPillars} (11)` },
              { id: 'operations', label: `${strings.operationsPillar} (4)` },
              { id: 'revenue', label: `${strings.revenuePillar} (3)` },
              { id: 'sales', label: `${strings.salesPillar} (4)` },
            ] as const
          ).map((pil) => (
            <button
              key={pil.id}
              type="button"
              onClick={() => setSelectedPillar(pil.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedPillar === pil.id
                  ? 'bg-purple-700 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {pil.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-400">
          Showing Data: {scorecardData?.dateRange.startDate || ''} to {scorecardData?.dateRange.endDate || ''}
        </div>
      </div>

      {/* Loading or Error State */}
      {loading && (
        <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500 text-sm">
          Loading scorecard metrics...
        </div>
      )}

      {error && !loading && (
        <div className="p-8 text-center bg-white rounded-xl border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      {!loading && scorecardData && (
        <>
          {/* SECTION A: OPERATIONS & COMPLIANCE */}
          {(selectedPillar === 'all' || selectedPillar === 'operations') && operations && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-800 uppercase tracking-wider bg-teal-50 px-3 py-1.5 rounded-md border border-teal-200">
                <CheckCircle2 className="w-4 h-4 text-teal-600" />
                <span>{strings.operationsPillar}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Tasks Completed */}
                <div className="bg-white p-4 rounded-xl border border-teal-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.tasksCompleted}</span>
                    <Briefcase className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {operations.tasksCompleted} / {operations.tasksAssigned}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-teal-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(operations.taskCompletionRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(operations.taskCompletionRate)} completed in period
                  </p>
                </div>

                {/* Card 2: Tickets Completed */}
                <div className="bg-white p-4 rounded-xl border border-pink-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.ticketsCompleted}</span>
                    <AlertCircle className="w-4 h-4 text-pink-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {operations.ticketsCompleted} / {operations.ticketsAssigned}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-pink-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(operations.ticketResolutionRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(operations.ticketResolutionRate)} resolved in period
                  </p>
                </div>

                {/* Card 3: Registrations */}
                <div className="bg-white p-4 rounded-xl border border-cyan-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.registrations}</span>
                    <UserCheck className="w-4 h-4 text-cyan-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {operations.registrations} / {operations.registrationsTarget}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(operations.registrationRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(operations.registrationRate)} registrations done
                  </p>
                </div>

                {/* Card 4: Site Visits Done */}
                <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.siteVisitsDone}</span>
                    <Target className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {operations.siteVisits} / {operations.siteVisitsPlanned}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-purple-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(operations.siteVisitRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(operations.siteVisitRate)} visits conducted
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION B: REVENUE & BANKING */}
          {(selectedPillar === 'all' || selectedPillar === 'revenue') && revenue && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-800 uppercase tracking-wider bg-blue-50 px-3 py-1.5 rounded-md border border-blue-200">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span>{strings.revenuePillar}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Card 1: Dues Collected / Pending */}
                <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.dueCollectedPending}</span>
                    <CreditCard className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900">
                    <span className="text-emerald-600">{formatCurrency(revenue.duesCollected)}</span>
                    <span className="text-slate-400 font-normal text-sm"> / {formatCurrency(revenue.totalDues)}</span>
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(revenue.collectionPercentage || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(revenue.collectionPercentage)} collected ({formatCurrency(revenue.pendingDues)} pend.)
                  </p>
                </div>

                {/* Card 2: Loans Disbursed */}
                <div className="bg-white p-4 rounded-xl border border-sky-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.loansDisbursed}</span>
                    <TrendingUp className="w-4 h-4 text-sky-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {revenue.loansDisbursed} / {revenue.loansTarget}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-sky-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(revenue.loanDisbursementRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(revenue.loanDisbursementRate)} files disbursed
                  </p>
                </div>

                {/* Card 3: Loan Realized */}
                <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.loanRealized}</span>
                    <CreditCard className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900">
                    {formatCurrency(revenue.loanRealized)}
                    <span className="text-slate-400 font-normal text-sm"> / {formatCurrency(revenue.loanRealizedTarget)}</span>
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(revenue.loanRealizationRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(revenue.loanRealizationRate)} amount realized
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION C: SALES & CUSTOMER ACQUISITION */}
          {(selectedPillar === 'all' || selectedPillar === 'sales') && sales && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800 uppercase tracking-wider bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                <TrendingUp className="w-4 h-4 text-amber-600" />
                <span>{strings.salesPillar}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Leads Contacted */}
                <div className="bg-white p-4 rounded-xl border border-amber-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.leadsContacted}</span>
                    <PhoneCall className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {sales.leadsContacted} / {sales.leadsTarget}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-amber-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(sales.leadContactRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(sales.leadContactRate)} contacted rate
                  </p>
                </div>

                {/* Card 2: Lead -> Visit Rate */}
                <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.leadVisitRate}</span>
                    <Target className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {formatRate(sales.leadToVisitRate)}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(sales.leadToVisitRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    * Excl. customers
                  </p>
                </div>

                {/* Card 3: Visit Conversion */}
                <div className="bg-white p-4 rounded-xl border border-lime-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.visitConversion}</span>
                    <TrendingUp className="w-4 h-4 text-lime-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {formatRate(sales.visitToDealRate)}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-lime-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(sales.visitToDealRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    * Excl. customers
                  </p>
                </div>

                {/* Card 4: Deals Closed */}
                <div className="bg-white p-4 rounded-xl border border-rose-100 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{strings.dealsClosed}</span>
                    <Award className="w-4 h-4 text-rose-600" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {sales.dealsClosed} / {sales.dealsTarget}
                  </div>
                  <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-rose-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(sales.dealAchievementRate || 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatRate(sales.dealAchievementRate)} lead conversion
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION D: TEAM PERFORMANCE SCORECARD TABLE */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-800">
                  {strings.teamScorecardTitle} ({scorecardData.dateRange.label})
                </h3>
              </div>
              <div className="text-xs font-medium px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                {formatString(strings.teamMembersCount, { count: visibleRows.length })}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                    <th className="py-3 px-3 w-12 text-center">{strings.rank}</th>
                    <th className="py-3 px-4">{strings.executive}</th>
                    <th className="py-3 px-3 text-center">{strings.tasks}</th>
                    <th className="py-3 px-3 text-center">{strings.tickets}</th>
                    <th className="py-3 px-3 text-center">{strings.registrationsCol}</th>
                    <th className="py-3 px-3 text-center">{strings.siteVisitsCol}</th>
                    <th className="py-3 px-3">{strings.loansRealizedCol}</th>
                    <th className="py-3 px-3">{strings.duesCollectedCol}</th>
                    <th className="py-3 px-3">{strings.leadsDealsCol}</th>
                    <th className="py-3 px-3">{strings.conversionRatesCol}</th>
                    <th className="py-3 px-3 text-center">{strings.scoreCol}</th>
                    <th className="py-3 px-3 text-center">{strings.performanceStatusCol}</th>
                    <th className="py-3 px-3 text-center">{strings.actionsCol}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-8 text-center text-slate-400">
                        {strings.noDataFound}
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Rank */}
                        <td className="py-3 px-3 text-center">
                          {row.rank === 1 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold">
                              🥇
                            </span>
                          ) : row.rank === 2 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold">
                              🥈
                            </span>
                          ) : row.rank === 3 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-amber-900 font-bold">
                              🥉
                            </span>
                          ) : (
                            <span className="font-semibold text-slate-600">{row.rank}</span>
                          )}
                        </td>

                        {/* Executive */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs uppercase">
                              {row.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-medium text-slate-900">{row.name}</div>
                              <div className="text-[10px] text-slate-400">{row.role}</div>
                            </div>
                          </div>
                        </td>

                        {/* Tasks */}
                        <td className="py-3 px-3 text-center">
                          <div className="font-medium text-slate-900">
                            {row.operations.tasksCompleted} / {row.operations.tasksAssigned}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatRate(row.operations.taskCompletionRate)}
                          </div>
                        </td>

                        {/* Tickets */}
                        <td className="py-3 px-3 text-center">
                          <div className="font-medium text-slate-900">
                            {row.operations.ticketsResolved} / {row.operations.ticketsAssigned}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatRate(row.operations.ticketResolutionRate)}
                          </div>
                        </td>

                        {/* Registrations */}
                        <td className="py-3 px-3 text-center">
                          <div className="font-medium text-slate-900">
                            {row.operations.registrationsCompleted} / {row.operations.registrationsTarget}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatRate(row.operations.registrationAchievementRate)}
                          </div>
                        </td>

                        {/* Site Visits */}
                        <td className="py-3 px-3 text-center">
                          <div className="font-medium text-slate-900">
                            {row.operations.siteVisitsCompleted} / {row.operations.siteVisitsPlanned}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatRate(row.operations.siteVisitAchievementRate)}
                          </div>
                        </td>

                        {/* Loans & Realized */}
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">
                            {row.revenue.loansDisbursed} files ({formatCurrency(row.revenue.loanAmountRealized)})
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Target: {row.revenue.loansTarget} files
                          </div>
                        </td>

                        {/* Dues Collected */}
                        <td className="py-3 px-3">
                          <div className="font-medium text-emerald-600">
                            {formatCurrency(row.revenue.duesCollected)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatCurrency(row.revenue.pendingDues)} pend. ({formatRate(row.revenue.collectionPercentage)})
                          </div>
                        </td>

                        {/* Leads & Deals */}
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">
                            {row.sales.leadsContacted} leads / {row.sales.dealsClosed} deals
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Deals target: {row.sales.dealsTarget}
                          </div>
                        </td>

                        {/* Conversion Rates */}
                        <td className="py-3 px-3">
                          <div className="text-slate-700">
                            Lead-Visit: <span className="font-semibold">{formatRate(row.sales.leadToVisitRate)}</span>
                          </div>
                          <div className="text-slate-700">
                            Visit-Deal: <span className="font-semibold">{formatRate(row.sales.visitToDealRate)}</span>
                          </div>
                        </td>

                        {/* Score */}
                        <td className="py-3 px-3 text-center">
                          <div className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-indigo-500 font-bold text-slate-900">
                            {row.score}
                          </div>
                        </td>

                        {/* Performance Status */}
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                              row.performanceStatus === 'On Track'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : row.performanceStatus === 'Average'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {row.performanceStatus}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setDrilldownExecutive(row)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            <span>{strings.viewDetails}</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Drilldown Modal for Individual Executive */}
      {drilldownExecutive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{strings.executivePerformanceTitle}</h3>
                <p className="text-xs text-slate-500">
                  {drilldownExecutive.name} • {drilldownExecutive.role} • Rank #{drilldownExecutive.rank}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrilldownExecutive(null)}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                <div>
                  <span className="text-xs text-indigo-600 font-medium">Overall Composite Score</span>
                  <div className="text-2xl font-bold text-indigo-900">{drilldownExecutive.score} / 100</div>
                </div>
                <div>
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                      drilldownExecutive.performanceStatus === 'On Track'
                        ? 'bg-emerald-100 text-emerald-800'
                        : drilldownExecutive.performanceStatus === 'Average'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {drilldownExecutive.performanceStatus}
                  </span>
                </div>
              </div>

              {/* 3 Pillar Summary for Executive */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="border border-teal-200 rounded-lg p-3 bg-teal-50/50">
                  <h4 className="text-xs font-bold text-teal-800 uppercase">{strings.operationsPillar}</h4>
                  <div className="mt-2 text-xs space-y-1 text-slate-700">
                    <div>Tasks: {drilldownExecutive.operations.tasksCompleted} / {drilldownExecutive.operations.tasksAssigned} ({formatRate(drilldownExecutive.operations.taskCompletionRate)})</div>
                    <div>Tickets: {drilldownExecutive.operations.ticketsResolved} / {drilldownExecutive.operations.ticketsAssigned} ({formatRate(drilldownExecutive.operations.ticketResolutionRate)})</div>
                    <div>Registrations: {drilldownExecutive.operations.registrationsCompleted} / {drilldownExecutive.operations.registrationsTarget}</div>
                    <div>Site Visits: {drilldownExecutive.operations.siteVisitsCompleted} / {drilldownExecutive.operations.siteVisitsPlanned}</div>
                  </div>
                </div>

                <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/50">
                  <h4 className="text-xs font-bold text-blue-800 uppercase">{strings.revenuePillar}</h4>
                  <div className="mt-2 text-xs space-y-1 text-slate-700">
                    <div>Collected: {formatCurrency(drilldownExecutive.revenue.duesCollected)}</div>
                    <div>Total Dues: {formatCurrency(drilldownExecutive.revenue.totalDues)}</div>
                    <div>Loans: {drilldownExecutive.revenue.loansDisbursed} / {drilldownExecutive.revenue.loansTarget}</div>
                    <div>Realized: {formatCurrency(drilldownExecutive.revenue.loanAmountRealized)}</div>
                  </div>
                </div>

                <div className="border border-amber-200 rounded-lg p-3 bg-amber-50/50">
                  <h4 className="text-xs font-bold text-amber-800 uppercase">{strings.salesPillar}</h4>
                  <div className="mt-2 text-xs space-y-1 text-slate-700">
                    <div>Leads Contacted: {drilldownExecutive.sales.leadsContacted} / {drilldownExecutive.sales.leadsTarget}</div>
                    <div>Lead-Visit Rate: {formatRate(drilldownExecutive.sales.leadToVisitRate)}</div>
                    <div>Visit-Deal Rate: {formatRate(drilldownExecutive.sales.visitToDealRate)}</div>
                    <div>Deals Closed: {drilldownExecutive.sales.dealsClosed} / {drilldownExecutive.sales.dealsTarget}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setDrilldownExecutive(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs transition-colors"
              >
                {strings.closeModal}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ScorecardDashboard;
