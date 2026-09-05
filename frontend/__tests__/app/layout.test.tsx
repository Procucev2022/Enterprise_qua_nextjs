import React from 'react';
import { render, screen } from '@testing-library/react';
import RootLayout, { metadata } from '@/app/layout';

// The header inside the layout navigates on sign-out, so the app router has to
// be available for the tree to mount.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/',
}));

describe('RootLayout Component', () => {
  test('renders metadata with correct title and description', () => {
    expect(String(metadata.title)).toMatch(/procucev enterprise/i);
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

  test('does not advertise a hardcoded system identifier account in the footer', () => {
    render(
      <RootLayout>
        <div>child</div>
      </RootLayout>
    );

    // The footer used to print a fixed "client@procucev.com" identifier that had
    // nothing to do with the signed-in user.
    expect(screen.queryByText(/System Identifier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/client@procucev\.com/i)).not.toBeInTheDocument();
  });
});
