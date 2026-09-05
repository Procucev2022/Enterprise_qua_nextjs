import React from 'react';
import WorkspaceShell from '@/app/components/WorkspaceShell';

export default function CategoryManagerLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell role="category_manager">{children}</WorkspaceShell>;
}
