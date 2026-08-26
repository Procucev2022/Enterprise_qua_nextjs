'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '@/lib/store';
import {
  MessageSquare,
  X,
  Send,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Phone,
  Bot,
  UserCheck,
  Headphones,
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      sender: 'ai',
      text: `Hello! 👋 Welcome to Procucev QUA AI Support. I can help you with sourcing modes, RFQ downloads, vendor subscription tiers, or technical questions. How can I help you today?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const [inputMsg, setInputMsg] = useState('');
  const [agentConnected, setAgentConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const quickQuestions = [
    { label: '📦 Vendor Subscriptions & Quotas', prompt: 'Explain vendor subscription plans and RFQ download quotas.' },
    { label: '⚡ Mode 1, 2, 3 Sourcing Engines', prompt: 'What is the difference between Mode 1, Mode 2, and Mode 3 sourcing?' },
    { label: '📄 RFQ Download & Quote Submission', prompt: 'How do vendors download RFQ specifications and submit quotes?' },
    { label: '🎧 Connect with Support Agent', prompt: 'I am not happy with the automated chat, I need further agent support.' },
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
    const userRoleStr = currentRole === 'buyer' ? 'Buyer' : currentRole === 'vendor' ? 'Vendor' : 'Category Manager';
    const transcript = currentMessages.map((m) => `[${m.timestamp}] ${m.sender.toUpperCase()}: ${m.text}`).join('\n');

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

    // Check if user is unhappy or asking for an agent
    const isUnhappy = dissatisfactionKeywords.some((kw) => prompt.toLowerCase().includes(kw));

    if (isUnhappy) {
      // Trigger silent background push to support@procucev.com
      silentPushToSupportEmail(prompt, updatedMessages);

      setTimeout(() => {
        const agentReply: ChatMessage = {
          id: `msg-${Date.now() + 1}`,
          sender: 'ai',
          text: `Our agent will connect with you shortly and provide further support to resolve your request. Thank you for your patience!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isEscalated: true,
        };
        setMessages((prev) => [...prev, agentReply]);
      }, 500);
      return;
    }

    // Standard AI reply logic
    setTimeout(() => {
      let aiText = '';
      const text = prompt.toLowerCase();

      if (text.includes('subscription') || text.includes('quota') || text.includes('connect') || text.includes('select')) {
        aiText = `Our Vendor Subscriptions feature 3 tiers:\n1. Premium Model (Free): Unlimited access to direct buyer RFQs.\n2. Connect Model ($149 / 3 mo): Up to 50 RFQ downloads in 3 months.\n3. Select Model ($349 / 3 mo): Item Catalogue (100 products) + 100 RFQ downloads in 3 months.`;
      } else if (text.includes('mode') || text.includes('engine') || text.includes('sourcing')) {
        aiText = `Procucev provides 3 Sourcing Modes:\n• Mode 1: Private Client Roster\n• Mode 2: Hybrid Base Network\n• Mode 3: 360° AI Evaluated Roster (open marketplace with OCR parsing and multi-tier capability scoring).`;
      } else if (text.includes('download') || text.includes('quote') || text.includes('boq')) {
        aiText = `Vendors can click "Download RFQ" on any open opportunity to receive the specifications directly via email. Quotations are submitted easily via email reply or 1-click submission.`;
      } else {
        aiText = `Thank you for reaching out! Procucev AI Sourcing streamlines multi-channel vendor chasing and automated quote evaluation. Let me know if you have specific questions or need support.`;
      }

      const aiMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'ai',
        text: aiText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    }, 600);
  };

  return (
    <>
      {/* Floating Trigger Button */}
      <div className="fixed bottom-5 right-5 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white p-3.5 sm:px-4 sm:py-3 rounded-full shadow-2xl flex items-center gap-2.5 transition-all duration-200 hover:scale-105 border-2 border-white/20 dark:border-indigo-400/30 group"
        >
          <div className="relative">
            <MessageSquare size={20} className="shrink-0" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse border border-white" />
          </div>
          <span className="hidden sm:inline font-black text-xs tracking-wide">
            Support / Need Help?
          </span>
        </button>
      </div>

      {/* Floating Chat Modal */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 sm:right-6 z-50 w-[92vw] sm:w-[380px] h-[500px] max-h-[85vh] bg-white dark:bg-gray-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white p-4 flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-indigo-200">
                {agentConnected ? <Headphones size={18} /> : <Bot size={18} />}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-black tracking-tight">
                    {agentConnected ? 'Procucev Support Desk' : 'QUA AI Support Assistant'}
                  </h3>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <p className="text-[10px] text-indigo-200 font-medium">
                  {agentConnected ? 'Agent Escalation Active' : `Active for ${currentRole.toUpperCase()} Desk`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-indigo-200 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/50 dark:bg-gray-950/50 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl space-y-1 ${
                    m.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none shadow-xs'
                      : m.isEscalated
                      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-bl-none shadow-xs'
                      : 'bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 border border-slate-200 dark:border-gray-800 rounded-bl-none shadow-xs'
                  }`}
                >
                  <p className="whitespace-pre-line leading-relaxed text-[11px] font-medium">{m.text}</p>
                  <span
                    className={`text-[9px] block text-right font-mono ${
                      m.sender === 'user'
                        ? 'text-indigo-200'
                        : m.isEscalated
                        ? 'text-amber-700 dark:text-amber-400 font-bold'
                        : 'text-slate-400 dark:text-gray-500'
                    }`}
                  >
                    {m.timestamp}
                  </span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Strip */}
          <div className="px-3 py-2 border-t border-slate-100 dark:border-gray-800/80 bg-white dark:bg-gray-900 overflow-x-auto flex items-center gap-1.5 shrink-0">
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(q.prompt)}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-700 dark:hover:text-indigo-300 border border-slate-200 dark:border-gray-700 shrink-0 transition-colors"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Standard Input Footer */}
          <div className="p-3 bg-white dark:bg-gray-900 border-t border-slate-100 dark:border-gray-800 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!inputMsg.trim()}
                className="p-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
