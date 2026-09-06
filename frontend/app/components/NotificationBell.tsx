'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  fetchNotifications,
  markNotificationRead as apiMarkRead,
  markAllNotificationsRead as apiMarkAllRead,
} from '@/lib/notificationClient';
import type { AppNotification } from '@/lib/types';
import { Bell, CheckCheck, FileText, Package, Sparkles } from 'lucide-react';

const N = UI_STRINGS.notifications;

/** How often the bell re-checks for new notifications while mounted. */
const POLL_MS = 45_000;

/** Roles that have a real per-recipient notification inbox. */
const INBOX_ROLES = new Set(['vendor', 'buyer']);

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * Header notification bell.
 *
 * For a vendor or buyer it shows their real, server-scoped notification inbox
 * (`GET /api/notifications`) with an unread badge. For a category manager or
 * admin — who have no inbox of their own — it falls back to the existing AI
 * chaser feed, unchanged.
 */
export default function NotificationBell() {
  const { currentRole, isLoggedIn, aiFeed } = useApp();
  const router = useRouter();

  const hasInbox = isLoggedIn && INBOX_ROLES.has(currentRole);

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const result = await fetchNotifications();
    if (result.success) {
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    }
  }, []);

  // Poll while a vendor/buyer session is active. The interval is cleared on
  // sign-out or unmount so a logged-out tab is not calling the API.
  useEffect(() => {
    if (!hasInbox) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasInbox, refresh]);

  // Close on an outside click, matching the other header dropdowns' behaviour.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && hasInbox) void refresh();
  };

  const handleMarkAll = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await apiMarkAllRead();
    void refresh();
  };

  const routeFor = (n: AppNotification): string | null => {
    if (n.kind === 'quote_received' && n.rfqNumber) {
      return `/buyer/rfq-details?rfq=${encodeURIComponent(n.rfqNumber)}`;
    }
    if (n.kind === 'rfq_category_match') {
      return '/vendor/opportunity-feed';
    }
    return null;
  };

  const handleOpenNotification = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      await apiMarkRead(n.id);
    }
    const dest = routeFor(n);
    if (dest) router.push(dest);
  };

  const iconFor = (kind: AppNotification['kind']) =>
    kind === 'quote_received' ? (
      <Package size={13} className="text-emerald-600 dark:text-emerald-400" />
    ) : (
      <FileText size={13} className="text-indigo-600 dark:text-indigo-400" />
    );

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        className="relative p-2 rounded-xl bg-slate-100 dark:bg-gray-800/70 border border-slate-300 dark:border-gray-700 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-300 transition-all shadow-sm"
        aria-label={
          hasInbox && unreadCount > 0
            ? formatString(N.bellAriaUnread, { count: unreadCount })
            : N.bellAria
        }
      >
        <Bell size={16} />
        {hasInbox ? (
          unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )
        ) : (
          <>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 w-80 sm:w-96 right-0 bg-white dark:bg-gray-900/95 border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl p-3 z-50 backdrop-blur-xl animate-fade-in max-h-96 overflow-y-auto">
          {hasInbox ? (
            <>
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <Bell size={13} className="text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-bold text-slate-800 dark:text-gray-200">{N.heading}</span>
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                      {formatString(N.unreadBadge, { count: unreadCount })}
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAll}
                    className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <CheckCheck size={12} /> {N.markAllRead}
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-gray-400 py-6 text-center">{N.empty}</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleOpenNotification(n)}
                      className={`w-full text-left p-2.5 rounded-xl border text-xs transition-colors ${
                        n.read
                          ? 'bg-slate-50 dark:bg-gray-800/40 border-slate-200 dark:border-gray-700/50'
                          : 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-slate-800 dark:text-gray-100 flex items-center gap-1.5">
                          {iconFor(n.kind)} {n.title}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{relativeTime(n.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">{n.message}</p>
                      {!n.read && (
                        <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-rose-500" aria-hidden />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <span className="live-dot" />
                  <span className="text-xs font-bold text-slate-800 dark:text-gray-200">{N.aiFeedHeading}</span>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-gray-400">
                  {formatString(N.aiFeedEventCount, { count: aiFeed.length })}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {aiFeed.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 text-xs"
                  >
                    <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-[10px] mb-1">
                      <span className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                        {item.type === 'call' || item.channel === 'call' ? (
                          <span className="text-purple-600 dark:text-purple-400 font-bold">📞 Call</span>
                        ) : item.type === 'whatsapp' || item.channel === 'whatsapp' ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">💬 WhatsApp</span>
                        ) : item.type === 'sms' || item.channel === 'sms' ? (
                          <span className="text-sky-600 dark:text-cyan-400 font-bold">📱 SMS</span>
                        ) : (
                          <Sparkles size={11} className="text-indigo-500" />
                        )}
                        <span className="text-slate-800 dark:text-gray-200">{item.title}</span>
                      </span>
                      <span className="mono">{item.timestamp}</span>
                    </div>
                    <p className="text-slate-700 dark:text-gray-300 text-[11px] leading-relaxed">{item.message}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
