'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import SpendDashboard from '@/app/category-manager/spend-dashboard';

export default function CategoryManagerSpendPage() {
  const router = useRouter();
  return (
    <SpendDashboard
      onBackToKanban={() => router.push('/category-manager/kanban-board')}
      onNavigateToAllRfqs={() => router.push('/category-manager/all-rfqs')}
      onNavigateToVendorConsole={() => router.push('/category-manager/vendor-console')}
      onNavigateToKanban={() => router.push('/category-manager/kanban-board')}
    />
  );
}
