'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';
import KanbanBoard from '@/app/category-manager/kanban-board';

export default function CategoryManagerKanbanPage() {
  const router = useRouter();
  const { setSelectedRFQForMatrix } = useApp();

  return (
    <KanbanBoard
      onNavigateToMatrix={(rfq?: RFQItem) => {
        if (rfq) setSelectedRFQForMatrix(rfq);
        router.push('/category-manager/quote-matrix');
      }}
      onNavigateToSpend={(rfq?: RFQItem) => {
        if (rfq) setSelectedRFQForMatrix(rfq);
        router.push('/category-manager/spend-dashboard');
      }}
    />
  );
}
