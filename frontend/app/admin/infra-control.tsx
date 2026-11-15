'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import type { AzureServiceHealth, DBHealthStatus, DBStatusResponse } from '@/lib/types';
import { DB_STATUS_ENDPOINT, DB_STATUS_POLL_INTERVAL_MS } from '@/lib/constants';
import { formatString, UI_STRINGS } from '@/lib/uiStrings';
import { logger } from '@/lib/logger';
import { AlertCircle, Cloud, Database, Lock, RefreshCw, Server, ShieldCheck, Sparkles } from 'lucide-react';

type DatabaseState = 'checking' | 'connected' | 'connectionError' | 'notConfigured' | 'unavailable';

const PILL_NEUTRAL = 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-700';
const PILL_OK = 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30';
const PILL_WARN = 'bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
const PILL_ERROR = 'bg-rose-50 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30';

const HEALTH_STATUS_LABEL: Record<AzureServiceHealth['status'], string> = {
  CHECKING: UI_STRINGS.infraControl.statusChecking,
  ONLINE: UI_STRINGS.infraControl.statusOnline,
  UNREACHABLE: UI_STRINGS.infraControl.statusUnreachable,
  NOT_CONFIGURED: UI_STRINGS.infraControl.statusNotConfigured,
};

const HEALTH_STATUS_STYLE: Record<AzureServiceHealth['status'], string> = {
  CHECKING: PILL_NEUTRAL,
  ONLINE: PILL_OK,
  UNREACHABLE: PILL_ERROR,
  NOT_CONFIGURED: PILL_WARN,
};

const DATABASE_STATE_STYLE: Record<DatabaseState, string> = {
  checking: PILL_NEUTRAL,
  connected: PILL_OK,
  connectionError: PILL_ERROR,
  notConfigured: PILL_WARN,
  unavailable: PILL_ERROR,
};

function getDatabaseState(health: DBHealthStatus | null, statusFailed: boolean): DatabaseState {
  if (statusFailed) return 'unavailable';
  if (!health) return 'checking';
  if (health.isConnected) return 'connected';
  return health.isConfigured ? 'connectionError' : 'notConfigured';
}

function getDatabaseStateLabel(state: DatabaseState, latencyMs: number | undefined): string {
  const strings = UI_STRINGS.infraControl;
  switch (state) {
    case 'connected':
      return latencyMs === undefined
        ? strings.databaseConnectedNoLatency
        : formatString(strings.databaseConnected, { latencyMs });
    case 'connectionError':
      return strings.databaseConnectionError;
    case 'notConfigured':
      return strings.databaseNotConfigured;
    case 'unavailable':
      return strings.databaseStatusUnavailable;
    default:
      return strings.databaseChecking;
  }
}

interface InfraControlProps {
  onNavigateToAuditLog: () => void;
}

export default function InfraControl({ onNavigateToAuditLog }: InfraControlProps) {
  const { azureHealth, systemConfig, showToast } = useApp();
  const strings = UI_STRINGS.infraControl;

  const [dbHealth, setDbHealth] = useState<DBHealthStatus | null>(null);
  const [dbStatusError, setDbStatusError] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  /**
   * Reads GET /api/db/status. Returns the health on success and null on failure.
   * A failure clears the last reading so a stale "connected" state is never shown.
   */
  const fetchDbHealth = useCallback(async (): Promise<DBHealthStatus | null> => {
    try {
      const res = await fetch(DB_STATUS_ENDPOINT);
      const data = (await res.json()) as DBStatusResponse;
      if (!res.ok || data.success !== true) {
        logger.log('WARN', 'Database status request was not successful', { status: res.status, error: data.error }, 'INFRASTRUCTURE');
        setDbHealth(null);
        setDbStatusError(data.error || UI_STRINGS.infraControl.databaseStatusFailed);
        return null;
      }
      setDbHealth(data);
      setDbStatusError(null);
      return data;
    } catch (err: unknown) {
      logger.log('ERROR', 'Failed to fetch database status', { error: err }, 'INFRASTRUCTURE');
      setDbHealth(null);
      setDbStatusError(UI_STRINGS.infraControl.databaseStatusFailed);
      return null;
    }
  }, []);

  useEffect(() => {
    void fetchDbHealth();
    const interval = setInterval(() => void fetchDbHealth(), DB_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchDbHealth]);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    const health = await fetchDbHealth();
    setTestingConnection(false);

    if (!health) {
      showToast(strings.statusFailedToastTitle, strings.databaseStatusFailed, 'warning');
      return;
    }
    if (health.isConnected) {
      const provider = health.providerLabel || strings.notAvailable;
      const message = health.latencyMs === undefined
        ? formatString(strings.connectedToastMessageNoLatency, { provider })
        : formatString(strings.connectedToastMessage, { provider, latencyMs: health.latencyMs });
      showToast(strings.connectedToastTitle, message, 'success');
      return;
    }
    showToast(strings.notConnectedToastTitle, health.errorMessage || health.providerLabel || strings.notAvailable, 'warning');
  };

  const databaseState = getDatabaseState(dbHealth, dbStatusError !== null);
  const aiModelText = systemConfig?.aiModel || strings.notAvailable;
  const aiTemperatureText = typeof systemConfig?.aiTemperature === 'number'
    ? String(systemConfig.aiTemperature)
    : strings.notAvailable;
  const loadedMetrics = [
    { label: strings.loadedBuyerAccounts, value: dbHealth?.loadedRecords?.buyerAccounts },
    { label: strings.loadedVendors, value: dbHealth?.loadedRecords?.vendors },
    { label: strings.loadedRfqs, value: dbHealth?.loadedRecords?.rfqs },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{strings.title}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-emerald flex items-center gap-1">
            <Lock size={12} /> {UI_STRINGS.badges.aesEncrypted}
          </span>
          <button type="button" onClick={onNavigateToAuditLog} className="btn btn-secondary btn-sm">
            <ShieldCheck size={14} /> {strings.auditTrailButton}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: Infrastructure health, as probed by the server */}
        <div className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <Cloud size={18} className="text-sky-600 dark:text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                {strings.healthTitle}
              </h2>
            </div>
          </div>

          <div className="space-y-3">
            {azureHealth.length === 0 && (
              <p className="text-xs text-slate-500 dark:text-gray-400">{strings.healthEmpty}</p>
            )}
            {azureHealth.map((srv, idx) => (
              <div
                key={`${srv.service}-${idx}`}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-white dark:bg-gray-800 text-sky-600 dark:text-cyan-400 border border-slate-200 dark:border-gray-700 shadow-sm">
                    <Server size={16} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-900 dark:text-gray-100 truncate">{srv.service}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">{srv.details}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${HEALTH_STATUS_STYLE[srv.status] ?? PILL_NEUTRAL}`}>
                    {HEALTH_STATUS_LABEL[srv.status] ?? srv.status}
                  </span>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400 mono mt-1">
                    {strings.latencyLabel}: <span className="font-bold text-slate-700 dark:text-gray-200">{srv.latency}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: AI engine configuration, read-only */}
        <div className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                {strings.configTitle}
              </h2>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 flex items-center justify-between gap-3">
              <span className="font-bold text-slate-800 dark:text-gray-200">{strings.configModelLabel}</span>
              <span className="mono font-bold text-slate-900 dark:text-white text-right break-all">{aiModelText}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 flex items-center justify-between gap-3">
              <span className="font-bold text-slate-800 dark:text-gray-200">{strings.configTemperatureLabel}</span>
              <span className="mono font-bold text-slate-900 dark:text-white">{aiTemperatureText}</span>
            </div>

            {!systemConfig && <p className="text-slate-500 dark:text-gray-400">{strings.configEmpty}</p>}
            <p className="text-[10px] text-slate-500 dark:text-gray-400">{strings.configReadOnlyNote}</p>
          </div>
        </div>
      </div>

      {/* Panel 3: Database connection, as reported by the server */}
      <div className="glass-panel p-6 rounded-2xl space-y-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shadow-sm">
              <Database size={20} />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {strings.databaseTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{dbHealth?.providerLabel || strings.notAvailable}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 shadow-sm ${DATABASE_STATE_STYLE[databaseState]}`}>
              {databaseState === 'connected' ? <span className="live-dot" /> : <AlertCircle size={13} />}
              {getDatabaseStateLabel(databaseState, dbHealth?.latencyMs)}
            </span>
          </div>
        </div>

        {dbStatusError && (
          <div role="alert" className="p-3 rounded-xl text-xs bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200">
            {dbStatusError}
          </div>
        )}

        {dbHealth && !dbHealth.isConnected && dbHealth.errorMessage && (
          <div className="p-3 rounded-xl text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200">
            {dbHealth.errorMessage}
          </div>
        )}

        {/* Records held by this server process. Each value is "not available" until the status is read. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {loadedMetrics.map((metric) => (
            <div key={metric.label} className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-gray-500 block">{metric.label}</span>
              <span className="text-base font-black text-slate-900 dark:text-white mt-0.5 block">
                {metric.value ?? strings.notAvailable}
              </span>
            </div>
          ))}
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testingConnection}
            className="btn btn-secondary btn-sm"
          >
            <RefreshCw size={13} className={testingConnection ? 'animate-spin' : ''} />
            {testingConnection ? strings.testingConnection : strings.testConnection}
          </button>
        </div>
      </div>
    </div>
  );
}
