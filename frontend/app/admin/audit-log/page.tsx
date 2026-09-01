'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import AuditLog from '@/app/admin/audit-log';

export default function AdminAuditLogPage() {
  const router = useRouter();
  return <AuditLog onBackToInfra={() => router.push('/admin/infra-control')} />;
}
