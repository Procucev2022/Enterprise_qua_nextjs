import React from 'react';
import { render, screen } from '@testing-library/react';
import RootLayout, { metadata } from '@/app/layout';

describe('RootLayout Component', () => {
  test('renders metadata with correct title and description', () => {
    expect(metadata.title).toContain('PROCUCEV ENTERPRISE');
    expect(metadata.description).toContain('Enterprise Procurement Platform');
  });

  test('renders RootLayout with child elements and footer', () => {
    render(
      <RootLayout>
        <div data-testid="test-child-page">Child Page Content</div>
      </RootLayout>
    );

    expect(screen.getByTestId('test-child-page')).toBeInTheDocument();
    expect(screen.getByText(/PROCUCEV ENTERPRISE SOLUTIONS/i)).toBeInTheDocument();
    expect(screen.getByText(/Central India \(Primary\) \/ West US 2/i)).toBeInTheDocument();
  });
});
