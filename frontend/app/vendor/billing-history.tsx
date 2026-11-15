'use client';

import React, { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { Receipt, Download, AlertCircle, RefreshCw } from 'lucide-react';

interface PaymentLinkRecord {
  id: string;
  planId: string;
  amount: number | null;
  status: string;
  activated: boolean;
  createdAt: string;
  updatedAt: string;
}

const PLAN_LABEL: Record<string, string> = {
  connect: 'Connect Model',
  select: 'Select Model',
  growth: 'Growth Model',
  enterprise: 'Enterprise Model',
};

/**
 * Vendor Billing History: Displays all subscription payment transactions with
 * Payment Date, Transaction ID, Plan Name, Amount, GST (18%), Payment Status,
 * and Downloadable Receipts. Resolves the vendor record from session or 'me'.
 */
export default function VendorBillingHistory() {
  const { buyerVendors, showToast } = useApp();
  const [links, setLinks] = useState<PaymentLinkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const sessionUser = authClient.getSessionUser();
  const sessionEmail = sessionUser?.email?.toLowerCase();
  const myVendor = buyerVendors.find((v) => v.email?.toLowerCase() === sessionEmail);
  const vendorId = myVendor?.id || (sessionUser as { vendorId?: string } | null)?.vendorId || sessionUser?.id || 'me';

  useEffect(() => {
    if (!myVendor) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = authClient.getToken();
        const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/payment-links`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Could not load your billing history.');
        }
        if (!cancelled) setLinks(data.data || []);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : 'Could not load your billing history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myVendor, vendorId]);

  const handleDownload = async (link: PaymentLinkRecord) => {
    setDownloadingId(link.id);
    try {
      const token = authClient.getToken();
      const res = await fetch(
        `/api/vendors/${encodeURIComponent(vendorId)}/payment-links/${encodeURIComponent(link.id)}/invoice`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) throw new Error('Could not generate the receipt.');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `receipt-${link.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    } catch (err: unknown) {
      showToast(
        'Download Failed',
        err instanceof Error && err.message ? err.message : 'Could not generate the receipt.',
        'warning'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (!myVendor) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
        <AlertCircle size={28} className="mx-auto text-amber-500 mb-2" />
        <p className="text-sm text-slate-600 dark:text-gray-300">Could not find your vendor profile.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
          <Receipt size={20} />
        </div>
        <div>
          <h1 className="text-base font-extrabold text-slate-900 dark:text-white">Billing History</h1>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            Every subscription payment on your account, with a downloadable receipt
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-gray-400">
          <RefreshCw size={16} className="animate-spin text-emerald-600" /> Loading billing history…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {!loading && !error && links.length === 0 && (
        <div className="p-8 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <p className="text-sm text-slate-500 dark:text-gray-400">No payments yet. Upgrade your plan from Subscription Plans to see receipts here.</p>
        </div>
      )}

      {!loading && !error && links.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400 uppercase tracking-wider text-[10px] font-bold border-b border-slate-200 dark:border-gray-800">
                <tr>
                  <th className="text-left font-bold px-4 py-3">Payment Date</th>
                  <th className="text-left font-bold px-4 py-3">Transaction ID</th>
                  <th className="text-left font-bold px-4 py-3">Plan Name</th>
                  <th className="text-right font-bold px-4 py-3">Amount</th>
                  <th className="text-right font-bold px-4 py-3">GST (18%)</th>
                  <th className="text-center font-bold px-4 py-3">Payment Status</th>
                  <th className="text-right font-bold px-4 py-3">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {links.map((link) => {
                  const baseAmount = typeof link.amount === 'number' && Number.isFinite(link.amount) ? link.amount : null;
                  const gstAmount = baseAmount !== null ? baseAmount * 0.18 : null;
                  const dateStr = link.createdAt || link.updatedAt;

                  return (
                    <tr key={link.id} className="hover:bg-slate-50/60 dark:hover:bg-gray-850/40 transition-colors">
                      <td className="px-4 py-3 text-slate-600 dark:text-gray-300 whitespace-nowrap">
                        {dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-800 dark:text-gray-200 whitespace-nowrap">
                        {link.id}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {PLAN_LABEL[link.planId] || link.planId}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-gray-200 whitespace-nowrap">
                        {baseAmount !== null ? `₹${baseAmount.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 dark:text-gray-400 whitespace-nowrap">
                        {gstAmount !== null ? `₹${gstAmount.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            link.activated
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                        >
                          {link.activated ? 'Paid & Activated' : link.status || 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleDownload(link)}
                          disabled={downloadingId === link.id}
                          className="btn btn-ghost btn-sm inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <Download size={13} /> {downloadingId === link.id ? 'Preparing…' : 'Download'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
