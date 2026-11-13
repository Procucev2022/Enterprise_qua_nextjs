'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import { SUPPORT_CHAT_COPY_CONFIRMATION_MS, SUPPORT_CHAT_ENDPOINT } from '@/lib/constants';
import type { SupportChatMessage, SupportChatResponse, UserRole } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  AlertCircle,
  Check,
  Copy,
  Headphones,
  Maximize2,
  Minimize2,
  MessageSquare,
  RotateCcw,
  Send,
  User,
  X,
} from 'lucide-react';

const WORKSPACE_LABEL: Record<UserRole, string> = {
  buyer: UI_STRINGS.supportChat.roleBuyer,
  vendor: UI_STRINGS.supportChat.roleVendor,
  category_manager: UI_STRINGS.supportChat.roleCategoryManager,
  admin: UI_STRINGS.supportChat.roleAdmin,
};

const QUICK_PROMPTS = [
  { label: UI_STRINGS.supportChat.quickSubscriptionsLabel, prompt: UI_STRINGS.supportChat.quickSubscriptionsPrompt },
  { label: UI_STRINGS.supportChat.quickSourcingModesLabel, prompt: UI_STRINGS.supportChat.quickSourcingModesPrompt },
  { label: UI_STRINGS.supportChat.quickRfqDownloadLabel, prompt: UI_STRINGS.supportChat.quickRfqDownloadPrompt },
  { label: UI_STRINGS.supportChat.quickAgentLabel, prompt: UI_STRINGS.supportChat.quickAgentPrompt },
];

function currentTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Chat with the support chat endpoint. The widget never writes a reply, a ticket
 * or an escalation itself: every answer shown is the server's `reply`, and every
 * refusal is the server's `error` (for example "not_configured").
 */
export default function SupportChatWidget() {
  const { currentRole } = useApp();
  const strings = UI_STRINGS.supportChat;

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [inputMsg, setInputMsg] = useState('');
  const [messages, setMessages] = useState<SupportChatMessage[]>(() => [
    { id: 'msg-intro', sender: 'notice', text: strings.intro, timestamp: currentTime() },
  ]);
  const messageCounter = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending, isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const createMessage = (sender: SupportChatMessage['sender'], text: string): SupportChatMessage => {
    messageCounter.current += 1;
    return { id: `msg-${messageCounter.current}`, sender, text, timestamp: currentTime() };
  };

  const appendMessage = (sender: SupportChatMessage['sender'], text: string) => {
    setMessages((prev) => [...prev, createMessage(sender, text)]);
  };

  const sendPrompt = async (prompt: string) => {
    appendMessage('user', prompt);
    setIsSending(true);
    try {
      const token = authClient.getToken();
      const res = await fetch(SUPPORT_CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, userRole: currentRole }),
      });
      const body = (await res.json().catch(() => null)) as SupportChatResponse | null;
      if (res.ok && body?.success === true && typeof body.reply === 'string') {
        appendMessage('support', body.reply);
        return;
      }
      // The service did not answer. Show its own explanation when it sent one.
      logger.log('WARN', 'Support chat did not answer the message', { status: res.status, supportStatus: body?.status }, 'SUPPORT_CHAT');
      appendMessage('notice', body?.error || strings.unexpectedResponse);
    } catch (err: unknown) {
      logger.log('ERROR', 'Support chat request failed', { error: err }, 'SUPPORT_CHAT');
      appendMessage('notice', strings.unreachable);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = inputMsg.trim();
    if (!prompt || isSending) return;
    setInputMsg('');
    void sendPrompt(prompt);
  };

  const handleQuickPrompt = (prompt: string) => {
    if (isSending) return;
    void sendPrompt(prompt);
  };

  const handleCopyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), SUPPORT_CHAT_COPY_CONFIRMATION_MS);
    } catch (error: unknown) {
      logger.log('WARN', 'Copying a support chat message failed', { error }, 'SUPPORT_CHAT');
    }
  };

  const handleResetChat = () => {
    setMessages([createMessage('notice', strings.intro)]);
  };

  return (
    <>
      {/* Floating Trigger Button with Hover Prompt */}
      <div className="fixed bottom-5 right-5 z-50 flex items-center group">
        {!isOpen && (
          <div
            onClick={() => setIsOpen(true)}
            className="mr-3 cursor-pointer opacity-0 pointer-events-none translate-x-3 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0 transition-all duration-300 ease-out flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/95 dark:bg-gray-900/95 border border-indigo-100 dark:border-indigo-900/50 text-slate-800 dark:text-gray-200 shadow-xl shadow-indigo-500/10 backdrop-blur-md whitespace-nowrap text-xs font-semibold select-none"
          >
            <span className="text-slate-800 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              {strings.hoverPrompt}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="relative w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-95 text-white shadow-xl shadow-indigo-500/25 flex items-center justify-center transition-all duration-200 border border-white/20 hover:scale-105"
          title={strings.triggerTitle}
          aria-label={strings.triggerLabel}
        >
          {isOpen ? (
            <X size={20} className="transition-transform duration-200 hover:rotate-90" />
          ) : (
            <MessageSquare size={20} className="shrink-0 group-hover:scale-110 transition-transform duration-200" />
          )}
        </button>
      </div>

      {/* Floating Chat Modal */}
      {isOpen && (
        <div
          className={`fixed bottom-20 right-4 sm:right-6 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-slate-200/80 dark:border-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-out animate-in fade-in zoom-in-95 ${
            isExpanded
              ? 'w-[calc(100vw-2rem)] sm:w-[460px] md:w-[500px] h-[580px] max-h-[85vh]'
              : 'w-[calc(100vw-2rem)] sm:w-[360px] md:w-[380px] h-[460px] max-h-[75vh]'
          }`}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 py-3 flex items-center justify-between border-b border-indigo-500/20 shadow-sm shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-0.5 shadow-md shrink-0 flex items-center justify-center">
                <div className="w-full h-full bg-slate-950/40 rounded-[10px] flex items-center justify-center text-white">
                  <Headphones size={15} />
                </div>
              </div>

              <div className="min-w-0">
                <h3 className="text-xs font-bold tracking-tight text-slate-100 truncate">{strings.headerTitle}</h3>
                <p className="text-[10px] text-slate-400 truncate font-mono">{WORKSPACE_LABEL[currentRole]}</p>
              </div>
            </div>

            {/* Header Action Icons */}
            <div className="flex items-center gap-0.5 shrink-0 text-slate-300">
              <button
                type="button"
                onClick={handleResetChat}
                className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title={strings.restartTitle}
              >
                <RotateCcw size={14} />
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors hidden sm:block"
                title={isExpanded ? strings.restoreTitle : strings.maximizeTitle}
              >
                {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-1"
                title={strings.closeTitle}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-slate-50/70 dark:bg-gray-950/70 text-xs">
            {messages.map((m) => {
              const isUser = m.sender === 'user';
              const isNotice = m.sender === 'notice';
              return (
                <div
                  key={m.id}
                  className={`flex gap-2 items-end group ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* Sender Avatar */}
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 shadow-xs text-[10px] ${
                      isUser
                        ? 'bg-gradient-to-tr from-indigo-600 to-violet-600 text-white'
                        : isNotice
                          ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                          : 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                    }`}
                  >
                    {isUser ? <User size={12} /> : isNotice ? <AlertCircle size={12} /> : <Headphones size={12} />}
                  </div>

                  {/* Message Content Bubble */}
                  <div
                    className={`relative max-w-[82%] px-3.5 py-2.5 rounded-2xl space-y-1 shadow-sm transition-all ${
                      isUser
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-br-xs'
                        : isNotice
                          ? 'bg-amber-50/90 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 border border-amber-200/80 dark:border-amber-800/80 rounded-bl-xs'
                          : 'bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-100 border border-slate-200/80 dark:border-gray-800 rounded-bl-xs'
                    }`}
                  >
                    <p className="whitespace-pre-line leading-relaxed text-[11.5px] tracking-tight">
                      {m.text}
                    </p>

                    <div className="flex items-center justify-between gap-3 pt-0.5">
                      <span
                        className={`text-[9px] font-mono ${
                          isUser
                            ? 'text-indigo-200'
                            : isNotice
                              ? 'text-amber-700 dark:text-amber-400 font-semibold'
                              : 'text-slate-400 dark:text-gray-500'
                        }`}
                      >
                        {m.timestamp}
                      </span>

                      {!isUser && !isNotice && (
                        <button
                          type="button"
                          onClick={() => void handleCopyText(m.id, m.text)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-opacity p-0.5 rounded"
                          title={strings.copyTitle}
                          aria-label={strings.copyTitle}
                        >
                          {copiedMsgId === m.id ? (
                            <Check size={11} className="text-emerald-500" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Waiting for the support service to answer */}
            {isSending && (
              <div className="flex gap-2 items-end" role="status" aria-label={strings.waitingForReply}>
                <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0">
                  <Headphones size={12} />
                </div>
                <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 px-3.5 py-2.5 rounded-2xl rounded-bl-xs shadow-xs flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-bounce" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Strip */}
          <div className="px-3 py-2 border-t border-slate-100 dark:border-gray-800/80 bg-slate-50/80 dark:bg-gray-900/80 backdrop-blur-xs overflow-x-auto flex items-center gap-1.5 shrink-0 scrollbar-none">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => handleQuickPrompt(q.prompt)}
                disabled={isSending}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/80 hover:text-indigo-600 dark:hover:text-indigo-300 border border-slate-200/90 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 shrink-0 transition-all duration-150 shadow-xs disabled:opacity-40"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Input Footer */}
          <div className="p-2.5 bg-white dark:bg-gray-900 border-t border-slate-200/80 dark:border-gray-800 shrink-0">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  placeholder={strings.inputPlaceholder}
                  className="w-full pl-3 pr-8 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
                {inputMsg && (
                  <button
                    type="button"
                    onClick={() => setInputMsg('')}
                    aria-label={strings.clearInputLabel}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!inputMsg.trim() || isSending}
                className="p-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-95 text-white shadow-sm shadow-indigo-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all duration-150 shrink-0 flex items-center justify-center"
                title={strings.sendTitle}
              >
                <Send size={14} />
              </button>
            </form>
            <div className="flex items-center justify-end text-[9px] text-slate-400 dark:text-gray-500 px-1 pt-1">
              <span>{strings.footerHint}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
