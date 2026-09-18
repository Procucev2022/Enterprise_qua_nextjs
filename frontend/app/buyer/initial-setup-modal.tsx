'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { useApp } from '@/lib/store';
import { formatCurrency } from '@/lib/constants';
import {
  VendorMasterUploadRecord,
  PurchaseOrderLineItemRecord,
  HistoricalPurchaseVendorRecord,
} from '@/lib/types';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Star,
  Clock,
  Download,
  AlertCircle,
  Tag,
  Zap,
  X,
  Layers,
  ChevronRight,
  Plus,
  Trash2,
  SlidersHorizontal,
  Check,
  Database,
  Pencil,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

export interface IngestionJobState {
  id: string;
  jobType: 'VENDOR_MASTER' | 'PO_DUMP';
  fileName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRecords: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  errorMessage?: string | null;
}

export function IngestionProgressCard({
  job,
  title,
  unit = 'records',
}: {
  job: IngestionJobState;
  title: string;
  unit?: string;
}) {
  const total = job.totalRecords || 0;
  const processed = job.processedRecords || 0;
  const imported = job.importedRecords || 0;
  const skipped = job.skippedRecords || 0;
  const failed = job.failedRecords || 0;
  const percentage =
    total > 0
      ? Math.min(100, Math.round((processed / total) * 100))
      : job.status === 'COMPLETED'
      ? 100
      : processed > 0
      ? 100
      : 0;

  const formatNumber = (n: number) => n.toLocaleString('en-IN');

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border-2 border-indigo-500/40 text-white shadow-xl space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-md shadow-indigo-600/20">
            <Database size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-black tracking-wide text-white">
                {title} Ingestion
              </h4>
              {job.status === 'PROCESSING' && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                  Processing...
                </span>
              )}
              {job.status === 'COMPLETED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shadow-xs">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  Completed
                </span>
              )}
              {job.status === 'FAILED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30">
                  <AlertCircle size={11} className="text-rose-400" />
                  Failed
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              File: <span className="text-indigo-300 font-semibold">{job.fileName}</span>
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-200 to-emerald-300">
            {percentage}%
          </span>
          <span className="block text-[10px] text-slate-400 font-medium">
            {formatNumber(processed)} / {formatNumber(total || processed)} {unit} processed ({percentage}%)
          </span>
        </div>
      </div>

      {/* Real-time Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full h-3.5 bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/60 p-0.5 shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-300 shadow-sm ${
              job.status === 'FAILED'
                ? 'bg-rose-500'
                : job.status === 'COMPLETED'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, percentage))}%` }}
          />
        </div>
      </div>

      {/* Metrics Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
        <div className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Total</span>
          <span className="font-mono font-black text-slate-100 text-sm">{formatNumber(total || processed)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-800/60">
          <span className="text-[10px] uppercase font-bold text-indigo-300 block">Processed</span>
          <span className="font-mono font-black text-indigo-100 text-sm">{formatNumber(processed)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-800/60">
          <span className="text-[10px] uppercase font-bold text-emerald-300 block">Imported</span>
          <span className="font-mono font-black text-emerald-200 text-sm">{formatNumber(imported)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-800/60">
          <span className="text-[10px] uppercase font-bold text-amber-300 block">Skipped</span>
          <span className="font-mono font-black text-amber-200 text-sm">{formatNumber(skipped)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/60 col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase font-bold text-rose-300 block">Failed</span>
          <span className="font-mono font-black text-rose-200 text-sm">{formatNumber(failed)}</span>
        </div>
      </div>

      {job.errorMessage && (
        <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-800/70 text-xs text-rose-200 flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0 text-rose-400" />
          <span>{job.errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 flex-wrap gap-1">
        <span>
          Status:{' '}
          <strong className="text-slate-200">
            {job.status === 'PROCESSING'
              ? 'Processing...'
              : job.status === 'COMPLETED'
              ? 'Completed Successfully'
              : job.status === 'FAILED'
              ? 'Processing Failed'
              : 'Pending'}
          </strong>
        </span>
        <span className="text-[10px] text-indigo-300/80 italic flex items-center gap-1">
          <Sparkles size={11} className="text-indigo-400" />
          Backend processing continues if you close this window or navigate away
        </span>
      </div>
    </div>
  );
}

export default function InitialSetupModal() {
  const router = useRouter();
  const {
    initialSetupModalOpen,
    setInitialSetupModalOpen,
    historicalPurchaseDataPeriod,
    setHistoricalPurchaseDataPeriod,
    processHistoricalPurchaseData,
    activeBuyerAccount,
    buyerVendors,
    showToast,
  } = useApp();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedPeriod, setSelectedPeriod] = useState<'1_year' | '2_years' | '3_years'>(historicalPurchaseDataPeriod || '2_years');

  // Active Session & Ingestion Job States
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vendorJob, setVendorJob] = useState<IngestionJobState | null>(null);
  const [poJob, setPoJob] = useState<IngestionJobState | null>(null);

  // Separate Upload States & File Handlers
  const [storedVendors, setStoredVendors] = useState<VendorMasterUploadRecord[]>([]);
  const [vendorMasterUploaded, setVendorMasterUploaded] = useState(false);
  const [vendorFileName, setVendorFileName] = useState<string>('');
  const [isDraggingVendor, setIsDraggingVendor] = useState<boolean>(false);
  const [isParsingVendor, setIsParsingVendor] = useState<boolean>(false);
  const [isEditingVendorTable, setIsEditingVendorTable] = useState<boolean>(false);

  const [poLineItems, setPoLineItems] = useState<PurchaseOrderLineItemRecord[]>([]);
  const [poDataUploaded, setPoDataUploaded] = useState(false);
  const [poFileName, setPoFileName] = useState<string>(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
  const [isDraggingPo, setIsDraggingPo] = useState<boolean>(false);
  const [isParsingPo, setIsParsingPo] = useState<boolean>(false);

  const [vendorPreviewLimit, setVendorPreviewLimit] = useState<number>(50);
  const [poPreviewLimit, setPoPreviewLimit] = useState<number>(50);

  const vendorFileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);

  const [isProcessingPOJoin, setIsProcessingPOJoin] = useState(false);
  const [isConfirmingIngestion, setIsConfirmingIngestion] = useState(false);
  const [activeReviewTab, setActiveReviewTab] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [apiJoinedVendors, setApiJoinedVendors] = useState<HistoricalPurchaseVendorRecord[] | null>(null);

  const authFetchHeaders = (): Record<string, string> => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
        : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // Re-establish session and resume any active background ingestion jobs on mount
  React.useEffect(() => {
    if (!initialSetupModalOpen) return;

    const initSession = async () => {
      try {
        const res = await fetch('/api/vendor-ingestion/session', { headers: authFetchHeaders() });
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.session?.id) {
            const sess = json.data.session;
            setSessionId(sess.id);
            if (sess.vendorMasterFileName && sess.vendorMasterRowCount > 0) {
              setVendorFileName(sess.vendorMasterFileName);
              setVendorMasterUploaded(true);
            }
            if (sess.poFileName && sess.poRowCount > 0) {
              setPoFileName(sess.poFileName);
              setPoDataUploaded(true);
            }

            // Check active jobs
            const jobsRes = await fetch(`/api/vendor-ingestion/${sess.id}/jobs/active`, { headers: authFetchHeaders() });
            if (jobsRes.ok) {
              const jobsJson = await jobsRes.json();
              if (jobsJson?.data?.job) {
                const j = jobsJson.data.job;
                if (j.jobType === 'VENDOR_MASTER') {
                  setVendorJob(j);
                  if (j.status === 'COMPLETED') setVendorMasterUploaded(true);
                } else if (j.jobType === 'PO_DUMP') {
                  setPoJob(j);
                  if (j.status === 'COMPLETED') setPoDataUploaded(true);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not initialize vendor ingestion session:', err);
      }
    };

    initSession();
  }, [initialSetupModalOpen]);

  // Live polling effect for active background jobs
  React.useEffect(() => {
    if (!sessionId) return;
    const isVendorActive = vendorJob?.status === 'PROCESSING' || vendorJob?.status === 'PENDING';
    const isPoActive = poJob?.status === 'PROCESSING' || poJob?.status === 'PENDING';

    if (!isVendorActive && !isPoActive) return;

    const interval = setInterval(async () => {
      try {
        if (isVendorActive) {
          const res = await fetch(`/api/vendor-ingestion/${sessionId}/jobs/active?type=VENDOR_MASTER`, {
            headers: authFetchHeaders(),
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              const j = json.data.job;
              setVendorJob(j);
              if (j.status === 'COMPLETED') {
                setVendorMasterUploaded(true);
                setVendorFileName(j.fileName);
                showToast(
                  'Vendor Master Processed',
                  `Successfully imported ${j.importedRecords.toLocaleString('en-IN')} vendors (${j.skippedRecords} skipped, ${j.failedRecords} failed).`,
                  'success'
                );
              } else if (j.status === 'FAILED') {
                showToast('Ingestion Error', j.errorMessage || 'Failed to process vendor master', 'warning');
              }
            }
          }
        }

        if (isPoActive) {
          const res = await fetch(`/api/vendor-ingestion/${sessionId}/jobs/active?type=PO_DUMP`, {
            headers: authFetchHeaders(),
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              const j = json.data.job;
              setPoJob(j);
              if (j.status === 'COMPLETED') {
                setPoDataUploaded(true);
                setPoFileName(j.fileName);
                showToast(
                  'PO Dump Processed',
                  `Successfully imported ${j.importedRecords.toLocaleString('en-IN')} PO records (${j.skippedRecords} skipped, ${j.failedRecords} failed).`,
                  'success'
                );
              } else if (j.status === 'FAILED') {
                showToast('Ingestion Error', j.errorMessage || 'Failed to process PO dump', 'warning');
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error polling job status:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [sessionId, vendorJob?.status, poJob?.status]);

  if (!initialSetupModalOpen) return null;

  const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv', '.txt'];
  const isAllowedSpreadsheetFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
  };

  // Real File Upload & SheetJS/CSV Parsing for File 1: Vendor Master
  const handleVendorFileUpload = (file: File) => {
    if (!file) return;
    if (!isAllowedSpreadsheetFile(file)) {
      showToast('Unsupported File Type', `"${file.name}" is not a supported spreadsheet file. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`, 'warning');
      return;
    }

    setVendorFileName(file.name);
    setIsParsingVendor(true);

    // Set initial active job state
    setVendorJob({
      id: `job-vm-${Date.now()}`,
      jobType: 'VENDOR_MASTER',
      fileName: file.name,
      status: 'PROCESSING',
      totalRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    });

    const isCsvOrText = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt');

    if (isCsvOrText && sessionId) {
      // Stream directly to backend for large files
      (async () => {
        try {
          const token =
            typeof window !== 'undefined'
              ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
              : null;

          const res = await fetch(`/api/vendor-ingestion/${sessionId}/stream-upload?type=VENDOR_MASTER&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/csv',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: file,
          });

          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              setVendorJob(json.data.job);
              showToast('Ingestion Started', `Started background streaming ingestion for ${file.name}. Progress is tracked live.`, 'info');
            }
          }
        } catch (err: any) {
          console.error('Streaming upload error:', err);
          showToast('Upload Error', err.message || 'Streaming upload failed', 'warning');
        } finally {
          setIsParsingVendor(false);
        }
      })();
    } else {
      // Excel or client fallback parsing
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawJson || rawJson.length === 0) {
            showToast('Empty File', 'The uploaded file has no readable data rows.', 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            return;
          }

          const parsedVendors: VendorMasterUploadRecord[] = rawJson.map((row, idx) => {
            const keys = Object.keys(row);
            const getVal = (possibleKeys: string[]): string => {
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matchedKey = keys.find((k) => k.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === pkClean);
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!pkClean) continue;
                const matchedKey = keys.find((k) => {
                  const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  return kClean.includes(pkClean) || pkClean.includes(kClean);
                });
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              return '';
            };

            const vendorCode = getVal(['vendorcode', 'vendor code', 'code', 'vendor id', 'supplier code', 'id']) || `VND-${1000 + idx + 1}`;
            const companyName = getVal(['companyname', 'company name', 'vendor name', 'supplier', 'name', 'vendor', 'supplier name']) || `Supplier ${idx + 1}`;
            const contactPerson = getVal(['contactperson', 'contact person', 'contact', 'person', 'representative', 'contact person name']) || 'Operations Lead';
            const email = getVal(['email', 'email id', 'email_id', 'mail', 'corporate email']) || `contact@${companyName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'vendor'}.com`;
            const phone = getVal(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number']) || '+91 98000 00000';
            const address = getVal(['address', 'location', 'city', 'plant location', 'street', 'office address']) || 'Industrial Zone, India';
            const gstNumber = getVal(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no']) || '27AAACA0000A1Z0';
            const ratingRaw = getVal(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score']);
            const vendorRatingScore = ratingRaw && !isNaN(Number(ratingRaw)) ? Math.min(100, Math.max(0, Math.round(Number(ratingRaw)))) : undefined;

            return {
              id: `vm-upload-${Date.now()}-${idx}`,
              vendorCode,
              companyName,
              contactPerson,
              email,
              phone,
              address,
              gstNumber,
              vendorRatingScore,
            };
          });

          setStoredVendors(parsedVendors);
          setVendorMasterUploaded(true);
          setIsEditingVendorTable(false);

          if (sessionId) {
            try {
              const jobRes = await fetch(`/api/vendor-ingestion/${sessionId}/start-job`, {
                method: 'POST',
                headers: authFetchHeaders(),
                body: JSON.stringify({
                  rows: parsedVendors,
                  fileName: file.name,
                  jobType: 'VENDOR_MASTER',
                }),
              });
              if (jobRes.ok) {
                const jobJson = await jobRes.json();
                if (jobJson?.data?.job) {
                  setVendorJob(jobJson.data.job);
                }
              }
            } catch (e) {
              console.warn('Job start error:', e);
            }
          } else {
            setVendorJob({
              id: `job-${Date.now()}`,
              jobType: 'VENDOR_MASTER',
              fileName: file.name,
              status: 'COMPLETED',
              totalRecords: parsedVendors.length,
              processedRecords: parsedVendors.length,
              importedRecords: parsedVendors.length,
              skippedRecords: 0,
              failedRecords: 0,
            });
          }

          showToast('Vendor Master Uploaded', `Loaded ${parsedVendors.length.toLocaleString('en-IN')} vendors from ${file.name}.`, 'success');
        } catch (err: any) {
          console.error('Vendor Master Parse Error:', err);
          showToast('Parsing Error', `Could not parse file: ${err.message || 'Unknown format'}`, 'warning');
          setVendorJob(null);
        } finally {
          setIsParsingVendor(false);
        }
      };

      reader.onerror = () => {
        showToast('File Read Error', 'Failed to read file from disk.', 'warning');
        setIsParsingVendor(false);
        setVendorJob(null);
      };

      reader.readAsArrayBuffer(file);
    }
  };

  // Real File Upload & SheetJS/CSV Parsing for File 2: PO Purchase Dump
  const handlePODataFileUpload = (file: File) => {
    if (!file) return;
    if (!isAllowedSpreadsheetFile(file)) {
      showToast('Unsupported File Type', `"${file.name}" is not a supported spreadsheet file. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`, 'warning');
      return;
    }

    setPoFileName(file.name);
    setIsParsingPo(true);

    // Set initial active job state
    setPoJob({
      id: `job-po-${Date.now()}`,
      jobType: 'PO_DUMP',
      fileName: file.name,
      status: 'PROCESSING',
      totalRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    });

    const isCsvOrText = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt');

    if (isCsvOrText && sessionId) {
      // Direct stream upload for large PO dumps
      (async () => {
        try {
          const token =
            typeof window !== 'undefined'
              ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
              : null;

          const res = await fetch(`/api/vendor-ingestion/${sessionId}/stream-upload?type=PO_DUMP&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/csv',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: file,
          });

          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              setPoJob(json.data.job);
              showToast('Ingestion Started', `Started background streaming ingestion for PO dump ${file.name}. Progress is tracked live.`, 'info');
            }
          }
        } catch (err: any) {
          console.error('Streaming upload error:', err);
          showToast('Upload Error', err.message || 'Streaming PO upload failed', 'warning');
        } finally {
          setIsParsingPo(false);
        }
      })();
    } else {
      // Excel parsing & background job dispatch
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawJson || rawJson.length === 0) {
            showToast('Empty PO File', 'The uploaded PO dump has no readable rows.', 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            return;
          }

          const parsedPOs: PurchaseOrderLineItemRecord[] = rawJson.map((row, idx) => {
            const keys = Object.keys(row);
            const getVal = (possibleKeys: string[]): string => {
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matchedKey = keys.find((k) => k.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === pkClean);
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!pkClean) continue;
                const matchedKey = keys.find((k) => {
                  const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  return kClean.includes(pkClean) || pkClean.includes(kClean);
                });
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              return '';
            };

            const poNumber = getVal(['ponumber', 'po number', 'po #', 'po no', 'pono', 'order id', 'order number', 'order no']) || `PO-2025-${(1000 + idx).toString()}`;
            const poDate = getVal(['podate', 'po date', 'date', 'order date', 'creation date']) || '2025-06-15';
            const vendorIdentifier = getVal(['vendor name', 'vendor identifier', 'vendor', 'supplier name', 'supplier', 'company name', 'vendor code', 'vendor id']) || 'Apex Supplies Ltd.';
            const itemName = getVal(['line item description', 'line item', 'item description', 'description', 'item name', 'product description', 'product name', 'material description', 'material', 'service description', 'service', 'item']) || 'Industrial Mechanical Spares';
            const specs = getVal(['specs', 'specification', 'technical specs', 'specifications', 'details', 'item specs', 'grade']);
            
            const qtyRaw = getVal(['quantity', 'qty', 'units', 'count', 'ordered qty', 'volume']);
            const quantity = qtyRaw && !isNaN(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) ? Math.max(1, Math.round(Number(String(qtyRaw).replace(/[^0-9.]/g, '')))) : 1;
            
            const unit = getVal(['unit', 'uom', 'unit of measure', 'units']) || 'Units';

            const unitPriceRaw = getVal(['unit price inr', 'unit price', 'unit rate', 'rate inr', 'rate', 'price inr', 'price', 'item price']);
            const totalSpendRaw = getVal(['total spend inr', 'total spend (inr)', 'total spend rs', 'total spend', 'total amount inr', 'total amount (inr)', 'total amount', 'total inr', 'total (inr)', 'spend inr', 'spend', 'amount inr', 'amount', 'total value', 'po amount', 'total']);

            const parsedUnitPrice = unitPriceRaw && !isNaN(Number(String(unitPriceRaw).replace(/[^0-9.]/g, ''))) ? Number(String(unitPriceRaw).replace(/[^0-9.]/g, '')) : 0;
            const parsedTotalSpend = totalSpendRaw && !isNaN(Number(String(totalSpendRaw).replace(/[^0-9.]/g, ''))) ? Number(String(totalSpendRaw).replace(/[^0-9.]/g, '')) : 0;

            let totalSpend = parsedTotalSpend;
            let unitPrice = parsedUnitPrice;

            if (totalSpend > 0 && unitPrice === 0 && quantity > 0) {
              unitPrice = Math.round(totalSpend / quantity);
            } else if (totalSpend === 0 && unitPrice > 0) {
              totalSpend = unitPrice * quantity;
            } else if (totalSpend === 0 && unitPrice === 0) {
              unitPrice = 500;
              totalSpend = unitPrice * quantity;
            }

            const department = getVal(['department', 'dept', 'cost center', 'plant', 'division', 'category', 'function']) || 'General';

            return {
              id: `po-upload-${Date.now()}-${idx}`,
              poNumber,
              poDate,
              vendorIdentifier,
              itemName,
              specs,
              quantity,
              unit,
              unitPrice,
              totalSpend,
              department,
            };
          });

          setPoLineItems(parsedPOs);
          setPoDataUploaded(true);

          if (sessionId) {
            try {
              const jobRes = await fetch(`/api/vendor-ingestion/${sessionId}/start-job`, {
                method: 'POST',
                headers: authFetchHeaders(),
                body: JSON.stringify({
                  rows: parsedPOs,
                  fileName: file.name,
                  jobType: 'PO_DUMP',
                }),
              });
              if (jobRes.ok) {
                const jobJson = await jobRes.json();
                if (jobJson?.data?.job) {
                  setPoJob(jobJson.data.job);
                }
              }
            } catch (e) {
              console.warn('Job start error:', e);
            }
          } else {
            setPoJob({
              id: `job-po-${Date.now()}`,
              jobType: 'PO_DUMP',
              fileName: file.name,
              status: 'COMPLETED',
              totalRecords: parsedPOs.length,
              processedRecords: parsedPOs.length,
              importedRecords: parsedPOs.length,
              skippedRecords: 0,
              failedRecords: 0,
            });
          }

          showToast('PO Dump Uploaded', `Successfully parsed & loaded ${parsedPOs.length.toLocaleString('en-IN')} PO line items from ${file.name}.`, 'success');
        } catch (err: any) {
          console.error('PO Dump Parse Error:', err);
          showToast('Parsing Error', `Could not parse PO file: ${err.message || 'Unknown format'}`, 'warning');
          setPoJob(null);
        } finally {
          setIsParsingPo(false);
        }
      };

      reader.onerror = () => {
        showToast('File Read Error', 'Failed to read file from disk.', 'warning');
        setIsParsingPo(false);
        setPoJob(null);
      };

      reader.readAsArrayBuffer(file);
    }
  };

  const clearVendorMasterData = () => {
    setStoredVendors([]);
    setApiJoinedVendors(null);
    setVendorMasterUploaded(false);
    setVendorFileName('');
    setIsEditingVendorTable(false);
    if (vendorFileInputRef.current) {
      vendorFileInputRef.current.value = '';
    }
    showToast('Selection Cleared', 'Vendor Master selection has been removed. Please upload a file.', 'info');
  };

  const resetToSamplePoData = () => {
    setPoLineItems([]);
    setApiJoinedVendors(null);
    setPoFileName(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
    setPoDataUploaded(false);
    if (poFileInputRef.current) {
      poFileInputRef.current.value = '';
    }
    showToast('Reset Complete', 'PO Dump line items cleared. Please upload your spreadsheet.', 'info');
  };

  // Compute Joined Records between Vendor Master & PO Line Items
  const computeJoinedRecords = (): HistoricalPurchaseVendorRecord[] => {
    return storedVendors.map((v) => {
      // Find matching POs
      const matchingPOs = poLineItems.filter(
        (po) =>
          po.vendorIdentifier.toLowerCase().includes(v.companyName.toLowerCase()) ||
          v.companyName.toLowerCase().includes(po.vendorIdentifier.toLowerCase()) ||
          (v.vendorCode && po.vendorIdentifier.toLowerCase().includes(v.vendorCode.toLowerCase()))
      );

      const hasMatchingPOs = matchingPOs.length > 0;
      const items = matchingPOs.map((p) => p.itemName);
      const totalAmount = matchingPOs.reduce((acc, p) => acc + p.totalSpend, 0);

      let firstSetMajor = '';
      let secondSetMinors: string[] = [];

      if (hasMatchingPOs) {
        // AI Category mapping based on purchased items & vendor names
        const itemText = (items.join(' ') + ' ' + v.companyName).toLowerCase();
        if (
          itemText.includes('microsoft') ||
          itemText.includes('google') ||
          itemText.includes('azure') ||
          itemText.includes('workspace') ||
          itemText.includes('cloud') ||
          itemText.includes('license') ||
          itemText.includes('software') ||
          itemText.includes('power bi') ||
          itemText.includes('bigquery') ||
          itemText.includes('gcp') ||
          itemText.includes('saas') ||
          itemText.includes('datacenter')
        ) {
          firstSetMajor = 'Information Technology (IT) & Software';
          if (itemText.includes('cloud') || itemText.includes('azure') || itemText.includes('gcp') || itemText.includes('storage') || itemText.includes('compute') || itemText.includes('credits')) {
            secondSetMinors.push('Cloud Infrastructure & Storage');
          }
          if (itemText.includes('license') || itemText.includes('subscription') || itemText.includes('renewal') || itemText.includes('365') || itemText.includes('workspace') || itemText.includes('teams') || itemText.includes('windows server')) {
            secondSetMinors.push('Enterprise Software & Licenses');
          }
          if (itemText.includes('bigquery') || itemText.includes('power bi') || itemText.includes('analytics') || itemText.includes('data')) {
            secondSetMinors.push('Data & Analytics Platforms');
          }
          if (itemText.includes('datacenter') || itemText.includes('infrastructure') || itemText.includes('server')) {
            secondSetMinors.push('IT Infrastructure');
          }
          if (secondSetMinors.length === 0) {
            secondSetMinors.push('Enterprise Software & Licenses');
          }
        } else if (itemText.includes('pump') || itemText.includes('valve') || itemText.includes('hose') || itemText.includes('compressor')) {
          firstSetMajor = 'Engineering Spares - Mechanical';
          if (itemText.includes('pump')) secondSetMinors.push('Pumps & Accessories');
          if (itemText.includes('valve') || itemText.includes('gate') || itemText.includes('globe')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('hose')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('compressor')) secondSetMinors.push('Compressors & Accessories');
          if (itemText.includes('motor')) secondSetMinors.push('Machinery Parts');
        } else if (itemText.includes('switchgear') || itemText.includes('panel') || itemText.includes('breaker') || itemText.includes('cable')) {
          firstSetMajor = 'Engineering Spares - Electrical';
          if (itemText.includes('panel') || itemText.includes('switchgear')) secondSetMinors.push('Panels');
          if (itemText.includes('breaker') || itemText.includes('mccb')) secondSetMinors.push('Circuit Breakers');
        } else if (itemText.includes('tmt') || itemText.includes('steel') || itemText.includes('civil') || itemText.includes('peb')) {
          firstSetMajor = 'Civil Works';
          if (itemText.includes('peb')) secondSetMinors.push('PEB Structure');
          if (itemText.includes('tmt')) secondSetMinors.push('TMT BARS');
          secondSetMinors.push('Roofing Sheets');
        } else {
          firstSetMajor = 'General Spares & Consumables';
          secondSetMinors.push('Customised Parts');
        }

        // Deduplicate
        secondSetMinors = Array.from(new Set(secondSetMinors));
      }

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        email: v.email,
        contactPerson: v.contactPerson,
        phone: v.phone,
        address: v.address,
        gstNumber: v.gstNumber,
        vendorRatingScore: v.vendorRatingScore,
        hasPoHistory: hasMatchingPOs,
        categoriesMappedByBuyer: hasMatchingPOs,
        itemsSupplied: items,
        pastPoSpend: hasMatchingPOs
          ? `${formatCurrency(totalAmount)} (${matchingPOs.length} POs)`
          : 'No PO History in Dump',
        poCount: matchingPOs.length,
        firstSetMajorCategory: firstSetMajor,
        secondSetMinorCategories: secondSetMinors,
        secondSetSecondaryMajors: hasMatchingPOs ? ['Engineering Spares - Electrical', 'Civil Works'] : [],
      };
    });
  };

  // Editable Vendor Master Table Handlers
  const handleUpdateVendorField = (id: string, field: keyof VendorMasterUploadRecord, value: any) => {
    setStoredVendors((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  };

  const handleDeleteVendorRow = (id: string) => {
    setStoredVendors((prev) => {
      const updated = prev.filter((v) => v.id !== id);
      if (updated.length === 0) {
        setVendorMasterUploaded(false);
      }
      return updated;
    });
  };

  const handleAddVendorRow = () => {
    const newVendor: VendorMasterUploadRecord = {
      id: `vm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      vendorCode: '',
      companyName: '',
      contactPerson: '',
      email: '',
      phone: '',
      address: '',
      gstNumber: '',
      vendorRatingScore: undefined,
    };
    setStoredVendors((prev) => [...prev, newVendor]);
    setVendorMasterUploaded(true);
    setIsEditingVendorTable(true);
  };

  const fallbackJoined = computeJoinedRecords();
  const joinedVendors = apiJoinedVendors || fallbackJoined;
  const mappedVendors = joinedVendors.filter((v) => v.categoriesMappedByBuyer);
  const unmappedVendors = joinedVendors.filter((v) => !v.categoriesMappedByBuyer);

  // Download Sample Vendor Master CSV
  const handleDownloadVendorMasterCsv = () => {
    const csv =
      'Vendor Code,Company Name,Contact Person,Email ID,Phone,Address,GSTIN,Rating (0-100 Optional)\n' +
      'VND-1001,Apex Supplies Ltd.,Rajesh Nair,rajesh@apexsupplies.in,+91 98201 44820,"MIDC Thane, Mumbai, MH",27AAACA1928K1Z4,95\n' +
      'VND-1002,Kiran Valve Industries,Amit Kumar,amit@kiranvalves.com,+91 97653 21098,"Bhosari, Pune, MH",27AAACK3921P1Z9,78\n' +
      'VND-1007,Vortex Hydraulic Systems,Nikhil Rane,nikhil@vortexhydraulics.in,+91 98450 11920,"Peenya, Bangalore, KA",29AAACV8841P1Z5,82\n' +
      'VND-1008,Nova Electrical Spares,Pooja Deshmukh,sales@novaelectricals.com,+91 97230 44510,"Makarpura, Vadodara, GJ",24AAACN4419K1Z1,\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Procucev_Template_1_Vendor_Master.csv';
    link.click();
    showToast('Template Downloaded', 'Sample Vendor Master CSV template downloaded.', 'success');
  };

  // Download Sample PO Data CSV
  const handleDownloadPoDataCsv = () => {
    const csv =
      'PO Number,PO Date,Vendor Name / Code,Item Name & Description,Quantity,Unit,Unit Price,Total Spend,Department\n' +
      'PO-2025-00891,2025-04-12,Apex Supplies Ltd.,Centrifugal Water Pump 500 GPM (15 HP Motor),12,Units,12500,150000,Mechanical\n' +
      'PO-2025-01156,2025-08-04,Kiran Valve Industries,Flanged Gate Valve 4-inch Class 150,24,Units,3800,91200,Piping\n' +
      'PO-2025-01431,2025-10-10,TechnoForce Engineering Ltd,LV Switchgear Modular Panels with Drawout MCCB,3,Panels,85000,255000,Electrical\n' +
      'PO-2025-01740,2025-12-05,Everest Steel & Infra Structures,Fe500D TMT High-Yield Reinforcement Bars,120,Tons,620,744000,Civil\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Procucev_Template_2_PO_Purchase_Dump_${selectedPeriod}.csv`;
    link.click();
    showToast('Template Downloaded', 'Sample PO Purchase Order Dump CSV downloaded.', 'success');
  };

  const handleSimulatePOJoin = () => {
    setIsProcessingPOJoin(true);
    let apiData: HistoricalPurchaseVendorRecord[] | null = null;

    fetch('/api/buyer-accounts/ai-cross-match', {
      method: 'POST',
      headers: authFetchHeaders(),
      body: JSON.stringify({
        vendors: storedVendors,
        poLineItems,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && json.success && Array.isArray(json.data)) {
          apiData = json.data;
          setApiJoinedVendors(json.data);
        }
      })
      .catch((err) => {
        console.warn('Backend AI cross-match API error:', err);
      });

    setTimeout(() => {
      setIsProcessingPOJoin(false);
      const dataToSet = apiData || computeJoinedRecords();
      setApiJoinedVendors(dataToSet);
      setStep(4);
      const mappedCount = dataToSet.filter((v: any) => v.categoriesMappedByBuyer).length;
      const unmappedCount = dataToSet.length - mappedCount;
      showToast(
        'Cross-Match Complete',
        `Matched PO data against ${storedVendors.length} stored vendors. ${mappedCount} categorized, ${unmappedCount} flagged for self-mapping.`,
        'success'
      );
    }, 600);
  };

  const handleConfirmFinalIngestion = async () => {
    if (isConfirmingIngestion) return;
    setIsConfirmingIngestion(true);
    await processHistoricalPurchaseData(selectedPeriod, joinedVendors);
    setIsConfirmingIngestion(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 sm:p-8 bg-white dark:bg-gray-900 border-2 border-indigo-500/30 dark:border-indigo-500/40 shadow-2xl space-y-6 animate-scale-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-gray-800 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Buyer Initial Setup: Vendor Master & PO Data Ingestion
                </h2>
                <span className="badge badge-amber font-mono font-bold text-[10px] uppercase">
                  Dual-File ERP Setup
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 leading-relaxed">
                Organization: <strong>{activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited'}</strong> · Upload Vendor Master and PO purchase dump separately for AI category cross-mapping.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInitialSetupModalOpen(false)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              title="Dismiss setup (you can resume from the blinking corner badge)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Informative Why This is Required Box */}
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-xs text-indigo-950 dark:text-indigo-200 space-y-2">
          <div className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-600 shrink-0" />
            <span>Dual-Stream ERP Ingestion Architecture</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-700 dark:text-gray-300">
            Because combined data is rarely available in enterprise systems, you can upload <strong>File 1 (Vendor Master Coordinates)</strong> first, followed by <strong>File 2 (Historical PO Spend Dump)</strong>. The system saves the vendor master, extracts purchased items from POs, and maps categories against each vendor profile. If a vendor is in the master but has no PO history, they receive an email notifying them to <strong>self-map their categories upon login</strong> in order to receive enquiries.
          </p>
        </div>

        {/* Step Progress Indicators */}
        <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] font-bold">
          {[
            { num: 1, label: '1. Time Horizon' },
            { num: 2, label: '2. Vendor Master' },
            { num: 3, label: '3. PO Dump' },
            { num: 4, label: '4. AI Category Join' },
            { num: 5, label: '5. Dispatch Emails' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num as any)}
              className={`p-2 rounded-xl border transition-all ${
                step === s.num
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                  : step > s.num
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/60 text-slate-400 dark:text-gray-500 border-slate-200 dark:border-gray-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* STEP 1: CHOOSE TIME HORIZON */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 1: Choose Historical Purchase Period
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Select the time horizon of PO data you wish to cross-reference against your vendor master.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: '1_year' as const,
                  title: 'Last 1 Year (12 Months)',
                  desc: 'Fast bootstrap focusing on recent high-velocity procurement spares.',
                  badge: 'Quick Ingestion',
                },
                {
                  id: '2_years' as const,
                  title: 'Last 2 Years (24 Months)',
                  desc: 'Recommended baseline covering seasonal maintenance & capex cycles.',
                  badge: '⭐ Recommended',
                },
                {
                  id: '3_years' as const,
                  title: 'Last 3 Years (36 Months)',
                  desc: 'Complete historical enterprise audit and comprehensive supplier discovery.',
                  badge: 'Full Enterprise Audit',
                },
              ].map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => {
                    setSelectedPeriod(opt.id);
                    setHistoricalPurchaseDataPeriod(opt.id);
                  }}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    selectedPeriod === opt.id
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20 shadow-md'
                      : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-slate-50/50 dark:bg-gray-850/40'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          selectedPeriod === opt.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300'
                        }`}
                      >
                        {opt.badge}
                      </span>
                      <Clock size={15} className={selectedPeriod === opt.id ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white mt-1">{opt.title}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Continue to File 1: Vendor Master <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: FILE 1 — VENDOR MASTER DATA INGESTION */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={vendorFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVendorFileUpload(file);
              }}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    Step 2: Upload File 1 — Vendor Master Database
                  </h3>
                  <span className="badge badge-indigo font-bold text-[10px]">Stored First</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Contains: Vendor Code, Company Name, Contact Person, Email, Phone, Address, GSTIN, and Optional Rating (0-100).
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadVendorMasterCsv}
                  className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 shrink-0"
                >
                  <Download size={12} /> Download CSV Template
                </button>
                {storedVendors.length > 0 && (
                  <button
                    type="button"
                    onClick={clearVendorMasterData}
                    className="text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400 underline font-medium"
                  >
                    Clear Selection
                  </button>
                )}
              </div>
            </div>

            {/* Progress Card when upload is active or completed */}
            {vendorJob && (
              <IngestionProgressCard job={vendorJob} title="Vendor Master" unit="vendors" />
            )}

            {/* Drag & Drop Vendor Master Area */}
            <div
              onClick={() => vendorFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingVendor(true);
              }}
              onDragLeave={() => setIsDraggingVendor(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingVendor(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleVendorFileUpload(file);
              }}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                isDraggingVendor
                  ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
                  : storedVendors.length > 0 || vendorJob?.status === 'COMPLETED'
                  ? 'border-emerald-300 dark:border-emerald-600/50 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-indigo-300 dark:border-indigo-500/50 hover:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/80'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-600/20 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                <UploadCloud size={24} />
              </div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mt-2">
                {isParsingVendor || vendorJob?.status === 'PROCESSING'
                  ? 'Streaming and Processing Vendor Records in Background...'
                  : storedVendors.length > 0 || vendorJob?.status === 'COMPLETED'
                  ? `Vendor Master File Loaded (${(vendorJob?.importedRecords || storedVendors.length).toLocaleString('en-IN')} Suppliers)`
                  : `Click to Browse or Drag & Drop Vendor Master (.xlsx, .csv, .xls)`}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                {storedVendors.length > 0 || vendorJob
                  ? `Active File: ${vendorFileName || vendorJob?.fileName}. Click below to upload another file or proceed.`
                  : 'Upload your ERP vendor master sheet containing vendor codes, company names, contact details, GSTIN, and ratings.'}
              </p>

              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                {storedVendors.length > 0 || vendorJob ? (
                  <>
                    <div className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-full bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 shadow-sm">
                      <Database size={12} className="text-indigo-500" />
                      <span>Active File:</span>
                      <span className="font-mono text-indigo-600 dark:text-indigo-400">{vendorFileName || vendorJob?.fileName}</span>
                      <span className="text-slate-400">({(vendorJob?.importedRecords || storedVendors.length).toLocaleString('en-IN')} Suppliers)</span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        vendorFileInputRef.current?.click();
                      }}
                      className="btn btn-primary btn-xs font-bold text-[11px] flex items-center gap-1"
                    >
                      <UploadCloud size={12} /> Choose Another File
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearVendorMasterData();
                        setVendorJob(null);
                      }}
                      className="btn btn-secondary btn-xs font-bold text-[11px] text-rose-600 hover:text-rose-700 flex items-center gap-1"
                    >
                      <Trash2 size={12} /> Clear Selection
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      vendorFileInputRef.current?.click();
                    }}
                    className="btn btn-primary btn-xs font-bold text-[11px] flex items-center gap-1"
                  >
                    <UploadCloud size={12} /> Browse File
                  </button>
                )}
              </div>
            </div>

            {/* Table of Stored Vendor Master or Empty State */}
            {storedVendors.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      {isEditingVendorTable ? 'Editing Vendor Master Records' : 'Stored Vendor Master Records'} ({storedVendors.length.toLocaleString('en-IN')} Suppliers):
                    </span>
                    {isEditingVendorTable && (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Sparkles size={10} /> Edit Mode Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditingVendorTable ? (
                      <>
                        <button
                          type="button"
                          onClick={handleAddVendorRow}
                          className="btn btn-secondary btn-xs font-bold text-[10px] flex items-center gap-1"
                        >
                          <Plus size={11} /> Add Vendor Row
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingVendorTable(false)}
                          className="btn btn-primary btn-xs font-bold text-[10px] flex items-center gap-1 shadow-xs"
                        >
                          <Check size={11} /> Done Editing
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsEditingVendorTable(true)}
                          className="btn btn-secondary btn-xs font-bold text-[10px] flex items-center gap-1 shadow-xs border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                        >
                          <Pencil size={11} /> Edit Data
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditingVendorTable ? (
                  /* EDITABLE MODE TABLE */
                  <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900 shadow-inner ring-1 ring-indigo-500/20">
                    <table className="w-full text-left border-collapse min-w-[960px]">
                      <thead className="bg-indigo-50/70 dark:bg-gray-800 text-[10px] uppercase font-bold text-indigo-900 dark:text-gray-300 sticky top-0 z-10">
                        <tr>
                          <th className="p-2 w-28">Vendor Code</th>
                          <th className="p-2 min-w-[140px]">Company Name</th>
                          <th className="p-2 min-w-[120px]">Contact Person</th>
                          <th className="p-2 min-w-[140px]">Email Address</th>
                          <th className="p-2 min-w-[110px]">Phone</th>
                          <th className="p-2 min-w-[120px]">GSTIN</th>
                          <th className="p-2 min-w-[140px]">Address / Location</th>
                          <th className="p-2 w-24">Rating</th>
                          <th className="p-2 w-10 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                        {storedVendors.slice(0, vendorPreviewLimit).map((v) => (
                          <tr key={v.id} className="hover:bg-indigo-50/30 dark:hover:bg-gray-800/50 group transition-colors">
                            <td className="p-1.5 align-top">
                              <input
                                type="text"
                                value={v.vendorCode || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'vendorCode', e.target.value)}
                                placeholder="VND-CODE"
                                className="w-full font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <input
                                type="text"
                                value={v.companyName || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'companyName', e.target.value)}
                                placeholder="Company name"
                                className="w-full font-bold text-xs px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <input
                                type="text"
                                value={v.contactPerson || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'contactPerson', e.target.value)}
                                placeholder="Contact Name"
                                className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <input
                                type="email"
                                value={v.email || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'email', e.target.value)}
                                placeholder="email@domain.com"
                                className="w-full font-mono text-[10px] font-semibold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <input
                                type="text"
                                value={v.phone || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'phone', e.target.value)}
                                placeholder="+91 Phone"
                                className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <input
                                type="text"
                                value={v.gstNumber || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'gstNumber', e.target.value.toUpperCase())}
                                placeholder="GSTIN"
                                className="w-full font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-200 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <input
                                type="text"
                                value={v.address || ''}
                                onChange={(e) => handleUpdateVendorField(v.id, 'address', e.target.value)}
                                placeholder="City, State / Address"
                                className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                              />
                            </td>
                            <td className="p-1.5 align-top">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={v.vendorRatingScore !== undefined ? v.vendorRatingScore : ''}
                                  onChange={(e) =>
                                    handleUpdateVendorField(
                                      v.id,
                                      'vendorRatingScore',
                                      e.target.value === '' ? undefined : Math.min(100, Math.max(0, Number(e.target.value)))
                                    )
                                  }
                                  placeholder="0-100"
                                  className="w-14 text-center font-bold text-xs px-1 py-1 rounded bg-amber-50/80 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 focus:border-amber-500 focus:outline-none transition-all"
                                />
                                <span className="text-[10px] text-slate-400 font-bold">/100</span>
                              </div>
                            </td>
                            <td className="p-1.5 align-top text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteVendorRow(v.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all opacity-70 group-hover:opacity-100"
                                title={`Delete ${v.companyName || 'Row'}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* DEFAULT READ-ONLY TABLE WITH ALL DISTINCT COLUMNS */
                  <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900/60 shadow-xs">
                    <table className="w-full text-left border-collapse min-w-[960px]">
                      <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10">
                        <tr>
                          <th className="p-2.5">Vendor Code</th>
                          <th className="p-2.5">Company Name</th>
                          <th className="p-2.5">Contact Person</th>
                          <th className="p-2.5">Email Address</th>
                          <th className="p-2.5">Phone Number</th>
                          <th className="p-2.5">GSTIN</th>
                          <th className="p-2.5">Address / Location</th>
                          <th className="p-2.5">Rating (0-100)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                        {storedVendors.slice(0, vendorPreviewLimit).map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                            <td className="p-2.5 font-mono text-[10px] text-slate-500">{v.vendorCode || 'VND-AUTO'}</td>
                            <td className="p-2.5 font-bold text-slate-800 dark:text-white">{v.companyName || '—'}</td>
                            <td className="p-2.5 text-slate-700 dark:text-gray-300 font-medium">{v.contactPerson || '—'}</td>
                            <td className="p-2.5 font-mono text-indigo-600 dark:text-indigo-400 font-semibold">{v.email || '—'}</td>
                            <td className="p-2.5 text-slate-600 dark:text-gray-400 font-mono text-[11px]">{v.phone || '—'}</td>
                            <td className="p-2.5 font-mono text-[10px] text-slate-700 dark:text-gray-200 font-bold">{v.gstNumber || '—'}</td>
                            <td className="p-2.5 text-slate-600 dark:text-gray-400 text-[11px] truncate max-w-[200px]">{v.address || '—'}</td>
                            <td className="p-2.5 font-bold">
                              {v.vendorRatingScore !== undefined && v.vendorRatingScore !== null ? (
                                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                                  <Star size={11} fill="currentColor" /> {v.vendorRatingScore}/100
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[10px]">Optional (N/A)</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Vendor Master Pagination / Show More Bar */}
                {storedVendors.length > 50 && (
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-800 text-xs flex-wrap gap-2">
                    <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                      Showing <strong>1 – {Math.min(vendorPreviewLimit, storedVendors.length).toLocaleString('en-IN')}</strong> of <strong>{storedVendors.length.toLocaleString('en-IN')}</strong> suppliers
                    </span>
                    <div className="flex items-center gap-2">
                      {vendorPreviewLimit < storedVendors.length && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit((prev) => Math.min(prev + 50, storedVendors.length))}
                          className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 hover:border-indigo-400"
                        >
                          <ChevronDown size={12} /> Show More (+50)
                        </button>
                      )}
                      {vendorPreviewLimit < Math.min(500, storedVendors.length) && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit(Math.min(500, storedVendors.length))}
                          className="btn btn-secondary btn-xs font-bold text-[11px] text-indigo-600 dark:text-indigo-400 hover:border-indigo-400"
                        >
                          Show All (up to 500)
                        </button>
                      )}
                      {vendorPreviewLimit > 50 && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit(50)}
                          className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium px-1"
                        >
                          Collapse to 50
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-xl bg-slate-50/50 dark:bg-gray-950/40 space-y-2">
                <FileSpreadsheet className="mx-auto text-slate-400" size={24} />
                <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  No Vendor Master file selected
                </p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Upload your vendor master spreadsheet (.xlsx, .csv, .xls) or manually add suppliers to the table.
                </p>
                <button
                  type="button"
                  onClick={handleAddVendorRow}
                  className="btn btn-secondary btn-xs font-bold text-[11px] inline-flex items-center gap-1 mt-1"
                >
                  <Plus size={12} /> Add Vendor Manually
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(1)} className="btn btn-secondary btn-sm">
                Back to Period
              </button>
              <button
                type="button"
                onClick={() => {
                  if (storedVendors.length === 0) {
                    showToast(
                      'Vendor Master Required',
                      'Please upload a Vendor Master file (.xlsx, .csv, .xls) before proceeding to the PO Dump.',
                      'warning'
                    );
                    return;
                  }
                  setStep(3);
                }}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Proceed to File 2: PO Dump <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FILE 2 — PO PURCHASE DATA INGESTION */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={poFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePODataFileUpload(file);
              }}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    Step 3: Upload File 2 — Historical PO Purchase Dump
                  </h3>
                  <span className="badge badge-purple font-bold text-[10px]">
                    {selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Contains: PO Number, PO Date, Vendor Name / Code, Line Item Description, Quantity, Spend, Department.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadPoDataCsv}
                  className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 shrink-0"
                >
                  <Download size={12} /> Download CSV Template
                </button>
                <button
                  type="button"
                  onClick={resetToSamplePoData}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 underline font-medium"
                >
                  Reset Template
                </button>
              </div>
            </div>

            {/* Progress Card when PO upload is active or completed */}
            {poJob && (
              <IngestionProgressCard job={poJob} title="PO Dump" unit="PO records" />
            )}

            {/* Drag & Drop PO Dump Area */}
            <div
              onClick={() => poFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingPo(true);
              }}
              onDragLeave={() => setIsDraggingPo(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingPo(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handlePODataFileUpload(file);
              }}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                isDraggingPo
                  ? 'border-purple-600 bg-purple-100/70 dark:bg-purple-900/50 scale-[1.01]'
                  : poLineItems.length > 0 || poJob?.status === 'COMPLETED'
                  ? 'border-emerald-300 dark:border-emerald-600/50 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-purple-300 dark:border-purple-500/50 hover:border-purple-600 bg-purple-50/40 dark:bg-purple-950/20 hover:bg-purple-50/80'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-600/20 flex items-center justify-center mx-auto text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                <FileSpreadsheet size={24} />
              </div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mt-2">
                {isParsingPo || poJob?.status === 'PROCESSING'
                  ? 'Streaming and Processing PO Dump Records in Background...'
                  : poLineItems.length > 0 || poJob?.status === 'COMPLETED'
                  ? `PO Dump Loaded (${(poJob?.importedRecords || poLineItems.length).toLocaleString('en-IN')} Records)`
                  : `Click to Browse or Drag & Drop PO Purchase Dump (.xlsx, .csv, .xls)`}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                {poLineItems.length > 0 || poJob
                  ? `Active File: ${poFileName || poJob?.fileName}. Click below to change or upload another PO dump file.`
                  : 'Upload your historical purchase orders to automatically extract purchased items and map vendor categories.'}
              </p>

              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 shadow-sm">
                  <FileSpreadsheet size={12} className="text-purple-500" />
                  <span>Active File:</span>
                  <span className="font-mono text-purple-600 dark:text-purple-400">{poFileName || poJob?.fileName}</span>
                  <span className="text-slate-400">({(poJob?.importedRecords || poLineItems.length).toLocaleString('en-IN')} PO Lines)</span>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    poFileInputRef.current?.click();
                  }}
                  className="btn btn-primary btn-xs font-bold text-[11px] flex items-center gap-1"
                >
                  <UploadCloud size={12} /> Choose Another File
                </button>
              </div>
            </div>

            {/* PO Line Items Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  PO Line Items Preview ({poLineItems.length.toLocaleString('en-IN')} Line Items):
                </span>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">
                  Total Spend: {formatCurrency(poLineItems.reduce((acc, p) => acc + p.totalSpend, 0))}
                </span>
              </div>

              <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900/60 shadow-xs">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5">PO Number</th>
                      <th className="p-2.5">PO Date</th>
                      <th className="p-2.5">Vendor / Supplier</th>
                      <th className="p-2.5">Line Item Description</th>
                      <th className="p-2.5">Specifications</th>
                      <th className="p-2.5">Quantity</th>
                      <th className="p-2.5">Unit</th>
                      <th className="p-2.5">Unit Price</th>
                      <th className="p-2.5">Total Spend</th>
                      <th className="p-2.5">Department</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800 bg-white dark:bg-gray-900/60">
                    {poLineItems.slice(0, poPreviewLimit).map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                        <td className="p-2.5 font-mono text-[10px] text-slate-500">{p.poNumber}</td>
                        <td className="p-2.5 font-mono text-[10px] text-slate-600 dark:text-gray-300">{p.poDate || '—'}</td>
                        <td className="p-2.5 font-bold text-slate-800 dark:text-white">{p.vendorIdentifier}</td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-gray-200">{p.itemName}</td>
                        <td className="p-2.5 text-slate-400 text-[10px] max-w-[160px] truncate">{p.specs || '—'}</td>
                        <td className="p-2.5 text-slate-600 dark:text-gray-300 font-bold">{p.quantity.toLocaleString('en-IN')}</td>
                        <td className="p-2.5 text-slate-500 dark:text-gray-400 text-[10px]">{p.unit}</td>
                        <td className="p-2.5 font-mono text-slate-600 dark:text-gray-300">{p.unitPrice ? formatCurrency(p.unitPrice) : '—'}</td>
                        <td className="p-2.5 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {formatCurrency(p.totalSpend)}
                        </td>
                        <td className="p-2.5 text-slate-500 dark:text-gray-400 text-[10px]">{p.department || 'General'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PO Dump Pagination / Show More Bar */}
              {poLineItems.length > 50 && (
                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-800 text-xs flex-wrap gap-2">
                  <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                    Showing <strong>1 – {Math.min(poPreviewLimit, poLineItems.length).toLocaleString('en-IN')}</strong> of <strong>{poLineItems.length.toLocaleString('en-IN')}</strong> PO line items
                  </span>
                  <div className="flex items-center gap-2">
                    {poPreviewLimit < poLineItems.length && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit((prev) => Math.min(prev + 50, poLineItems.length))}
                        className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 hover:border-purple-400"
                      >
                        <ChevronDown size={12} /> Show More (+50)
                      </button>
                    )}
                    {poPreviewLimit < Math.min(500, poLineItems.length) && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit(Math.min(500, poLineItems.length))}
                        className="btn btn-secondary btn-xs font-bold text-[11px] text-purple-600 dark:text-purple-400 hover:border-purple-400"
                      >
                        Show All (up to 500)
                      </button>
                    )}
                    {poPreviewLimit > 50 && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit(50)}
                        className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium px-1"
                      >
                        Collapse to 50
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(2)} className="btn btn-secondary btn-sm">
                Back to Vendor Master
              </button>
              <button
                type="button"
                onClick={handleSimulatePOJoin}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                {isProcessingPOJoin ? 'Processing Join...' : 'Run AI Category Cross-Match'} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: AI CATEGORY JOIN & CROSS-MATCH AUDIT */}
        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  Step 4: AI Cross-Match & Category Assignment Audit
                </h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Review vendors with buyer-mapped categories vs vendors requiring self-mapping.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 p-1 rounded-xl text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('all')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'all' ? 'bg-white dark:bg-gray-900 text-indigo-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  All ({joinedVendors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('mapped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'mapped' ? 'bg-white dark:bg-gray-900 text-emerald-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ✓ Mapped ({mappedVendors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('unmapped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'unmapped' ? 'bg-white dark:bg-gray-900 text-amber-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ⚠️ Unmapped ({unmappedVendors.length})
                </button>
              </div>
            </div>

            {/* List of Correlated Vendors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1 text-xs">
              {joinedVendors
                .filter((v) => {
                  if (activeReviewTab === 'mapped') return v.categoriesMappedByBuyer;
                  if (activeReviewTab === 'unmapped') return !v.categoriesMappedByBuyer;
                  return true;
                })
                .map((v) => (
                  <div
                    key={v.id}
                    className={`p-4 rounded-2xl border transition-all space-y-2.5 ${
                      v.categoriesMappedByBuyer
                        ? 'bg-slate-50/80 dark:bg-gray-800/50 border-slate-200 dark:border-gray-800'
                        : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300/80 dark:border-amber-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-black text-slate-900 dark:text-white text-xs">{v.companyName}</h4>
                          {v.vendorCode && (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300">
                              {v.vendorCode}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">{v.email} · {v.phone}</span>
                      </div>

                      {v.categoriesMappedByBuyer ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 shrink-0 flex items-center gap-0.5">
                          <Check size={10} /> PO Mapped ({v.poCount} POs)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 shrink-0 flex items-center gap-0.5">
                          <AlertCircle size={10} /> No POs · Self-Map
                        </span>
                      )}
                    </div>

                    {v.categoriesMappedByBuyer ? (
                      <>
                        {/* 1st Set Category */}
                        <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/50">
                          <span className="text-[9px] uppercase font-black text-indigo-700 dark:text-indigo-300 block">
                            1st Set: Primary Major Category
                          </span>
                          <span className="font-bold text-indigo-950 dark:text-white text-xs block mt-0.5">
                            {v.firstSetMajorCategory}
                          </span>
                        </div>

                        {/* 2nd Set Minor Categories */}
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase font-bold text-slate-400 block">
                            2nd Set: Minor Categories & Product Lines
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {v.secondSetMinorCategories.map((m) => (
                              <span
                                key={m}
                                className="px-2 py-0.5 rounded-lg bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 text-[10px] font-semibold"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      /* Unmapped Fallback Notice Box */
                      <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                        <div className="font-bold flex items-center gap-1 text-amber-800 dark:text-amber-300 text-[10px] uppercase">
                          <AlertCircle size={12} />
                          Dispatched Notification Protocol:
                        </div>
                        <p className="text-[10px] leading-relaxed">
                          The onboarding email will explicitly notify <strong>{v.companyName}</strong> that <em>&quot;the buyer didn&apos;t map any categories for you, so please map yourself in order to receive enquiries.&quot;</em>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => setStep(3)} className="btn btn-secondary btn-sm">
                Back to PO Dump
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Review Email Dispatch & Finalize <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: FINAL CONFIRMATION & TAILORED EMAIL PREVIEWS */}
        {step === 5 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 5: Confirm Ingestion & Dispatch Tailored Onboarding Emails
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                The platform will dispatch tailored credentials and category notices based on PO correlation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Template A Preview: PO-Mapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-900 dark:text-indigo-200 text-[11px] flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-emerald-600" />
                    Template A: Suppliers With PO History ({mappedVendors.length})
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900 text-[10px] space-y-1 font-mono text-slate-700 dark:text-gray-300">
                  <p><strong>Subject:</strong> [Action Required] Welcome: {activeBuyerAccount?.organizationName || 'Larsen & Toubro'} mapped your categories</p>
                  <p className="text-emerald-700 dark:text-emerald-400 font-bold">
                    • 1st Set: Engineering Spares - Mechanical<br />
                    • 2nd Set: Pumps, Valves, Hoses, Machinery Parts
                  </p>
                  <p className="text-slate-400">• User: [Email] | Pass: [TempPass] | OTP Ready</p>
                </div>
              </div>

              {/* Template B Preview: Unmapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 dark:text-amber-200 text-[11px] flex items-center gap-1">
                    <AlertCircle size={13} className="text-amber-600" />
                    Template B: Suppliers With NO POs ({unmappedVendors.length})
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 text-[10px] space-y-1 font-mono text-slate-700 dark:text-gray-300">
                  <p><strong>Subject:</strong> [Action Required] Set Up Categories: {activeBuyerAccount?.organizationName || 'Larsen & Toubro'} added you</p>
                  <p className="text-amber-700 dark:text-amber-400 font-bold">
                    • &quot;Buyer didn&apos;t map any categories for you, so please map yourself in order to receive enquiries.&quot;
                  </p>
                  <p className="text-slate-400">• User: [Email] | Pass: [TempPass] | OTP Ready</p>
                </div>
              </div>
            </div>

            {/* Ingestion Totals Grid */}
            <div className="grid grid-cols-4 gap-2.5 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                <span className="text-[10px] text-slate-400 block">Total Stored</span>
                <span className="font-black text-slate-900 dark:text-white text-sm">{joinedVendors.length} Vendors</span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">PO Mapped</span>
                <span className="font-black text-emerald-700 dark:text-emerald-300 text-sm">{mappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
                <span className="text-[10px] text-amber-600 dark:text-amber-400 block">Self-Map Required</span>
                <span className="font-black text-amber-700 dark:text-amber-300 text-sm">{unmappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50">
                <span className="text-[10px] text-purple-600 dark:text-purple-400 block">3-Day Reminders</span>
                <span className="font-black text-purple-700 dark:text-purple-300 text-sm">Active (Day 3)</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="btn btn-secondary btn-sm"
                disabled={isConfirmingIngestion}
              >
                Back to Category Join
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalIngestion}
                disabled={isConfirmingIngestion}
                className="btn btn-primary font-bold text-xs py-3 px-6 shadow-lg shadow-indigo-600/30 flex items-center gap-2 disabled:opacity-60"
              >
                <CheckCircle2 size={16} />{' '}
                {isConfirmingIngestion ? 'PROCESSING...' : `[ COMPLETE SETUP & INGEST ${joinedVendors.length} VENDORS ]`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  }