import React from 'react';
import { render, screen } from '@testing-library/react';
import BuyerLayout from '@/app/buyer/layout';
import CategoryManagerLayout from '@/app/category-manager/layout';
import VendorLayout from '@/app/vendor/layout';
import AdminLayout from '@/app/admin/layout';
import type { UserRole } from '@/lib/types';

// The shell itself is covered by its own suite; here we only assert that each
// role's route segment is wrapped with the correct role scope.
const shellCalls: { role: UserRole }[] = [];
jest.mock('@/app/components/WorkspaceShell', () => ({
  __esModule: true,
  default: ({ role, children }: { role: UserRole; children: React.ReactNode }) => {
    shellCalls.push({ role });
    return (
      <div data-testid="workspace-shell" data-role={role}>
        {children}
      </div>
    );
  },
}));

describe('Role route layouts', () => {
  beforeEach(() => {
    shellCalls.length = 0;
  });

  it.each<[string, React.ComponentType<{ children: React.ReactNode }>, UserRole]>([
    ['buyer', BuyerLayout, 'buyer'],
    ['category manager', CategoryManagerLayout, 'category_manager'],
    ['vendor', VendorLayout, 'vendor'],
    ['admin', AdminLayout, 'admin'],
  ])('the %s layout scopes the workspace shell to its own role', (_label, Layout, expectedRole) => {
    render(
      <Layout>
        <p>segment content</p>
      </Layout>
    );

    expect(screen.getByTestId('workspace-shell')).toHaveAttribute('data-role', expectedRole);
    expect(screen.getByText('segment content')).toBeInTheDocument();
    expect(shellCalls).toEqual([{ role: expectedRole }]);
  });
});
