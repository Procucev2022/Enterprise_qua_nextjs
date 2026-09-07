'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { fetchEmailGatewayStatus } from '@/lib/emailGatewayClient';
import { createRFQ, extractLineItemsFromDocument } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { logger } from '@/lib/logger';
import type { ExtractedEntity, RFQItem } from '@/lib/types';
import {
  Mail,
  RefreshCw,
  TriangleAlert,
  Send,
} from 'lucide-react';

const GATEWAY = UI_STRINGS.emailGateway;

interface EmailGatewayPanelProps {
  onRFQCreated?: (rfq: RFQItem) => void;
}

export default function EmailGatewayPanel({ onRFQCreated }: EmailGatewayPanelProps) {
  const { showToast, activeBuyerAccount, adoptCreatedRFQ } = useApp();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Email composer state - defaults empty for subject and body as requested
  const [emailSender, setEmailSender] = useState<string>('project.procurement@lt-heavy.com');
  const [emailGatewayTo, setEmailGatewayTo] = useState<string>('navinchaudhary.dev@gmail.com');
  const [emailSubject, setEmailSubject] = useState<string>('');
  const [emailBody, setEmailBody] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    const result = await fetchEmailGatewayStatus();
    if (result.success && result.data) {
      setLoadError(null);
      if (result.data.gatewayAddress) {
        setEmailGatewayTo(result.data.gatewayAddress);
      }
    } else {
      setLoadError(result.error || GATEWAY.statusUnavailable);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Sync active buyer account email when available
  useEffect(() => {
    if (activeBuyerAccount?.corporateEmail) {
      setEmailSender(activeBuyerAccount.corporateEmail);
    }
  }, [activeBuyerAccount]);

  const handleSubmitRequisition = async () => {
    if (!emailSubject.trim()) {
      showToast('Missing Subject', 'Please provide a requisition subject.', 'warning');
      return;
    }
    if (!emailBody.trim()) {
      showToast('Missing Requirement', 'Please provide email body and line-item specs.', 'warning');
      return;
    }
    setIsSubmitting(true);
    logger.info('Submitting requisition via email gateway UI', { sender: emailSender, subject: emailSubject }, 'EMAIL_GATEWAY');

    try {
      const extractRes = await extractLineItemsFromDocument({
        fileName: 'inbound-requisition.txt',
        documentText: emailBody,
        mimeType: 'text/plain',
      });

      let items: ExtractedEntity[] = [];
      let category = 'Engineering Spares - Mechanical';
      let budget = 2500000;
      let targetDeliveryDate = '2026-09-18';

      if (extractRes.success && extractRes.data && extractRes.data.extractedEntities && extractRes.data.extractedEntities.length > 0) {
        items = extractRes.data.extractedEntities;
        category = extractRes.data.category || category;
        budget = extractRes.data.estimatedBudget || budget;
        targetDeliveryDate = extractRes.data.targetDeliveryDate || targetDeliveryDate;
      } else {
        // Structured fallback from requirement text
        items = [
          {
            id: `item-${Date.now()}-1`,
            itemName: emailSubject.replace(/^URGENT:\s*/i, '') || 'Custom Requisition Requirement',
            technicalSpecs: emailBody.slice(0, 160).replace(/\n/g, ' '),
            quantity: 12,
            unit: 'Units',
            category: category,
            majorCategory: category,
            minorCategory: 'General Industrial Equipment',
            targetDate: targetDeliveryDate,
            confidence: 0.95,
          },
        ];
      }

      const saveRes = await createRFQ({
        title: emailSubject || 'Inbound Email Requisition',
        category,
        sourcingMode: 'mode_1',
        status: 'Parsing',
        source: 'email_gateway',
        sourceFileName: 'inbound-email.eml',
        sourceEmail: emailSender,
        budget,
        targetDeliveryDate,
        deliveryLocation: 'Enterprise Logistics Hub (Navi Mumbai CIF Site)',
        deliveryPincode: '400707',
        extractedEntities: items,
        attachments: [],
      });

      if (!saveRes.success) {
        showToast('Ingestion Error', saveRes.error || 'Failed to save RFQ to database.', 'warning');
        return;
      }

      adoptCreatedRFQ(saveRes.rfq);
      setEmailSubject('');
      setEmailBody('');
      showToast(
        'Requisition Ingested Successfully',
        `RFQ ${saveRes.rfq.rfqNumber} has been added to the database and is now on the Category Manager Kanban Board.`,
        'success'
      );
      if (onRFQCreated) {
        onRFQCreated(saveRes.rfq);
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      showToast('Ingestion Failed', errMessage, 'warning');
    } finally {
      setIsSubmitting(false);
      await loadStatus();
    }
  };

  if (isLoading) {
    return (
      <div
        data-testid="gateway-loading"
        className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 flex items-center gap-2"
      >
        <RefreshCw size={14} className="animate-spin" /> {GATEWAY.title}
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        data-testid="gateway-error"
        className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-1"
      >
        <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
          <TriangleAlert size={14} /> {GATEWAY.title}
        </p>
        <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">{loadError}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="gateway-panel"
      className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-4 text-xs"
    >
      {/* Header Banner */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-gray-800 pb-3 flex-wrap">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold">
          <Mail size={16} /> {GATEWAY.title}
        </div>
      </div>

      {/* Requisition Composer Form */}
      <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
              {GATEWAY.fromPlantEngineerLabel}
            </label>
            <input
              type="text"
              value={emailSender}
              onChange={(e) => setEmailSender(e.target.value)}
              placeholder="project.procurement@lt-heavy.com"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
              {GATEWAY.toGatewayLabel}
            </label>
            <input
              type="text"
              value={emailGatewayTo}
              readOnly
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-100 dark:bg-gray-950/80 text-slate-600 dark:text-gray-400 cursor-not-allowed"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
            {GATEWAY.subjectInputLabel} <span className="text-rose-500 font-bold">*</span>
          </label>
          <input
            type="text"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="e.g. URGENT: Requisition for Centrifugal Pumps & Valves"
            className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 block mb-1">
            {GATEWAY.bodyInputLabel} <span className="text-rose-500 font-bold">*</span>
          </label>
          <textarea
            rows={5}
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="Paste or write line items, quantities, delivery timeline, and technical specifications..."
            className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-gray-800 flex items-center justify-end flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSubmitRequisition}
            disabled={isSubmitting}
            className="btn btn-primary btn-sm font-bold flex items-center gap-2 shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={13} className="animate-spin" /> {GATEWAY.submittingAction}
              </>
            ) : (
              <>
                <Send size={13} /> {GATEWAY.submitAction}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


