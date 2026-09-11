'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '@/lib/store';
import {
  MessageSquare,
  X,
  Send,
  Sparkles,
  Bot,
  Headphones,
  Maximize2,
  Minimize2,
  RotateCcw,
  Copy,
  Check,
  Zap,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
  CheckCheck,
  User,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user' | 'system';
  text: string;
  timestamp: string;
  isEscalated?: boolean;
}

export default function SupportChatWidget() {
  const { currentRole, addAuditLog } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const initialGreeting: ChatMessage = {
    id: 'msg-1',
    sender: 'ai',
    text: `Hello! 👋 I'm your QUA AI Sourcing Assistant.\nHow can I help you today with RFQs, sourcing modes, or subscriptions?`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  const [messages, setMessages] = useState<ChatMessage[]>([initialGreeting]);
  const [inputMsg, setInputMsg] = useState('');
  const [agentConnected, setAgentConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const quickQuestions = [
    { label: '📦 Subscriptions', prompt: 'Explain vendor subscription plans and RFQ quotas.' },
    { label: '⚡ Sourcing Modes', prompt: 'What is the difference between Mode 1, 2, and 3?' },
    { label: '📄 RFQ Download', prompt: 'How do vendors download RFQs and submit quotes?' },
    { label: '🎧 Agent Support', prompt: 'Connect me with a support agent.' },
  ];

  const dissatisfactionKeywords = [
    'not happy',
    'not satisfied',
    'not helpful',
    'bad',
    'human',
    'agent',
    'connect with agent',
    'support agent',
    'further support',
    'speak to person',
    'transfer',
    'unsatisfied',
    'disappointed',
    'no help',
  ];

  const silentPushToSupportEmail = (prompt: string, currentMessages: ChatMessage[]) => {
    const ticketId = `TK-${Math.floor(100000 + Math.random() * 900000)}`;
    const userRoleStr =
      currentRole === 'buyer'
        ? 'Buyer'
        : currentRole === 'vendor'
        ? 'Vendor'
        : 'Category Manager';

    // Silent background dispatch to support@procucev.com
    addAuditLog(
      `Support Chat Escalation (#${ticketId}) pushed to support@procucev.com for ${userRoleStr}. Prompt: "${prompt}". Full chat transcript attached.`,
      undefined,
      'system'
    );

    setAgentConnected(true);
  };

  const handleSendMessage = (textToSend?: string) => {
    const prompt = (textToSend || inputMsg).trim();
    if (!prompt) return;

    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: prompt,
      timestamp: timeNow,
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    if (!textToSend) setInputMsg('');
    setIsTyping(true);

    // Check if user is unhappy or asking for an agent
    const isUnhappy = dissatisfactionKeywords.some((kw) => prompt.toLowerCase().includes(kw));

    if (isUnhappy) {
      silentPushToSupportEmail(prompt, updatedMessages);

      setTimeout(() => {
        setIsTyping(false);
        const agentReply: ChatMessage = {
          id: `msg-${Date.now() + 1}`,
          sender: 'ai',
          text: `Our support agent will connect with you shortly to assist you. Thank you for your patience!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isEscalated: true,
        };
        setMessages((prev) => [...prev, agentReply]);
      }, 400);
      return;
    }

    // Standard AI reply logic
    setTimeout(() => {
      setIsTyping(false);
      let aiText = '';
      const text = prompt.toLowerCase();

      if (
        text.includes('subscription') ||
        text.includes('quota') ||
        text.includes('connect') ||
        text.includes('select')
      ) {
        aiText = `Vendor Subscriptions:\n1. Premium (Free): Direct buyer RFQs\n2. Connect (₹2 / 3mo): 50 RFQ downloads ($0 self-eval)\n3. Select (₹5 / 3mo): 100 SKUs catalogue + 100 RFQs ($0 self-eval).`;
      } else if (text.includes('mode') || text.includes('engine') || text.includes('sourcing')) {
        aiText = `3 Sourcing Modes:\n• Mode 1: Private Client Roster\n• Mode 2: Hybrid Base Network\n• Mode 3: 360° AI Evaluated Roster.`;
      } else if (text.includes('download') || text.includes('quote') || text.includes('boq')) {
        aiText = `Click "Download RFQ" on any open opportunity to receive technical specs via email. Quotes are submitted via email reply or 1-click portal.`;
      } else {
        aiText = `Procucev QUA AI streamlines multi-channel vendor chasing and automated quote evaluation. Let me know if you need more details!`;
      }

      const aiMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'ai',
        text: aiText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    }, 500);
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const handleResetChat = () => {
    setMessages([
      {
        ...initialGreeting,
        id: `msg-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setAgentConnected(false);
  };

  const roleLabel =
    currentRole === 'buyer'
      ? 'Buyer Workspace'
      : currentRole === 'vendor'
      ? 'Vendor Portal'
      : 'Category Manager';

  return (
    <>
      {/* Floating Trigger Button with Hover Badge */}
      <div className="fixed bottom-5 right-5 z-50 flex items-center group">
        {!isOpen && (
          <div
            onClick={() => setIsOpen(true)}
            className="mr-3 cursor-pointer opacity-0 pointer-events-none translate-x-3 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0 transition-all duration-300 ease-out flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/95 dark:bg-gray-900/95 border border-indigo-100 dark:border-indigo-900/50 text-slate-800 dark:text-gray-200 shadow-xl shadow-indigo-500/10 backdrop-blur-md whitespace-nowrap text-xs font-semibold select-none"
          >
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-slate-800 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              Need Help? Ask QUA AI
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="relative w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-95 text-white shadow-xl shadow-indigo-500/25 flex items-center justify-center transition-all duration-200 border border-white/20 hover:scale-105"
          title="Support / Need Help?"
          aria-label="Open support chat"
        >
          {isOpen ? (
            <X size={20} className="transition-transform duration-200 hover:rotate-90" />
          ) : (
            <>
              <MessageSquare size={20} className="shrink-0 group-hover:scale-110 transition-transform duration-200" />
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-gray-900" />
              </span>
            </>
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
          {/* Enhanced Header */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 py-3 flex items-center justify-between border-b border-indigo-500/20 shadow-sm shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-0.5 shadow-md shrink-0 flex items-center justify-center">
                <div className="w-full h-full bg-slate-950/40 rounded-[10px] flex items-center justify-center text-white">
                  {agentConnected ? <Headphones size={15} /> : <Bot size={15} />}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold tracking-tight text-slate-100 truncate">
                    {agentConnected ? 'Support Desk' : 'QUA AI Support'}
                  </h3>
                  <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 rounded">
                    {agentConnected ? 'Escalated' : 'AI 2.0'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 truncate flex items-center gap-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                  {agentConnected ? 'Ticket Dispatched • SLA < 15m' : `${roleLabel} • Online`}
                </p>
              </div>
            </div>

            {/* Header Action Icons */}
            <div className="flex items-center gap-0.5 shrink-0 text-slate-300">
              <button
                type="button"
                onClick={handleResetChat}
                className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Restart conversation"
              >
                <RotateCcw size={14} />
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors hidden sm:block"
                title={isExpanded ? 'Restore compact view' : 'Maximize view'}
              >
                {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-1"
                title="Close chat"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Escalation Notification Banner */}
          {agentConnected && (
            <div className="bg-amber-500/10 dark:bg-amber-950/40 border-b border-amber-500/20 px-3.5 py-2 flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-300 shrink-0">
              <div className="flex items-center gap-1.5 font-medium">
                <ShieldCheck size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Escalation ticket dispatched to support@procucev.com</span>
              </div>
            </div>
          )}

          {/* Messages Body */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-slate-50/70 dark:bg-gray-950/70 text-xs">
            {messages.map((m) => {
              const isUser = m.sender === 'user';
              return (
                <div
                  key={m.id}
                  className={`flex gap-2 items-end group ${
                    isUser ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {/* Sender Avatar */}
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 shadow-xs text-[10px] ${
                      isUser
                        ? 'bg-gradient-to-tr from-indigo-600 to-violet-600 text-white'
                        : m.isEscalated
                        ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                        : 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                    }`}
                  >
                    {isUser ? <User size={12} /> : m.isEscalated ? <Headphones size={12} /> : <Bot size={12} />}
                  </div>

                  {/* Message Content Bubble */}
                  <div
                    className={`relative max-w-[82%] px-3.5 py-2.5 rounded-2xl space-y-1 shadow-sm transition-all ${
                      isUser
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-br-xs'
                        : m.isEscalated
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
                            : m.isEscalated
                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                            : 'text-slate-400 dark:text-gray-500'
                        }`}
                      >
                        {m.timestamp}
                      </span>

                      {isUser ? (
                        <CheckCheck size={11} className="text-indigo-200" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCopyText(m.id, m.text)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-opacity p-0.5 rounded"
                          title="Copy response"
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

            {/* Realistic Animated Typing Indicator */}
            {isTyping && (
              <div className="flex gap-2 items-end">
                <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0">
                  <Sparkles size={12} className="animate-spin text-indigo-600 dark:text-indigo-400" />
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

          {/* Quick Actions Suggestions Strip */}
          <div className="px-3 py-2 border-t border-slate-100 dark:border-gray-800/80 bg-slate-50/80 dark:bg-gray-900/80 backdrop-blur-xs overflow-x-auto flex items-center gap-1.5 shrink-0 scrollbar-none">
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(q.prompt)}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/80 hover:text-indigo-600 dark:hover:text-indigo-300 border border-slate-200/90 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 shrink-0 transition-all duration-150 shadow-xs"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Input Footer */}
          <div className="p-2.5 bg-white dark:bg-gray-900 border-t border-slate-200/80 dark:border-gray-800 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  placeholder="Ask a question..."
                  className="w-full pl-3 pr-8 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
                {inputMsg && (
                  <button
                    type="button"
                    onClick={() => setInputMsg('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!inputMsg.trim() || isTyping}
                className="p-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-95 text-white shadow-sm shadow-indigo-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all duration-150 shrink-0 flex items-center justify-center"
                title="Send"
              >
                <Send size={14} />
              </button>
            </form>
            <div className="flex items-center justify-between text-[9px] text-slate-400 dark:text-gray-500 px-1 pt-1">
              <span>QUA Neural Assist</span>
              <span>Press Enter ↵ to send</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
