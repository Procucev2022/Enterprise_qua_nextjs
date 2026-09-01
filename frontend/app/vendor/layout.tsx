import React from 'react';
import WorkspaceShell from '@/app/components/WorkspaceShell';

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell role="vendor">{children}</WorkspaceShell>;
}
