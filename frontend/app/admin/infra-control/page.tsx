'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import InfraControl from '@/app/admin/infra-control';

export default function AdminInfraControlPage() {
  const router = useRouter();
  return <InfraControl onNavigateToAuditLog={() => router.push('/admin/audit-log')} />;
}
