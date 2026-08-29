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
  Minimize2,
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
      text: `Hello! 👋 How can I help you today with RFQs, sourcing modes, or subscriptions?`,
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
    const userRoleStr = currentRole === 'buyer' ? 'Buyer' : currentRole === 'vendor' ? 'Vendor' : 'Category Manager';

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
      silentPushToSupportEmail(prompt, updatedMessages);

      setTimeout(() => {
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
      let aiText = '';
      const text = prompt.toLowerCase();

      if (text.includes('subscription') || text.includes('quota') || text.includes('connect') || text.includes('select')) {
        aiText = `Vendor Subscriptions:\n1. Premium (Free): Direct buyer RFQs\n2. Connect ($149 / 3mo): 50 RFQ downloads ($0 self-eval)\n3. Select ($349 / 3mo): 100 SKUs catalogue + 100 RFQs ($0 self-eval).`;
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

  return (
    <>
      {/* Compact Floating Trigger Button */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-10 h-10 sm:w-11 sm:h-11 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 border border-white/20 relative group"
          title="Support / Need Help?"
          aria-label="Open support chat"
        >
          <MessageSquare size={17} className="shrink-0" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-400 rounded-full animate-pulse border border-white" />

          {/* Micro hover tooltip */}
          <span className="absolute right-full mr-2 px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-md">
            Need Help?
          </span>
        </button>
      </div>

      {/* Compact Floating Chat Modal */}
      {isOpen && (
        <div className="fixed bottom-16 right-4 z-50 w-[300px] sm:w-[330px] h-[380px] max-h-[70vh] bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-up">
          {/* Compact Header */}
          <div className="bg-gradient-to-r from-indigo-700 to-indigo-900 text-white px-3.5 py-2.5 flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-indigo-100 shrink-0">
                {agentConnected ? <Headphones size={13} /> : <Bot size={13} />}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-[11px] font-bold tracking-tight leading-none">
                    {agentConnected ? 'Support Desk' : 'QUA AI Support'}
                  </h3>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <p className="text-[9px] text-indigo-200/80 font-mono leading-tight mt-0.5">
                  {agentConnected ? 'Escalation Active' : `${currentRole.toUpperCase()} Assistant`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-indigo-200 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
              title="Close chat"
            >
              <X size={15} />
            </button>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 p-3 overflow-y-auto space-y-2.5 bg-slate-50/60 dark:bg-gray-950/60 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[88%] px-2.5 py-2 rounded-xl space-y-0.5 ${
                    m.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none shadow-xs'
                      : m.isEscalated
                      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-bl-none shadow-xs'
                      : 'bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 border border-slate-200 dark:border-gray-800 rounded-bl-none shadow-xs'
                  }`}
                >
                  <p className="whitespace-pre-line leading-relaxed text-[11px] font-medium">{m.text}</p>
                  <span
                    className={`text-[8px] block text-right font-mono ${
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

          {/* Compact Quick Prompts Strip */}
          <div className="px-2.5 py-1.5 border-t border-slate-100 dark:border-gray-800/80 bg-white dark:bg-gray-900 overflow-x-auto flex items-center gap-1 shrink-0">
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(q.prompt)}
                className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-700 dark:hover:text-indigo-300 border border-slate-200 dark:border-gray-700 shrink-0 transition-colors"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Compact Input Footer */}
          <div className="p-2 bg-white dark:bg-gray-900 border-t border-slate-100 dark:border-gray-800 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Ask a question..."
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-[11px] bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!inputMsg.trim()}
                className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
                title="Send"
              >
                <Send size={12} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
