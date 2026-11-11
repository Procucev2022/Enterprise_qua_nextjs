'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  Send,
  Mail,
  Smartphone,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  User,
  MessageSquare,
  Paperclip,
  FileText,
  ChevronDown,
  Check,
  Sparkles,
  Upload,
} from 'lucide-react';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { DEFAULT_INTERNAL_MEMBERS, ACTION_CENTER_SMS_MAX_CHARS } from '@/lib/constants';
import { dispatchActionCenterCommunication } from '@/lib/actionCenterCommClient';
import {
  getScenariosForEntityType,
  interpolateScenarioTemplate,
  type EmailScenarioTemplate,
} from '@/lib/emailScenarioTemplates';
import { fetchDocuments } from '@/lib/documentVaultClient';
import type {
  ActionCenterCommChannel,
  ActionCenterEntityType,
  ActionCenterCommunicationResult,
  ActionCenterAttachment,
  DocumentVaultItem,
} from '@/lib/types';

const EMPTY_ATTACHMENTS: ActionCenterAttachment[] = [];

export interface ActionCenterComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: ActionCenterEntityType;
  entityId: string;
  defaultRecipientName?: string;
  defaultRecipientEmail?: string;
  defaultRecipientPhone?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  defaultChannel?: ActionCenterCommChannel;
  defaultScenarioId?: string;
  defaultAttachments?: ActionCenterAttachment[];
  onSuccess?: (result: ActionCenterCommunicationResult) => void;
}

export default function ActionCenterComposeModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  defaultRecipientName = '',
  defaultRecipientEmail = '',
  defaultRecipientPhone = '',
  defaultSubject = '',
  defaultMessage = '',
  defaultChannel = 'EMAIL',
  defaultScenarioId = '',
  defaultAttachments = EMPTY_ATTACHMENTS,
  onSuccess,
}: ActionCenterComposeModalProps) {
  const strings = UI_STRINGS.actionCenter.communicationModal;

  const [channel, setChannel] = useState<ActionCenterCommChannel>(defaultChannel);
  const [recipientName, setRecipientName] = useState(defaultRecipientName);
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail);
  const [recipientPhone, setRecipientPhone] = useState(defaultRecipientPhone);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);

  // Scenario & Document Vault Attachments
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(defaultScenarioId);
  const [availableDocuments, setAvailableDocuments] = useState<DocumentVaultItem[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<ActionCenterAttachment[]>(defaultAttachments);
  const [isAttachmentDropdownOpen, setIsAttachmentDropdownOpen] = useState(false);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  const [scheduleFollowup, setScheduleFollowup] = useState(false);
  const [followupDueDate, setFollowupDueDate] = useState('');
  const [followupPriority, setFollowupPriority] = useState<'Critical' | 'High' | 'Medium' | 'Low'>('Medium');
  const [followupAssigneeId, setFollowupAssigneeId] = useState(DEFAULT_INTERNAL_MEMBERS[0]?.id || '');
  const [followupNotes, setFollowupNotes] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [followupErrorNotice, setFollowupErrorNotice] = useState<string | null>(null);
  const [isDispatched, setIsDispatched] = useState<boolean>(false);

  // Load available active documents from Document Vault
  useEffect(() => {
    let isMounted = true;
    if (isOpen) {
      fetchDocuments({ activeOnly: true })
        .then((docs: DocumentVaultItem[]) => {
          if (isMounted) {
            setAvailableDocuments(docs);
          }
        })
        .catch(() => {
          if (isMounted) {
            setAvailableDocuments([]);
          }
        });
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen]);



  // Sync default props when modal opens
  useEffect(() => {
    if (isOpen) {
      setChannel(defaultChannel);
      setRecipientName(defaultRecipientName);
      setRecipientEmail(defaultRecipientEmail);
      setRecipientPhone(defaultRecipientPhone);
      setSubject(defaultSubject);
      setMessage(defaultMessage);
      setSelectedScenarioId(defaultScenarioId);
      setSelectedAttachments(defaultAttachments);
      setIsAttachmentDropdownOpen(false);
      setFormError(null);
      setToastMessage(null);
      setFollowupErrorNotice(null);
      setScheduleFollowup(false);
      setFollowupDueDate('');
      setFollowupNotes('');
      setIsDispatched(false);
    }
  }, [
    isOpen,
    defaultChannel,
    defaultRecipientName,
    defaultRecipientEmail,
    defaultRecipientPhone,
    defaultSubject,
    defaultMessage,
    defaultScenarioId,
    defaultAttachments,
  ]);

  const scenarios = useMemo(() => {
    return getScenariosForEntityType(entityType);
  }, [entityType]);

  const smsChars = message.length;
  const smsUnits = useMemo(() => {
    return Math.max(1, Math.ceil(smsChars / ACTION_CENTER_SMS_MAX_CHARS));
  }, [smsChars]);

  const assignedMember = useMemo(() => {
    return DEFAULT_INTERNAL_MEMBERS.find((m) => m.id === followupAssigneeId);
  }, [followupAssigneeId]);

  // Scenario Selection Handler with Auto-select of suggested documents
  const handleScenarioChange = useCallback(
    (scenarioId: string) => {
      setSelectedScenarioId(scenarioId);
      if (!scenarioId || scenarioId === 'custom') {
        return;
      }

      const template = scenarios.find((s) => s.id === scenarioId);
      if (!template) return;

      const defaultDateStr = new Date(Date.now() + 86400000 * (template.defaultFollowupDays || 2))
        .toISOString()
        .slice(0, 10);

      const tokens: Record<string, string | number | undefined> = {
        contactName: recipientName.trim() || 'Partner',
        companyName: recipientName.trim() || entityId,
        entityId,
        followupDate: followupDueDate || defaultDateStr,
        followupTime: '11:00 AM',
        followupNotes: followupNotes.trim() || 'Commercial proposal and plan review',
        assigneeName: assignedMember?.name || 'Category Specialist',
        senderName: 'Category Manager',
        dueDate: followupDueDate || defaultDateStr,
        rfqNumber: entityId,
        rfqTitle: 'Procurement Requirements',
        notes: message || 'Please review the attached commercial details',
        priority: followupPriority,
        taskTitle: subject || 'Commercial Action Item',
      };

      if (template.subjectTemplate) {
        setSubject(interpolateScenarioTemplate(template.subjectTemplate, tokens));
      }
      if (template.bodyTemplate) {
        setMessage(interpolateScenarioTemplate(template.bodyTemplate, tokens));
      }

      // Auto-select suggested documents from the vault (Requirement 2)
      if (Array.isArray(template.suggestedVaultTags) && template.suggestedVaultTags.length > 0 && availableDocuments.length > 0) {
        const matchingDocs = availableDocuments.filter((d) =>
          template.suggestedVaultTags.includes(d.category)
        );
        if (matchingDocs.length > 0) {
          setSelectedAttachments((prev) => {
            const existingIds = new Set(prev.map((a) => a.id));
            const newToAdd = matchingDocs
              .filter((d) => !existingIds.has(d.id))
              .map((d) => ({
                id: d.id,
                documentName: d.documentName,
                fileName: d.fileName,
                fileSize: d.fileSize,
                mimeType: d.mimeType,
                category: d.category,
              }));
            return [...prev, ...newToAdd];
          });
        }
      }
    },
    [
      scenarios,
      recipientName,
      entityId,
      followupDueDate,
      followupNotes,
      assignedMember?.name,
      message,
      followupPriority,
      subject,
      availableDocuments,
    ]
  );

  const toggleAttachment = useCallback((doc: DocumentVaultItem) => {
    setSelectedAttachments((prev) => {
      const exists = prev.some((a) => a.id === doc.id);
      if (exists) {
        return prev.filter((a) => a.id !== doc.id);
      } else {
        return [
          ...prev,
          {
            id: doc.id,
            documentName: doc.documentName,
            fileName: doc.fileName,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            category: doc.category,
          },
        ];
      }
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setSelectedAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // One-off direct local file upload handler (Requirement 3)
  const handleLocalFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const newLocalAtt: ActionCenterAttachment = {
        id: `local_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        documentName: `${cleanName} (Local Upload)`,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/pdf',
        category: 'local_upload',
      };
      setSelectedAttachments((prev) => [...prev, newLocalAtt]);
      if (localFileInputRef.current) {
        localFileInputRef.current.value = '';
      }
    }
  }, []);

  const validateForm = useCallback((): boolean => {
    setFormError(null);
    if (!message.trim()) {
      setFormError(strings.validationMessageRequired);
      return false;
    }

    if ((channel === 'EMAIL' || channel === 'BOTH') && !recipientEmail.trim()) {
      setFormError(strings.validationEmailRequired);
      return false;
    }

    if ((channel === 'SMS' || channel === 'BOTH') && !recipientPhone.trim()) {
      setFormError(strings.validationPhoneRequired);
      return false;
    }

    if (scheduleFollowup && !followupDueDate.trim()) {
      setFormError(strings.validationFollowupDueDateRequired || 'A due date is required when scheduling a follow-up task.');
      return false;
    }

    return true;
  }, [channel, message, recipientEmail, recipientPhone, scheduleFollowup, followupDueDate, strings]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSending(true);
    setFormError(null);
    setFollowupErrorNotice(null);

    try {
      const result = await dispatchActionCenterCommunication({
        entityType,
        entityId,
        channel,
        recipientName: recipientName.trim(),
        recipientEmail: channel === 'SMS' ? '' : recipientEmail.trim(),
        recipientPhone: channel === 'EMAIL' ? '' : recipientPhone.trim(),
        subject: subject.trim(),
        message: message.trim(),
        scenarioId: selectedScenarioId || undefined,
        attachments: selectedAttachments.length > 0 ? selectedAttachments : undefined,
        scheduleFollowup: scheduleFollowup && followupDueDate
          ? {
              dueDate: followupDueDate,
              priority: followupPriority,
              assigneeId: followupAssigneeId,
              assigneeName: assignedMember?.name || 'Assignee',
              notes: followupNotes.trim() || undefined,
            }
          : undefined,
      });

      if (result.success) {
        setIsDispatched(true);
        if (result.followupError) {
          const warningText = formatString(result.queued ? strings.queuedFollowupSchedulingWarning : strings.followupSchedulingWarning, {
            error: result.followupError,
          });
          setFollowupErrorNotice(warningText);
          if (onSuccess) {
            onSuccess(result);
          }
          return;
        }

        const channelLabel =
          channel === 'BOTH'
            ? strings.channelBoth
            : channel === 'SMS'
            ? strings.channelSms
            : strings.channelEmail;

        const successText = formatString(result.queued ? strings.queuedToast : strings.successToast, { channel: channelLabel });
        setToastMessage(successText);
        if (onSuccess) {
          onSuccess(result);
        }
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        if (result.emailResult?.success || result.smsResult?.success) {
          const emailStatus = result.emailResult?.success ? 'Email: Sent' : `Email: Failed (${result.emailResult?.error || 'Unsent'})`;
          const smsStatus = result.smsResult?.success ? 'SMS: Sent' : `SMS: Failed (${result.smsResult?.error || 'Unsent'})`;
          setFormError(`Partial delivery: ${emailStatus} | ${smsStatus}`);
          if (result.emailResult?.success && !result.smsResult?.success) {
            setChannel('SMS');
          } else if (!result.emailResult?.success && result.smsResult?.success) {
            setChannel('EMAIL');
          }
          setScheduleFollowup(false);
        } else {
          const channelErrors = [result.emailResult?.error, result.smsResult?.error].filter(Boolean).join(' | ');
          setFormError(result.error || channelErrors || strings.errorToast);
        }
      }
    } catch {
      setFormError(strings.errorToast);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <MessageSquare size={18} />
            </div>
            <div>
              <h2 id="compose-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                {strings.modalTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {strings.modalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
            aria-label={strings.btnCancel}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSend} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Toast Notification */}
          {toastMessage && (
            <div
              role="status"
              className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 font-medium"
            >
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Form Error Banner */}
          {formError && (
            <div
              role="alert"
              className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2 font-medium"
            >
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* Follow-up Scheduling Warning Banner */}
          {followupErrorNotice && (
            <div
              role="alert"
              className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2 font-medium"
            >
              <AlertCircle size={16} className="shrink-0 text-amber-600" />
              <span>{followupErrorNotice}</span>
            </div>
          )}

          {/* Channel Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              {strings.channelLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setChannel('EMAIL')}
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                  channel === 'EMAIL'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-600 font-semibold shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Mail size={14} className={channel === 'EMAIL' ? 'text-indigo-600' : 'text-slate-400'} />
                <span>{strings.channelEmail}</span>
              </button>

              <button
                type="button"
                onClick={() => setChannel('SMS')}
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                  channel === 'SMS'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-600 font-semibold shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Smartphone size={14} className={channel === 'SMS' ? 'text-indigo-600' : 'text-slate-400'} />
                <span>{strings.channelSms}</span>
              </button>

              <button
                type="button"
                onClick={() => setChannel('BOTH')}
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                  channel === 'BOTH'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-600 font-semibold shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Send size={14} className={channel === 'BOTH' ? 'text-indigo-600' : 'text-slate-400'} />
                <span>{strings.channelBoth}</span>
              </button>
            </div>
          </div>

          {/* Customer Conversion Scenario Selector (When Email is active) */}
          {(channel === 'EMAIL' || channel === 'BOTH') && (
            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-lg">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="compose-scenario"
                  className="text-xs font-semibold text-indigo-950 dark:text-indigo-300 flex items-center gap-1.5"
                >
                  <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />
                  <span>Select Conversion Scenario</span>
                </label>
              </div>
              <select
                id="compose-scenario"
                value={selectedScenarioId}
                onChange={(e) => handleScenarioChange(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">-- Choose a sales / conversion scenario --</option>
                {scenarios.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Recipient Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="compose-recipient-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {strings.recipientNameLabel}
              </label>
              <input
                id="compose-recipient-name"
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Client / Decision Maker"
                className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {(channel === 'EMAIL' || channel === 'BOTH') && (
              <div>
                <label htmlFor="compose-recipient-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {strings.recipientEmailLabel} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="compose-recipient-email"
                  type="email"
                  required
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="decision.maker@company.com"
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {(channel === 'SMS' || channel === 'BOTH') && (
              <div>
                <label htmlFor="compose-recipient-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {strings.recipientPhoneLabel} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="compose-recipient-phone"
                  type="tel"
                  required
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="9876543210"
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>

          {/* Subject Line (Required for Email or Both) */}
          {(channel === 'EMAIL' || channel === 'BOTH') && (
            <div>
              <label htmlFor="compose-subject" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {strings.subjectLabel}
              </label>
              <input
                id="compose-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={strings.subjectPlaceholder}
                className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Document Vault + Local File Attachments (When Email is active) */}
          {(channel === 'EMAIL' || channel === 'BOTH') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paperclip size={13} className="text-slate-500" />
                  <span>Attachments (Vault or Local File)</span>
                </label>
                <span className="text-[11px] text-slate-400">
                  {formatString(strings.selectedAttachmentsCount, {
                    count: selectedAttachments.length,
                  })}
                </span>
              </div>

              {/* Action Buttons: Select from Vault OR Upload One-off Local File */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => setIsAttachmentDropdownOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <span className="truncate">
                      {selectedAttachments.length > 0
                        ? `${selectedAttachments.length} document(s) attached`
                        : 'Select from Document Vault...'}
                    </span>
                    <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
                  </button>

                  {isAttachmentDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-30 max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl p-1 space-y-1">
                      {availableDocuments.length === 0 ? (
                        <div className="p-3 text-center text-xs text-slate-400">
                          No active documents available in Document Vault.
                        </div>
                      ) : (
                        availableDocuments.map((doc) => {
                          const isSelected = selectedAttachments.some((a) => a.id === doc.id);
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => toggleAttachment(doc)}
                              className={`w-full flex items-center justify-between p-2 rounded-md text-xs text-left transition-colors cursor-pointer ${
                                isSelected
                                ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 pr-2">
                                <FileText size={14} className={isSelected ? 'text-indigo-600' : 'text-slate-400'} />
                                <div className="truncate">
                                  <div className="font-medium truncate">{doc.documentName}</div>
                                  <div className="text-[10px] text-slate-400 truncate">
                                    {doc.fileName} • {doc.category}
                                  </div>
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5">
                                {isSelected && <Check size={14} className="text-indigo-600 font-bold" />}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Local File Upload Button (Requirement 3) */}
                <div>
                  <input
                    type="file"
                    ref={localFileInputRef}
                    onChange={handleLocalFileSelect}
                    className="hidden"
                    id="local-file-attachment-input"
                  />
                  <label
                    htmlFor="local-file-attachment-input"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer shrink-0"
                  >
                    <Upload size={13} className="text-indigo-600" />
                    <span>Attach Local File</span>
                  </label>
                </div>
              </div>

              {/* Selected Attachment Chips with Remove Option */}
              {selectedAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedAttachments.map((att) => (
                    <span
                      key={att.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-md text-[11px] font-medium"
                    >
                      <Paperclip size={11} />
                      <span className="truncate max-w-[200px]">{att.documentName}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="p-0.5 hover:text-rose-600 transition-colors ml-0.5 cursor-pointer"
                        title={strings.removeAttachmentTooltip}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message Area */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="compose-message" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {strings.messageLabel} <span className="text-rose-500">*</span>
              </label>
              {(channel === 'SMS' || channel === 'BOTH') && (
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {formatString(
                    smsUnits > 1 ? strings.charCountLabelPlural : strings.charCountLabel,
                    { chars: smsChars, units: smsUnits }
                  )}
                </span>
              )}
            </div>
            <textarea
              id="compose-message"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={strings.messagePlaceholder}
              className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Follow-up Section Toggle */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleFollowup}
                onChange={(e) => setScheduleFollowup(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {strings.scheduleFollowupCheckbox}
              </span>
            </label>

            {scheduleFollowup && (
              <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-950/60 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="compose-followup-date" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {strings.followupDueDateLabel}
                    </label>
                    <input
                      id="compose-followup-date"
                      type="date"
                      required={scheduleFollowup}
                      value={followupDueDate}
                      onChange={(e) => setFollowupDueDate(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="compose-followup-priority" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {strings.followupPriorityLabel}
                    </label>
                    <select
                      id="compose-followup-priority"
                      value={followupPriority}
                      onChange={(e) => setFollowupPriority(e.target.value as 'Critical' | 'High' | 'Medium' | 'Low')}
                      className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="compose-followup-assignee" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {strings.followupAssigneeLabel}
                    </label>
                    <select
                      id="compose-followup-assignee"
                      value={followupAssigneeId}
                      onChange={(e) => setFollowupAssigneeId(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {DEFAULT_INTERNAL_MEMBERS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="compose-followup-notes" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {strings.followupNotesLabel}
                  </label>
                  <input
                    id="compose-followup-notes"
                    type="text"
                    value={followupNotes}
                    onChange={(e) => setFollowupNotes(e.target.value)}
                    placeholder={strings.followupNotesPlaceholder}
                    className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              {isDispatched ? 'Close' : strings.btnCancel}
            </button>
            {!isDispatched && (
              <button
                type="submit"
                disabled={isSending}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Clock size={13} className="animate-spin" />
                    <span>{strings.btnSending}</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>{strings.btnSend}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
