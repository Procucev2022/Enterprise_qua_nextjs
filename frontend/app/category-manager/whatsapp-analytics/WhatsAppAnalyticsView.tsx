'use client';

import React, { useState } from 'react';
import { ExternalLink, RefreshCw, MessageSquare } from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import { WHATSAPP_ANALYTICS_EMBED_URL } from '@/lib/constants';

export default function WhatsAppAnalyticsView() {
  const [isLoading, setIsLoading] = useState(true);
  const strings = UI_STRINGS.categoryManagerDashboard.whatsapp;

  return (
    <div className="flex flex-col w-full h-[calc(100vh-80px)] p-4 sm:p-6 space-y-4">
      {/* Top action bar */}
      <div className="flex items-center justify-between bg-white px-5 py-3 rounded-xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">{strings.title}</h1>
            <p className="text-xs text-slate-500">{strings.fallbackNotice}</p>
          </div>
        </div>

        <a
          href={WHATSAPP_ANALYTICS_EMBED_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          data-testid="open-new-tab-link"
        >
          <span>{strings.openNewTab}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Main embed container */}
      <div className="relative flex-1 w-full bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {isLoading && (
          <div
            data-testid="loading-indicator"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm"
          >
            <RefreshCw className="w-8 h-8 text-teal-600 animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-600">{strings.loading}</p>
          </div>
        )}

        <iframe
          src={WHATSAPP_ANALYTICS_EMBED_URL}
          title={strings.title}
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          allow="camera; microphone; geolocation"
          data-testid="whatsapp-analytics-iframe"
        />
      </div>
    </div>
  );
}
