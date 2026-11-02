'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CreditCard,
  Building2,
  Truck,
  AlertTriangle,
  Clock,
  HelpCircle,
  Search,
  RefreshCw,
  RotateCcw,
  Download,
  Settings,
  Mail,
  MessageSquare,
  Phone,
  CheckCircle2,
  XCircle,
  History,
  CheckSquare,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GripVertical,
  ExternalLink,
  X,
  Send,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  fetchPaymentDues,
  fetchPaymentDuesSummary,
  sendPaymentDuesEmail,
  sendPaymentDuesMessage,
  sendPaymentDuesWhatsApp,
  updatePaymentDuesAcknowledgement,
  fetchPaymentDuesHistory,
  getPaymentDuesExportUrl,
} from '@/lib/paymentDuesClient';
import type {
  PaymentDuesAccount,
  PaymentDuesSummary,
  PaymentDuesCommunication,
  PaymentDuesColumnKey,
  PaymentDuesColumnConfig,
  PaymentDuesFilterParams,
  PaymentDuesAcknowledgementStatus,
  PaymentDuesAccountType,
} from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import BuyerDetailsModal from '../BuyerDetailsModal';
import VendorDetailsModal from '../VendorDetailsModal';

const DEFAULT_COLUMNS: PaymentDuesColumnConfig[] = [
  { key: 'accountId', label: 'Account ID', visible: true },
  { key: 'accountType', label: 'Account Type', visible: true },
  { key: 'companyName', label: 'Company Name', visible: true, required: true },
  { key: 'contactPerson', label: 'Contact Person', visible: true },
  { key: 'email', label: 'Email', visible: true },
  { key: 'phoneNumber', label: 'Phone Number', visible: true },
  { key: 'availableCredits', label: 'Available Credits', visible: true, required: true },
  { key: 'totalCredits', label: 'Total Credits', visible: true },
  { key: 'creditsUsed', label: 'Credits Used', visible: true },
  { key: 'accountStatus', label: 'Account Status', visible: true },
  { key: 'registrationDate', label: 'Registration Date', visible: true },
  { key: 'lastActivity', label: 'Last Activity', visible: true },
  { key: 'assignedExecutive', label: 'Assigned Executive', visible: true },
  { key: 'lastNotification', label: 'Last Notification', visible: true },
  { key: 'notificationChannel', label: 'Notification Channel', visible: true },
  { key: 'acknowledgementStatus', label: 'Acknowledgement Status', visible: true },
  { key: 'actions', label: 'Actions', visible: true, required: true },
];

const LOCAL_STORAGE_KEY = 'qua_payment_dues_column_prefs';

export interface PaymentDuesDashboardProps {
  onSummaryChange?: (summary: PaymentDuesSummary) => void;
}

export default function PaymentDuesDashboard({ onSummaryChange }: PaymentDuesDashboardProps = {}) {
  const strings = UI_STRINGS.actionCenter.paymentDues;

  // Account Data & Summary
  const [accounts, setAccounts] = useState<PaymentDuesAccount[]>([]);
  const [totalAccounts, setTotalAccounts] = useState<number>(0);
  const [summary, setSummary] = useState<PaymentDuesSummary>({
    totalLowCreditAccounts: 0,
    totalBuyers: 0,
    totalSellers: 0,
    zeroCredits: 0,
    oneToTwoCredits: 0,
    acknowledgementPending: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filters & Sorting & Pagination
  const [search, setSearch] = useState<string>('');
  const [accountTypeFilter, setAccountTypeFilter] = useState<'all' | 'buyer' | 'seller'>('all');
  const [creditsFilter, setCreditsFilter] = useState<'all' | '0' | '1-2'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<PaymentDuesColumnKey>('availableCredits');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Column Customization (Gear Popover)
  const [columns, setColumns] = useState<PaymentDuesColumnConfig[]>(DEFAULT_COLUMNS);
  const [isColumnSettingsOpen, setIsColumnSettingsOpen] = useState<boolean>(false);
  const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);

  // Close column settings modal on Escape key
  useEffect(() => {
    if (!isColumnSettingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsColumnSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isColumnSettingsOpen]);

  // Profile Modals
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
  const [selectedBuyerName, setSelectedBuyerName] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedVendorName, setSelectedVendorName] = useState<string | null>(null);

  // Communication Modals
  const [activeActionAccount, setActiveActionAccount] = useState<PaymentDuesAccount | null>(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState<boolean>(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState<boolean>(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState<boolean>(false);
  const [isAckModalOpen, setIsAckModalOpen] = useState<boolean>(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);

  // Form states for modals
  const [emailForm, setEmailForm] = useState({ recipient: '', subject: '', message: '', notes: '' });
  const [messageForm, setMessageForm] = useState({ title: '', message: '', notes: '' });
  const [whatsAppForm, setWhatsAppForm] = useState({ phone: '', message: '', notes: '' });
  const [ackForm, setAckForm] = useState<{ status: PaymentDuesAcknowledgementStatus; notes: string }>({
    status: 'Acknowledgement Pending',
    notes: '',
  });
  const [historyList, setHistoryList] = useState<PaymentDuesCommunication[]>([]);
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Load saved column preferences from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as PaymentDuesColumnConfig[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Merge with defaults to guarantee all keys exist
            const merged = parsed.map((col) => {
              const def = DEFAULT_COLUMNS.find((d) => d.key === col.key);
              return { ...def, ...col };
            });
            DEFAULT_COLUMNS.forEach((def) => {
              if (!merged.find((m) => m.key === def.key)) {
                merged.push(def);
              }
            });
            setColumns(merged);
          }
        }
      } catch {
        // Fallback to default
      }
    }
  }, []);

  // Save column preferences
  const saveColumnPreferences = useCallback((newCols: PaymentDuesColumnConfig[]) => {
    setColumns(newCols);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newCols));
      } catch {
        // ignore
      }
    }
  }, []);

  // Fetch low-credit accounts
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const filters: PaymentDuesFilterParams = {
        search,
        accountType: accountTypeFilter,
        credits: creditsFilter,
        acknowledgementStatus: statusFilter,
        sortBy,
        sortOrder,
        page,
        limit: pageSize,
      };
      const res = await fetchPaymentDues(filters);
      if (res.error) {
        setLoadError(res.error);
        showToast('Failed to load low-credit accounts from database', 'error');
      } else {
        setAccounts(res.accounts);
        setTotalAccounts(res.total);
        setSummary(res.summary);
        onSummaryChange?.(res.summary);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('qua_payment_dues_updated', { detail: res.summary }));
        }
        setLoadError(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load low-credit accounts from database';
      setLoadError(msg);
      showToast('Failed to load low-credit accounts from database', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [search, accountTypeFilter, creditsFilter, statusFilter, sortBy, sortOrder, page, pageSize, showToast, onSummaryChange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Column Visibility Handlers
  const handleToggleColumnVisibility = (key: PaymentDuesColumnKey) => {
    const updated = columns.map((col) => {
      if (col.key === key) {
        return { ...col, visible: !col.visible };
      }
      return col;
    });
    saveColumnPreferences(updated);
  };

  const handleSelectAllColumns = () => {
    const updated = columns.map((col) => ({ ...col, visible: true }));
    saveColumnPreferences(updated);
  };

  const handleHideAllOptionalColumns = () => {
    const updated = columns.map((col) => ({
      ...col,
      visible: !!col.required,
    }));
    saveColumnPreferences(updated);
  };

  const handleResetColumns = () => {
    saveColumnPreferences(DEFAULT_COLUMNS);
  };

  // Drag-and-drop column reordering
  const handleDragStart = (index: number) => {
    setDraggedColumnIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedColumnIndex === null || draggedColumnIndex === targetIndex) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(draggedColumnIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setDraggedColumnIndex(null);
    saveColumnPreferences(reordered);
  };

  // Sort Handler
  const handleSort = (colKey: PaymentDuesColumnKey) => {
    if (sortBy === colKey) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(colKey);
      setSortOrder('asc');
    }
    setPage(1);
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearch('');
    setAccountTypeFilter('all');
    setCreditsFilter('all');
    setStatusFilter('all');
    setSortBy('availableCredits');
    setSortOrder('asc');
    setPage(1);
  };

  // Open communication modals with prefilled templates
  const handleOpenEmailModal = (account: PaymentDuesAccount) => {
    setActiveActionAccount(account);
    const defaultSubject = 'Low Credit Balance Notification – QUA AI';
    const defaultMessage = `Dear ${account.contactPerson || 'Valued Partner'},\n\nThis is to inform you that your QUA AI account currently has only ${account.availableCredits} credits remaining.\n\nPlease review your credit balance and take the necessary action to continue using the platform without interruption.\n\nKindly acknowledge receipt of this notification.\n\nRegards,\nQUA AI Team\nProcucev Enterprises Solutions Pvt Ltd.`;
    setEmailForm({
      recipient: account.email && account.email !== '–' ? account.email : '',
      subject: defaultSubject,
      message: defaultMessage,
      notes: '',
    });
    setIsEmailModalOpen(true);
  };

  const handleOpenMessageModal = (account: PaymentDuesAccount) => {
    setActiveActionAccount(account);
    const defaultTitle = 'Low Credit Balance Notification – QUA AI';
    const defaultMessage = `Your QUA AI credit balance is currently ${account.availableCredits} credit(s). Please replenish your credits to avoid service disruptions.`;
    setMessageForm({
      title: defaultTitle,
      message: defaultMessage,
      notes: '',
    });
    setIsMessageModalOpen(true);
  };

  const handleOpenWhatsAppModal = (account: PaymentDuesAccount) => {
    setActiveActionAccount(account);
    const defaultMessage = `Dear ${account.contactPerson || 'Valued Partner'},\n\nThis is to inform you that your QUA AI account currently has only ${account.availableCredits} credits remaining.\n\nPlease review your credit balance and take the necessary action to continue using the platform without interruption.\n\nKindly acknowledge receipt of this notification.\n\nRegards,\nQUA AI Team\nProcucev Enterprises Solutions Pvt Ltd.`;
    setWhatsAppForm({
      phone: account.phoneNumber && account.phoneNumber !== '–' ? account.phoneNumber : '',
      message: defaultMessage,
      notes: '',
    });
    setIsWhatsAppModalOpen(true);
  };

  const handleOpenAckModal = (account: PaymentDuesAccount) => {
    setActiveActionAccount(account);
    setAckForm({
      status: account.acknowledgementStatus || 'Acknowledgement Pending',
      notes: '',
    });
    setIsAckModalOpen(true);
  };

  const handleOpenHistoryModal = async (account: PaymentDuesAccount) => {
    setActiveActionAccount(account);
    setIsHistoryModalOpen(true);
    try {
      const history = await fetchPaymentDuesHistory(account.accountId);
      setHistoryList(history);
    } catch {
      setHistoryList([]);
    }
  };

  // Submit Actions
  const handleSubmitEmail = async (e: React.FormEvent, account: PaymentDuesAccount) => {
    e.preventDefault();
    setIsSubmittingAction(true);
    const res = await sendPaymentDuesEmail({
      accountId: account.accountId,
      accountType: account.accountType,
      recipientEmail: emailForm.recipient,
      subject: emailForm.subject,
      message: emailForm.message,
      notes: emailForm.notes,
    });
    setIsSubmittingAction(false);
    if (res.success) {
      showToast('Email notification sent and audit log updated successfully');
      setIsEmailModalOpen(false);
      loadData();
    } else {
      showToast(res.error || 'Failed to send email notification', 'error');
    }
  };

  const handleSubmitMessage = async (e: React.FormEvent, account: PaymentDuesAccount) => {
    e.preventDefault();
    setIsSubmittingAction(true);
    const res = await sendPaymentDuesMessage({
      accountId: account.accountId,
      accountType: account.accountType,
      title: messageForm.title,
      message: messageForm.message,
      notes: messageForm.notes,
    });
    setIsSubmittingAction(false);
    if (res.success) {
      showToast('In-app message delivered and audit log updated successfully');
      setIsMessageModalOpen(false);
      loadData();
    } else {
      showToast(res.error || 'Failed to send in-app message', 'error');
    }
  };

  const handleSubmitWhatsApp = async (e: React.FormEvent, account: PaymentDuesAccount) => {
    e.preventDefault();
    setIsSubmittingAction(true);
    const res = await sendPaymentDuesWhatsApp({
      accountId: account.accountId,
      accountType: account.accountType,
      phone: whatsAppForm.phone,
      message: whatsAppForm.message,
      notes: whatsAppForm.notes,
    });
    setIsSubmittingAction(false);
    if (res.success) {
      showToast('WhatsApp notification initiated and audit log updated successfully');
      setIsWhatsAppModalOpen(false);
      if (res.directLink) {
        window.open(res.directLink, '_blank', 'noopener,noreferrer');
      }
      loadData();
    } else {
      showToast(res.error || 'Failed to initiate WhatsApp notification', 'error');
    }
  };

  const handleSubmitAck = async (e: React.FormEvent, account: PaymentDuesAccount) => {
    e.preventDefault();
    setIsSubmittingAction(true);
    const res = await updatePaymentDuesAcknowledgement({
      accountId: account.accountId,
      accountType: account.accountType,
      acknowledgementStatus: ackForm.status,
      notes: ackForm.notes,
    });
    setIsSubmittingAction(false);
    if (res.success) {
      showToast(`Acknowledgement status updated to "${ackForm.status}"`);
      setIsAckModalOpen(false);
      loadData();
    } else {
      showToast(res.error || 'Failed to update acknowledgement status', 'error');
    }
  };

  // Visible columns in user's chosen order
  const visibleColumns = useMemo(() => {
    return columns.filter((c) => c.visible);
  }, [columns]);

  // Credit Badge Component
  const renderCreditBadge = (credits: number) => {
    if (credits === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />0 Credits · Critical
        </span>
      );
    }
    if (credits === 1) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />1 Credit · Attention
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-800">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-600" />2 Credits · Low
      </span>
    );
  };

  // Acknowledgement Badge Component
  const renderAckBadge = (status: PaymentDuesAcknowledgementStatus) => {
    switch (status) {
      case 'Acknowledged':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 size={12} className="text-emerald-600" /> Acknowledged
          </span>
        );
      case 'Acknowledgement Pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Clock size={12} className="text-amber-600" /> Ack Pending
          </span>
        );
      case 'Delivered':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            <CheckCircle2 size={12} className="text-indigo-600" /> Delivered
          </span>
        );
      case 'Notification Sent':
      case 'Delivery Pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Send size={12} className="text-blue-600" /> Sent
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <XCircle size={12} className="text-rose-600" /> Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Not Notified
          </span>
        );
    }
  };

  // Render Cell content by key
  const renderCellContent = (account: PaymentDuesAccount, key: PaymentDuesColumnKey) => {
    switch (key) {
      case 'accountId':
        return (
          <button
            type="button"
            onClick={() => {
              if (account.accountType === 'buyer') {
                setSelectedBuyerId(account.accountId);
                setSelectedBuyerName(account.companyName);
              } else {
                setSelectedVendorId(account.accountId);
                setSelectedVendorName(account.companyName);
              }
            }}
            className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {account.accountId}
          </button>
        );

      case 'accountType':
        return account.accountType === 'buyer' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
            <Building2 size={11} /> Buyer
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            <Truck size={11} /> Seller
          </span>
        );

      case 'companyName':
        return (
          <button
            type="button"
            onClick={() => {
              if (account.accountType === 'buyer') {
                setSelectedBuyerId(account.accountId);
                setSelectedBuyerName(account.companyName);
              } else {
                setSelectedVendorId(account.accountId);
                setSelectedVendorName(account.companyName);
              }
            }}
            className="text-left font-semibold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer flex items-center gap-1.5"
          >
            <span>{account.companyName}</span>
            <ExternalLink size={12} className="text-slate-400 hover:text-indigo-500" />
          </button>
        );

      case 'contactPerson':
        return <span className="text-slate-700 dark:text-slate-300">{account.contactPerson}</span>;

      case 'email':
        return (
          <span className="text-slate-600 dark:text-slate-400 font-mono text-[11px]" title={account.email}>
            {account.email}
          </span>
        );

      case 'phoneNumber':
        return (
          <span className="text-slate-600 dark:text-slate-400 font-mono text-[11px]">
            {account.phoneNumber}
          </span>
        );

      case 'availableCredits':
        return renderCreditBadge(account.availableCredits);

      case 'totalCredits':
        return <span className="font-semibold text-slate-700 dark:text-slate-300">{account.totalCredits}</span>;

      case 'creditsUsed':
        return <span className="text-slate-600 dark:text-slate-400">{account.creditsUsed}</span>;

      case 'accountStatus':
        return (
          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 capitalize">
            {account.accountStatus}
          </span>
        );

      case 'registrationDate':
        return (
          <span className="text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
            {account.registrationDate ? new Date(account.registrationDate).toLocaleDateString() : '–'}
          </span>
        );

      case 'lastActivity':
        return (
          <span className="text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
            {account.lastActivity ? new Date(account.lastActivity).toLocaleDateString() : '–'}
          </span>
        );

      case 'assignedExecutive':
        return <span className="text-slate-600 dark:text-slate-300">{account.assignedExecutive}</span>;

      case 'lastNotification':
        return (
          <span className="text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
            {account.lastNotification ? new Date(account.lastNotification).toLocaleDateString() : '–'}
          </span>
        );

      case 'notificationChannel':
        return (
          <span className="text-slate-600 dark:text-slate-300 capitalize text-xs">
            {account.notificationChannel || '–'}
          </span>
        );

      case 'acknowledgementStatus':
        return renderAckBadge(account.acknowledgementStatus);

      case 'actions':
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={() => handleOpenEmailModal(account)}
              title={strings.actions.sendEmail}
              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded border border-blue-200 dark:border-blue-900 transition-colors"
            >
              <Mail size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleOpenMessageModal(account)}
              title={strings.actions.sendMessage}
              className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded border border-indigo-200 dark:border-indigo-900 transition-colors"
            >
              <MessageSquare size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleOpenWhatsAppModal(account)}
              title={strings.actions.sendWhatsApp}
              className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded border border-emerald-200 dark:border-emerald-900 transition-colors"
            >
              <Phone size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleOpenAckModal(account)}
              title={strings.actions.updateStatus}
              className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded border border-amber-200 dark:border-amber-900 transition-colors"
            >
              <CheckSquare size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleOpenHistoryModal(account)}
              title={strings.actions.viewHistory}
              className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <History size={13} />
            </button>
          </div>
        );

      default:
        return '–';
    }
  };

  const totalPages = Math.ceil(totalAccounts / pageSize) || 1;

  return (
    <div className="w-full space-y-4 animate-in fade-in duration-200">
      {/* Toast alert */}
      {toastMessage && (
        <div
          role="alert"
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-xs font-semibold ${
            toastMessage.type === 'error'
              ? 'bg-rose-600 text-white'
              : 'bg-emerald-600 text-white'
          }`}
        >
          {toastMessage.type === 'error' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* 6 Dynamic Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 w-full">
        {/* Low-Credit Accounts */}
        <div
          onClick={() => {
            setAccountTypeFilter('all');
            setCreditsFilter('all');
            setPage(1);
          }}
          className="bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-400 transition cursor-pointer flex flex-col justify-between h-full"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
              {strings.kpi.totalLowCreditAccounts}
            </span>
            <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400 shrink-0">
              <CreditCard className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            {summary.totalLowCreditAccounts}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {strings.kpi.totalLowCreditSubtitle}
          </div>
        </div>

        {/* Buyers */}
        <div
          onClick={() => {
            setAccountTypeFilter('buyer');
            setPage(1);
          }}
          className="bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-sky-400 transition cursor-pointer flex flex-col justify-between h-full"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
              {strings.kpi.totalBuyers}
            </span>
            <div className="p-1.5 rounded-md bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 shrink-0">
              <Building2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-sky-700 dark:text-sky-300">
            {summary.totalBuyers}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {strings.kpi.totalBuyersSubtitle}
          </div>
        </div>

        {/* Sellers */}
        <div
          onClick={() => {
            setAccountTypeFilter('seller');
            setPage(1);
          }}
          className="bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-purple-400 transition cursor-pointer flex flex-col justify-between h-full"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
              {strings.kpi.totalSellers}
            </span>
            <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 shrink-0">
              <Truck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-purple-700 dark:text-purple-300">
            {summary.totalSellers}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {strings.kpi.totalSellersSubtitle}
          </div>
        </div>

        {/* 0 Credits (Critical) */}
        <div
          onClick={() => {
            setCreditsFilter('0');
            setPage(1);
          }}
          className="bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/60 shadow-sm hover:border-rose-400 transition cursor-pointer bg-rose-50/20 flex flex-col justify-between h-full"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider truncate">
              {strings.kpi.zeroCredits}
            </span>
            <div className="p-1.5 rounded-md bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-rose-600 dark:text-rose-400">
            {summary.zeroCredits}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {strings.kpi.zeroCreditsSubtitle}
          </div>
        </div>

        {/* 1-2 Credits (Attention) */}
        <div
          onClick={() => {
            setCreditsFilter('1-2');
            setPage(1);
          }}
          className="bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 shadow-sm hover:border-amber-400 transition cursor-pointer bg-amber-50/20 flex flex-col justify-between h-full"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider truncate">
              {strings.kpi.oneToTwoCredits}
            </span>
            <div className="p-1.5 rounded-md bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 shrink-0">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-400">
            {summary.oneToTwoCredits}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {strings.kpi.oneToTwoCreditsSubtitle}
          </div>
        </div>

        {/* Acknowledgement Pending */}
        <div
          onClick={() => {
            setStatusFilter('Acknowledgement Pending');
            setPage(1);
          }}
          className="bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-400 transition cursor-pointer flex flex-col justify-between h-full"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
              {strings.kpi.acknowledgementPending}
            </span>
            <div className="p-1.5 rounded-md bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 shrink-0">
              <HelpCircle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-orange-600 dark:text-orange-400">
            {summary.acknowledgementPending}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {strings.kpi.acknowledgementPendingSubtitle}
          </div>
        </div>
      </div>

      {/* TOOLBAR: SEARCH, ACCOUNT TYPE, CREDIT FILTER, ACKNOWLEDGEMENT STATUS, REFRESH, EXPORT CSV & GEAR ICON IN ONE HORIZONTAL ROW */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-sm flex flex-row items-center gap-2 sm:gap-2.5 overflow-x-auto no-scrollbar">
        {/* Search input with maximum available width */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={strings.toolbar.searchPlaceholder}
            className="w-full pl-8 pr-7 py-1.5 h-8.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Account Type Filter */}
        <select
          value={accountTypeFilter}
          onChange={(e) => {
            setAccountTypeFilter(e.target.value as 'all' | 'buyer' | 'seller');
            setPage(1);
          }}
          aria-label={strings.toolbar.accountTypeFilter}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{strings.toolbar.allTypes}</option>
          <option value="buyer">{strings.toolbar.buyersOnly}</option>
          <option value="seller">{strings.toolbar.sellersOnly}</option>
        </select>

        {/* Credit Filter */}
        <select
          value={creditsFilter}
          onChange={(e) => {
            setCreditsFilter(e.target.value as 'all' | '0' | '1-2');
            setPage(1);
          }}
          aria-label={strings.toolbar.creditsFilter}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{strings.toolbar.allCredits}</option>
          <option value="0">{strings.toolbar.zeroCreditsOnly}</option>
          <option value="1-2">{strings.toolbar.oneToTwoCreditsOnly}</option>
        </select>

        {/* Acknowledgement Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          aria-label={strings.toolbar.statusFilter}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 max-w-[190px] focus:outline-none focus:ring-1 focus:ring-emerald-500 whitespace-nowrap cursor-pointer truncate"
        >
          <option value="all">{strings.toolbar.allStatuses}</option>
          <option value="Not Notified">Not Notified</option>
          <option value="Notification Sent">Notification Sent</option>
          <option value="Delivery Pending">Delivery Pending</option>
          <option value="Delivered">Delivered</option>
          <option value="Acknowledgement Pending">Acknowledgement Pending</option>
          <option value="Acknowledged">Acknowledged</option>
          <option value="Failed">Failed</option>
        </select>

        {/* Reset Filters button */}
        <button
          type="button"
          onClick={handleResetFilters}
          title={strings.toolbar.resetFilters}
          aria-label={strings.toolbar.resetFilters}
          className="h-8.5 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Action Buttons Aligned at Right: Refresh, Export CSV, and Gear Icon */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Refresh */}
          <button
            type="button"
            onClick={() => loadData()}
            disabled={isLoading}
            title={strings.toolbar.refresh}
            aria-label={strings.toolbar.refresh}
            className="p-2 h-8.5 w-8.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* Export CSV */}
          <a
            href={getPaymentDuesExportUrl({
              search,
              accountType: accountTypeFilter,
              credits: creditsFilter,
              acknowledgementStatus: statusFilter,
              sortBy,
              sortOrder,
            })}
            download="payment_dues_report.csv"
            className="flex items-center gap-1.5 px-3 py-1.5 h-8.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{strings.toolbar.exportCsv}</span>
          </a>

          {/* Gear Icon - Customize Columns */}
          <button
            type="button"
            onClick={() => setIsColumnSettingsOpen((prev) => !prev)}
            title={strings.toolbar.columnSettings}
            aria-label={strings.toolbar.columnSettings}
            className={`p-2 h-8.5 w-8.5 rounded-lg border transition-colors flex items-center justify-center shrink-0 cursor-pointer ${
              isColumnSettingsOpen
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Column Customization Modal - Centered Popup with Background Overlay */}
      {isColumnSettingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Customize Columns"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsColumnSettingsOpen(false);
            }
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Column Settings</h3>
                  <p className="text-[11px] text-slate-500">Show, hide, and drag handles to reorder columns</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsColumnSettingsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Actions (Select All, Hide Optional) */}
            <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={handleSelectAllColumns}
                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleHideAllOptionalColumns}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                Hide All Optional
              </button>
            </div>

            {/* Column List with Drag-and-Drop */}
            <div className="p-4 overflow-y-auto space-y-1 divide-y divide-slate-100 dark:divide-slate-800/60 flex-1">
              {columns.map((col, idx) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  className={`pt-2 pb-2 first:pt-0 flex items-center justify-between gap-3 px-2 rounded-lg transition-colors cursor-move ${
                    draggedColumnIndex === idx
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 opacity-50'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GripVertical className="w-4 h-4 text-slate-400 shrink-0 cursor-grab active:cursor-grabbing" />
                    <label
                      htmlFor={`col-toggle-${col.key}`}
                      className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none truncate"
                    >
                      <input
                        type="checkbox"
                        id={`col-toggle-${col.key}`}
                        checked={col.visible}
                        disabled={col.required}
                        onChange={() => handleToggleColumnVisibility(col.key)}
                        className="rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50 cursor-pointer"
                      />
                      <span className={col.required ? 'font-semibold text-slate-900 dark:text-slate-100' : ''}>
                        {col.label}
                      </span>
                      {col.required && <span className="ml-1 text-[10px] text-slate-400 font-normal">(locked)</span>}
                    </label>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono shrink-0">#{idx + 1}</span>
                </div>
              ))}
            </div>

            {/* Modal Footer with Reset and Done */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetColumns}
                className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
              <button
                type="button"
                onClick={() => setIsColumnSettingsOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Structured Table */}
      <div className="w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto no-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 select-none">
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className="px-3.5 py-3 font-semibold whitespace-nowrap"
                  >
                    {col.key === 'actions' ? (
                      <span>{col.label}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                      >
                        <span>{col.label}</span>
                        {sortBy === col.key ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp size={12} className="text-indigo-600" />
                          ) : (
                            <ArrowDown size={12} className="text-indigo-600" />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="text-slate-400 opacity-60" />
                        )}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-16 text-center text-slate-500">
                    <Loader2 size={24} className="animate-spin mx-auto text-indigo-600 mb-2" />
                    <span>Loading low-credit accounts from database...</span>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-16 text-center text-slate-500">
                    <AlertTriangle size={24} className="mx-auto text-rose-500 mb-2" />
                    <p className="font-semibold text-rose-600 dark:text-rose-400">
                      Failed to load low-credit accounts
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                      {loadError}
                    </p>
                    <button
                      type="button"
                      onClick={() => loadData()}
                      className="mt-3 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition cursor-pointer"
                    >
                      Retry Connection
                    </button>
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-16 text-center text-slate-500">
                    <AlertTriangle size={24} className="mx-auto text-slate-400 mb-2" />
                    <p className="font-medium text-slate-700 dark:text-slate-300">
                      {strings.emptyState}
                    </p>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 underline font-medium"
                    >
                      {strings.toolbar.resetFilters}
                    </button>
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => (
                  <tr
                    key={acc.accountId}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-3.5 py-3 text-slate-700 dark:text-slate-300">
                        {renderCellContent(acc, col.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        {!isLoading && totalAccounts > 0 && (
          <div className="px-4 py-3 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-300"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="ml-2">
                Showing {Math.min((page - 1) * pageSize + 1, totalAccounts)} to{' '}
                {Math.min(page * pageSize, totalAccounts)} of {totalAccounts} accounts
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-300">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* COMMUNICATION & ACTION MODALS */}
      {/* ========================================================================= */}

      {/* 1. Email Modal */}
      {isEmailModalOpen && activeActionAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40">
                  <Mail size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {strings.modals.emailTitle}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {activeActionAccount.companyName} ({activeActionAccount.accountType.toUpperCase()})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEmailModalOpen(false)}
                aria-label="Close"
                title="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => handleSubmitEmail(e, activeActionAccount)} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.emailRecipient}
                </label>
                <input
                  type="email"
                  required
                  value={emailForm.recipient}
                  onChange={(e) => setEmailForm({ ...emailForm, recipient: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.emailSubject}
                </label>
                <input
                  type="text"
                  required
                  value={emailForm.subject}
                  onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.emailMessage}
                </label>
                <textarea
                  rows={6}
                  required
                  value={emailForm.message}
                  onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Internal Follow-up Notes (Optional)
                </label>
                <input
                  type="text"
                  value={emailForm.notes}
                  onChange={(e) => setEmailForm({ ...emailForm, notes: e.target.value })}
                  placeholder="e.g. Discussed extension with CFO"
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEmailModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {strings.modals.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSubmittingAction ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  <span>{strings.modals.emailSend}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. In-App Message Modal */}
      {isMessageModalOpen && activeActionAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40">
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {strings.modals.messageTitle}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {activeActionAccount.companyName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMessageModalOpen(false)}
                aria-label="Close"
                title="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => handleSubmitMessage(e, activeActionAccount)} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.messageTitleLabel}
                </label>
                <input
                  type="text"
                  value={messageForm.title}
                  onChange={(e) => setMessageForm({ ...messageForm, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.messageBodyLabel}
                </label>
                <textarea
                  rows={4}
                  required
                  value={messageForm.message}
                  onChange={(e) => setMessageForm({ ...messageForm, message: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Internal Notes (Optional)
                </label>
                <input
                  type="text"
                  value={messageForm.notes}
                  onChange={(e) => setMessageForm({ ...messageForm, notes: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsMessageModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {strings.modals.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSubmittingAction ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  <span>{strings.modals.messageSend}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. WhatsApp Modal */}
      {isWhatsAppModalOpen && activeActionAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                  <Phone size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {strings.modals.whatsAppTitle}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {activeActionAccount.companyName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsWhatsAppModalOpen(false)}
                aria-label="Close"
                title="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => handleSubmitWhatsApp(e, activeActionAccount)} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.whatsAppNumber}
                </label>
                <input
                  type="text"
                  required
                  value={whatsAppForm.phone}
                  onChange={(e) => setWhatsAppForm({ ...whatsAppForm, phone: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.whatsAppMessage}
                </label>
                <textarea
                  rows={5}
                  required
                  value={whatsAppForm.message}
                  onChange={(e) => setWhatsAppForm({ ...whatsAppForm, message: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsWhatsAppModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {strings.modals.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSubmittingAction ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  <span>{strings.modals.whatsAppSend}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Acknowledgement Status Modal */}
      {isAckModalOpen && activeActionAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/40">
                  <CheckSquare size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {strings.modals.ackTitle}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {activeActionAccount.companyName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAckModalOpen(false)}
                aria-label="Close"
                title="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => handleSubmitAck(e, activeActionAccount)} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.ackStatusLabel}
                </label>
                <select
                  aria-label={strings.modals.ackStatusLabel}
                  value={ackForm.status}
                  onChange={(e) => setAckForm({ ...ackForm, status: e.target.value as PaymentDuesAcknowledgementStatus })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                >
                  <option value="Not Notified">Not Notified</option>
                  <option value="Notification Sent">Notification Sent</option>
                  <option value="Delivery Pending">Delivery Pending</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Acknowledgement Pending">Acknowledgement Pending</option>
                  <option value="Acknowledged">Acknowledged (Confirmed Response)</option>
                  <option value="Failed">Failed (Undeliverable / Rejected)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modals.ackNotesLabel}
                </label>
                <textarea
                  rows={3}
                  value={ackForm.notes}
                  onChange={(e) => setAckForm({ ...ackForm, notes: e.target.value })}
                  placeholder="Record client confirmation, telephone remarks, or resolution reason..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAckModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {strings.modals.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {strings.modals.ackSubmit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Communication History & Audit Modal */}
      {isHistoryModalOpen && activeActionAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <History size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {strings.modals.historyTitle}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {activeActionAccount.companyName} ({activeActionAccount.accountId})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                aria-label="Close"
                title="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3.5 flex-1">
              {historyList.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  {strings.modals.noHistoryFound}
                </div>
              ) : (
                historyList.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white capitalize">
                          {item.channel} Notification
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          to {item.recipient}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {item.sentAt ? new Date(item.sentAt).toLocaleString() : ''}
                      </span>
                    </div>

                    {item.subject && (
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {item.subject}
                      </div>
                    )}

                    <div className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-100 dark:border-slate-800 font-mono text-[11px]">
                      {item.message}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Status:</span>
                        {renderAckBadge(item.acknowledgementStatus)}
                      </div>
                      <span className="text-slate-400">
                        By {item.communicatedBy || 'Category Manager'}
                      </span>
                    </div>

                    {item.notes && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                        <strong>Notes:</strong> {item.notes}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300"
              >
                {strings.modals.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* REUSED BUYER & SELLER PROFILE MODALS */}
      {/* ========================================================================= */}
      <BuyerDetailsModal
        isOpen={!!selectedBuyerId}
        onClose={() => {
          setSelectedBuyerId(null);
          setSelectedBuyerName(null);
        }}
        buyerAccountId={selectedBuyerId}
        buyerName={selectedBuyerName}
      />

      <VendorDetailsModal
        isOpen={!!selectedVendorId}
        onClose={() => {
          setSelectedVendorId(null);
          setSelectedVendorName(null);
        }}
        vendorId={selectedVendorId}
        vendorName={selectedVendorName}
      />
    </div>
  );
}


export { PaymentDuesDashboard };
