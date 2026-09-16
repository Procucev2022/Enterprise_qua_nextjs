'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem, VendorEvaluationRecord } from '@/lib/types';
import {
  X,
  FileCheck,
  Send,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Download,
  Printer,
  Copy,
  KeyRound,
  Lock,
  UserCheck,
  Sliders,
  Hash,
  CreditCard,
} from 'lucide-react';

interface POLineItem {
  description: string;
  quantity: number;
  unit: string;
}

interface POModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqNumber: string;
  vendorId: string | null;
  vendorName: string;
  totalAmount: number;
  unitPrice: number;
  leadTime: number;
  deliveryDate: string;
  lineItems: POLineItem[];
}

export function PurchaseOrderModal({
  isOpen,
  onClose,
  rfqNumber,
  vendorId,
  vendorName,
  totalAmount,
  unitPrice,
  leadTime,
  deliveryDate,
  lineItems,
}: POModalProps) {
  const { approvePO } = useApp();
  const [poSigned, setPoSigned] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approverNotes, setApproverNotes] = useState('Approved based on AI Evaluation Matrix >94% match score & lowest compliant price.');
  // Populated from the real backend response once approval succeeds — shown
  // instead of the fake, hardcoded-constant "SHA-256 seal" this used to
  // display unconditionally (the same string regardless of what was
  // actually approved).
  const [approvedPo, setApprovedPo] = useState<{ poNumber: string; issueDate: string; shaSignature: string } | null>(null);

  if (!isOpen) return null;

  // Deterministic preview before approval — this formula matches the
  // backend's exactly, so it's accurate to show ahead of time; the real
  // hash and issue date, unlike the PO number, can't be known until the
  // backend actually seals them.
  const previewPoNumber = `PO-2026-` + rfqNumber.replace('RFQ-2026-', '');
  const poNumber = approvedPo?.poNumber || previewPoNumber;
  const issueDate = approvedPo?.issueDate || null;

  const handleApprove = async () => {
    setApproving(true);
    const result = await approvePO(rfqNumber, vendorId, vendorName, totalAmount, approverNotes);
    setApproving(false);
    if (result.success) {
      setPoSigned(true);
      setApprovedPo({
        poNumber: result.poNumber || previewPoNumber,
        issueDate: result.issueDate || new Date().toISOString().substring(0, 10),
        shaSignature: result.shaSignature || '',
      });
      setTimeout(() => {
        onClose();
      }, 1800);
    }
    // On failure, approvePO already surfaced a toast — stay open so the
    // buyer can retry rather than silently closing on a failed approval.
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
              <FileCheck size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Purchase Order Generation & Dispatch</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Formal Enterprise Contract Dispatch to ERP & Vendor Master</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        {/* PO Document Preview Canvas */}
        <div className="my-5 p-5 rounded-xl bg-slate-50 dark:bg-gray-950/80 border border-slate-200 dark:border-gray-800 text-xs space-y-4">
          <div className="flex justify-between items-start border-b border-slate-200 dark:border-gray-800 pb-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-bold">PROCUCEV ENTERPRISE BUYER</span>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">PURCHASE ORDER: {poNumber}</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Linked RFQ: <span className="mono text-indigo-600 dark:text-indigo-300 font-bold">{rfqNumber}</span></p>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 inline-flex items-center gap-1">
                <ShieldCheck size={12} /> AI Verified & Compliant
              </span>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">Issue Date: {issueDate || 'Sealed upon approval'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 py-2 border-b border-slate-200 dark:border-gray-800/80">
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Contract Awarded To:</p>
              <p className="font-bold text-slate-900 dark:text-white text-xs mt-0.5">{vendorName}</p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Vendor ID: <span className="mono font-semibold">{vendorId || '—'}</span></p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Payment Terms: Net 30 Days (Pre-negotiated)</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Delivery & Logistics:</p>
              <p className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5">Navi Mumbai Industrial Hub / CIF Site</p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Lead Time Commitment: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{leadTime} Days</span></p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Target Delivery: {deliveryDate}</p>
            </div>
          </div>

          {/* Line Items — the actual RFQ line items, not a hardcoded pump description */}
          <div>
            <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold mb-1.5">Line-Item Summary</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-100 dark:bg-gray-900/90 text-slate-600 dark:text-gray-400 text-[10px]">
                  <tr>
                    <th className="p-2">Item Description</th>
                    <th className="p-2 text-center">Qty</th>
                    <th className="p-2 text-center">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-700 dark:text-gray-300">
                  {lineItems.length > 0 ? (
                    lineItems.map((li, idx) => (
                      <tr key={idx}>
                        <td className="p-2">{li.description}</td>
                        <td className="p-2 text-center">{li.quantity}</td>
                        <td className="p-2 text-center">{li.unit}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="p-2 text-slate-400 italic" colSpan={3}>No structured line items on this RFQ.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 mt-2 text-[11px]">
              <span className="text-slate-500 dark:text-gray-400">Quoted Unit Price: <span className="font-bold text-slate-900 dark:text-white mono">₹{unitPrice.toLocaleString()}</span></span>
              <span className="text-slate-500 dark:text-gray-400">Quoted Total: <span className="font-bold text-slate-900 dark:text-white mono">₹{totalAmount.toLocaleString()}</span></span>
            </div>
          </div>

          {/* Cryptographic Audit Seal — only real once the backend has actually
              sealed this PO; previously a hardcoded constant shown even before
              approval, identical no matter what was approved. */}
          <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 flex items-start gap-2 text-[10px] text-slate-500 dark:text-gray-400 shadow-sm">
            <Hash size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-slate-800 dark:text-gray-300 font-semibold">Cryptographic Audit Seal (SHA-256):</span>
              {approvedPo?.shaSignature ? (
                <p className="mono text-indigo-700 dark:text-indigo-300 break-all select-all font-semibold">{approvedPo.shaSignature}</p>
              ) : (
                <p className="italic text-slate-400">Generated by the audit ledger once this PO is approved.</p>
              )}
            </div>
          </div>
        </div>

        {/* Approver Notes */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">Executive Approver Sign-off Note:</label>
          <input
            type="text"
            value={approverNotes}
            onChange={(e) => setApproverNotes(e.target.value)}
            className="w-full text-xs"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              title="Use your browser's print dialog to save as PDF"
              className="btn btn-secondary btn-sm"
            >
              <Download size={13} /> Export PDF
            </button>
            <button
              onClick={() => window.print()}
              className="btn btn-secondary btn-sm"
            >
              <Printer size={13} /> Print
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={poSigned || approving}
              className="btn btn-primary"
            >
              {poSigned ? (
                <>
                  <CheckCircle2 size={15} /> Dispatched to Vendor & ERP!
                </>
              ) : approving ? (
                <>Approving...</>
              ) : (
                <>
                  <ShieldCheck size={15} /> APPROVE & GENERATE PO
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MultiChannelChaserModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqNumber: string;
  vendorName: string;
  initialChannel?: 'call' | 'whatsapp' | 'sms';
}

export function MultiChannelChaserModal({
  isOpen,
  onClose,
  rfqNumber,
  vendorName,
  initialChannel = 'whatsapp',
}: MultiChannelChaserModalProps) {
  const { triggerChannelChaser } = useApp();
  const [selectedChannel, setSelectedChannel] = useState<'call' | 'whatsapp' | 'sms'>(initialChannel);
  const [phone, setPhone] = useState('+91 98201 44820');
  const [template, setTemplate] = useState('urgent_reminder');
  const [customMsg, setCustomMsg] = useState(
    `Hello ${vendorName}, this is Procucev Enterprise QUA AI. We require your line-item quotation for ${rfqNumber} within 24 hours to include in the comparative matrix. Click here to submit instantly: https://portal.procucev.com/bid/${rfqNumber}`
  );
  const [callScript, setCallScript] = useState(
    `"Hello, this is Procucev Autonomous Voice Bot calling on behalf of the Enterprise Buyer regarding ${rfqNumber}. We noticed your quote submission is pending. Can you confirm if you will submit by 4:00 PM today?"`
  );

  useEffect(() => {
    setSelectedChannel(initialChannel);
  }, [initialChannel]);

  if (!isOpen) return null;

  const handleSend = () => {
    triggerChannelChaser(rfqNumber, selectedChannel, vendorName, selectedChannel === 'call' ? callScript : customMsg);
    onClose();
  };

  return (
    <div className="modal-overlay !z-[1050]">
      <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-lg border ${
                selectedChannel === 'call'
                  ? 'bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30'
                  : selectedChannel === 'whatsapp'
                  ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                  : 'bg-sky-50 dark:bg-cyan-500/20 text-sky-600 dark:text-cyan-400 border-sky-200 dark:border-cyan-500/30'
              }`}
            >
              {selectedChannel === 'call' ? (
                <span className="text-base">📞</span>
              ) : selectedChannel === 'whatsapp' ? (
                <MessageSquare size={18} />
              ) : (
                <span className="text-base">📱</span>
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Dispatch AI Follow-Up ({selectedChannel.toUpperCase()})
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Multi-Channel Autonomous Supplier Outreach Engine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Channel Switcher Tabs */}
        <div className="grid grid-cols-3 gap-2 my-4 p-1 bg-slate-100 dark:bg-gray-800/80 rounded-xl">
          <button
            type="button"
            onClick={() => setSelectedChannel('call')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              selectedChannel === 'call'
                ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-sm border border-slate-200 dark:border-gray-700'
                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
            }`}
          >
            <span>📞</span> AI Voice Call
          </button>
          <button
            type="button"
            onClick={() => setSelectedChannel('whatsapp')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              selectedChannel === 'whatsapp'
                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-sm border border-slate-200 dark:border-gray-700'
                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
            }`}
          >
            <MessageSquare size={13} /> WhatsApp Bot
          </button>
          <button
            type="button"
            onClick={() => setSelectedChannel('sms')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              selectedChannel === 'sms'
                ? 'bg-white dark:bg-gray-900 text-sky-700 dark:text-cyan-300 shadow-sm border border-slate-200 dark:border-gray-700'
                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
            }`}
          >
            <span>📱</span> SMS Direct
          </button>
        </div>

        <div className="space-y-3.5 my-3 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
              Target Vendor & Phone Number
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={vendorName} readOnly className="opacity-80 font-medium" />
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {selectedChannel === 'call' ? (
            <div>
              <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                AI Voice Bot Conversation Script & Objective
              </label>
              <textarea
                rows={3}
                value={callScript}
                onChange={(e) => setCallScript(e.target.value)}
                className="w-full text-xs font-sans leading-relaxed"
              />
              <div className="p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 text-purple-900 dark:text-purple-200 mt-2 text-[11px] flex items-center gap-2">
                <span className="live-dot" />
                <span>AI will call supplier, detect intent, confirm lead time, and log audio transcript.</span>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                  Chasing Template
                </label>
                <select
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    if (e.target.value === 'urgent_reminder') {
                      setCustomMsg(
                        `Hello ${vendorName}, this is Procucev Enterprise QUA AI. We require your line-item quotation for ${rfqNumber} within 24 hours. Click to submit: https://portal.procucev.com/bid/${rfqNumber}`
                      );
                    } else {
                      setCustomMsg(
                        `Action Required: Procucev Buyer has prioritized ${rfqNumber}. Please upload your technical compliance sheet and unit prices immediately.`
                      );
                    }
                  }}
                >
                  <option value="urgent_reminder">Urgent RFQ Deadline Reminder (24h Window)</option>
                  <option value="technical_request">Technical Compliance & Specification Clarification</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                  Message Payload Preview ({selectedChannel === 'whatsapp' ? 'WhatsApp Payload' : 'SMS DLT Template'})
                </label>
                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    selectedChannel === 'whatsapp'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200'
                      : 'bg-sky-50 dark:bg-cyan-950/30 border-sky-200 dark:border-cyan-800/40 text-sky-900 dark:text-cyan-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase mb-1">
                    <span className="live-dot" /> PROCUCEV {selectedChannel.toUpperCase()} DISPATCH
                  </div>
                  <p>{customMsg}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            onClick={handleSend}
            className={`btn ${
              selectedChannel === 'call'
                ? 'btn-primary'
                : selectedChannel === 'whatsapp'
                ? 'btn-emerald'
                : 'btn-secondary text-sky-700 dark:text-cyan-300 border-sky-300 dark:border-cyan-500/40'
            }`}
          >
            {selectedChannel === 'call' ? (
              <>📞 Initiate AI Voice Call</>
            ) : selectedChannel === 'whatsapp' ? (
              <>
                <Send size={13} /> Send WhatsApp Chaser
              </>
            ) : (
              <>📱 Broadcast SMS Alert</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Backward compatibility export
export const WhatsAppChaserModal = MultiChannelChaserModal;

/* RFQ-WISE MULTI-CHANNEL FOLLOW-UP DEEP DIVE MODAL */
interface RFQFollowUpDeepDiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfq: RFQItem | null;
}

export function RFQFollowUpDeepDiveModal({ isOpen, onClose, rfq }: RFQFollowUpDeepDiveModalProps) {
  const { triggerChannelChaser, triggerBatchChannelChaser, showToast } = useApp();
  const [activeChannelTab, setActiveChannelTab] = useState<'all' | 'call' | 'whatsapp' | 'sms'>('all');
  const [activeVendorModal, setActiveVendorModal] = useState<{
    vendorName: string;
    channel: 'call' | 'whatsapp' | 'sms';
  } | null>(null);

  if (!isOpen || !rfq) return null;

  const followUp = rfq.followUpData;
  // A vendor invited straight onto assignedVendors (see
  // storeService.inviteVendorsToRFQ) never got the simulated chaser
  // dispatch's call/whatsapp/sms sub-objects built for it — every field
  // below assumes they always exist, which crashed the whole modal for
  // any such vendor. Normalized once here instead of guarding every
  // access site individually.
  const vendors = (followUp?.vendors || []).map((v) => ({
    ...v,
    call: v.call || { status: 'not_dispatched', lastAttempt: 'Not yet dispatched' },
    whatsapp: v.whatsapp || { status: 'not_dispatched', lastAttempt: 'Not yet dispatched' },
    sms: v.sms || { status: 'not_dispatched', lastAttempt: 'Not yet dispatched' },
  }));

  const filteredVendors = vendors.filter((v) => {
    if (activeChannelTab === 'all') return true;
    if (activeChannelTab === 'call') return v.call.status !== 'failed';
    if (activeChannelTab === 'whatsapp') return v.whatsapp.status !== 'failed';
    if (activeChannelTab === 'sms') return v.sms.status !== 'failed';
    return true;
  });

  const getCallBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-emerald">📞 Connected ({status})</span>;
      case 'connected':
        return <span className="badge badge-blue">📞 In Call</span>;
      case 'voicemail':
        return <span className="badge badge-amber">📞 Voicemail Left</span>;
      case 'scheduled':
        return <span className="badge badge-purple">📞 Callback Queued</span>;
      default:
        return <span className="badge badge-blue">📞 {status}</span>;
    }
  };

  const getWhatsAppBadge = (status: string) => {
    switch (status) {
      case 'replied':
        return <span className="badge badge-emerald">💬 Replied / Bid In</span>;
      case 'read':
        return <span className="badge badge-blue">💬 Read (Link Clicked)</span>;
      case 'delivered':
        return <span className="badge badge-amber">💬 Delivered</span>;
      case 'pending':
        return <span className="badge badge-purple">💬 Queued</span>;
      default:
        return <span className="badge badge-blue">💬 {status}</span>;
    }
  };

  const getSMSBadge = (status: string) => {
    switch (status) {
      case 'clicked':
        return <span className="badge badge-emerald">📱 Link Clicked</span>;
      case 'delivered':
        return <span className="badge badge-blue">📱 Delivered (DLT)</span>;
      case 'sent':
        return <span className="badge badge-amber">📱 Sent</span>;
      default:
        return <span className="badge badge-purple">📱 {status}</span>;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-4xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-md font-extrabold text-xs mono bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                {rfq.rfqNumber}
              </span>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                RFQ AI Follow-Up Telemetry & Deep Dive
              </h2>
              <span className="badge badge-purple">Multi-Channel</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-gray-300 mt-1 font-medium">
              {rfq.title} • <span className="text-slate-500 dark:text-gray-400">Target Delivery: {rfq.targetDeliveryDate}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* 4-Channel Live Metric Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-4">
          {/* Channel 1: Call (Voice Bot) */}
          <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-bold text-purple-900 dark:text-purple-300">
              <span className="flex items-center gap-1">
                <span>📞</span> VOICE CALLS
              </span>
              <span className="mono text-[10px] bg-purple-100 dark:bg-purple-900/60 px-1.5 py-0.5 rounded">
                Avg {followUp?.callStats.avgDuration || '1m 30s'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-xl font-black text-purple-950 dark:text-purple-100 mono">
                {followUp?.callStats.connected || 0} / {followUp?.callStats.total || 0}
              </span>
              <span className="text-[10px] text-purple-700 dark:text-purple-300 font-semibold">Connected</span>
            </div>
            <p className="text-[9px] text-purple-600 dark:text-purple-400 mt-0.5">
              Autonomous intent & transcript
            </p>
          </div>

          {/* Channel 2: WhatsApp */}
          <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900 dark:text-emerald-300">
              <span className="flex items-center gap-1">
                <MessageSquare size={13} /> WHATSAPP BOT
              </span>
              <span className="mono text-[10px] bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded">
                {followUp?.whatsappStats.read || 0} Read
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-xl font-black text-emerald-950 dark:text-emerald-100 mono">
                {followUp?.whatsappStats.replied || 0} / {followUp?.whatsappStats.total || 0}
              </span>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">Bids Submitted</span>
            </div>
            <p className="text-[9px] text-emerald-600 dark:text-emerald-400 mt-0.5">
              1-click bid links & receipts
            </p>
          </div>

          {/* Channel 3: SMS Direct */}
          <div className="p-3 rounded-xl bg-sky-50/60 dark:bg-cyan-950/20 border border-sky-200 dark:border-cyan-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-bold text-sky-900 dark:text-cyan-300">
              <span className="flex items-center gap-1">
                <span>📱</span> SMS ALERTS
              </span>
              <span className="mono text-[10px] bg-sky-100 dark:bg-cyan-900/60 px-1.5 py-0.5 rounded">
                DLT Verified
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-xl font-black text-sky-950 dark:text-cyan-100 mono">
                {followUp?.smsStats.delivered || 0} / {followUp?.smsStats.total || 0}
              </span>
              <span className="text-[10px] text-sky-700 dark:text-cyan-300 font-semibold">Delivered</span>
            </div>
            <p className="text-[9px] text-sky-600 dark:text-cyan-400 mt-0.5">
              Carrier priority sales alerts
            </p>
          </div>

          {/* Channel 4: 24h Email Reminder Escalation */}
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-955/20 border border-amber-200 dark:border-amber-800/40 relative overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 dark:text-amber-300">
              <span className="flex items-center gap-1">
                <span>✉️</span> 24H EMAIL REMINDER
              </span>
              <span className="mono text-[10px] bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded font-black">
                Next-Day
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-xl font-black text-amber-950 dark:text-amber-100 mono">
                {followUp?.emailStats?.sent24h || 2} / {followUp?.totalInvited || 5}
              </span>
              <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">Escalations Sent</span>
            </div>
            <p className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">
              Re-attaches RFQ BOQ if no SMS/Call/WA response in 24h
            </p>
          </div>
        </div>

        {/* 24-Hour Follow-Up Escalation Rule Banner */}
        <div className="p-3 rounded-xl bg-amber-50/90 dark:bg-amber-955/40 text-amber-900 dark:text-amber-200 border border-amber-250/60 dark:border-amber-800/60 text-xs flex items-center gap-2.5 shadow-xs mb-3">
          <span className="text-base shrink-0">⏳</span>
          <div className="leading-relaxed">
            <strong>Automated 24-Hour Chaser Rule</strong>: If a vendor does not respond to SMS (5m), Voice Call (6h), and WhatsApp (12h) within 24 hours of initial RFQ email, an automated <strong>24h Reminder Email</strong> is dropped the next day re-attaching the RFQ specifications & requesting immediate quotation submission.
          </div>
        </div>

        {/* Channel Filter & Batch Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-gray-800/90 p-1 rounded-xl">
            <button
              onClick={() => setActiveChannelTab('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                activeChannelTab === 'all'
                  ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Channels ({vendors.length})
            </button>
            <button
              onClick={() => setActiveChannelTab('call')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                activeChannelTab === 'call'
                  ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📞</span> Calls ({followUp?.callStats.total || 0})
            </button>
            <button
              onClick={() => setActiveChannelTab('whatsapp')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                activeChannelTab === 'whatsapp'
                  ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MessageSquare size={12} /> WhatsApp ({followUp?.whatsappStats.total || 0})
            </button>
            <button
              onClick={() => setActiveChannelTab('sms')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                activeChannelTab === 'sms'
                  ? 'bg-white dark:bg-gray-900 text-sky-700 dark:text-cyan-300 shadow-sm'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📱</span> SMS ({followUp?.smsStats.total || 0})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => triggerBatchChannelChaser(rfq.rfqNumber, ['call', 'whatsapp', 'sms'])}
              className="btn btn-primary btn-sm text-[11px] shadow-sm"
            >
              <Sparkles size={12} /> ⚡ Multi-Channel Chaser Broadcast (Call + WA + SMS)
            </button>
          </div>
        </div>

        {/* Vendor-by-Vendor Deep Dive List */}
        <div className="flex-1 overflow-y-auto my-3 space-y-3 pr-1">
          {filteredVendors.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-gray-500 text-xs">
              No vendors found for this channel filter.
            </div>
          ) : (
            filteredVendors.map((vendor) => (
              <div
                key={vendor.vendorId}
                className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950/70 border border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all text-xs space-y-3"
              >
                {/* Vendor Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-gray-800/80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                        {vendor.vendorName}
                      </span>
                      <span className="text-slate-500 dark:text-gray-400 text-xs mono">({vendor.phone})</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          vendor.overallStatus === 'Responded'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        }`}
                      >
                        {vendor.overallStatus} • Bid {vendor.bidStatus}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                      Contact: <span className="text-slate-700 dark:text-gray-300 font-medium">{vendor.contactPerson}</span> • Last Interaction: {vendor.lastInteraction} (Attempt #{vendor.attemptsCount})
                    </p>
                  </div>

                  {/* Channel Action Buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, channel: 'call' })
                      }
                      className="px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50 hover:bg-purple-100 font-semibold text-[11px] flex items-center gap-1"
                    >
                      <span>📞</span> Call
                    </button>
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, channel: 'whatsapp' })
                      }
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50 hover:bg-emerald-100 font-semibold text-[11px] flex items-center gap-1"
                    >
                      <MessageSquare size={11} /> WhatsApp
                    </button>
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, channel: 'sms' })
                      }
                      className="px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-cyan-900/40 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700/50 hover:bg-sky-100 font-semibold text-[11px] flex items-center gap-1"
                    >
                      <span>📱</span> SMS
                    </button>
                  </div>
                </div>

                {/* 4-Channel Status Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Call Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>📞</span> AI Voice Bot
                      </span>
                      {getCallBadge(vendor.call.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400 flex justify-between">
                      <span>Last Call: {vendor.call.lastAttempt}</span>
                      {vendor.call.duration && <span className="mono font-semibold">{vendor.call.duration}</span>}
                    </div>
                    {vendor.call.summary && (
                      <p className="text-[11px] text-slate-700 dark:text-gray-300 leading-snug">
                        {vendor.call.summary}
                      </p>
                    )}
                    {vendor.call.transcriptSnippet && (
                      <div className="p-2 rounded bg-slate-50 dark:bg-gray-950 border border-slate-100 dark:border-gray-800/80 text-[10px] text-indigo-700 dark:text-indigo-300 italic">
                        &ldquo;{vendor.call.transcriptSnippet}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* WhatsApp Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <MessageSquare size={12} className="text-emerald-500" /> WhatsApp Chaser
                      </span>
                      {getWhatsAppBadge(vendor.whatsapp.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      Dispatched: {vendor.whatsapp.lastAttempt}
                    </div>
                    {vendor.whatsapp.messagePreview && (
                      <p className="text-[11px] text-slate-700 dark:text-gray-300 leading-snug">
                        {vendor.whatsapp.messagePreview}
                      </p>
                    )}
                    {vendor.whatsapp.linkClicked !== undefined && (
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 size={11} /> {vendor.whatsapp.linkClicked ? 'Bid Sheet Link Clicked' : 'Delivered, Link Pending Click'}
                      </div>
                    )}
                  </div>

                  {/* SMS Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>📱</span> SMS Direct Alert
                      </span>
                      {getSMSBadge(vendor.sms.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      Status Date: {vendor.sms.lastAttempt}
                    </div>
                    <p className="text-[11px] text-slate-700 dark:text-gray-300 leading-snug">
                      Priority RFQ shortlink notification delivered to mobile gateway.
                    </p>
                    {vendor.sms.deliveryReport && (
                      <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-mono">
                        Gateway: {vendor.sms.deliveryReport}
                      </span>
                    )}
                  </div>

                  {/* 24h Email Reminder Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>✉️</span> 24h Email Reminder
                      </span>
                      {vendor.email24h?.is24hReminderSent ? (
                        <span className="badge badge-amber">✉️ Dispatched (+24h)</span>
                      ) : vendor.bidStatus === 'Submitted' || vendor.overallStatus === 'Responded' ? (
                        <span className="badge badge-emerald">✅ Bid Submitted</span>
                      ) : (
                        <span className="badge badge-purple">⏳ Pending 24h</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      {vendor.email24h?.lastAttempt ? `Sent: ${vendor.email24h.lastAttempt}` : 'Automated rule: Sent 24h after RFQ if no Call/WA/SMS response'}
                    </div>
                    <p className="text-[11px] text-slate-700 dark:text-gray-300 leading-snug">
                      {vendor.email24h?.is24hReminderSent
                        ? 'BOQ specs re-attached via email. Urgent bid submission requested.'
                        : 'Dispatches 24h post-RFQ if vendor fails to respond to Call/WA/SMS.'}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
          <div className="text-[11px] text-slate-500 dark:text-gray-400 flex items-center gap-2">
            <span className="live-dot" />
            <span>Next Automated Follow-Up Wave: <strong className="text-slate-800 dark:text-gray-200">{followUp?.nextScheduledChaser || 'Today 03:00 PM'}</strong></span>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Close Deep Dive
          </button>
        </div>
      </div>

      {/* Individual Vendor Multi-Channel Modal */}
      {activeVendorModal && (
        <MultiChannelChaserModal
          isOpen={!!activeVendorModal}
          onClose={() => setActiveVendorModal(null)}
          rfqNumber={rfq.rfqNumber}
          vendorName={activeVendorModal.vendorName}
          initialChannel={activeVendorModal.channel}
        />
      )}
    </div>
  );
}


interface SurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VendorSurveyModal({ isOpen, onClose }: SurveyModalProps) {
  const { showToast, addAuditLog } = useApp();
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleTriggerSurvey = () => {
    setSubmitting(true);
    setTimeout(() => {
      addAuditLog('Executed Global Override: Triggered Mode 3 Vendor Capability Survey to 24 pool suppliers');
      showToast('Mode 3 Survey Dispatched', 'AI evaluation survey sent to 24 suppliers. Scores will update autonomously upon response.', 'success');
      setSubmitting(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-purple-500/40">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30">
              <Sliders size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Mode 3 AI Vendor Survey</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Deep Capability Assessment & Scoring for High-Match Suppliers</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 my-4 text-xs">
          <p className="text-slate-600 dark:text-gray-300">
            This operational override dispatches an autonomous capability audit questionnaire to all prospective suppliers in the Procucev Network scoring &gt;80% match.
          </p>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Target Supplier Pool:</span>
              <span className="font-semibold text-slate-900 dark:text-white">24 High-Match Vendors</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Audit Criteria:</span>
              <span className="font-semibold text-purple-700 dark:text-purple-300">ISO 9001, ANSI, Delivery SLA, ESG</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Auto-Scoring Model:</span>
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">Llama 3 (8B Instruct) Multi-Factor</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button onClick={handleTriggerSurvey} disabled={submitting} className="btn btn-primary">
            <Sparkles size={14} /> {submitting ? 'Dispatching...' : 'Execute Mode 3 Survey'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SubscriptionPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  planName: string;
  price: string;
  /** Creates a real Zoho payment link for `planId` and resolves its redirect URL, or null on failure (a toast is already shown by the caller). */
  createPaymentLink: (planId: string) => Promise<string | null>;
}

/**
 * Real Zoho Payments checkout, shared by both the vendor and buyer
 * subscription screens (each passes its own `createPaymentLink` — vendor's
 * `createVendorPaymentLink` or buyer's `createBuyerPaymentLink` from
 * `useApp()`). This app never collects card details itself — on confirm it
 * asks the backend to create a Zoho payment link, then redirects the browser
 * to Zoho's own hosted payment page. The subscription is granted server-side
 * once Zoho's webhook (or the reconciliation poller) confirms the payment,
 * not by this modal.
 */
export function SubscriptionPaymentModal({ isOpen, onClose, planId, planName, price, createPaymentLink }: SubscriptionPaymentModalProps) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePay = async () => {
    setProcessing(true);
    setError(null);
    const paymentUrl = await createPaymentLink(planId);
    if (!paymentUrl) {
      setProcessing(false);
      setError('Could not start checkout. Please try again.');
      return;
    }
    window.location.href = paymentUrl;
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <CreditCard size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Secure Payment</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">You&apos;ll complete payment on Zoho&apos;s secure checkout page</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={processing}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 my-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-slate-500 dark:text-gray-400">Plan</span>
            <span className="font-bold text-slate-900 dark:text-white">{planName}</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-slate-500 dark:text-gray-400">Amount Due</span>
            <span className="font-black text-lg text-indigo-600 dark:text-indigo-400">{price}</span>
          </div>
          {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} disabled={processing} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button onClick={() => void handlePay()} disabled={processing} className="btn btn-primary">
            <CreditCard size={14} /> {processing ? 'Redirecting to secure payment…' : `Pay ${price}`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RbacModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RbacModal({ isOpen, onClose }: RbacModalProps) {
  const { showToast } = useApp();

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-purple-500/40">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <UserCheck size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Azure Active Directory & RBAC Matrix</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Role-Based Access Control Policies & Service Principals</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        <div className="my-4 space-y-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
            <div className="grid grid-cols-3 gap-2 font-semibold text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800 pb-2 mb-2">
              <span>Role Principle</span>
              <span>Permissions</span>
              <span>SSO MFA Policy</span>
            </div>
            <div className="space-y-2 text-slate-700 dark:text-gray-300">
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-indigo-700 dark:text-indigo-300">Enterprise Buyer</span>
                <span>Create RFQ, Approve PO</span>
                <span className="text-emerald-600 dark:text-emerald-400">Conditional Access</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-sky-700 dark:text-cyan-300">Category Manager</span>
                <span>Chaser Triggers, Overrides</span>
                <span className="text-emerald-600 dark:text-emerald-400">FIDO2 / Authenticator</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-emerald-700 dark:text-emerald-300">Vendor / Supplier</span>
                <span>Bid Submission, File Upload</span>
                <span className="text-emerald-600 dark:text-emerald-400">SMS OTP + Email Link</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-purple-700 dark:text-purple-300">Platform Auditor</span>
                <span>Read-Only Cryptographic Log</span>
                <span className="text-emerald-600 dark:text-emerald-400">Hardware Key Required</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
          <button
            onClick={() => {
              showToast('RBAC Policies Synchronized', 'Updated Azure Entra ID access matrix across all tenants.', 'success');
              onClose();
            }}
            className="btn btn-primary"
          >
            <ShieldCheck size={14} /> Sync Azure AD Roles
          </button>
        </div>
      </div>
    </div>
  );
}

interface EvaluationSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  record?: any;
}

export function VendorEvaluationSummaryModal({ isOpen, onClose, record }: EvaluationSummaryModalProps) {
  const { selectedVendorEvaluation } = useApp();
  if (!isOpen) return null;
  const evalRecord = record || selectedVendorEvaluation;

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-5xl p-6 max-h-[92vh] overflow-y-auto relative animate-scale-up">
        <div className="flex justify-end mb-2">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {evalRecord ? (
          <div className="space-y-4">
            {/* Inline import pattern or standalone summary render */}
            <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                  Mode 3 Vendor Evaluation Summary Report
                </span>
                <h3 className="text-xl font-bold mt-0.5">{evalRecord.vendorName}</h3>
                <p className="text-xs text-indigo-200/80 mt-0.5">{evalRecord.category} • Submitted: {evalRecord.submissionDate}</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black mono text-emerald-400">{evalRecord.overallScore}%</div>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-block mt-1">
                  {evalRecord.status}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-900 dark:text-emerald-200">
              ⚡ <strong>Automated System Execution Action:</strong> {evalRecord.systemAction}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Commercial Terms (25%)</div>
                  <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mono mt-0.5">{evalRecord.moduleScores?.commercial?.weightedScore || 24} / 25 pts</div>
                </div>
                <div className="p-2 rounded bg-indigo-50/70 dark:bg-indigo-950/40 text-[10px] text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.commercial?.remarks || 'Net 30 terms; 12-month fixed pricing with 5% volume tier discount.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Technical Specs (15%)</div>
                  <div className="text-lg font-bold text-sky-600 dark:text-cyan-400 mono mt-0.5">{evalRecord.moduleScores?.technical?.weightedScore || 13.5} / 15 pts</div>
                </div>
                <div className="p-2 rounded bg-sky-50/70 dark:bg-cyan-950/40 text-[10px] text-sky-900 dark:text-cyan-200 border border-sky-100 dark:border-cyan-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.technical?.remarks || '100% spec match; robotic CNC lines & accredited R&D lab.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Quality & Warranty (20%)</div>
                  <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mono mt-0.5">{evalRecord.moduleScores?.quality?.weightedScore || 18.4} / 20 pts</div>
                </div>
                <div className="p-2 rounded bg-emerald-50/70 dark:bg-emerald-950/40 text-[10px] text-emerald-900 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.quality?.remarks || 'ISO 9001:2015 verified; 350 PPM defect rate with 24m warranty & RFID.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Delivery OTIF (20%)</div>
                  <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mono mt-0.5">{evalRecord.moduleScores?.delivery?.weightedScore || 17.6} / 20 pts</div>
                </div>
                <div className="p-2 rounded bg-purple-50/70 dark:bg-purple-950/40 text-[10px] text-purple-900 dark:text-purple-200 border border-purple-100 dark:border-purple-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.delivery?.remarks || '96.4% OTIF delivery history; 10-day lead time & active BCP.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Financial Rating (10%)</div>
                  <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mono mt-0.5">{evalRecord.moduleScores?.financial?.weightedScore || 8} / 10 pts</div>
                </div>
                <div className="p-2 rounded bg-amber-50/70 dark:bg-amber-950/40 text-[10px] text-amber-900 dark:text-amber-200 border border-amber-100 dark:border-amber-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.financial?.remarks || 'Turnover 4.2x scope; CRISIL A+ rating with 1.6 current liquidity.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Governance & ESG (10%)</div>
                  <div className="text-lg font-bold text-rose-600 dark:text-rose-400 mono mt-0.5">{evalRecord.moduleScores?.governance?.weightedScore || 9.4} / 10 pts</div>
                </div>
                <div className="p-2 rounded bg-rose-50/70 dark:bg-rose-950/40 text-[10px] text-rose-900 dark:text-rose-200 border border-rose-100 dark:border-rose-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.governance?.remarks || '100% KYC verified; ISO 14001 & 45001 ESG certs with ISO 27001 GDPR.'}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2 text-xs">
              <div className="font-bold text-slate-800 dark:text-gray-200">Verified Statutory PDFs & Certifications</div>
              <div className="space-y-1.5">
                {(evalRecord.documents || []).map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-2 rounded bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-gray-200">{doc.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ {doc.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
              <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
              <button onClick={onClose} className="btn btn-primary btn-sm"><Download size={13} /> Download Report (PDF)</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

