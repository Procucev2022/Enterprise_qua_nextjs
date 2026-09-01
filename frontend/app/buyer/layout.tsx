import React from 'react';
import WorkspaceShell from '@/app/components/WorkspaceShell';

export default function BuyerLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell role="buyer">{children}</WorkspaceShell>;
}
