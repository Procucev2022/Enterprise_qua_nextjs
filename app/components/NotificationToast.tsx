'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export default function NotificationToast() {
  const { toastMessage, dismissToast } = useApp();

  if (!toastMessage) return null;

  const getIcon = () => {
    switch (toastMessage.type) {
      case 'success':
        return <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />;
      default:
        return <Info size={18} className="text-indigo-600 dark:text-cyan-400 shrink-0" />;
    }
  };

  const getBorderColor = () => {
    switch (toastMessage.type) {
      case 'success':
        return 'border-emerald-300 dark:border-emerald-500/40 shadow-emerald-500/10';
      case 'warning':
        return 'border-amber-300 dark:border-amber-500/40 shadow-amber-500/10';
      default:
        return 'border-indigo-300 dark:border-indigo-500/40 shadow-indigo-500/10';
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-md w-full px-4 animate-fade-in pointer-events-auto">
      <div
        className={`p-4 rounded-2xl bg-white/95 dark:bg-gray-900/95 border ${getBorderColor()} shadow-2xl backdrop-blur-xl flex items-start justify-between gap-3 text-xs`}
      >
        <div className="flex items-start gap-3">
          {getIcon()}
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-xs">{toastMessage.title}</h4>
            <p className="text-slate-600 dark:text-gray-300 text-[11px] mt-0.5 leading-relaxed">{toastMessage.description}</p>
          </div>
        </div>

        <button
          onClick={dismissToast}
          className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
