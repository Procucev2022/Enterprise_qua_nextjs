import React from 'react';
import WorkspaceShell from '@/app/components/WorkspaceShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell role="admin">{children}</WorkspaceShell>;
}
