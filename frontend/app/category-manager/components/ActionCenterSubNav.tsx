'use client';

import React from 'react';
import {
  type LucideIcon,
  CheckSquare,
  Ticket,
  FileCheck,
  Award,
  Building2,
  Truck,
  Users,
  TrendingUp,
} from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { ActionCenterTabKey } from '@/lib/types';

export type { ActionCenterTabKey };

interface ActionCenterSubNavProps {
  activeTab: ActionCenterTabKey;
  onSelectTab: (tab: ActionCenterTabKey) => void;
  tasksCount?: number;
  ticketsCount?: number;
  approvalsCount?: number;
}

export default function ActionCenterSubNav({
  activeTab,
  onSelectTab,
  tasksCount = 0,
  ticketsCount = 0,
  approvalsCount = 0,
}: ActionCenterSubNavProps) {
  const tabs = UI_STRINGS.actionCenter.tabs;

  const navItems: Array<{
    id: ActionCenterTabKey;
    label: string;
    icon: LucideIcon;
    badge?: number | string;
    badgeColor?: string;
  }> = [
    {
      id: 'tasks',
      label: tabs.internalTasks,
      icon: CheckSquare,
      badge: tasksCount > 0 ? tasksCount : undefined,
      badgeColor: 'bg-amber-500 text-white',
    },
    {
      id: 'tickets',
      label: tabs.tickets,
      icon: Ticket,
      badge: ticketsCount > 0 ? ticketsCount : undefined,
      badgeColor: 'bg-rose-500 text-white',
    },
    {
      id: 'approvals',
      label: tabs.approvals,
      icon: FileCheck,
      badge: approvalsCount > 0 ? approvalsCount : undefined,
      badgeColor: 'bg-sky-500 text-white',
    },
    {
      id: 'scorecard',
      label: tabs.scorecard,
      icon: Award,
    },
    {
      id: 'buyers',
      label: tabs.buyersDirectory,
      icon: Building2,
    },
    {
      id: 'sellers',
      label: tabs.sellersDirectory,
      icon: Truck,
    },
    {
      id: 'registrations',
      label: tabs.registrations,
      icon: Users,
    },
    {
      id: 'payment_dues',
      label: tabs.paymentDues,
      icon: TrendingUp,
      badge: '99+',
      badgeColor: 'bg-amber-600 text-white',
    },
  ];

  return (
    <div className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 sticky top-0 z-30 mb-4 -mx-2 sm:-mx-3 px-2 sm:px-3">
      <div role="tablist" aria-label="Action Center Navigation" className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap rounded-lg border-b-2 transition-all cursor-pointer ${
                isActive
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <Icon size={14} className={isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`ml-0.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full ${
                    item.badgeColor || 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
