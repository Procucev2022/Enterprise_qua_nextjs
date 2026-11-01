'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { DEFAULT_INTERNAL_MEMBERS, ACTION_CENTER_SMS_MAX_CHARS } from '@/lib/constants';
import { dispatchActionCenterCommunication } from '@/lib/actionCenterCommClient';
import type {
  ActionCenterCommChannel,
  ActionCenterEntityType,
  ActionCenterCommunicationResult,
} from '@/lib/types';

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
  onSuccess,
}: ActionCenterComposeModalProps) {
  const strings = UI_STRINGS.actionCenter.communicationModal;

  const [channel, setChannel] = useState<ActionCenterCommChannel>(defaultChannel);
  const [recipientName, setRecipientName] = useState(defaultRecipientName);
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail);
  const [recipientPhone, setRecipientPhone] = useState(defaultRecipientPhone);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);

  const [scheduleFollowup, setScheduleFollowup] = useState(false);
  const [followupDueDate, setFollowupDueDate] = useState('');
  const [followupPriority, setFollowupPriority] = useState<'Critical' | 'High' | 'Medium' | 'Low'>('Medium');
  const [followupAssigneeId, setFollowupAssigneeId] = useState(DEFAULT_INTERNAL_MEMBERS[0]?.id || '');
  const [followupNotes, setFollowupNotes] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync default props when modal opens
  useEffect(() => {
    if (isOpen) {
      setChannel(defaultChannel);
      setRecipientName(defaultRecipientName);
      setRecipientEmail(defaultRecipientEmail);
      setRecipientPhone(defaultRecipientPhone);
      setSubject(defaultSubject);
      setMessage(defaultMessage);
      setFormError(null);
      setToastMessage(null);
      setScheduleFollowup(false);
      setFollowupDueDate('');
      setFollowupNotes('');
    }
  }, [
    isOpen,
    defaultChannel,
    defaultRecipientName,
    defaultRecipientEmail,
    defaultRecipientPhone,
    defaultSubject,
    defaultMessage,
  ]);

  const smsChars = message.length;
  const smsUnits = useMemo(() => {
    return Math.max(1, Math.ceil(smsChars / ACTION_CENTER_SMS_MAX_CHARS));
  }, [smsChars]);

  const assignedMember = useMemo(() => {
    return DEFAULT_INTERNAL_MEMBERS.find((m) => m.id === followupAssigneeId);
  }, [followupAssigneeId]);

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

    return true;
  }, [channel, message, recipientEmail, recipientPhone, strings]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSending(true);
    setFormError(null);

    try {
      const result = await dispatchActionCenterCommunication({
        entityType,
        entityId,
        channel,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        recipientPhone: recipientPhone.trim(),
        subject: subject.trim(),
        message: message.trim(),
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
        const channelLabel =
          channel === 'BOTH'
            ? strings.channelBoth
            : channel === 'SMS'
            ? strings.channelSms
            : strings.channelEmail;

        const successText = formatString(strings.successToast, { channel: channelLabel });
        setToastMessage(successText);
        if (onSuccess) {
          onSuccess(result);
        }
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setFormError(result.error || strings.errorToast);
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
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
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

          {/* Channel Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              {strings.channelLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setChannel('EMAIL')}
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
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
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
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
                className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
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
                placeholder="Partner / Team Member"
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
                  placeholder="partner@company.com"
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
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              {strings.btnCancel}
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
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
          </div>
        </form>
      </div>
    </div>
  );
}

