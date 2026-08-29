'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import {
  X,
  Mail,
  Building2,
  CheckCircle2,
  Copy,
  Printer,
  ShieldCheck,
  Hash,
  Star,
  Clock,
  Award,
  AlertCircle,
  TrendingUp,
  MessageSquare,
  Scale,
  Sparkles,
} from 'lucide-react';

export default function VendorRatingRevisionModal() {
  const {
    selectedRatingRevisionEmail,
    ratingRevisionEmailModalOpen,
    setRatingRevisionEmailModalOpen,
    showToast,
  } = useApp();

  const [copied, setCopied] = useState(false);

  if (!ratingRevisionEmailModalOpen || !selectedRatingRevisionEmail) return null;

  const email = selectedRatingRevisionEmail;

  const handleCopy = () => {
    const rawEmailText = `
SUBJECT: Official Vendor Performance & Rating Revision Notification - ${email.buyerCompany}
FROM: ${email.buyerContactName} (${email.buyerCompany}) <${email.buyerContactEmail}> via Procucev AI Rating Engine
TO: ${email.vendorContactPerson} <${email.vendorEmail}> (${email.vendorName})
DATE: ${email.dispatchedAt}

DEAR ${email.vendorContactPerson.toUpperCase()} (${email.vendorName}),

Your client, ${email.buyerCompany}, has officially submitted a Performance & Rating Revision for your organization on the Procucev Network.

PERFORMANCE EVALUATION BREAKDOWN (OUT OF 100):
- Quality Score: ${email.qualityScore} / 100
- Cost Competitiveness Score: ${email.costScore} / 100
- Delivery & OTIF Score: ${email.deliveryScore} / 100
- Buyer Evaluation Average: ${email.buyerAverage}%

AGGREGATE RATING RECONCILIATION:
- Previous Platform Score: ${email.previousScore}% (${(email.previousScore / 20).toFixed(1)} ★)
- Calculated Buyer Average: ${email.buyerAverage}%
- New Composite Platform Rating: ${email.newRating} ★ (${email.newCompositeScore}% Composite Score)

BUYER'S OFFICIAL REMARKS & PERFORMANCE NOTES:
"${email.remarks}"

NETWORK VISIBILITY NOTICE:
This updated aggregate rating is now active in your verified supplier ledger and will be displayed to all enterprise buyers issuing RFQs in your mapped categories.

SHA-256 AUDIT SEAL: ${email.shaSignature}
`;
    navigator.clipboard.writeText(rawEmailText.trim());
    setCopied(true);
    showToast('Copied to Clipboard', 'Rating revision email text copied.', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    const printableArea = document.getElementById('printable-revision-email-content');
    if (!printableArea) {
      window.print();
      return;
    }

    const printIframe = document.createElement('iframe');
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    document.body.appendChild(printIframe);

    const doc = printIframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${email.vendorName} - Rating Revision Notification</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10pt; line-height: 1.4; color: #0f172a; margin: 0; padding: 0; background: #fff; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.5pt; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
            th { background-color: #f1f5f9; font-weight: bold; }
            .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 10px 0; }
            .card { border: 1px solid #cbd5e1; background: #f8fafc; padding: 10px; border-radius: 6px; }
            .text-indigo { color: #074193; font-weight: bold; }
            .text-emerald { color: #059669; font-weight: bold; }
            .text-amber { color: #d97706; font-weight: bold; }
            .no-print { display: none !important; }
          </style>
        </head>
        <body>
          <div style="margin-bottom: 12px; border-bottom: 2px solid #074193; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 13pt; color: #074193;">PROCUCEV SUPPLIER GOVERNANCE</strong>
              <div style="font-size: 8.5pt; color: #64748b;">Official Vendor Performance &amp; Rating Revision Notice</div>
            </div>
            <div style="font-size: 8.5pt; text-align: right; color: #64748b;">
              <div>Date: ${email.dispatchedAt}</div>
              <div>Audit: ${email.shaSignature.slice(0, 16)}</div>
            </div>
          </div>
          ${printableArea.innerHTML}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      printIframe.contentWindow?.focus();
      printIframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(printIframe);
      }, 1500);
    }, 300);
  };

  return (
    <div className="modal-overlay !z-[1100]">
      <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0 no-print">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
              <Star size={22} className="fill-amber-500 text-amber-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Vendor Rating Revision Email Notification
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Dispatched to Vendor
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Official rating update transmitted to supplier and synchronized across all enterprise buyers.
              </p>
            </div>
          </div>
          <button
            onClick={() => setRatingRevisionEmailModalOpen(false)}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Email Canvas */}
        <div id="printable-revision-email-content" className="overflow-y-auto my-4 space-y-4 pr-1 text-xs leading-relaxed">
          {/* Email Headers Meta */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950/80 border border-slate-200 dark:border-gray-800 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 dark:border-gray-800 pb-2.5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Subject:</span>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  Official Vendor Performance &amp; Rating Revision Notification - {email.buyerCompany}
                </h4>
              </div>
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/50 shrink-0 flex items-center gap-1">
                <Star size={11} className="fill-amber-500 text-amber-500" /> New: {email.newRating} ★
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-slate-400 font-semibold block text-[10px] uppercase">From (Reviewing Buyer):</span>
                <span className="font-bold text-slate-800 dark:text-gray-200">{email.buyerContactName} ({email.buyerCompany})</span>
                <span className="text-slate-500 dark:text-gray-400 block font-mono text-[10px]">{email.buyerContactEmail}</span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[10px] uppercase">To (Vendor Management):</span>
                <span className="font-bold text-slate-800 dark:text-gray-200">{email.vendorContactPerson} ({email.vendorName})</span>
                <span className="text-indigo-600 dark:text-indigo-400 block font-mono text-[10px] font-semibold">{email.vendorEmail}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/80 dark:border-gray-800 flex items-center justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <Clock size={11} /> Dispatched: <strong className="text-slate-700 dark:text-gray-300">{email.dispatchedAt}</strong>
              </span>
              <span className="font-mono bg-white dark:bg-gray-900 px-2 py-0.5 rounded border border-slate-200 dark:border-gray-800">
                Audit: {email.shaSignature.slice(0, 16)}...
              </span>
            </div>
          </div>

          {/* Letter Body */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs space-y-4">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">
                Dear {email.vendorContactPerson} / Team {email.vendorName},
              </p>
              <p className="text-slate-600 dark:text-gray-300 mt-2">
                This is an official communication from <strong>{email.buyerCompany}</strong> regarding a recent revision of your performance rating on the Procucev Enterprise Sourcing Network.
              </p>
            </div>

            {/* Performance Input Score Cards (Quality, Cost, Delivery) */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                1. Buyer Performance Input Scores (Out of 100)
              </span>
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Quality</span>
                  <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-0.5">{email.qualityScore} / 100</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Cost / Pricing</span>
                  <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{email.costScore} / 100</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">Delivery (OTIF)</span>
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5">{email.deliveryScore} / 100</div>
                </div>
              </div>
            </div>

            {/* Rating Calculation Reconciliation Box */}
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 via-indigo-50/40 to-slate-50 dark:from-gray-950 dark:via-indigo-950/20 dark:to-gray-950 border border-indigo-200/60 dark:border-indigo-900/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                  <Scale size={14} className="text-indigo-600 dark:text-indigo-400" />
                  2. Two-Tier Rating Averaging Formula:
                </span>
                <span className="text-[10px] font-mono font-bold text-indigo-700 dark:text-indigo-300">
                  Step 1: Avg(Q,C,D) → Step 2: Avg(Prev, BuyerAvg)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block">Buyer Input Average:</span>
                  <strong className="text-slate-800 dark:text-gray-200">
                    ({email.qualityScore} + {email.costScore} + {email.deliveryScore}) / 3 = <span className="text-indigo-600 font-bold">{email.buyerAverage}%</span>
                  </strong>
                </div>
                <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 block">Previous Rating:</span>
                  <strong className="text-slate-800 dark:text-gray-200">
                    {email.previousScore}% ({ (email.previousScore / 20).toFixed(1) } ★)
                  </strong>
                </div>
                <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800">
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold block">New Platform Rating:</span>
                  <strong className="text-emerald-800 dark:text-emerald-200 text-sm">
                    {email.newRating} / 5.0 ({email.newCompositeScore}%)
                  </strong>
                </div>
              </div>
            </div>

            {/* Buyer Remarks & Notes */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-1.5">
              <div className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5 text-[11px]">
                <MessageSquare size={13} className="text-indigo-600 dark:text-indigo-400" />
                <span>Buyer Remarks &amp; Feedback:</span>
              </div>
              <p className="text-slate-700 dark:text-gray-300 italic text-[11.5px] bg-white dark:bg-gray-900 p-2.5 rounded-lg border border-slate-200 dark:border-gray-800">
                &ldquo;{email.remarks}&rdquo;
              </p>
            </div>

            {/* Network Visibility Callout */}
            <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 text-[10.5px] text-slate-600 dark:text-gray-300 space-y-1">
              <div className="font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1">
                <ShieldCheck size={13} className="text-blue-600 dark:text-blue-400" />
                <span>Cross-Buyer Network Visibility Policy:</span>
              </div>
              <p>
                In accordance with Procucev governance guidelines, this updated aggregate rating has been updated in the master directory and is now visible to all enterprise buyers conducting supplier selection and automated RFQ priority dispatch.
              </p>
            </div>

            {/* Sign-off */}
            <div className="pt-2 border-t border-slate-200 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] text-slate-500">
              <div>
                <span className="font-bold text-slate-800 dark:text-gray-200">{email.buyerContactName}</span> · {email.buyerCompany}
                <div className="text-slate-400">Procucev Autonomous Sourcing Orchestration Engine</div>
              </div>
              <div className="font-mono text-[9px] text-slate-400 bg-slate-50 dark:bg-gray-950 px-2 py-1 rounded border border-slate-200 dark:border-gray-800">
                SHA-256: {email.shaSignature}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800 shrink-0 no-print">
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <Copy size={13} /> {copied ? 'Copied!' : 'Copy Email Text'}
            </button>
            <button
              onClick={handlePrint}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <Printer size={13} /> Print
            </button>
          </div>

          <button
            onClick={() => setRatingRevisionEmailModalOpen(false)}
            className="btn btn-primary btn-sm"
          >
            Done / Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
