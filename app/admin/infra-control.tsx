'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { RbacModal } from '@/app/components/Modals';
import {
  Cpu,
  Database,
  Cloud,
  ShieldCheck,
  KeyRound,
  Sliders,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  HardDrive,
  MessageSquare,
  Sparkles,
  Server,
  Lock,
} from 'lucide-react';

interface InfraControlProps {
  onNavigateToAuditLog: () => void;
}

export default function InfraControl({ onNavigateToAuditLog }: InfraControlProps) {
  const { azureHealth, systemConfig, setSystemConfig, showToast, addAuditLog } = useApp();

  const [rbacModalOpen, setRbacModalOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [secretsModalOpen, setSecretsModalOpen] = useState(false);

  const handleBackup = () => {
    setBackingUp(true);
    setTimeout(() => {
      setBackingUp(false);
      addAuditLog('Executed manual snapshot backup of Azure SQL Master and Cosmos DB collections');
      showToast('Database Backup Completed', 'Point-in-time snapshot committed to Azure Geo-Redundant Storage (GRS).', 'success');
    }, 1500);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Security, Azure Infrastructure & System Settings
            </h1>
            <span className="badge badge-purple">Screen 4.1</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Azure cloud infrastructure telemetry, AI LLM model orchestration parameters, and security policies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onNavigateToAuditLog} className="btn btn-secondary btn-sm">
            <ShieldCheck size={14} /> Immutable Audit Trail
          </button>
        </div>
      </div>

      {/* Main Grid: Azure Service Health & AI Engine Parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: Azure Service Health */}
        <div className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <Cloud size={18} className="text-sky-600 dark:text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                AZURE CLOUD INFRASTRUCTURE HEALTH
              </h2>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              <span className="live-dot" /> Multi-Region Active
            </span>
          </div>

          <div className="space-y-3">
            {azureHealth.map((srv, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white dark:bg-gray-800 text-sky-600 dark:text-cyan-400 border border-slate-200 dark:border-gray-700 shadow-sm">
                    <Server size={16} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-gray-100">{srv.service}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">{srv.details}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
                    {srv.status}
                  </span>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400 mono mt-1">
                    Latency: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{srv.latency}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: AI Engine Parameters */}
        <div className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                AI ENGINE ORCHESTRATION PARAMETERS
              </h2>
            </div>
            <span className="badge badge-purple">Llama 3 Active</span>
          </div>

          <div className="space-y-4 text-xs">
            {/* Llama 3 Model Selection */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-800 dark:text-gray-200">Ollama / Llama 3 Model Deployment</label>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                  <CheckCircle2 size={12} /> GPU Accelerated
                </span>
              </div>
              <select
                value={systemConfig.ollamaModel}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setSystemConfig({ ...systemConfig, ollamaModel: val });
                  showToast('AI Model Updated', `Inference engine switched to: ${val}`, 'info');
                }}
              >
                <option value="Llama 3 (8B Instruct)">Llama 3 (8B Instruct - Ultra Fast)</option>
                <option value="Llama 3.1 (70B Quantized)">Llama 3.1 (70B Quantized - Deep Reasoning)</option>
                <option value="Mistral NeMo 12B">Mistral NeMo 12B Enterprise</option>
              </select>
            </div>

            {/* OCR Threshold Slider */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-800 dark:text-gray-200">OCR Entity Extraction Confidence Threshold</label>
                <span className="mono text-indigo-600 dark:text-indigo-300 font-bold">{systemConfig.ocrExtractionThreshold}%</span>
              </div>
              <input
                type="range"
                min={70}
                max={99}
                value={systemConfig.ocrExtractionThreshold}
                onChange={(e) => setSystemConfig({ ...systemConfig, ocrExtractionThreshold: Number(e.target.value) })}
                className="w-full"
              />
              <p className="text-[10px] text-slate-500 dark:text-gray-400">
                Entities extracted below this confidence score trigger mandatory human-in-the-loop verification.
              </p>
            </div>

            {/* WhatsApp Chaser Toggle & Escalation Interval */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1">
                <span className="font-bold text-slate-800 dark:text-gray-200 block">WhatsApp Auto-Chaser</span>
                <button
                  onClick={() => {
                    const next = !systemConfig.whatsappAutoChaser;
                    setSystemConfig({ ...systemConfig, whatsappAutoChaser: next });
                    showToast('Chaser Setting Changed', `WhatsApp Auto-Chaser ${next ? 'Enabled' : 'Disabled'}`, 'info');
                  }}
                  className={`btn btn-sm w-full mt-1 ${
                    systemConfig.whatsappAutoChaser ? 'btn-emerald' : 'btn-secondary'
                  }`}
                >
                  {systemConfig.whatsappAutoChaser ? 'Enabled (Active)' : 'Disabled'}
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1">
                <span className="font-bold text-slate-800 dark:text-gray-200 block">Escalation Interval</span>
                <select
                  value={systemConfig.escalationIntervalHours}
                  onChange={(e) => setSystemConfig({ ...systemConfig, escalationIntervalHours: Number(e.target.value) })}
                  className="mt-1"
                >
                  <option value={12}>12 Hours</option>
                  <option value={24}>24 Hours (Standard)</option>
                  <option value={48}>48 Hours</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SYSTEM ACTIONS TOOLBAR */}
      <div className="glass-panel p-5 rounded-2xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-300">
            SYSTEM ADMINISTRATIVE ACTIONS
          </span>
          <span className="text-[11px] text-slate-500 dark:text-gray-500">Authorized Azure Subscription: Sub-Procucev-Prod-01</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button
            onClick={() => setRbacModalOpen(true)}
            className="btn btn-secondary btn-md"
          >
            <ShieldCheck size={15} /> [ Manage RBAC Permissions ]
          </button>
          <button
            onClick={() => setSecretsModalOpen(true)}
            className="btn btn-secondary btn-md"
          >
            <KeyRound size={15} /> [ Azure Key Vault Secrets ]
          </button>
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="btn btn-primary btn-md"
          >
            <RefreshCw size={15} className={backingUp ? 'animate-spin' : ''} />
            {backingUp ? 'Creating Snapshot...' : '[ Database Backup ]'}
          </button>
        </div>
      </div>

      {/* Modals */}
      <RbacModal isOpen={rbacModalOpen} onClose={() => setRbacModalOpen(false)} />

      {secretsModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-cyan-500/40 rounded-2xl text-slate-900 dark:text-white space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-gray-800">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <KeyRound size={16} className="text-sky-600 dark:text-cyan-400" /> Azure Key Vault Secrets (kv-procucev-prod)
              </h3>
              <button onClick={() => setSecretsModalOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">✕</button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex justify-between items-center">
                <span className="font-mono text-slate-700 dark:text-gray-300">WHATSAPP_BUSINESS_API_TOKEN</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">••••••••••••92a1</span>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex justify-between items-center">
                <span className="font-mono text-slate-700 dark:text-gray-300">AZURE_SQL_CONNECTION_STRING</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">••••••••••••b810</span>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 flex justify-between items-center">
                <span className="font-mono text-slate-700 dark:text-gray-300">AZURE_OPENAI_DOC_INTELLIGENCE_KEY</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">••••••••••••3f19</span>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setSecretsModalOpen(false)} className="btn btn-secondary btn-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
