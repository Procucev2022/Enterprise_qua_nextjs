'use client';

import React, { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { Receipt, Download, AlertCircle, RefreshCw } from 'lucide-react';

interface PaymentLinkRecord {
  id: string;
  planId: string;
  amount: number;
  status: string;
  activated: boolean;
  createdAt: string;
  updatedAt: string;
}

const PLAN_LABEL: Record<string, string> = {
  connect: 'Connect Model',
  select: 'Select Model',
};

/**
 * Read-only billing history for the signed-in vendor: every payment link this
 * app has ever created for them, with a real server-generated PDF receipt
 * available for each. Mirrors vendor-subscription.tsx's own-vendor
 * resolution (session email -> buyerVendors) rather than trusting any
 * client-held id, and rfq-details.tsx's fetch-with-auth-header-then-blob
 * pattern for the actual download (a plain `<a href>` can't carry the
 * session's Authorization header).
 */
export default function VendorBillingHistory() {
  const { buyerVendors, showToast } = useApp();
  const [links, setLinks] = useState<PaymentLinkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
  const myVendor = buyerVendors.find((v) => v.email?.toLowerCase() === sessionEmail);

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
        const res = await fetch(`/api/vendors/${encodeURIComponent(myVendor.id)}/payment-links`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Could not load your billing history.');
        }
        if (!cancelled) setLinks(data.data || []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load your billing history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myVendor?.id]);

  const handleDownload = async (link: PaymentLinkRecord) => {
    if (!myVendor) return;
    setDownloadingId(link.id);
    try {
      const token = authClient.getToken();
      const res = await fetch(
        `/api/vendors/${encodeURIComponent(myVendor.id)}/payment-links/${encodeURIComponent(link.id)}/invoice`,
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
    } catch (err: any) {
      showToast('Download Failed', err?.message || 'Could not generate the receipt.', 'warning');
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
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
          <Receipt size={18} />
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900 dark:text-white">Billing History</h1>
          <p className="text-xs text-slate-500 dark:text-gray-400">Every subscription payment on your account, with a downloadable receipt</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-gray-400">
          <RefreshCw size={16} className="animate-spin" /> Loading billing history…
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
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-gray-800/60 text-slate-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Plan</th>
                <th className="text-left font-semibold px-4 py-2.5">Amount</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Date</th>
                <th className="text-right font-semibold px-4 py-2.5">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
              {links.map((link) => (
                <tr key={link.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">
                    {PLAN_LABEL[link.planId] || link.planId}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 dark:text-gray-300">₹{Number(link.amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-2.5">
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
                  <td className="px-4 py-2.5 text-slate-500 dark:text-gray-400">
                    {link.updatedAt ? new Date(link.updatedAt).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => void handleDownload(link)}
                      disabled={downloadingId === link.id}
                      className="btn btn-ghost btn-sm inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Download size={13} /> {downloadingId === link.id ? 'Preparing…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
