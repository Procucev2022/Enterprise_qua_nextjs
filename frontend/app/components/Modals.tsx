'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/lib/store';
import { RFQItem, VendorEvaluationRecord, QuoteComparison, VendorFollowUpRecord, VendorModuleScore } from '@/lib/types';
import { SOURCING_MODES, VENDOR_QUOTATION_ROUTE, formatIndianDateTime, isBuyerQuotesSealed } from '@/lib/constants';
import { computeRFQFollowUpTimes, computeRFQFollowUpMetrics, normalizeFollowUpVendors } from '@/lib/followUpSchedule';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
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
  Sliders,
  CreditCard,
  FileText,
  Clock,
  Mail,
  UploadCloud,
  FileSpreadsheet,
  Phone,
  Smartphone,
  ChevronRight,
  Search,
  Layers,
  TrendingUp,
  Tag,
  Building2,
  Calendar,
  ExternalLink,
  Filter,
  Check,
  Info,
  Eye,
  Radio,
  ChevronLeft,
  ArrowUpDown,
} from 'lucide-react';

interface POLineItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalPrice?: number;
  technicalSpecs?: string;
}

interface POModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinalized?: (poNumber: string) => void;
  rfqNumber: string;
  vendorId: string | null;
  vendorName: string;
  totalAmount: number;
  unitPrice: number;
  leadTime: number;
  deliveryDate: string;
  lineItems: POLineItem[];
  rfq?: RFQItem | null;
  quote?: QuoteComparison | null;
  buyerAccount?: any;
  vendorRecord?: any;
}

// Helper to convert numbers into Indian Rupees currency words
export function numberToIndianWords(num: number): string {
  if (typeof num !== 'number' || isNaN(num) || !isFinite(num) || num <= 0 || num > 99999999999) return '';
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n: number): string {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
  }

  function convertThreeDigits(n: number): string {
    let str = '';
    if (Math.floor(n / 100) > 0) {
      str += a[Math.floor(n / 100)] + ' Hundred';
      if (n % 100 !== 0) str += ' and ';
    }
    if (n % 100 !== 0) {
      str += convertTwoDigits(n % 100);
    }
    return str;
  }

  const rounded = Math.round(num);
  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const remainder = rounded % 1000;

  let words = '';
  if (crore > 0) words += convertTwoDigits(crore) + ' Crore ';
  if (lakh > 0) words += convertTwoDigits(lakh) + ' Lakh ';
  if (thousand > 0) words += convertTwoDigits(thousand) + ' Thousand ';
  if (remainder > 0) words += convertThreeDigits(remainder);

  words = words.trim();
  return words ? `Rupees ${words} Only` : '';
}

/** Quoted amount for display. A quote with no recorded price shows the not-available placeholder, never zero. */
function formatQuotedPrice(quote: QuoteComparison): string {
  const amount = quote.totalPrice || quote.unitPrice;
  return amount ? `₹${amount.toLocaleString()}` : UI_STRINGS.recordPlaceholders.notAvailable;
}

/** Rupee amount on the purchase order. An amount the quote does not record shows the not-available placeholder, never zero. */
function formatPoAmount(amount: number | null): string {
  return amount === null ? UI_STRINGS.recordPlaceholders.notAvailable : `₹${amount.toLocaleString('en-IN')}`;
}

/** Follow-up count for display. A count the server did not send shows the not-available placeholder, never zero. */
function formatFollowUpCount(count: number | null | undefined): string {
  return typeof count === 'number' && Number.isFinite(count) ? String(count) : UI_STRINGS.recordPlaceholders.notAvailable;
}

/** Module score for the evaluation report. A module with no weighted score shows the not-evaluated placeholder, never a substitute number. */
function formatModuleScore(moduleScore: VendorModuleScore | undefined): string {
  const weighted = moduleScore?.weightedScore;
  if (typeof weighted !== 'number' || !Number.isFinite(weighted)) return UI_STRINGS.recordPlaceholders.notEvaluated;
  const max = moduleScore?.maxScore;
  return typeof max === 'number' && Number.isFinite(max)
    ? formatString(UI_STRINGS.modals.evaluation.scoreWithMax, { score: weighted, maxScore: max })
    : formatString(UI_STRINGS.modals.evaluation.scoreOnly, { score: weighted });
}

/** GST label for the subscription breakdown. The rate appears only when the pricing data supplies one. */
function gstLabelFor(gstPercent: number | undefined): string {
  if (typeof gstPercent !== 'number' || !Number.isFinite(gstPercent)) return UI_STRINGS.modals.subscriptionPayment.gstLabel;
  return formatString(UI_STRINGS.modals.subscriptionPayment.gstLabelWithRate, { gstPercent });
}

/**
 * Vendor quotation link for an RFQ, on the origin that serves this portal. Empty when there is no
 * window (server render), so the link is left out rather than guessed.
 */
function buildVendorQuotationLink(rfqNumber: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${VENDOR_QUOTATION_ROUTE}?rfq=${encodeURIComponent(rfqNumber)}`;
}

/** Urgent chaser text. The quotation link is included only when it can be built. */
function buildUrgentReminderMessage(vendorName: string, rfqNumber: string): string {
  const quotationLink = buildVendorQuotationLink(rfqNumber);
  return quotationLink
    ? formatString(UI_STRINGS.modals.chaser.urgentReminderWithLink, { vendorName, rfqNumber, quotationLink })
    : formatString(UI_STRINGS.modals.chaser.urgentReminderWithoutLink, { vendorName, rfqNumber });
}

/** AI voice bot script. It names no deadline, because the buyer's RFQ deadline is not passed to this modal. */
function buildCallScript(rfqNumber: string): string {
  return formatString(UI_STRINGS.modals.chaser.callScript, { rfqNumber });
}

export function PurchaseOrderModal({
  isOpen,
  onClose,
  onFinalized,
  rfqNumber,
  vendorId,
  vendorName,
  totalAmount,
  unitPrice,
  leadTime,
  deliveryDate,
  lineItems = [],
  rfq,
  quote,
  buyerAccount,
  vendorRecord,
}: POModalProps) {
  let router: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }
  const { approvePO, showToast } = useApp();
  const [poSigned, setPoSigned] = useState(false);
  const [approving, setApproving] = useState(false);
  // The approver writes the sign-off note. No default note is supplied, so none is sent unless the approver types one.
  const [approverNotes, setApproverNotes] = useState('');
  const [approvedPo, setApprovedPo] = useState<{ poNumber: string; issueDate: string; shaSignature: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Buyer Details Mapping (strictly real content, no substitute values)
  const buyerOrg = buyerAccount?.organizationName || (buyerAccount as any)?.name || rfq?.buyerAccountName || rfq?.buyerCompany || '';
  const buyerContactPerson = buyerAccount?.contactPerson || rfq?.buyerName || (rfq as any)?.buyerContactPerson || '';
  const buyerEmail = buyerAccount?.corporateEmail || (buyerAccount as any)?.email || rfq?.buyerEmail || rfq?.sourceEmail || '';
  const buyerPhone = buyerAccount?.contactPhone || buyerAccount?.phone || rfq?.buyerContact || (rfq as any)?.buyerPhone || '';
  const addressParts = [
    buyerAccount?.address,
    buyerAccount?.city,
    buyerAccount?.state,
    buyerAccount?.pincode,
  ].filter(Boolean);
  const buyerAddress = addressParts.length > 0 ? addressParts.join(', ') : (rfq?.deliveryLocation || '');
  const buyerGstin = buyerAccount?.taxId || (buyerAccount as any)?.gstin || (rfq as any)?.buyerGstin || '';

  // Vendor Details Mapping (strictly real content, no substitute values)
  const awardedVendorName = vendorName || quote?.vendorName || vendorRecord?.name || '';
  const awardedVendorContact = vendorRecord?.contactPerson || (quote as any)?.contactPerson || (quote as any)?.vendorContact || '';
  const awardedVendorEmail = vendorRecord?.email || (quote as any)?.vendorEmail || (quote as any)?.email || '';
  const awardedVendorPhone = vendorRecord?.phone || (vendorRecord as any)?.contactPhone || (quote as any)?.vendorPhone || '';
  const vendorAddressParts = [
    vendorRecord?.address,
    vendorRecord?.city,
    vendorRecord?.state,
    vendorRecord?.pincode,
  ].filter(Boolean);
  const awardedVendorAddress = vendorAddressParts.length > 0
    ? vendorAddressParts.join(', ')
    : (vendorRecord?.location || (quote as any)?.vendorAddress || (quote as any)?.location || '');
  const awardedVendorGstin = vendorRecord?.gstin || vendorRecord?.taxId || (quote as any)?.gstin || '';

  // RFQ & Commercial Terms
  const rfqTitle = rfq?.title || UI_STRINGS.recordPlaceholders.notRecorded;
  const rfqCategory = rfq?.category || '';
  const paymentTerms = quote?.paymentTerms || UI_STRINGS.recordPlaceholders.notRecorded;
  const warranty = quote?.warrantyYears ? `${quote.warrantyYears} Year(s) Manufacturer Warranty` : '';
  const deliveryLocation = rfq?.deliveryLocation || buyerAddress || '';
  const targetDeliveryDate = deliveryDate || rfq?.targetDeliveryDate || '';
  const effectiveLeadTime = leadTime || quote?.leadTimeDays || '';

  // Helper to filter out placeholder specification labels that carry no real specification
  const isPlaceholderSpec = (s: string) => {
    const lower = (s || '').trim().toLowerCase();
    return (
      !lower ||
      lower === 'standard specification' ||
      lower === 'standard enterprise specification' ||
      lower === 'industrial grade'
    );
  };

  // Items breakdown: support multi-item line quotes or single line fallback. A quantity, rate or total the
  // record does not hold stays null, so the document shows it as not available instead of a substitute value.
  const itemsWithPricing = useMemo(() => {
    if (quote?.lineItemQuotes && quote.lineItemQuotes.length > 0) {
      return quote.lineItemQuotes.map((lq, idx) => {
        const rawSpecs = lineItems[idx]?.technicalSpecs || (lq as any).technicalSpecs || '';
        const specs = isPlaceholderSpec(rawSpecs) ? '' : rawSpecs.trim();
        const quantity = lq.quantity || lineItems[idx]?.quantity || null;
        const lineRate = lq.unitPrice || null;
        return {
          id: lq.lineItemId || `item-${idx + 1}`,
          description: lq.itemName || lineItems[idx]?.description || UI_STRINGS.recordPlaceholders.notRecorded,
          quantity,
          unit: lineItems[idx]?.unit || lq.unit || UI_STRINGS.recordPlaceholders.notRecorded,
          unitPrice: lineRate,
          totalPrice: lq.totalPrice || (lineRate !== null && quantity !== null ? lineRate * quantity : null),
          specs,
        };
      });
    }
    if (lineItems.length > 0) {
      return lineItems.map((li, idx) => {
        const rawSpecs = li.technicalSpecs || '';
        const specs = isPlaceholderSpec(rawSpecs) ? '' : rawSpecs.trim();
        const quantity = li.quantity || null;
        // Without a recorded rate, the rate is derived from the total when the quantity is known.
        const derivedRate = quantity !== null
          ? (totalAmount ? Math.round(totalAmount / quantity) : null)
          : (unitPrice || totalAmount || null);
        const lineRate = li.unitPrice || derivedRate;
        return {
          id: (li as any).id || `item-${idx + 1}`,
          description: li.description || UI_STRINGS.recordPlaceholders.notRecorded,
          quantity,
          unit: li.unit || UI_STRINGS.recordPlaceholders.notRecorded,
          unitPrice: lineRate,
          totalPrice: li.totalPrice || (lineRate !== null && quantity !== null ? lineRate * quantity : null),
          specs,
        };
      });
    }
    return [{
      id: 'item-1',
      description: rfqTitle,
      quantity: null,
      unit: UI_STRINGS.recordPlaceholders.notRecorded,
      unitPrice: unitPrice || totalAmount || null,
      totalPrice: totalAmount || unitPrice || null,
      specs: '',
    }];
  }, [quote, lineItems, totalAmount, unitPrice, rfqTitle]);

  // Taxes and totals. The subtotal is the recorded total, or the sum of the line totals that are known.
  // It stays null when neither exists, so it is never shown as zero.
  const knownLineTotals = itemsWithPricing
    .map((item) => item.totalPrice)
    .filter((total): total is number => total !== null);
  const subTotal: number | null = totalAmount || (knownLineTotals.length > 0 ? knownLineTotals.reduce((sum, total) => sum + total, 0) : null);
  // GST defaults to 18% when not explicitly recorded in the quote
  const DEFAULT_GST_RATE = 0.18;
  const gstAmount: number | null = subTotal === null ? null : (quote?.taxes && quote.taxes > 0 ? quote.taxes : Math.round(subTotal * DEFAULT_GST_RATE));
  const gstRate: number | null = quote?.taxes && quote.taxes > 0 && subTotal !== null && subTotal > 0 ? Math.round((quote.taxes / subTotal) * 100) : 18;
  const grandTotal: number | null = gstAmount === null || subTotal === null ? null : subTotal + gstAmount;
  const grandTotalInWords = grandTotal === null ? '' : numberToIndianWords(grandTotal);

  if (!isOpen) return null;

  // The PO number comes from the server only. Until the server issues one, the document says so.
  const poNumber = approvedPo?.poNumber || rfq?.poNumber || '';
  const displayPoNumber = poNumber || UI_STRINGS.modals.purchaseOrder.notIssuedYet;
  const issueDate = approvedPo?.issueDate || rfq?.poIssueDate || null;

  const handleApprove = async () => {
    if (!vendorName || !totalAmount) {
      showToast('Validation Error', 'Vendor name and total amount are required.', 'warning');
      return;
    }
    setApproving(true);
    const result = await approvePO(rfqNumber, vendorId, vendorName, totalAmount, approverNotes);
    setApproving(false);
    if (result.success) {
      setPoSigned(true);
      const finalPoNum = result.poNumber || '';
      setApprovedPo({
        poNumber: finalPoNum,
        issueDate: result.issueDate || '',
        shaSignature: result.shaSignature || '',
      });
      showToast(
        'Pre-Purchase Order Finalised',
        finalPoNum
          ? formatString(UI_STRINGS.modals.purchaseOrder.finalisedToast, { poNumber: finalPoNum, vendorName })
          : formatString(UI_STRINGS.modals.purchaseOrder.finalisedWithoutNumberToast, { vendorName }),
        'success'
      );
      setTimeout(() => {
        onClose();
        if (onFinalized) {
          onFinalized(finalPoNum);
        } else if (router) {
          router.push(`/buyer/rfq-details?rfq=${encodeURIComponent(rfqNumber)}`);
        }
      }, 1500);
    }
  };

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=1100');
    if (!printWindow) {
      window.print();
      return;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Pre-Purchase Order - ${displayPoNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; line-height: 1.5; font-size: 13px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; }
    .logo-title { font-size: 20px; font-weight: 800; color: #0369a1; text-transform: uppercase; letter-spacing: 0.5px; }
    .po-badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 9999px; font-weight: 700; font-size: 11px; margin-top: 4px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .card-title { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 8px; }
    .card-text { font-size: 12px; margin: 3px 0; color: #1e293b; }
    .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .table th { background: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; padding: 10px 12px; border: 1px solid #cbd5e1; text-align: left; }
    .table td { padding: 10px 12px; border: 1px solid #e2e8f0; font-size: 12px; }
    .table td.right, .table th.right { text-align: right; }
    .table td.center, .table th.center { text-align: center; }
    .totals-table { width: 380px; margin-left: auto; border-collapse: collapse; margin-bottom: 24px; }
    .totals-table td { padding: 6px 12px; font-size: 12px; }
    .totals-table tr.grand-total td { font-size: 14px; font-weight: 800; color: #0369a1; border-top: 2px solid #cbd5e1; }
    .terms-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; font-size: 11px; }
    .terms-conditions-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; }
    .terms-conditions-card ol { margin: 0; padding-left: 18px; color: #334155; font-size: 10.5px; line-height: 1.6; }
    .terms-conditions-card li { margin-bottom: 4px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 36px; padding-top: 16px; }
    .sig-line { border-top: 1px solid #94a3b8; padding-top: 8px; font-size: 11px; color: #475569; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo-title">PROCUCEV ENTERPRISE</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Autonomous Procurement & SCM Intelligence</div>
      <div class="po-badge">OFFICIAL PRE-PURCHASE ORDER</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 16px; font-weight: 800; color: #0f172a;">${displayPoNumber}</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Linked RFQ: <strong>${rfqNumber}</strong></div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Issue Date: <strong>${issueDate || UI_STRINGS.modals.purchaseOrder.notIssuedYet}</strong></div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">BUYER / ISSUING ENTITY</div>
      <div class="card-text" style="font-weight: 700; font-size: 13px;">${buyerOrg || UI_STRINGS.recordPlaceholders.notRecorded}</div>
      ${buyerContactPerson ? `<div class="card-text">Attn: ${buyerContactPerson}</div>` : ''}
      ${buyerEmail ? `<div class="card-text">Email: ${buyerEmail}</div>` : ''}
      ${buyerPhone ? `<div class="card-text">Phone: ${buyerPhone}</div>` : ''}
      ${buyerAddress ? `<div class="card-text">Address: ${buyerAddress}</div>` : ''}
      ${buyerGstin ? `<div class="card-text">GSTIN: <strong>${buyerGstin}</strong></div>` : ''}
    </div>
    <div class="card">
      <div class="card-title">VENDOR / CONTRACTOR</div>
      <div class="card-text" style="font-weight: 700; font-size: 13px;">${awardedVendorName || UI_STRINGS.recordPlaceholders.notRecorded}</div>
      ${awardedVendorContact ? `<div class="card-text">Contact: ${awardedVendorContact}</div>` : ''}
      ${awardedVendorEmail ? `<div class="card-text">Email: ${awardedVendorEmail}</div>` : ''}
      ${awardedVendorPhone ? `<div class="card-text">Phone: ${awardedVendorPhone}</div>` : ''}
      ${awardedVendorAddress ? `<div class="card-text">Address: ${awardedVendorAddress}</div>` : ''}
      ${awardedVendorGstin ? `<div class="card-text">GSTIN: <strong>${awardedVendorGstin}</strong></div>` : ''}
    </div>
  </div>

  <table class="table">
    <thead>
      <tr>
        <th style="width: 40px;" class="center">#</th>
        <th>Item Description & Specification</th>
        <th class="center" style="width: 80px;">Qty</th>
        <th class="center" style="width: 70px;">Unit</th>
        <th class="right" style="width: 120px;">Unit Rate (INR)</th>
        <th class="right" style="width: 130px;">Total (INR)</th>
      </tr>
    </thead>
    <tbody>
      ${itemsWithPricing.map((item, idx) => `
        <tr>
          <td class="center">${idx + 1}</td>
          <td>
            <strong>${item.description}</strong>
            ${item.specs ? `<div style="font-size: 10px; color: #64748b; margin-top: 2px;">Specs: ${item.specs}</div>` : ''}
          </td>
          <td class="center font-mono">${item.quantity ?? UI_STRINGS.recordPlaceholders.notRecorded}</td>
          <td class="center">${item.unit}</td>
          <td class="right font-mono">${formatPoAmount(item.unitPrice)}</td>
          <td class="right font-mono" style="font-weight: 700;">${formatPoAmount(item.totalPrice)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <table class="totals-table">
    <tr>
      <td style="color: #64748b;">Subtotal (Base Value):</td>
      <td class="right font-mono" style="font-weight: 600;">${formatPoAmount(subTotal)}</td>
    </tr>
    <tr>
      <td style="color: #64748b;">GST / Taxes (${gstRate !== null ? `${gstRate}%` : UI_STRINGS.recordPlaceholders.notAvailable}):</td>
      <td class="right font-mono" style="font-weight: 600;">${gstAmount !== null ? `₹${gstAmount.toLocaleString('en-IN')}` : UI_STRINGS.recordPlaceholders.notAvailable}</td>
    </tr>
    <tr class="grand-total">
      <td>Grand Total (INR):</td>
      <td class="right font-mono">${grandTotal !== null ? `₹${grandTotal.toLocaleString('en-IN')}` : UI_STRINGS.recordPlaceholders.notAvailable}</td>
    </tr>
    ${grandTotalInWords ? `
    <tr>
      <td colspan="2" style="font-size: 11px; color: #334155; padding-top: 8px; text-align: right;">
        <strong>Amount in Words:</strong> <em>${grandTotalInWords}</em>
      </td>
    </tr>` : ''}
  </table>

  <div class="terms-card">
    <div style="font-weight: 700; color: #166534; margin-bottom: 6px;">COMMERCIAL TERMS & LOGISTICS CONDITIONS</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div>• <strong>Payment Terms:</strong> ${paymentTerms}</div>
      <div>• <strong>Delivery Lead Time:</strong> ${effectiveLeadTime ? `${effectiveLeadTime} Days from PO Acceptance` : UI_STRINGS.recordPlaceholders.notRecorded}</div>
      ${deliveryLocation ? `<div>• <strong>Delivery Location:</strong> ${deliveryLocation}</div>` : ''}
      ${warranty ? `<div>• <strong>Warranty / Guarantee:</strong> ${warranty}</div>` : ''}
      ${targetDeliveryDate ? `<div>• <strong>Target Delivery Date:</strong> ${targetDeliveryDate}</div>` : ''}
    </div>
  </div>

  <div class="terms-conditions-card">
    <div style="font-weight: 700; color: #0f172a; margin-bottom: 8px; font-size: 11px; text-transform: uppercase;">Standard Purchase Order Terms & Conditions</div>
    <ol>
      <li><strong>Order Acceptance:</strong> This Purchase Order (PO) constitutes a binding commercial agreement upon vendor acknowledgement or commencement of fulfillment.</li>
      <li><strong>Quality & Inspection:</strong> Goods and services supplied must strictly conform to the approved specifications, quantities, and quality requirements. The buyer reserves the right to inspect and reject defective or non-conforming items.</li>
      <li><strong>Delivery Schedule:</strong> Deliveries must be made to the designated site on or before the agreed delivery lead time. Timely delivery is of the essence.</li>
      <li><strong>Invoicing & Documentation:</strong> Invoices, delivery challans, and e-way bills must clearly quote this Purchase Order number, line items, and statutory GSTIN details.</li>
      <li><strong>Payment Terms:</strong> Payments shall be processed as per agreed commercial terms upon satisfactory delivery, physical inspection, and verification of invoice.</li>
      <li><strong>Tax & Statutory Compliance:</strong> Vendor shall ensure timely filing of GST returns (GSTR-1) and compliance with all statutory regulations to ensure input tax credit eligibility for the buyer.</li>
      <li><strong>Warranty & Defect Liability:</strong> Vendor warrants all supplies against defects in material, design, and workmanship for the specified warranty period and agrees to replace or repair any defective items without additional cost.</li>
    </ol>
  </div>

  <div class="signatures">
    <div>
      <div class="sig-line">
        <strong>Authorized Signatory — Buyer</strong><br />
        ${buyerContactPerson ? `${buyerContactPerson}<br />` : ''}
        ${buyerOrg || UI_STRINGS.recordPlaceholders.notRecorded}
      </div>
    </div>
    <div>
      <div class="sig-line" style="text-align: right;">
        <strong>Accepted & Acknowledged — Vendor</strong><br />
        ${awardedVendorContact ? `${awardedVendorContact}<br />` : ''}
        ${awardedVendorName || UI_STRINGS.recordPlaceholders.notRecorded}
      </div>
    </div>
  </div>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content max-w-3xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
              <FileCheck size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Pre-Purchase Order Generation & Dispatch</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Formal Enterprise Contract Dispatch to ERP & Vendor Master</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        {/* PO Document Preview Canvas */}
        <div className="my-5 p-5 rounded-xl bg-slate-50 dark:bg-gray-950/80 border border-slate-200 dark:border-gray-800 text-xs space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="flex justify-between items-start border-b border-slate-200 dark:border-gray-800 pb-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-bold">PROCUCEV ENTERPRISE BUYER</span>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">PRE-PURCHASE ORDER: {displayPoNumber}</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Linked RFQ: <span className="mono text-indigo-600 dark:text-indigo-300 font-bold">{rfqNumber}</span></p>
            </div>
            <div className="text-right">
              {approvedPo?.shaSignature ? (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 inline-flex items-center gap-1">
                  <ShieldCheck size={12} /> {UI_STRINGS.modals.purchaseOrder.sealedBadge}
                </span>
              ) : null}
              <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">Issue Date: {issueDate || UI_STRINGS.modals.purchaseOrder.notIssuedYet}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2 border-b border-slate-200 dark:border-gray-800/80">
            <div className="space-y-1">
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Issuing Buyer Entity:</p>
              <p className="font-bold text-slate-900 dark:text-white text-xs">{buyerOrg || UI_STRINGS.recordPlaceholders.notRecorded}</p>
              {buyerContactPerson && <p className="text-[11px] text-slate-600 dark:text-gray-300">Attn: <strong>{buyerContactPerson}</strong></p>}
              {buyerEmail && <p className="text-[11px] text-slate-500 dark:text-gray-400">Email: {buyerEmail}</p>}
              {buyerPhone && <p className="text-[11px] text-slate-500 dark:text-gray-400">Phone: {buyerPhone}</p>}
              {buyerAddress && <p className="text-[11px] text-slate-500 dark:text-gray-400">Location: {buyerAddress}</p>}
              {buyerGstin && <p className="text-[11px] text-slate-500 dark:text-gray-400">GSTIN: <span className="mono font-semibold">{buyerGstin}</span></p>}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Contract Awarded To:</p>
              <p className="font-bold text-slate-900 dark:text-white text-xs">{awardedVendorName || UI_STRINGS.recordPlaceholders.notRecorded}</p>
              {awardedVendorContact && <p className="text-[11px] text-slate-600 dark:text-gray-300">Contact: <strong>{awardedVendorContact}</strong></p>}
              {awardedVendorEmail && <p className="text-[11px] text-slate-500 dark:text-gray-400">Email: {awardedVendorEmail}</p>}
              {awardedVendorPhone && <p className="text-[11px] text-slate-500 dark:text-gray-400">Phone: {awardedVendorPhone}</p>}
              {awardedVendorAddress && <p className="text-[11px] text-slate-500 dark:text-gray-400">Address: {awardedVendorAddress}</p>}
              {awardedVendorGstin && <p className="text-[11px] text-slate-500 dark:text-gray-400">GSTIN: <span className="mono font-semibold">{awardedVendorGstin}</span></p>}
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Payment Terms: <strong>{paymentTerms}</strong></p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2 border-b border-slate-200 dark:border-gray-800/80">
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Delivery & Logistics:</p>
              {deliveryLocation && <p className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5">{deliveryLocation}</p>}
              {targetDeliveryDate && <p className="text-[11px] text-slate-500 dark:text-gray-400">Target Delivery: <strong>{targetDeliveryDate}</strong></p>}
              {effectiveLeadTime && (
                <p className="text-[11px] text-slate-500 dark:text-gray-400">
                  Lead Time Commitment: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{effectiveLeadTime} Days</span>
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Commercial & Warranty:</p>
              {warranty && <p className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5">{warranty}</p>}
              {rfqCategory && <p className="text-[11px] text-slate-500 dark:text-gray-400">Category: {rfqCategory}</p>}
            </div>
          </div>

          {/* Line Items Table */}
          <div>
            <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold mb-1.5">Line-Item Commercial Breakdown</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-100 dark:bg-gray-900/90 text-slate-600 dark:text-gray-400 text-[10px]">
                  <tr>
                    <th className="p-2">Item Description</th>
                    <th className="p-2 text-center">Qty</th>
                    <th className="p-2 text-center">Unit</th>
                    <th className="p-2 text-right">Unit Rate</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-700 dark:text-gray-300">
                  {itemsWithPricing.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-2">
                        <div className="font-semibold text-slate-800 dark:text-gray-100">{item.description}</div>
                        {item.specs ? <div className="text-[10px] text-slate-400">{item.specs}</div> : null}
                      </td>
                      <td className="p-2 text-center mono">{item.quantity ?? UI_STRINGS.recordPlaceholders.notRecorded}</td>
                      <td className="p-2 text-center">{item.unit}</td>
                      <td className="p-2 text-right mono">{formatPoAmount(item.unitPrice)}</td>
                      <td className="p-2 text-right mono font-bold">{formatPoAmount(item.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-end gap-1 mt-3 text-[11px] pr-2">
              <div className="flex justify-between w-64 text-slate-500 dark:text-gray-400">
                <span>Subtotal (Base):</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-gray-200">{formatPoAmount(subTotal)}</span>
              </div>
              <div className="flex justify-between w-64 text-slate-500 dark:text-gray-400">
                <span>GST / Taxes ({gstRate !== null ? `${gstRate}%` : UI_STRINGS.recordPlaceholders.notAvailable}):</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-gray-200">{gstAmount !== null ? `+₹${gstAmount.toLocaleString('en-IN')}` : UI_STRINGS.recordPlaceholders.notAvailable}</span>
              </div>
              <div className="flex justify-between w-64 pt-1 border-t border-slate-200 dark:border-gray-800 font-bold text-sm text-indigo-700 dark:text-indigo-300">
                <span>Grand Total:</span>
                <span className="font-mono">{grandTotal !== null ? `₹${grandTotal.toLocaleString('en-IN')}` : UI_STRINGS.recordPlaceholders.notAvailable}</span>
              </div>
              {grandTotalInWords && (
                <div className="text-[10px] text-slate-500 dark:text-gray-400 italic text-right mt-0.5">
                  {grandTotalInWords}
                </div>
              )}
            </div>
          </div>

          {/* Standard PO Terms & Conditions preview */}
          <div className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-[10px] text-slate-600 dark:text-gray-400 shadow-sm space-y-1">
            <span className="text-slate-800 dark:text-gray-300 font-semibold uppercase tracking-wider text-[9px]">Standard Terms & Conditions:</span>
            <ul className="list-disc pl-4 space-y-0.5 text-[10px]">
              <li>Binding contract upon acknowledgement or delivery commencement.</li>
              <li>Goods must strictly conform to specifications and approved quality standards.</li>
              <li>Delivery to designated site within agreed lead time; invoices must quote PO number & GSTIN.</li>
              <li>Payments processed strictly as per agreed credit terms after inspection and 3-way matching.</li>
            </ul>
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
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              title="Export complete Pre-Purchase Order as PDF document"
              className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5"
            >
              <Download size={13} /> Export PDF
            </button>
            <button
              onClick={handleExportPDF}
              className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5"
            >
              <Printer size={13} /> Print
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost btn-sm font-semibold">
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={poSigned || approving}
              className="btn btn-primary font-bold shadow-md inline-flex items-center gap-1.5"
            >
              {poSigned ? (
                <>
                  <CheckCircle2 size={15} /> Finalised & Redirecting...
                </>
              ) : approving ? (
                <>Finalising...</>
              ) : (
                <>
                  <ShieldCheck size={15} /> [ APPROVE & GENERATE PRE-PURCHASE ORDER ]
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
  vendorPhone?: string;
  initialChannel?: 'call' | 'whatsapp' | 'sms';
  hidePhone?: boolean;
}

export function MultiChannelChaserModal({
  isOpen,
  onClose,
  rfqNumber,
  vendorName,
  vendorPhone,
  initialChannel = 'whatsapp',
  hidePhone = false,
}: MultiChannelChaserModalProps) {
  const { triggerChannelChaser } = useApp();
  const [selectedChannel, setSelectedChannel] = useState<'call' | 'whatsapp' | 'sms'>(initialChannel);
  const [phone, setPhone] = useState(vendorPhone || '');
  const [template, setTemplate] = useState('urgent_reminder');
  const [customMsg, setCustomMsg] = useState(() => buildUrgentReminderMessage(vendorName, rfqNumber));
  const [callScript, setCallScript] = useState(() => buildCallScript(rfqNumber));

  useEffect(() => {
    setSelectedChannel(initialChannel);
  }, [initialChannel]);

  // Sync phone and message content whenever the modal re-opens for a different vendor
  useEffect(() => {
    if (isOpen) {
      setPhone(vendorPhone || '');
      setCustomMsg(buildUrgentReminderMessage(vendorName, rfqNumber));
      setCallScript(buildCallScript(rfqNumber));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, vendorName, vendorPhone, rfqNumber]);

  if (!isOpen) return null;

  const handleSend = () => {
    triggerChannelChaser(rfqNumber, selectedChannel, vendorName, selectedChannel === 'call' ? callScript : customMsg);
    onClose();
  };

  return (
    <div className="modal-overlay !z-[1050]" onClick={onClose}>
      <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in" onClick={(e) => e.stopPropagation()}>
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
          {hidePhone ? (
            <div>
              <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                Target Vendor
              </label>
              <input type="text" value={vendorName} readOnly className="w-full opacity-80 font-medium" />
            </div>
          ) : (
            <div>
              <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                Target Vendor & Phone Number
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={vendorName} readOnly className="opacity-80 font-medium" />
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}

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
                      setCustomMsg(buildUrgentReminderMessage(vendorName, rfqNumber));
                    } else {
                      setCustomMsg(formatString(UI_STRINGS.modals.chaser.technicalRequestTemplate, { rfqNumber }));
                    }
                  }}
                >
                  <option value="urgent_reminder">{UI_STRINGS.modals.chaser.urgentTemplateLabel}</option>
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

/** A channel's next follow-up time, or the not-recorded placeholder when the RFQ creation time is unreadable. */
function formatNextFollowUp(iso: string | null): string {
  return iso ? formatIndianDateTime(iso) : UI_STRINGS.recordPlaceholders.notRecorded;
}

export const getCallBadge = (status: string) => {
  switch (status) {
    case 'completed':
      return <span className="badge badge-emerald text-[11px] px-2 py-0.5">📞 Connected</span>;
    case 'connected':
      return <span className="badge badge-blue text-[11px] px-2 py-0.5">📞 In Call</span>;
    case 'voicemail':
      return <span className="badge badge-amber text-[11px] px-2 py-0.5">📞 Voicemail Left</span>;
    case 'scheduled':
      return <span className="badge badge-purple text-[11px] px-2 py-0.5">📞 Callback Queued</span>;
    case 'not_dispatched':
      return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ {UI_STRINGS.recordPlaceholders.notDispatched}</span>;
    default:
      return <span className="badge badge-blue text-[11px] px-2 py-0.5">📞 {status}</span>;
  }
};

export const getWhatsAppBadge = (status: string) => {
  switch (status) {
    case 'replied':
      return <span className="badge badge-emerald text-[11px] px-2 py-0.5">💬 Replied / Bid In</span>;
    case 'read':
      return <span className="badge badge-blue text-[11px] px-2 py-0.5">💬 Read (Link Clicked)</span>;
    case 'delivered':
      return <span className="badge badge-amber text-[11px] px-2 py-0.5">💬 Delivered</span>;
    case 'pending':
      return <span className="badge badge-purple text-[11px] px-2 py-0.5">💬 Queued</span>;
    case 'not_dispatched':
      return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ {UI_STRINGS.recordPlaceholders.notDispatched}</span>;
    default:
      return <span className="badge badge-blue text-[11px] px-2 py-0.5">💬 {status}</span>;
  }
};

export const getSMSBadge = (status: string) => {
  switch (status) {
    case 'clicked':
      return <span className="badge badge-emerald text-[11px] px-2 py-0.5">📱 Link Clicked</span>;
    case 'delivered':
      return <span className="badge badge-blue text-[11px] px-2 py-0.5">📱 Delivered (DLT)</span>;
    case 'sent':
      return <span className="badge badge-amber text-[11px] px-2 py-0.5">📱 Sent</span>;
    case 'not_dispatched':
      return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ {UI_STRINGS.recordPlaceholders.notDispatched}</span>;
    default:
      return <span className="badge badge-purple text-[11px] px-2 py-0.5">📱 {status}</span>;
  }
};

export const getEmailBadge = (status: string) => {
  switch (status) {
    case 'replied':
    case 'opened':
      return <span className="badge badge-emerald text-[11px] px-2 py-0.5">✉️ Opened / Replied</span>;
    case 'delivered':
      return <span className="badge badge-blue text-[11px] px-2 py-0.5">✉️ Delivered</span>;
    case 'escalated':
    case 'sent':
      return <span className="badge badge-amber text-[11px] px-2 py-0.5">✉️ Escalated (24h)</span>;
    case 'not_dispatched':
      return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ {UI_STRINGS.recordPlaceholders.notDispatched}</span>;
    default:
      return <span className="badge badge-amber text-[11px] px-2 py-0.5">✉️ {status}</span>;
  }
};

/* RFQ-WISE MULTI-CHANNEL FOLLOW-UP DEEP DIVE MODAL */
interface RFQFollowUpDeepDiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfq: RFQItem | null;
}

export function RFQFollowUpDeepDiveModal({ isOpen, onClose, rfq }: RFQFollowUpDeepDiveModalProps) {
  const { rfqs, setSelectedRFQForDeepDive, triggerChannelChaser, triggerBatchChannelChaser, showToast } = useApp();
  const [activeChannelTab, setActiveChannelTab] = useState<'all' | 'call' | 'whatsapp' | 'sms'>('all');
  const [activeVendorModal, setActiveVendorModal] = useState<{
    vendorName: string;
    channel: 'call' | 'whatsapp' | 'sms';
  } | null>(null);

  if (!isOpen || !rfq) return null;

  const liveRfq = (Array.isArray(rfqs) ? rfqs.find((item) => item.rfqNumber === rfq.rfqNumber || item.id === rfq.id) : undefined) || rfq;
  const followUp = liveRfq.followUpData;
  // Each channel's next follow-up counts from the RFQ creation time, so it does not depend on follow-up data.
  const nextFollowUps = computeRFQFollowUpTimes(liveRfq.createdAt);
  const metrics = computeRFQFollowUpMetrics(liveRfq);
  const totalInvitedVendors = metrics.totalInvited ?? 0;

  // Normalize vendor telemetry records so assignedVendors entries without explicit vendorName/vendorId still display cleanly
  const vendors: VendorFollowUpRecord[] = normalizeFollowUpVendors(liveRfq);

  // Vendor type shown per row:
  //  - "Buyer Vendors": a vendor the buyer explicitly added to this RFQ (present
  //    on rfq.assignedVendors, matched by id or name).
  //  - "Procucev Vendors": vendors sourced from the Procucev network, which is
  //    what a V2 (Hybrid) or V3 (Autonomous) RFQ expands into when the buyer's
  //    own roster is insufficient. Any follow-up vendor on a V2/V3 RFQ that is
  //    not on the buyer's assigned list is a Procucev network vendor.
  // V0/V1 RFQs circulate to the buyer's own roster only, so their vendors are
  // Buyer Vendors regardless.
  const isHybridOrAutonomous = liveRfq.sourcingMode === 'mode_2' || liveRfq.sourcingMode === 'mode_3';
  const assignedVendorKeys = new Set(
    (liveRfq.assignedVendors || []).flatMap((av) =>
      [av.id, av.name].filter((k): k is string => !!k).map((k) => k.trim().toLowerCase())
    )
  );
  const vendorTypeFor = (v: VendorFollowUpRecord): 'procucev' | 'buyer' => {
    const addedByBuyer =
      assignedVendorKeys.has((v.vendorId || '').trim().toLowerCase()) ||
      assignedVendorKeys.has((v.vendorName || '').trim().toLowerCase());
    if (addedByBuyer) return 'buyer';
    return isHybridOrAutonomous ? 'procucev' : 'buyer';
  };

  const filteredVendors = vendors.filter((v) => {
    if (activeChannelTab === 'call') return v.call.status !== 'failed';
    if (activeChannelTab === 'whatsapp') return v.whatsapp.status !== 'failed';
    if (activeChannelTab === 'sms') return v.sms.status !== 'failed';
    return true;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shadow-xs">
              <Phone size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-md font-extrabold text-xs mono bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                  {liveRfq.rfqNumber}
                </span>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Vendor Follow-Up Details
                </h2>
                <span className="badge badge-purple text-xs font-bold px-2.5 py-0.5">Multi-Channel</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                {liveRfq.title} • <span className="font-semibold text-slate-700 dark:text-gray-300">Target Delivery: {liveRfq.targetDeliveryDate || UI_STRINGS.recordPlaceholders.notRecorded}</span> • <span className="text-indigo-600 dark:text-indigo-400 font-bold">{vendors.length} Vendors Empanelled</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {Array.isArray(rfqs) && rfqs.length > 1 && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-gray-800/80 px-2 py-1 rounded-lg border border-slate-200 dark:border-gray-700">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-400">Switch:</span>
                <select
                  aria-label="Switch Deep Dive RFQ"
                  value={liveRfq.rfqNumber || liveRfq.id}
                  onChange={(e) => {
                    const next = rfqs.find((item) => (item.rfqNumber || item.id) === e.target.value);
                    if (next && setSelectedRFQForDeepDive) {
                      setSelectedRFQForDeepDive(next);
                    }
                  }}
                  className="text-xs font-bold mono bg-white dark:bg-gray-900 text-slate-900 dark:text-white px-2 py-0.5 rounded border border-slate-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {rfqs.map((item) => (
                    <option key={item.id} value={item.rfqNumber || item.id}>
                      {item.rfqNumber} {item.title ? `— ${item.title.length > 25 ? item.title.slice(0, 25) + '…' : item.title}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* 4-Channel Live Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-4 shrink-0">
          {/* Channel 1: Call (Voice Bot) */}
          <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-purple-800 dark:text-purple-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span>📞</span> VOICE CALLS
              </span>
              {followUp?.callStats?.avgDuration ? (
                <span className="mono text-[10px] bg-purple-100 dark:bg-purple-900/60 px-2 py-0.5 rounded font-black">
                  Avg {followUp.callStats.avgDuration}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-purple-950 dark:text-purple-100 mono">
                {formatFollowUpCount(metrics.callConnected)} / {formatFollowUpCount(metrics.callTotal)}
              </span>
              <span className="text-xs text-purple-700 dark:text-purple-300 font-semibold">Connected</span>
            </div>
            <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-0.5">
              Autonomous intent & transcription
            </p>
            <p data-testid="next-follow-up-call" className="text-[11px] font-semibold text-purple-800 dark:text-purple-200 mt-1.5">
              {UI_STRINGS.modals.followUp.nextFollowUpLabel}{' '}
              <span>{formatNextFollowUp(nextFollowUps.call)}</span>
            </p>
            <p className="text-[10px] text-purple-600 dark:text-purple-400">
              {UI_STRINGS.modals.followUp.businessHoursNote}
            </p>
          </div>

          {/* Channel 2: WhatsApp */}
          <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 shadow-xs">
            <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex-wrap">
              <span className="flex items-center gap-1.5">
                <MessageSquare size={13} /> WHATSAPP BOT
              </span>
              <span className="flex items-center gap-1">
                {(metrics.waDelivered ?? 0) > (metrics.waRead ?? 0) && (
                  <span className="mono text-[10px] bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded font-black">
                    {formatFollowUpCount(metrics.waDelivered)} Delivered
                  </span>
                )}
                <span className="mono text-[10px] bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded font-black">
                  {formatFollowUpCount(metrics.waRead)} Read
                </span>
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-emerald-950 dark:text-emerald-100 mono">
                {formatFollowUpCount(metrics.waReplied)} / {formatFollowUpCount(metrics.waTotal)}
              </span>
              <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Bids Submitted</span>
            </div>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
              1-click bid submission & receipts
            </p>
            <p data-testid="next-follow-up-whatsapp" className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 mt-1.5">
              {UI_STRINGS.modals.followUp.nextFollowUpLabel}{' '}
              <span>{formatNextFollowUp(nextFollowUps.whatsapp)}</span>
            </p>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
              {UI_STRINGS.modals.followUp.businessHoursNote}
            </p>
          </div>

          {/* Channel 3: SMS Direct */}
          <div className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-cyan-950/30 border border-sky-200 dark:border-cyan-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-sky-800 dark:text-cyan-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span>📱</span> SMS ALERTS
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-sky-950 dark:text-cyan-100 mono">
                {formatFollowUpCount(metrics.smsDelivered)} / {formatFollowUpCount(metrics.smsTotal)}
              </span>
              <span className="text-xs text-sky-700 dark:text-cyan-300 font-semibold">Delivered</span>
            </div>
            <p className="text-[11px] text-sky-600 dark:text-cyan-400 mt-0.5">
              Carrier priority sales alerts
            </p>
            <p data-testid="next-follow-up-sms" className="text-[11px] font-semibold text-sky-800 dark:text-cyan-200 mt-1.5">
              {UI_STRINGS.modals.followUp.nextFollowUpLabel}{' '}
              <span>{formatNextFollowUp(nextFollowUps.sms)}</span>
            </p>
          </div>

          {/* Channel 4: 24h Email Reminder Escalation */}
          <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-955/30 border border-amber-200 dark:border-amber-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Mail size={13} /> 24H EMAIL ESCALATION
              </span>
              <span className="mono text-[10px] bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded font-black">
                Next-Day
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-amber-950 dark:text-amber-100 mono">
                {formatFollowUpCount(metrics.emailEscalationsSent)} / {totalInvitedVendors}
              </span>
              <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold">Escalations Sent</span>
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              Automated BOQ re-attachment
            </p>
            <p data-testid="next-follow-up-email" className="text-[11px] font-semibold text-amber-800 dark:text-amber-200 mt-1.5">
              {UI_STRINGS.modals.followUp.nextFollowUpLabel}{' '}
              <span>{formatNextFollowUp(nextFollowUps.email)}</span>
            </p>
          </div>
        </div>

        {/* Channel Filter & Batch Action Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800 text-xs shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-gray-800/90 p-1 rounded-xl w-full sm:w-auto overflow-x-auto">
            <button
              onClick={() => setActiveChannelTab('all')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 ${
                activeChannelTab === 'all'
                  ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Channels ({vendors.length})
            </button>
            <button
              onClick={() => setActiveChannelTab('call')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 ${
                activeChannelTab === 'call'
                  ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📞</span> Calls ({formatFollowUpCount(metrics.callTotal)})
            </button>
            <button
              onClick={() => setActiveChannelTab('whatsapp')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 ${
                activeChannelTab === 'whatsapp'
                  ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MessageSquare size={13} /> WhatsApp ({formatFollowUpCount(metrics.waTotal)})
            </button>
            <button
              onClick={() => setActiveChannelTab('sms')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 ${
                activeChannelTab === 'sms'
                  ? 'bg-white dark:bg-gray-900 text-sky-700 dark:text-cyan-300 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📱</span> SMS ({formatFollowUpCount(metrics.smsTotal)})
            </button>
          </div>
        </div>

        {/* Vendor Follow-Up Details List */}
        <div className="flex-1 overflow-y-auto my-3 space-y-3 pr-1 min-h-[260px]">
          {filteredVendors.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500 text-xs">
              <Phone size={32} className="mx-auto mb-2 opacity-40 text-indigo-500" />
              <p className="font-bold text-slate-700 dark:text-gray-300 text-sm">No vendors found for this channel filter.</p>
              <p className="text-xs text-slate-400 mt-1">Select &apos;All Channels&apos; or broadcast follow-ups across your roster.</p>
            </div>
          ) : (
            filteredVendors.map((vendor) => (
              <div
                key={vendor.vendorId}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all text-xs space-y-3 shadow-2xs"
              >
                {/* Vendor Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-gray-800">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                        <Building2 size={15} className="text-slate-400" /> {vendor.vendorName}
                      </span>
                      {(() => {
                        const vendorType = vendorTypeFor(vendor);
                        return (
                          <span
                            data-testid={`vendor-type-${vendor.vendorId}`}
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              vendorType === 'procucev'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-cyan-300 border-sky-200 dark:border-cyan-800'
                            }`}
                          >
                            {vendorType === 'procucev' ? 'Procucev Vendors' : 'Buyer Vendors'}
                          </span>
                        );
                      })()}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          vendor.overallStatus === 'Responded' || vendor.bidStatus === 'Submitted'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        }`}
                      >
                        {vendor.overallStatus}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">
                      Last Interaction: <span className="font-medium text-slate-700 dark:text-gray-300">{vendor.lastInteraction || UI_STRINGS.recordPlaceholders.notRecorded}</span> {typeof vendor.attemptsCount === 'number' && vendor.attemptsCount > 0 && `(Attempt #${vendor.attemptsCount})`}
                    </p>
                  </div>

                  {/* Channel Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, channel: 'call' })
                      }
                      className="px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50 hover:bg-purple-100 dark:hover:bg-purple-900/70 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <span>📞</span> Call
                    </button>
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, channel: 'whatsapp' })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <MessageSquare size={13} /> WhatsApp
                    </button>
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, channel: 'sms' })
                      }
                      className="px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-cyan-900/40 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700/50 hover:bg-sky-100 dark:hover:bg-cyan-900/70 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <span>📱</span> SMS
                    </button>
                  </div>
                </div>

                {/* 4-Channel Status Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Call Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>📞</span> AI Voice Bot
                      </span>
                      {getCallBadge(vendor.call.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400 flex justify-between">
                      <span>Status: {vendor.call.lastAttempt || UI_STRINGS.recordPlaceholders.notRecorded}</span>
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
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <MessageSquare size={12} className="text-emerald-500" /> WhatsApp Chaser
                      </span>
                      {getWhatsAppBadge(vendor.whatsapp.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      Dispatched: {vendor.whatsapp.lastAttempt || UI_STRINGS.recordPlaceholders.notRecorded}
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
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>📱</span> SMS Direct Alert
                      </span>
                      {getSMSBadge(vendor.sms.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      Status Date: {vendor.sms.lastAttempt || UI_STRINGS.recordPlaceholders.notRecorded}
                    </div>
                    {vendor.sms.deliveryReport ? (
                      <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-mono block">
                        Gateway: {vendor.sms.deliveryReport}
                      </span>
                    ) : (
                      <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-snug">
                        Direct SMS notification route.
                      </p>
                    )}
                  </div>

                  {/* 24h Email Reminder Details */}
                  {(() => {
                    const email24hDispatched = Boolean(
                      vendor.email24h?.is24hReminderSent ||
                      vendor.email24h?.status === 'sent' ||
                      vendor.email24h?.status === 'delivered' ||
                      vendor.email24h?.status === 'reminded_24h'
                    );
                    return (
                      <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                            <Mail size={12} className="text-amber-500" /> 24h Email Escalation
                          </span>
                          {email24hDispatched ? (
                            <span className="badge badge-amber text-[11px] px-2 py-0.5">✉️ Dispatched</span>
                          ) : vendor.bidStatus === 'Submitted' || vendor.overallStatus === 'Responded' ? (
                            <span className="badge badge-emerald text-[11px] px-2 py-0.5">✅ Bid Submitted</span>
                          ) : vendor.email24h ? (
                            <span className="badge badge-purple text-[11px] px-2 py-0.5">⏳ Pending 24h</span>
                          ) : (
                            <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ {UI_STRINGS.recordPlaceholders.notDispatched}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-gray-400">
                          {vendor.email24h?.lastAttempt
                            ? `Sent: ${vendor.email24h.lastAttempt}`
                            : vendor.email24h
                              ? UI_STRINGS.modals.followUp.escalationQueued
                              : UI_STRINGS.recordPlaceholders.notDispatched}
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-snug">
                          {email24hDispatched
                            ? 'BOQ specs re-attached via email. Urgent bid submission requested.'
                            : 'Dispatches if vendor fails to respond to initial follow-up.'}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end pt-3.5 mt-1 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">
            Close Vendor Follow-Up Details
          </button>
        </div>
      </div>

      {/* Individual Vendor Multi-Channel Modal */}
      {activeVendorModal && (
        <MultiChannelChaserModal
          isOpen={!!activeVendorModal}
          onClose={() => setActiveVendorModal(null)}
          rfqNumber={liveRfq.rfqNumber}
          vendorName={activeVendorModal.vendorName}
          hidePhone={true}
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

/**
 * Mode 3 survey entry point. No survey dispatch endpoint exists, so this dialog sends
 * nothing and records no audit entry. It states that the survey is not connected.
 */
export function VendorSurveyModal({ isOpen, onClose }: SurveyModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-purple-500/40"
        onClick={(e) => e.stopPropagation()}
      >
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
          <p className="text-slate-600 dark:text-gray-300">{UI_STRINGS.vendorSurvey.notConnected}</p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            {UI_STRINGS.vendorSurvey.closeButton}
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
  billingDurationLabel?: string;
  breakdown?: {
    basePrice: string;
    gstAmount: string;
    /** GST rate in percent from the pricing response. Omitted, the label shows "GST" with no rate. */
    gstPercent?: number;
  };
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
export function SubscriptionPaymentModal({ isOpen, onClose, planId, planName, price, billingDurationLabel, breakdown, createPaymentLink }: SubscriptionPaymentModalProps) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !processing) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, processing]);

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
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !processing) onClose();
      }}
    >
      <div
        className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40"
        onClick={(e) => e.stopPropagation()}
      >
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
          {billingDurationLabel && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Billing Period</span>
              <span className="font-bold text-slate-900 dark:text-white">{billingDurationLabel}</span>
            </div>
          )}
          {breakdown && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 space-y-1.5">
              <div className="flex items-center justify-between text-slate-500 dark:text-gray-400">
                <span>Base Plan Price</span>
                <span className="font-semibold text-slate-700 dark:text-gray-200">{breakdown.basePrice}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500 dark:text-gray-400">
                <span>{gstLabelFor(breakdown.gstPercent)}</span>
                <span className="font-semibold text-slate-700 dark:text-gray-200">{breakdown.gstAmount}</span>
              </div>
            </div>
          )}
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

interface EvaluationSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  record?: any;
}

export function VendorEvaluationSummaryModal({ isOpen, onClose, record }: EvaluationSummaryModalProps) {
  const { selectedVendorEvaluation } = useApp();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const evalRecord = record || selectedVendorEvaluation;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content max-w-5xl p-6 max-h-[92vh] overflow-y-auto relative animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
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
            <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                  Mode 3 Vendor Evaluation Summary Report
                </span>
                <h3 className="text-xl font-bold mt-0.5 break-words">{evalRecord.vendorName}</h3>
                <p className="text-xs text-indigo-200/80 mt-0.5 break-words">{evalRecord.category} • Submitted: {evalRecord.submissionDate}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-3xl font-black mono text-emerald-400">{typeof evalRecord.overallScore === 'number' ? `${evalRecord.overallScore}%` : UI_STRINGS.recordPlaceholders.notEvaluated}</div>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-flex items-center justify-center whitespace-nowrap mt-1">
                  {evalRecord.status}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-900 dark:text-emerald-200 min-w-0 break-words">
              ⚡ <strong>Automated System Execution Action:</strong> {evalRecord.systemAction}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs min-w-0">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between min-w-0">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Commercial Terms (25%)</div>
                  <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mono mt-0.5">{formatModuleScore(evalRecord.moduleScores?.commercial)}</div>
                </div>
                <div className="p-2 rounded bg-indigo-50/70 dark:bg-indigo-950/40 text-[10px] text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-800 break-words">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.commercial?.remarks || UI_STRINGS.recordPlaceholders.notRecorded}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between min-w-0">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Technical Specs (15%)</div>
                  <div className="text-lg font-bold text-sky-600 dark:text-cyan-400 mono mt-0.5">{formatModuleScore(evalRecord.moduleScores?.technical)}</div>
                </div>
                <div className="p-2 rounded bg-sky-50/70 dark:bg-cyan-950/40 text-[10px] text-sky-900 dark:text-cyan-200 border border-sky-100 dark:border-cyan-800 break-words">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.technical?.remarks || UI_STRINGS.recordPlaceholders.notRecorded}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between min-w-0">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Quality & Warranty (20%)</div>
                  <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mono mt-0.5">{formatModuleScore(evalRecord.moduleScores?.quality)}</div>
                </div>
                <div className="p-2 rounded bg-emerald-50/70 dark:bg-emerald-950/40 text-[10px] text-emerald-900 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-800 break-words">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.quality?.remarks || UI_STRINGS.recordPlaceholders.notRecorded}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between min-w-0">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Delivery OTIF (20%)</div>
                  <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mono mt-0.5">{formatModuleScore(evalRecord.moduleScores?.delivery)}</div>
                </div>
                <div className="p-2 rounded bg-purple-50/70 dark:bg-purple-950/40 text-[10px] text-purple-900 dark:text-purple-200 border border-purple-100 dark:border-purple-800 break-words">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.delivery?.remarks || UI_STRINGS.recordPlaceholders.notRecorded}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between min-w-0">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Financial Rating (10%)</div>
                  <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mono mt-0.5">{formatModuleScore(evalRecord.moduleScores?.financial)}</div>
                </div>
                <div className="p-2 rounded bg-amber-50/70 dark:bg-amber-950/40 text-[10px] text-amber-900 dark:text-amber-200 border border-amber-100 dark:border-amber-800 break-words">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.financial?.remarks || UI_STRINGS.recordPlaceholders.notRecorded}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between min-w-0">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Governance & ESG (10%)</div>
                  <div className="text-lg font-bold text-rose-600 dark:text-rose-400 mono mt-0.5">{formatModuleScore(evalRecord.moduleScores?.governance)}</div>
                </div>
                <div className="p-2 rounded bg-rose-50/70 dark:bg-rose-950/40 text-[10px] text-rose-900 dark:text-rose-200 border border-rose-100 dark:border-rose-800 break-words">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.governance?.remarks || UI_STRINGS.recordPlaceholders.notRecorded}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2 text-xs">
              <div className="font-bold text-slate-800 dark:text-gray-200">{UI_STRINGS.modals.evaluation.documentsHeading}</div>
              <div className="space-y-1.5">
                {(evalRecord.documents || []).map((doc: any) => (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px] min-w-0">
                    <span className="font-semibold text-slate-700 dark:text-gray-200 break-words">{doc.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">{doc.verified ? `✓ ${doc.status}` : doc.status}</span>
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

/* ════════════════════════════════════════════════════════════════════════════════
   1. ACTIVE PIPELINE MODAL
════════════════════════════════════════════════════════════════════════════════ */
interface ActivePipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onOpenDeepDive: (rfq: RFQItem) => void;
  onNavigateToMatrix: (rfq: RFQItem) => void;
}

const isEmailRfqSource = (src?: string | null) => Boolean(src && (src === 'email_gateway' || src === 'email_upload'));

export function ActivePipelineModal({
  isOpen,
  onClose,
  rfqs,
  onOpenDeepDive,
  onNavigateToMatrix,
}: ActivePipelineModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_evaluation' | 'ai_recommended' | 'quotes_received'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email_gateway' | 'web_portal' | 'manual_entry'>('all');

  const totalActiveRFQs = rfqs.length;
  const inEvaluationCount = rfqs.filter((r) => r.status === 'In Evaluation').length;
  const aiRecommendedCount = rfqs.filter((r) => r.status === 'AI Recommended').length;
  const quotesPendingCount = rfqs.filter((r) => r.status === 'Quotes Pending' || r.status === 'Parsing').length;
  const totalQuotes = rfqs.reduce((acc, r) => acc + (r.quotesCount || (r.quotes ? r.quotes.length : 0)), 0);

  const filteredRfqs = rfqs.filter((rfq) => {
    if (statusFilter === 'in_evaluation' && rfq.status !== 'In Evaluation') return false;
    if (statusFilter === 'ai_recommended' && rfq.status !== 'AI Recommended') return false;
    if (statusFilter === 'quotes_received') {
      const qCount = rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0);
      if (rfq.status !== 'Quotes Received' && qCount === 0) return false;
    }

    if (sourceFilter === 'email_gateway' && !isEmailRfqSource(rfq.source)) return false;
    if (sourceFilter === 'web_portal' && (isEmailRfqSource(rfq.source) || rfq.source === 'manual_entry')) return false;
    if (sourceFilter === 'manual_entry' && rfq.source !== 'manual_entry') return false;

    if (!searchTerm) return true;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;

    const matchesLineItems = (rfq.extractedEntities || []).some(
      (item) => ((item.itemName || '') + ' ' + (item.technicalSpecs || '') + ' ' + (item.category || '')).toLowerCase().includes(term)
    );
    const matchesVendors = (rfq.assignedVendors || []).some(
      (v) => ((v.name || '') + ' ' + (v.contactPerson || '') + ' ' + (v.email || '')).toLowerCase().includes(term)
    );

    return (
      (rfq.rfqNumber || '').toLowerCase().includes(term) ||
      (rfq.title || '').toLowerCase().includes(term) ||
      (rfq.category || '').toLowerCase().includes(term) ||
      (rfq.status && rfq.status.toLowerCase().includes(term)) ||
      (rfq.source && rfq.source.toLowerCase().includes(term)) ||
      (rfq.sourcingMode && rfq.sourcingMode.toLowerCase().includes(term)) ||
      (rfq.targetDeliveryDate && rfq.targetDeliveryDate.toLowerCase().includes(term)) ||
      matchesLineItems ||
      matchesVendors
    );
  });

  if (!isOpen) return null;

  const getSourceBadge = (source?: string) => {
    if (isEmailRfqSource(source)) {
      return (
        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
          <span>via Email Upload</span>
        </span>
      );
    }
    if (source === 'manual_entry') {
      return (
        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
          <span>Manual RFQ Form</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
        <span>AI RFQ Ingestion</span>
      </span>
    );
  };

  const getModeBadge = (modeId: string) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    return (
      <span
        className="px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide"
        style={{
          backgroundColor: `${mode.badgeColor}15`,
          color: mode.badgeColor,
          border: `1px solid ${mode.badgeColor}35`,
        }}
      >
        {mode.code} ({mode.shortLabel})
      </span>
    );
  };

  const getStatusBadge = (status: RFQItem['status']) => {
    switch (status) {
      case 'AI Recommended':
        return <span className="badge badge-emerald text-xs px-2.5 py-1">AI Recommended</span>;
      case 'In Evaluation':
        return <span className="badge badge-blue text-xs px-2.5 py-1">In Evaluation</span>;
      case 'Quotes Received':
        return <span className="badge badge-blue text-xs px-2.5 py-1">Quotes Received</span>;
      case 'PO Generated':
        return <span className="badge badge-purple text-xs px-2.5 py-1">PO Generated</span>;
      case 'Parsing':
        return <span className="badge badge-amber text-xs px-2.5 py-1">OCR Parsing</span>;
      default:
        return <span className="badge badge-blue text-xs px-2.5 py-1">{status}</span>;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shadow-xs">
              <Layers size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Active Procurement Pipeline</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                  {totalActiveRFQs} Total Requisitions
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Comprehensive tracking of live RFQs, multi-channel response telemetry, and quote evaluation states.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* Metrics Banner (Interactive Filter Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-4 shrink-0">
          <div
            onClick={() => setStatusFilter('all')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'all'
                ? 'bg-slate-100 dark:bg-gray-800 border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20'
                : 'bg-slate-50 dark:bg-gray-800/60 border-slate-200 dark:border-gray-700 hover:border-slate-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">Total Active Requisitions</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white mono mt-1">{totalActiveRFQs}</div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'in_evaluation' ? 'all' : 'in_evaluation')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'in_evaluation'
                ? 'bg-blue-100 dark:bg-blue-950/80 border-blue-500 ring-2 ring-blue-500/20'
                : 'bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/40 hover:border-blue-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">In Evaluation</div>
            <div className="text-2xl font-black text-blue-900 dark:text-blue-200 mono mt-1">{inEvaluationCount}</div>
            <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold mt-0.5">Parametric Scoring Active</div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'ai_recommended' ? 'all' : 'ai_recommended')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'ai_recommended'
                ? 'bg-emerald-100 dark:bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/20'
                : 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 hover:border-emerald-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">AI Recommended</div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-1">{aiRecommendedCount}</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">Ready for PO Approval</div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'quotes_received' ? 'all' : 'quotes_received')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'quotes_received'
                ? 'bg-purple-100 dark:bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/20'
                : 'bg-purple-50/60 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/40 hover:border-purple-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">Total Quotes Received</div>
            <div className="text-2xl font-black text-purple-900 dark:text-purple-200 mono mt-1">{totalQuotes}</div>
            <div className="text-xs text-purple-600 dark:text-purple-400 font-semibold mt-0.5">Across All Modes</div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="space-y-2 mb-3 pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 w-full">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by RFQ number, title, category, or status..."
                className="has-leading-icon w-full pl-10 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {(statusFilter !== 'all' || sourceFilter !== 'all' || searchTerm) && (
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setSourceFilter('all');
                  setSearchTerm('');
                }}
                className="btn btn-ghost btn-sm text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
              >
                Reset Filters
              </button>
            )}
          </div>

          {/* Quick Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] pt-1">
            <span className="text-slate-400 dark:text-gray-500 text-[10px] uppercase font-bold mr-1">Source:</span>
            <button
              onClick={() => setSourceFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'all'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSourceFilter('email_gateway')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'email_gateway'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40'
              }`}
            >
              via Email Upload
            </button>
            <button
              onClick={() => setSourceFilter('web_portal')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'web_portal'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40'
              }`}
            >
              AI RFQ Ingestion
            </button>
            <button
              onClick={() => setSourceFilter('manual_entry')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'manual_entry'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40'
              }`}
            >
              Manual RFQ
            </button>
          </div>
        </div>

        {/* Requisitions List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {filteredRfqs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500">
              <FileText size={36} className="mx-auto mb-2 opacity-40 text-indigo-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No matching requisitions found</p>
              <p className="text-xs mt-1 text-slate-400">Try adjusting your search query or status/source filters.</p>
            </div>
          ) : (
            filteredRfqs.map((rfq) => (
              <div
                key={rfq.id}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black mono text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</span>
                    {getSourceBadge(rfq.source)}
                    {getModeBadge(rfq.sourcingMode)}
                    {getStatusBadge(rfq.status)}
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-gray-700 text-slate-800 dark:text-gray-200 mono">
                      {rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0)} quotes received
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{rfq.title}</h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-gray-300">
                    <div>
                      Category: <strong className="text-slate-800 dark:text-gray-100">{rfq.category}</strong>
                    </div>
                    <div>
                      Target Delivery: <strong className="text-slate-800 dark:text-gray-100">{rfq.targetDeliveryDate || UI_STRINGS.recordPlaceholders.notRecorded}</strong>
                    </div>
                    <div>
                      Estimated Budget: <strong className="text-slate-800 dark:text-gray-100">{rfq.budget > 0 ? `₹${rfq.budget.toLocaleString()}` : 'Unspecified'}</strong>
                    </div>
                  </div>

                  {(() => {
                    const followUp = rfq.followUpData;
                    const metrics = computeRFQFollowUpMetrics(rfq);
                    const vCount = metrics.totalVendors;
                    if (!followUp && vCount === 0) return null;

                    const waTotal = Math.max(metrics.waTotal ?? 0, vCount);
                    const waRead = metrics.waDelivered ?? 0;
                    const smsTotal = Math.max(metrics.smsTotal ?? 0, vCount);
                    const smsDelivered = metrics.smsDelivered ?? 0;
                    const emailTotal = Math.max(metrics.emailTotal ?? 0, vCount);
                    const emailDelivered = metrics.emailDelivered ?? 0;
                    const totalInvited = Math.max(metrics.totalInvited ?? 0, vCount, waTotal, smsTotal, emailTotal);
                    const responded = metrics.responded;

                    return (
                      <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-600 dark:text-gray-300 flex-wrap">
                        <span title={`WhatsApp: ${waRead}/${waTotal}`} className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                          <MessageSquare size={11} className="shrink-0" />
                          <span>WA {waRead}/{waTotal}</span>
                        </span>
                        <span title={`SMS: ${smsDelivered}/${smsTotal}`} className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-cyan-950/50 text-sky-700 dark:text-cyan-300 font-semibold border border-sky-200 dark:border-cyan-800 flex items-center gap-1">
                          <Smartphone size={11} className="shrink-0" />
                          <span>SMS {smsDelivered}/{smsTotal}</span>
                        </span>
                        <span title={`Email: ${emailDelivered}/${emailTotal}`} className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                          <Mail size={11} className="shrink-0" />
                          <span>Email {emailDelivered}/{emailTotal}</span>
                        </span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold ml-1">
                          {responded}/{totalInvited} vendors responded
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                  <Link
                    href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                    onClick={onClose}
                    className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View RFQ Details"
                  >
                    <Eye size={13} /> View RFQ
                  </Link>

                  {((rfq.quotesCount && rfq.quotesCount > 0) || (rfq.quotes && rfq.quotes.length > 0) || rfq.status === 'AI Recommended' || rfq.status === 'In Evaluation') && (
                    <button
                      onClick={() => {
                        onClose();
                        onNavigateToMatrix(rfq);
                      }}
                      className="btn btn-emerald btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                      title="View Quotes"
                    >
                      <Sparkles size={13} /> View Quotes
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <span>Showing {filteredRfqs.length} of {totalActiveRFQs} requisitions</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   2. INTAKE SOURCES MODAL
════════════════════════════════════════════════════════════════════════════════ */
interface IntakeSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onOpenDeepDive: (rfq: RFQItem) => void;
  onNavigateToMatrix?: (rfq: RFQItem) => void;
}

export function IntakeSourcesModal({
  isOpen,
  onClose,
  rfqs,
  onOpenDeepDive,
  onNavigateToMatrix,
}: IntakeSourcesModalProps) {
  const [selectedSourceTab, setSelectedSourceTab] = useState<'all' | 'email_gateway' | 'web_portal' | 'manual_entry'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const totalActiveRFQs = rfqs.length;
const emailGatewayRFQs = rfqs.filter((r) => isEmailRfqSource(r.source));
  const webPortalRFQs = rfqs.filter((r) => !isEmailRfqSource(r.source) && r.source !== 'manual_entry');
  const manualRFQs = rfqs.filter((r) => r.source === 'manual_entry');

  const filteredRfqs = rfqs.filter((rfq) => {
    if (!rfq) return false;
    const matchesTab =
      selectedSourceTab === 'all'
        ? true
        : selectedSourceTab === 'web_portal'
? !isEmailRfqSource(rfq.source) && rfq.source !== 'manual_entry'
        : selectedSourceTab === 'email_gateway'
        ? isEmailRfqSource(rfq.source)
        : rfq.source === selectedSourceTab;

    if (!matchesTab) return false;
    if (!searchTerm || !searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();

    return (
      String(rfq.rfqNumber || '').toLowerCase().includes(term) ||
      String(rfq.title || '').toLowerCase().includes(term) ||
      String(rfq.category || '').toLowerCase().includes(term) ||
      String(rfq.status || '').toLowerCase().includes(term) ||
      String(rfq.sourceEmail || '').toLowerCase().includes(term) ||
      String(rfq.sourceFileName || '').toLowerCase().includes(term)
    );
  });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-900/50 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shadow-xs">
              <Mail size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Requisitions by Intake Source</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  3 Ingestion Channels
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Channel-by-channel origin verification across Autonomous via Email Upload, Web Portal AI OCR, and Manual Entry.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* 3 Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 my-4 shrink-0">
          {/* via Email Upload */}
          <div
            onClick={() => setSelectedSourceTab('email_gateway')}
            className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
              selectedSourceTab === 'email_gateway'
                ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-400 dark:border-amber-500 ring-2 ring-amber-400/20'
                : 'bg-white dark:bg-gray-800/60 border-amber-200 dark:border-amber-900/40 hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-400">
              <span>via Email Upload</span>
              <span className="mono text-xs font-black">
                {totalActiveRFQs > 0 ? Math.round((emailGatewayRFQs.length / totalActiveRFQs) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black text-amber-900 dark:text-amber-200 mono mt-2">
              {emailGatewayRFQs.length} <span className="text-xs font-normal text-slate-500">RFQs</span>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 font-medium">
              ⚡ Autonomous Ingestion · Auto-circulated
            </p>
          </div>

          {/* AI RFQ Create */}
          <div
            onClick={() => setSelectedSourceTab('web_portal')}
            className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
              selectedSourceTab === 'web_portal'
                ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-400/20'
                : 'bg-white dark:bg-gray-800/60 border-indigo-200 dark:border-indigo-900/40 hover:border-indigo-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-indigo-700 dark:text-indigo-400">
              <span>AI RFQ Create</span>
              <span className="mono text-xs font-black">
                {totalActiveRFQs > 0 ? Math.round((webPortalRFQs.length / totalActiveRFQs) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black text-indigo-900 dark:text-indigo-200 mono mt-2">
              {webPortalRFQs.length} <span className="text-xs font-normal text-slate-500">RFQs</span>
            </div>
            <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1 font-medium">
              📄 Web Portal BOQ PDF/Excel Ingest
            </p>
          </div>

          {/* Manual RFQ */}
          <div
            onClick={() => setSelectedSourceTab('manual_entry')}
            className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
              selectedSourceTab === 'manual_entry'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400 dark:border-emerald-500 ring-2 ring-emerald-400/20'
                : 'bg-white dark:bg-gray-800/60 border-emerald-200 dark:border-emerald-900/40 hover:border-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
              <span>Manual RFQ</span>
              <span className="mono text-xs font-black">
                {totalActiveRFQs > 0 ? Math.round((manualRFQs.length / totalActiveRFQs) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-2">
              {manualRFQs.length} <span className="text-xs font-normal text-slate-500">RFQs</span>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 font-medium">
              ✍️ Parametric Line-Item Entry Form
            </p>
          </div>
        </div>

        {/* Tab & Search Strip */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 mb-3 pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
            <button
              onClick={() => setSelectedSourceTab('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'all'
                  ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-xs'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200'
              }`}
            >
              All Channels ({rfqs.length})
            </button>
            <button
              onClick={() => setSelectedSourceTab('email_gateway')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'email_gateway'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40'
              }`}
            >
              via Email Upload ({emailGatewayRFQs.length})
            </button>
            <button
              onClick={() => setSelectedSourceTab('web_portal')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'web_portal'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40'
              }`}
            >
              AI RFQ Create ({webPortalRFQs.length})
            </button>
            <button
              onClick={() => setSelectedSourceTab('manual_entry')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'manual_entry'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40'
              }`}
            >
              Manual RFQ ({manualRFQs.length})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by origin or title..."
              className="has-leading-icon w-full pl-10 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Source Items List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {filteredRfqs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500">
              <Mail size={36} className="mx-auto mb-2 opacity-40 text-amber-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No requisitions from this intake source</p>
              <p className="text-xs mt-1 text-slate-400">Send an RFQ email to your corporate gateway or use AI RFQ generator to ingest.</p>
            </div>
          ) : (
            filteredRfqs.map((rfq) => (
              <div
                key={rfq.id}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-amber-400 dark:hover:border-amber-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black mono text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</span>
                    {(rfq.source === 'email_gateway' || rfq.source === 'email_upload') && (
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1.5">
                        Origin: {rfq.sourceEmail || rfq.sourceFileName || UI_STRINGS.recordPlaceholders.notRecorded}
                      </span>
                    )}
                    {rfq.source === 'manual_entry' && (
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
                        Direct Keyed Requisition
                      </span>
                    )}
                    {(rfq.source === 'web_portal' || rfq.source === 'ai_extraction' || (!rfq.source && rfq.source !== 'manual_entry')) && (
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800 flex items-center gap-1.5">
                        Document: {rfq.sourceFileName || UI_STRINGS.recordPlaceholders.notRecorded}
                      </span>
                    )}
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-gray-700 text-slate-800 dark:text-gray-200">
                      {rfq.status}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{rfq.title}</h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-gray-300">
                    <div>
                      Category: <strong className="text-slate-800 dark:text-gray-100">{rfq.category}</strong>
                    </div>
                    <div>
                      Extracted Items: <strong className="text-slate-800 dark:text-gray-100">{rfq.extractedEntities ? `${rfq.extractedEntities.length} items` : UI_STRINGS.recordPlaceholders.notRecorded}</strong>
                    </div>
                    <div>
                      Quotes Received: <strong className="text-slate-800 dark:text-gray-100">{rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0)}</strong>
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                  <Link
                    href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                    onClick={onClose}
                    className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View RFQ Details"
                  >
                    <Eye size={13} /> View RFQ
                  </Link>

                  {((rfq.quotesCount && rfq.quotesCount > 0) || (rfq.quotes && rfq.quotes.length > 0) || rfq.status === 'AI Recommended' || rfq.status === 'In Evaluation') && (
                    <button
                      onClick={() => {
                        onClose();
                        if (onNavigateToMatrix) {
                          onNavigateToMatrix(rfq);
                        } else {
                          onOpenDeepDive(rfq);
                        }
                      }}
                      className="btn btn-emerald btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                      title="View Quotes"
                    >
                      <Sparkles size={13} /> View Quotes
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Informational Box */}
        <div className="mt-3.5 p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5 shrink-0">
          <Info size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            <strong>Autonomous Routing Pipeline:</strong> Inbound RFQ emails are instantly parsed via LLM OCR to extract BOQs and match empanelled vendor rosters before initiating multi-channel chasers.
          </span>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3.5 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <span>Showing {filteredRfqs.length} requisitions in selected channel</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   3. SUPPLIER QUOTES MODAL
════════════════════════════════════════════════════════════════════════════════ */
interface SupplierQuotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onOpenDeepDive: (rfq: RFQItem) => void;
}

export function SupplierQuotesModal({
  isOpen,
  onClose,
  rfqs,
  onNavigateToMatrix,
  onOpenDeepDive,
}: SupplierQuotesModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // Flatten quotes across active RFQs (respecting 48h/closure sealing & V0 privacy)
  const allQuotesWithRfq = useMemo(() => {
    const list: Array<{ quote: QuoteComparison; rfq: RFQItem }> = [];
    rfqs.forEach((rfq) => {
      const mode = String(rfq.sourcingMode || '').trim().toLowerCase();
      if (mode === 'mode_0' || mode === 'v0' || mode === 'version_0') return;
      if (isBuyerQuotesSealed(rfq, 'buyer')) return;
      if (rfq.quotes && rfq.quotes.length > 0) {
        rfq.quotes.forEach((quote) => {
          list.push({ quote, rfq });
        });
      }
    });
    return list;
  }, [rfqs]);

  if (!isOpen) return null;

  const totalQuotesCount = allQuotesWithRfq.length;
  const inEvaluationRfqs = rfqs.filter((r) => r.status === 'In Evaluation' || r.status === 'AI Recommended');
  const bestScore = allQuotesWithRfq.length > 0 ? Math.max(...allQuotesWithRfq.map((q) => q.quote.aiMatchScore || 0)) : 0;
  const compliantQuotesCount = allQuotesWithRfq.filter((q) => q.quote.complianceStatus === 'Fully Compliant').length;

  const filteredQuotes = allQuotesWithRfq.filter(({ quote, rfq }) => {
    if (!quote || !rfq) return false;
    if (!searchTerm || !searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    return (
      String(quote.vendorName || '').toLowerCase().includes(term) ||
      String(quote.vendorCategory || '').toLowerCase().includes(term) ||
      String(rfq.rfqNumber || '').toLowerCase().includes(term) ||
      String(rfq.title || '').toLowerCase().includes(term) ||
      String(rfq.category || '').toLowerCase().includes(term) ||
      String(quote.complianceStatus || '').toLowerCase().includes(term)
    );
  });

  const sortedQuotes = [...filteredQuotes].sort((a, b) => {
    return (b.quote.aiMatchScore || 0) - (a.quote.aiMatchScore || 0);
  });

  const getComplianceBadge = (status: QuoteComparison['complianceStatus']) => {
    switch (status) {
      case 'Fully Compliant':
        return <span className="badge badge-emerald text-xs px-2.5 py-1">✓ Fully Compliant</span>;
      case 'Minor Exception':
        return <span className="badge badge-amber text-xs px-2.5 py-1">⚠ Minor Exception</span>;
      default:
        return <span className="badge badge-blue text-xs px-2.5 py-1">⏳ {status || UI_STRINGS.recordPlaceholders.notRecorded}</span>;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-sky-200 dark:border-cyan-900/50 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-sky-50 dark:bg-cyan-950/60 text-sky-600 dark:text-cyan-400 border border-sky-200 dark:border-cyan-800 shadow-xs">
              <Clock size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Supplier Quotes & Evaluation Matrix</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 dark:bg-cyan-950 text-sky-800 dark:text-cyan-300 border border-sky-300 dark:border-cyan-800">
                  {totalQuotesCount} Received Bids
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Consolidated parametric view of supplier price quotations, lead times, compliance ratings, and AI match scores.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* Top KPI Metrics Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-4 shrink-0">
          <div className="p-3.5 rounded-xl bg-sky-50/60 dark:bg-cyan-950/30 border border-sky-200 dark:border-cyan-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-cyan-400">Total Bids Ingested</div>
            <div className="text-2xl font-black text-sky-900 dark:text-cyan-100 mono mt-1">{totalQuotesCount}</div>
            <div className="text-xs text-sky-600 dark:text-cyan-400 font-semibold mt-0.5">Across all active RFQs</div>
          </div>

          <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">In Evaluation</div>
            <div className="text-2xl font-black text-blue-900 dark:text-blue-200 mono mt-1">{inEvaluationRfqs.length}</div>
            <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold mt-0.5">RFQs under review</div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Top Match Score</div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-1">
              {bestScore > 0 ? `${bestScore}%` : UI_STRINGS.recordPlaceholders.notAvailable}
            </div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">Highest AI parametric match</div>
          </div>

          <div className="p-3.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">Fully Compliant Bids</div>
            <div className="text-2xl font-black text-purple-900 dark:text-purple-200 mono mt-1">{compliantQuotesCount}</div>
            <div className="text-xs text-purple-600 dark:text-purple-400 font-semibold mt-0.5">Technical specs verified</div>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="relative flex-1 w-full">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by vendor name, item title, or RFQ..."
              className="has-leading-icon w-full pl-10 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Quotes List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {sortedQuotes.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500">
              <Clock size={36} className="mx-auto mb-2 opacity-40 text-sky-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No supplier quotes found</p>
              <p className="text-xs mt-1 text-slate-400">
                {rfqs.length > 0
                  ? 'Suppliers have been invited and autonomous follow-ups are chasing bids.'
                  : 'Create or ingest an RFQ to start receiving supplier quotes.'}
              </p>
              {rfqs.length > 0 && (
                <button
                  onClick={() => {
                    onClose();
                    onNavigateToMatrix(rfqs[0]);
                  }}
                  className="btn btn-secondary btn-sm font-bold mt-3 inline-flex items-center gap-1.5"
                >
                  <Sparkles size={13} /> View Quotes
                </button>
              )}
            </div>
          ) : (
            sortedQuotes.map(({ quote, rfq }, idx) => (
              <div
                key={`${rfq.id}-${quote.vendorId}-${idx}`}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-sky-400 dark:hover:border-sky-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black mono text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Building2 size={14} className="text-slate-400" /> {quote.vendorName}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-600">
                      {quote.vendorCategory || UI_STRINGS.recordPlaceholders.notRecorded}
                    </span>
                    {quote.isBestPrice && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300">
                        ⚡ Lowest Quoted Price
                      </span>
                    )}
                    {getComplianceBadge(quote.complianceStatus)}
                  </div>

                  <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">{rfq.title}</p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Quoted Price</span>
                      <span className="text-sm font-black text-slate-900 dark:text-white mono">
                        {formatQuotedPrice(quote)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Lead Time</span>
                      <span className="text-sm font-bold text-slate-800 dark:text-gray-200 mono">
                        {quote.leadTimeDays ? `${quote.leadTimeDays} Days` : UI_STRINGS.recordPlaceholders.notAvailable}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">AI Match Score</span>
                      <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 mono">
                        {quote.aiMatchScore !== undefined ? `${quote.aiMatchScore}%` : UI_STRINGS.recordPlaceholders.notAvailable}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Warranty & Terms</span>
                      <span className="text-xs text-slate-700 dark:text-gray-300 font-semibold truncate block">
                        {quote.warrantyYears ? `${quote.warrantyYears} yr` : UI_STRINGS.recordPlaceholders.notAvailable}{quote.paymentTerms ? ` • ${quote.paymentTerms}` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                  <Link
                    href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                    onClick={onClose}
                    className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View RFQ Details"
                  >
                    <Eye size={13} /> View RFQ
                  </Link>

                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToMatrix(rfq);
                    }}
                    className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View Quotes"
                  >
                    <Sparkles size={13} /> View Quotes
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <span>Showing {sortedQuotes.length} quotes across active pipeline</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   4. LIVE MULTI-CHANNEL OUTREACH OVERVIEW MODAL
════════════════════════════════════════════════════════════════════════════════ */
export interface LiveOutreachModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onOpenDeepDive: (rfq: RFQItem) => void;
  onNavigateToMatrix?: (rfq: RFQItem) => void;
}

export function LiveOutreachModal({
  isOpen,
  onClose,
  rfqs,
  onOpenDeepDive,
  onNavigateToMatrix,
}: LiveOutreachModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'call' | 'whatsapp' | 'sms' | 'email'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'engaged' | 'delivered' | 'pending'>('all');
  const [selectedRfqFilter, setSelectedRfqFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grouped' | 'records'>('grouped');
  const [sortField, setSortField] = useState<'activity' | 'vendors' | 'newest' | 'engagement'>('activity');
  const [currentPage, setCurrentPage] = useState(1);

  // Reset pagination on filter or view mode change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, channelFilter, statusFilter, selectedRfqFilter, viewMode, sortField]);

  // Aggregate metrics across ALL RFQs
  const telemetrySummary = useMemo(() => {
    let totalWa = 0;
    let totalWaReplied = 0;
    let totalWaRead = 0;
    let totalWaDelivered = 0;
    let totalSms = 0;
    let totalSmsClicked = 0;
    let totalSmsDelivered = 0;
    let totalCalls = 0;
    let totalCallsConnected = 0;
    let totalCallsVoicemail = 0;
    let totalEmail = 0;
    let totalEmailDelivered = 0;
    let totalVendors = 0;
    let totalEngaged = 0;

    (rfqs || []).forEach((rfq) => {
      if (!rfq) return;
      const fu = rfq.followUpData;
      const metrics = computeRFQFollowUpMetrics(rfq);
      const vendors = normalizeFollowUpVendors(rfq);

      totalWa += fu?.whatsappStats?.total || 0;
      totalWaReplied += fu?.whatsappStats?.replied || metrics.waReplied || 0;
      totalWaRead += fu?.whatsappStats?.read || metrics.waRead || 0;
      totalWaDelivered += fu?.whatsappStats?.delivered || metrics.waDelivered || 0;

      totalSms += fu?.smsStats?.total || 0;
      totalSmsClicked += fu?.smsStats?.clicked || 0;
      totalSmsDelivered += fu?.smsStats?.delivered || metrics.smsDelivered || 0;

      totalCalls += fu?.callStats?.total || 0;
      totalCallsConnected += fu?.callStats?.connected || metrics.callConnected || 0;
      totalCallsVoicemail += (fu?.callStats as any)?.voicemail || vendors.filter((v) => v.call?.status === 'voicemail').length;

      totalEmail += fu?.emailStats?.total || 0;
      totalEmailDelivered += fu?.emailStats?.delivered || metrics.emailDelivered || 0;

      totalVendors += vendors.length;
      totalEngaged += metrics.responded || 0;
    });

    const totalOutreachMessages = totalWa + totalSms + totalEmail;
    const engagementRate = totalVendors > 0 ? Math.round((totalEngaged / totalVendors) * 100) : 0;

    return {
      totalOutreachMessages,
      totalWa,
      totalWaReplied,
      totalWaRead,
      totalWaDelivered,
      totalSms,
      totalSmsClicked,
      totalSmsDelivered,
      totalCalls,
      totalCallsConnected,
      totalCallsVoicemail,
      totalEmail,
      totalEmailDelivered,
      totalVendors,
      totalEngaged,
      engagementRate,
    };
  }, [rfqs]);

  // Flatten vendor outreach records across all RFQs for granular record-level telemetry view
  const flattenedRecords = useMemo(() => {
    const list: Array<{
      id: string;
      rfq: RFQItem;
      vendor: VendorFollowUpRecord;
      vendorType: 'buyer' | 'procucev';
      callStatus: string;
      whatsappStatus: string;
      smsStatus: string;
      emailStatus: string;
      lastInteraction: string;
      nextFollowUp: string;
    }> = [];

    (rfqs || []).forEach((rfq) => {
      if (!rfq) return;
      const isHybridOrAutonomous = rfq.sourcingMode === 'mode_2' || rfq.sourcingMode === 'mode_3';
      const assignedVendorKeys = new Set(
        (rfq.assignedVendors || []).flatMap((av: any) => {
          if (!av) return [];
          if (typeof av === 'string') return [av.trim().toLowerCase()];
          return [av.id, av.name].filter((k: any): k is string => Boolean(k)).map((k: string) => k.trim().toLowerCase());
        })
      );
      const vendors = normalizeFollowUpVendors(rfq);

      vendors.forEach((v, idx) => {
        if (!v) return;
        const vId = (v.vendorId || '').trim().toLowerCase();
        const vName = (v.vendorName || '').trim().toLowerCase();
        const addedByBuyer = assignedVendorKeys.has(vId) || assignedVendorKeys.has(vName);
        const vendorType: 'buyer' | 'procucev' = addedByBuyer ? 'buyer' : isHybridOrAutonomous ? 'procucev' : 'buyer';

        list.push({
          id: `${rfq.id}-${v.vendorId || v.vendorName || idx}`,
          rfq,
          vendor: v,
          vendorType,
          callStatus: v.call?.status || 'not_dispatched',
          whatsappStatus: v.whatsapp?.status || 'not_dispatched',
          smsStatus: v.sms?.status || 'not_dispatched',
          emailStatus: (v as any).emailStatus || (v.emailSent ? 'delivered' : 'not_dispatched'),
          lastInteraction: v.lastInteraction || rfq.createdAt || '',
          nextFollowUp: (v as any).nextFollowUp || rfq.followUpData?.nextScheduledChaser || '',
        });
      });
    });

    return list;
  }, [rfqs]);

  // Filtered RFQs for Grouped View
  const filteredRfqs = useMemo(() => {
    return (rfqs || [])
      .filter((rfq) => {
        if (!rfq) return false;
        if (selectedRfqFilter !== 'all' && (rfq.rfqNumber || rfq.id) !== selectedRfqFilter) {
          return false;
        }

        const metrics = computeRFQFollowUpMetrics(rfq);
        const vendors = normalizeFollowUpVendors(rfq);

        if (channelFilter === 'whatsapp') {
          const hasWa = (rfq.followUpData?.whatsappStats?.total || 0) > 0 || vendors.some((v) => v.whatsapp.status !== 'not_dispatched');
          if (!hasWa) return false;
        } else if (channelFilter === 'call') {
          const hasCall = (rfq.followUpData?.callStats?.total || 0) > 0 || vendors.some((v) => v.call.status !== 'not_dispatched');
          if (!hasCall) return false;
        } else if (channelFilter === 'sms') {
          const hasSms = (rfq.followUpData?.smsStats?.total || 0) > 0 || vendors.some((v) => v.sms.status !== 'not_dispatched');
          if (!hasSms) return false;
        } else if (channelFilter === 'email') {
          const hasEmail = (rfq.followUpData?.emailStats?.total || 0) > 0 || vendors.some((v) => Boolean(v.emailSent));
          if (!hasEmail) return false;
        }

        if (statusFilter === 'engaged') {
          const isEngaged = (metrics.responded || 0) > 0 || (metrics.waReplied || 0) > 0 || (metrics.callConnected || 0) > 0;
          if (!isEngaged) return false;
        } else if (statusFilter === 'delivered') {
          const isDelivered = (metrics.waDelivered || 0) > 0 || (metrics.smsDelivered || 0) > 0 || (metrics.emailDelivered || 0) > 0;
          if (!isDelivered) return false;
        } else if (statusFilter === 'pending') {
          const hasPending = vendors.some(
            (v) =>
              v.whatsapp.status === 'pending' ||
              v.call.status === 'scheduled' ||
              v.whatsapp.status === 'not_dispatched' ||
              v.call.status === 'not_dispatched'
          );
          if (!hasPending) return false;
        }

        if (searchTerm) {
          const term = searchTerm.trim().toLowerCase();
          const matchesRfq =
            (rfq.rfqNumber || '').toLowerCase().includes(term) ||
            (rfq.title || '').toLowerCase().includes(term) ||
            (rfq.category || '').toLowerCase().includes(term) ||
            (rfq.status || '').toLowerCase().includes(term);
          const matchesVendor = vendors.some((v) =>
            ((v.vendorName || '') + ' ' + (v.contactPerson || '') + ' ' + (v.phone || '') + ' ' + (typeof v.email === 'string' ? v.email : (v.email as any)?.address || ''))
              .toLowerCase()
              .includes(term)
          );
          if (!matchesRfq && !matchesVendor) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const metricsA = computeRFQFollowUpMetrics(a);
        const metricsB = computeRFQFollowUpMetrics(b);
        const vendorsA = normalizeFollowUpVendors(a);
        const vendorsB = normalizeFollowUpVendors(b);

        if (sortField === 'activity') {
          const outA = (a.followUpData?.whatsappStats?.total || 0) + (a.followUpData?.smsStats?.total || 0) + (a.followUpData?.callStats?.total || 0);
          const outB = (b.followUpData?.whatsappStats?.total || 0) + (b.followUpData?.smsStats?.total || 0) + (b.followUpData?.callStats?.total || 0);
          return outB - outA;
        }
        if (sortField === 'vendors') {
          return vendorsB.length - vendorsA.length;
        }
        if (sortField === 'engagement') {
          const rateA = vendorsA.length > 0 ? (metricsA.responded || 0) / vendorsA.length : 0;
          const rateB = vendorsB.length > 0 ? (metricsB.responded || 0) / vendorsB.length : 0;
          return rateB - rateA;
        }
        if (sortField === 'newest') {
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        }
        const outA = (a.followUpData?.whatsappStats?.total || 0) + (a.followUpData?.smsStats?.total || 0) + (a.followUpData?.callStats?.total || 0);
        const outB = (b.followUpData?.whatsappStats?.total || 0) + (b.followUpData?.smsStats?.total || 0) + (b.followUpData?.callStats?.total || 0);
        return outB - outA;
      });
  }, [rfqs, selectedRfqFilter, channelFilter, statusFilter, searchTerm, sortField]);

  // Filtered records for All Records View
  const filteredRecords = useMemo(() => {
    return flattenedRecords
      .filter((rec) => {
        if (selectedRfqFilter !== 'all' && (rec.rfq.rfqNumber || rec.rfq.id) !== selectedRfqFilter) {
          return false;
        }

        if (channelFilter === 'whatsapp' && rec.whatsappStatus === 'not_dispatched') return false;
        if (channelFilter === 'call' && rec.callStatus === 'not_dispatched') return false;
        if (channelFilter === 'sms' && rec.smsStatus === 'not_dispatched') return false;
        if (channelFilter === 'email' && rec.emailStatus === 'not_dispatched') return false;

        const isEngaged =
          rec.whatsappStatus === 'replied' ||
          rec.callStatus === 'connected' ||
          rec.callStatus === 'completed' ||
          rec.smsStatus === 'clicked' ||
          rec.vendor.bidStatus === 'Submitted';

        const isDelivered =
          rec.whatsappStatus === 'delivered' ||
          rec.whatsappStatus === 'read' ||
          rec.smsStatus === 'delivered' ||
          rec.callStatus === 'voicemail' ||
          rec.emailStatus === 'delivered';

        if (statusFilter === 'engaged' && !isEngaged) return false;
        if (statusFilter === 'delivered' && !isDelivered) return false;
        if (statusFilter === 'pending' && (isEngaged || isDelivered)) return false;

        if (searchTerm) {
          const term = searchTerm.trim().toLowerCase();
          const target = [
            rec.rfq.rfqNumber,
            rec.rfq.title,
            rec.vendor.vendorName,
            rec.vendor.contactPerson,
            rec.vendor.phone,
            typeof rec.vendor.email === 'string' ? rec.vendor.email : (rec.vendor.email as any)?.address,
            rec.callStatus,
            rec.whatsappStatus,
            rec.smsStatus,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!target.includes(term)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortField === 'newest') {
          return new Date(b.lastInteraction || b.rfq.createdAt || 0).getTime() - new Date(a.lastInteraction || a.rfq.createdAt || 0).getTime();
        }
        if (sortField === 'vendors') {
          return (a.vendor.vendorName || '').localeCompare(b.vendor.vendorName || '');
        }
        if (sortField === 'engagement') {
          const scoreA = a.vendor.bidStatus === 'Submitted' ? 2 : a.whatsappStatus === 'replied' || a.callStatus === 'connected' ? 1 : 0;
          const scoreB = b.vendor.bidStatus === 'Submitted' ? 2 : b.whatsappStatus === 'replied' || b.callStatus === 'connected' ? 1 : 0;
          return scoreB - scoreA;
        }
        const outA = (a.rfq.followUpData?.whatsappStats?.total || 0) + (a.rfq.followUpData?.smsStats?.total || 0) + (a.rfq.followUpData?.callStats?.total || 0);
        const outB = (b.rfq.followUpData?.whatsappStats?.total || 0) + (b.rfq.followUpData?.smsStats?.total || 0) + (b.rfq.followUpData?.callStats?.total || 0);
        return outB - outA;
      });
  }, [flattenedRecords, selectedRfqFilter, channelFilter, statusFilter, searchTerm, sortField]);

  if (!isOpen) return null;

  // Pagination calculations
  const pageSize = viewMode === 'grouped' ? 6 : 10;
  const currentTotalItems = viewMode === 'grouped' ? filteredRfqs.length : filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(currentTotalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;

  const paginatedRfqs = filteredRfqs.slice(startIdx, endIdx);
  const paginatedRecords = filteredRecords.slice(startIdx, endIdx);

  const getModeBadge = (modeId?: string) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
        style={{
          backgroundColor: `${mode.badgeColor}15`,
          color: mode.badgeColor,
          border: `1px solid ${mode.badgeColor}35`,
        }}
      >
        {mode.code} ({mode.shortLabel})
      </span>
    );
  };

  const getRfqStatusBadge = (status: RFQItem['status']) => {
    switch (status) {
      case 'AI Recommended':
        return <span className="badge badge-emerald text-[11px] px-2 py-0.5">AI Recommended</span>;
      case 'In Evaluation':
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">In Evaluation</span>;
      case 'Quotes Received':
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">Quotes Received</span>;
      case 'PO Generated':
        return <span className="badge badge-purple text-[11px] px-2 py-0.5">PO Generated</span>;
      case 'Parsing':
        return <span className="badge badge-amber text-[11px] px-2 py-0.5">OCR Parsing</span>;
      case 'Closed':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-500 border border-slate-200 dark:border-gray-700">Closed</span>;
      default:
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">{status}</span>;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-emerald-500/40 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-xs">
              <Radio size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Live Multi-Channel Outreach
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {(rfqs || []).filter(Boolean).length} Active RFQs
                </span>
                <span className="badge badge-purple text-xs font-bold px-2 py-0.5">Real-Time Telemetry</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Autonomous vendor follow-up tracking across Voice Bot, WhatsApp, Verified SMS, and Email escalations.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* Aggregate KPI Strip across ALL RFQs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 my-4 shrink-0">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">Total Outreach</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white mono mt-1">
              {telemetrySummary.totalOutreachMessages}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-gray-400 font-semibold mt-0.5 truncate">
              {telemetrySummary.totalVendors} Empanelled Vendors
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <MessageSquare size={12} /> WhatsApp Bot
            </div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-1">
              {telemetrySummary.totalWa}
            </div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 truncate">
              {telemetrySummary.totalWaReplied} Replied • {telemetrySummary.totalWaRead} Read
            </div>
          </div>

          <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-cyan-950/30 border border-sky-200 dark:border-cyan-800/40 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-cyan-300 flex items-center gap-1">
              <Smartphone size={12} /> Verified SMS
            </div>
            <div className="text-2xl font-black text-sky-900 dark:text-cyan-200 mono mt-1">
              {telemetrySummary.totalSms}
            </div>
            <div className="text-[10px] text-sky-600 dark:text-cyan-400 font-semibold mt-0.5 truncate">
              {telemetrySummary.totalSmsClicked} Clicks • {telemetrySummary.totalSmsDelivered} Delivered
            </div>
          </div>

          <div className="p-3 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-1">
              <Phone size={12} /> Voice Calls
            </div>
            <div className="text-2xl font-black text-purple-900 dark:text-purple-200 mono mt-1">
              {telemetrySummary.totalCalls}
            </div>
            <div className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold mt-0.5 truncate">
              {telemetrySummary.totalCallsConnected} Connected • {telemetrySummary.totalCallsVoicemail} Voicemail
            </div>
          </div>

          <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/40 shadow-2xs col-span-2 sm:col-span-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Engagement</div>
            <div className="text-2xl font-black text-indigo-900 dark:text-indigo-200 mono mt-1">
              {telemetrySummary.engagementRate}%
            </div>
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5 truncate">
              {telemetrySummary.totalEngaged} Vendors Responded
            </div>
          </div>
        </div>

        {/* Filter, Search & View Controls Bar */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-800/70 border border-slate-200 dark:border-gray-800 space-y-3 shrink-0">
          <div className="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search across all RFQs by number, title, vendor, contact, phone..."
                className="has-leading-icon w-full pr-8 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* RFQ Dropdown Selector */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-gray-400">RFQ:</span>
              <select
                aria-label="Filter by RFQ"
                value={selectedRfqFilter}
                onChange={(e) => setSelectedRfqFilter(e.target.value)}
                className="text-xs font-bold py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="all">All RFQs ({(rfqs || []).filter(Boolean).length})</option>
                {(rfqs || []).filter((r): r is RFQItem => Boolean(r)).map((r) => (
                  <option key={r.id || r.rfqNumber} value={r.rfqNumber || r.id}>
                    {r.rfqNumber} {r.title ? `— ${r.title.slice(0, 28)}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-gray-400">Sort:</span>
              <select
                aria-label="Sort Outreach Items"
                value={sortField}
                onChange={(e) => setSortField(e.target.value as any)}
                className="text-xs font-bold py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="activity">Most Outreach Activity</option>
                <option value="vendors">Most Empanelled Vendors</option>
                <option value="engagement">Highest Response Rate</option>
                <option value="newest">Newest Requisitions</option>
              </select>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center bg-slate-200/80 dark:bg-gray-700/80 p-0.5 rounded-lg shrink-0">
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
                  viewMode === 'grouped'
                    ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                    : 'text-slate-600 dark:text-gray-300 hover:text-slate-900'
                }`}
              >
                <Layers size={13} /> Grouped by RFQ
              </button>
              <button
                onClick={() => setViewMode('records')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
                  viewMode === 'records'
                    ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                    : 'text-slate-600 dark:text-gray-300 hover:text-slate-900'
                }`}
              >
                <FileText size={13} /> All Records Table
              </button>
            </div>
          </div>

          {/* Secondary Filter Row: Channel Tabs & Status Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-gray-800">
            {/* Channel Tabs */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-gray-400 mr-1">Channel:</span>
              <button
                onClick={() => setChannelFilter('all')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                  channelFilter === 'all'
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-2xs'
                    : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:border-slate-400'
                }`}
              >
                All Channels
              </button>
              <button
                onClick={() => setChannelFilter('whatsapp')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  channelFilter === 'whatsapp'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:border-emerald-400'
                }`}
              >
                <MessageSquare size={12} /> WhatsApp
              </button>
              <button
                onClick={() => setChannelFilter('call')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  channelFilter === 'call'
                    ? 'bg-purple-600 text-white shadow-2xs'
                    : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:border-purple-400'
                }`}
              >
                <Phone size={12} /> Voice Calls
              </button>
              <button
                onClick={() => setChannelFilter('sms')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  channelFilter === 'sms'
                    ? 'bg-sky-600 text-white shadow-2xs'
                    : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:border-sky-400'
                }`}
              >
                <Smartphone size={12} /> SMS
              </button>
              <button
                onClick={() => setChannelFilter('email')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  channelFilter === 'email'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:border-amber-400'
                }`}
              >
                <Mail size={12} /> Email
              </button>
            </div>

            {/* Status Outcome Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-gray-400">Status:</span>
              <div className="flex items-center gap-1">
                {(['all', 'engaged', 'delivered', 'pending'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2 py-0.5 text-[11px] font-bold rounded capitalize transition-all ${
                      statusFilter === st
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-400'
                        : 'bg-white dark:bg-gray-900 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700 hover:text-slate-700'
                    }`}
                  >
                    {st === 'engaged' ? 'Responded / Connected' : st}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto my-3 pr-1 space-y-3 min-h-[220px]">
          {viewMode === 'grouped' ? (
            /* GROUPED BY RFQ VIEW */
            paginatedRfqs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-gray-500">
                <Radio size={32} className="mx-auto mb-2 opacity-40 text-emerald-500" />
                <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No Requisitions Found</p>
                <p className="text-xs text-slate-400 mt-1">No RFQs match your current search and channel filter criteria.</p>
                {(searchTerm || channelFilter !== 'all' || statusFilter !== 'all' || selectedRfqFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setChannelFilter('all');
                      setStatusFilter('all');
                      setSelectedRfqFilter('all');
                    }}
                    className="btn btn-secondary btn-xs font-bold mt-3 inline-flex items-center gap-1"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              paginatedRfqs.map((rfq) => {
                const metrics = computeRFQFollowUpMetrics(rfq);
                const vendors = normalizeFollowUpVendors(rfq);
                const responseRate = vendors.length > 0 ? Math.round(((metrics.responded || 0) / vendors.length) * 100) : 0;
                const nextFollowUps = computeRFQFollowUpTimes(rfq.createdAt);
                const hasQuotes = (rfq.quotesCount && rfq.quotesCount > 0) || (rfq.quotes && rfq.quotes.length > 0);

                return (
                  <div
                    key={rfq.id}
                    className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-emerald-400 dark:hover:border-emerald-600 transition-all shadow-2xs flex flex-col gap-3"
                  >
                    {/* RFQ Meta Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-800">
                            {rfq.rfqNumber}
                          </span>
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {rfq.title}
                          </span>
                          {getModeBadge(rfq.sourcingMode)}
                          {getRfqStatusBadge(rfq.status)}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400 flex-wrap">
                          <span>Category: <strong className="text-slate-700 dark:text-gray-300">{rfq.category || 'General'}</strong></span>
                          <span>•</span>
                          <span>Target Delivery: <strong className="text-slate-700 dark:text-gray-300">{rfq.targetDeliveryDate || UI_STRINGS.recordPlaceholders.notRecorded}</strong></span>
                          <span>•</span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold">{vendors.length} Vendors Empanelled</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Link
                          href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                          onClick={onClose}
                          className="btn btn-secondary btn-xs font-bold flex items-center gap-1"
                          title="View RFQ Requisition Details"
                        >
                          <Eye size={12} /> View RFQ
                        </Link>

                        {hasQuotes && (
                          <button
                            onClick={() => {
                              onClose();
                              if (onNavigateToMatrix) {
                                onNavigateToMatrix(rfq);
                              } else {
                                onOpenDeepDive(rfq);
                              }
                            }}
                            className="btn btn-emerald btn-xs font-bold flex items-center gap-1 shadow-2xs"
                            title="View Quotes Matrix"
                          >
                            <Sparkles size={12} /> Quotes
                          </button>
                        )}

                        <button
                          onClick={() => {
                            onClose();
                            onOpenDeepDive(rfq);
                          }}
                          className="btn btn-primary btn-xs font-bold flex items-center gap-1 shadow-2xs"
                          title="Open Full Multi-Channel Follow-Up Telemetry"
                        >
                          <Phone size={12} /> Deep Dive
                        </button>
                      </div>
                    </div>

                    {/* 4-Channel Strip for this RFQ */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      <div className="p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                        <span className="text-[10px] text-purple-700 dark:text-purple-300 font-bold uppercase tracking-wide flex items-center gap-1">
                          <span>📞</span> Voice Calls
                        </span>
                        <div className="text-sm font-black mono text-slate-900 dark:text-white mt-0.5">
                          {metrics.callConnected || 0} / {metrics.callTotal || vendors.length} Connected
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">Next: {formatNextFollowUp(nextFollowUps.call)}</div>
                      </div>

                      <div className="p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-wide flex items-center gap-1">
                          <MessageSquare size={11} /> WhatsApp Bot
                        </span>
                        <div className="text-sm font-black mono text-slate-900 dark:text-white mt-0.5">
                          {metrics.waReplied || 0} Replied • {metrics.waRead || 0} Read
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">Next: {formatNextFollowUp(nextFollowUps.whatsapp)}</div>
                      </div>

                      <div className="p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                        <span className="text-[10px] text-sky-700 dark:text-cyan-300 font-bold uppercase tracking-wide flex items-center gap-1">
                          <Smartphone size={11} /> Verified SMS
                        </span>
                        <div className="text-sm font-black mono text-slate-900 dark:text-white mt-0.5">
                          {metrics.smsDelivered || 0} / {metrics.smsTotal || vendors.length} Delivered
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">Next: {formatNextFollowUp(nextFollowUps.sms)}</div>
                      </div>

                      <div className="p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                        <span className="text-[10px] text-amber-700 dark:text-amber-300 font-bold uppercase tracking-wide flex items-center gap-1">
                          <Mail size={11} /> Inbound / Escalation
                        </span>
                        <div className="text-sm font-black mono text-slate-900 dark:text-white mt-0.5">
                          {metrics.emailDelivered || 0} Delivered
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">Next: {formatNextFollowUp(nextFollowUps.email)}</div>
                      </div>
                    </div>

                    {/* Progress Bar & Vendors Roster Preview */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-gray-400">
                        <span>Engagement Response Rate</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {metrics.responded || 0} of {vendors.length} Vendors Engaged ({responseRate}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, responseRate)}%` }}
                        />
                      </div>

                      {/* Mini Vendor Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Roster:</span>
                        {vendors.slice(0, 5).map((v, idx) => (
                          <span
                            key={v.vendorId || idx}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 flex items-center gap-1"
                          >
                            <Building2 size={10} className="text-slate-400" />
                            {v.vendorName}
                            {v.whatsapp.status === 'replied' ? (
                              <span className="text-emerald-500 font-bold">💬 Bid In</span>
                            ) : v.call.status === 'connected' ? (
                              <span className="text-purple-500 font-bold">📞 Connected</span>
                            ) : v.whatsapp.status === 'read' ? (
                              <span className="text-blue-500">💬 Read</span>
                            ) : (
                              <span className="text-slate-400">⏳ Follow-up</span>
                            )}
                          </span>
                        ))}
                        {vendors.length > 5 && (
                          <span className="text-[10px] text-slate-400 font-medium">
                            +{vendors.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            /* ALL RECORDS FLAT TELEMETRY TABLE VIEW */
            paginatedRecords.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-gray-500">
                <Radio size={32} className="mx-auto mb-2 opacity-40 text-emerald-500" />
                <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No Outreach Records Found</p>
                <p className="text-xs text-slate-400 mt-1">No individual vendor records match your current filter settings.</p>
                {(searchTerm || channelFilter !== 'all' || statusFilter !== 'all' || selectedRfqFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setChannelFilter('all');
                      setStatusFilter('all');
                      setSelectedRfqFilter('all');
                    }}
                    className="btn btn-secondary btn-xs font-bold mt-3 inline-flex items-center gap-1"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-gray-800/80 text-slate-600 dark:text-gray-300 uppercase text-[10px] font-extrabold tracking-wider border-b border-slate-200 dark:border-gray-800">
                      <th className="py-2.5 px-3">Requisition</th>
                      <th className="py-2.5 px-3">Empanelled Vendor</th>
                      <th className="py-2.5 px-3">Contact Details</th>
                      <th className="py-2.5 px-3">WhatsApp Bot</th>
                      <th className="py-2.5 px-3">Voice Calls</th>
                      <th className="py-2.5 px-3">SMS</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                    {paginatedRecords.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-medium">
                          <span className="mono font-bold text-emerald-700 dark:text-emerald-400 block">
                            {row.rfq.rfqNumber}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-gray-400 truncate max-w-[160px] block">
                            {row.rfq.title}
                          </span>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                            <Building2 size={12} className="text-slate-400 shrink-0" />
                            <span>{row.vendor.vendorName}</span>
                          </div>
                          <span
                            className={`inline-block text-[9px] font-bold px-1.5 py-0.2 rounded mt-0.5 ${
                              row.vendorType === 'buyer'
                                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            }`}
                          >
                            {row.vendorType === 'buyer' ? 'Buyer Vendor' : 'Procucev Network'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-gray-400">
                          <div className="font-semibold text-slate-800 dark:text-gray-200">{row.vendor.contactPerson || row.vendor.vendorName}</div>
                          <div className="mono text-[10px] text-slate-400">
                            {row.vendor.phone || (typeof row.vendor.email === 'string' ? row.vendor.email : (row.vendor.email as any)?.address) || '—'}
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          {getWhatsAppBadge(row.whatsappStatus)}
                        </td>

                        <td className="py-2.5 px-3">
                          {getCallBadge(row.callStatus)}
                        </td>

                        <td className="py-2.5 px-3">
                          {getSMSBadge(row.smsStatus)}
                        </td>

                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              onClose();
                              onOpenDeepDive(row.rfq);
                            }}
                            className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1"
                            title="Open Deep Dive for this Requisition"
                          >
                            Deep Dive
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* Informational Guidance Box */}
        <div className="mt-2 p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5 shrink-0">
          <Info size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>
            <strong>Multi-Channel Automated Chaser Engine:</strong> Dispatches WhatsApp reminders at T+1h, automated voice follow-ups at T+4h, and DLT SMS at T+12h across all active requisitions to guarantee timely vendor response.
          </span>
        </div>

        {/* Footer & Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between pt-3 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 gap-2 shrink-0">
          <div>
            Showing {currentTotalItems > 0 ? startIdx + 1 : 0}–{Math.min(endIdx, currentTotalItems)} of {currentTotalItems}{' '}
            {viewMode === 'grouped' ? 'requisitions' : 'vendor outreach records'}
          </div>

          {/* Pagination buttons */}
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="btn btn-secondary btn-xs font-bold px-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="text-xs font-bold text-slate-700 dark:text-gray-300 px-1.5 mono">
                  {safeCurrentPage} / {totalPages}
                </span>
                <button
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="btn btn-secondary btn-xs font-bold px-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
            <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

