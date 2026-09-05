'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import SpendDashboard from '@/app/category-manager/spend-dashboard';

export default function CategoryManagerSpendPage() {
  const router = useRouter();
  return <SpendDashboard onBackToKanban={() => router.push('/category-manager/kanban-board')} />;
}
