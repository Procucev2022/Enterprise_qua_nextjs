import React from 'react';
import { render, screen } from '@testing-library/react';
import DocumentVaultPage from '@/app/category-manager/document-vault/page';

jest.mock('@/app/category-manager/components/DocumentVaultDashboard', () => {
  return function MockDashboard() {
    return <div data-testid="mock-document-vault-dashboard">Document Vault Dashboard</div>;
  };
});

describe('DocumentVaultPage', () => {
  test('renders DocumentVaultDashboard inside container', () => {
    render(<DocumentVaultPage />);
    expect(screen.getByTestId('mock-document-vault-dashboard')).toBeInTheDocument();
  });
});

