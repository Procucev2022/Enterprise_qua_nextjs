import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VendorDirectoryLoginPage from '@/app/vendors/login/page';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/app/vendors/VendorDirectoryLoginGate', () => {
  return function MockGate({ onAuthenticated }: { onAuthenticated: () => void }) {
    return (
      <div data-testid="vendor-directory-login-gate">
        <button data-testid="gate-authenticate-btn" onClick={onAuthenticated}>
          Authenticate
        </button>
      </div>
    );
  };
});

jest.mock('@/lib/vendorAuthClient', () => ({
  isVendorDirectoryAuthenticated: jest.fn(),
  getVendorDirectoryAuthToken: jest.fn(() => null),
  getVendorDirectorySession: jest.fn(() => null),
  requestVendorDirectoryOtp: jest.fn(),
  verifyVendorDirectoryOtp: jest.fn(),
  logoutVendorDirectory: jest.fn(),
  touchVendorDirectoryActivity: jest.fn(),
}));

import * as vendorAuthClient from '@/lib/vendorAuthClient';

describe('VendorDirectoryLoginPage (/vendors/login)', () => {
  const mockReplace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      replace: mockReplace,
    });
  });

  test('redirects immediately to /vendors if already authenticated', () => {
    (vendorAuthClient.isVendorDirectoryAuthenticated as jest.Mock).mockReturnValue(true);

    render(<VendorDirectoryLoginPage />);

    expect(mockReplace).toHaveBeenCalledWith('/vendors');
  });

  test('renders login gate if not authenticated', () => {
    (vendorAuthClient.isVendorDirectoryAuthenticated as jest.Mock).mockReturnValue(false);

    render(<VendorDirectoryLoginPage />);

    expect(screen.getByTestId('vendor-directory-login-gate')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('navigates to /vendors after successful authentication via gate callback', () => {
    (vendorAuthClient.isVendorDirectoryAuthenticated as jest.Mock).mockReturnValue(false);

    render(<VendorDirectoryLoginPage />);

    fireEvent.click(screen.getByTestId('gate-authenticate-btn'));
    expect(mockReplace).toHaveBeenCalledWith('/vendors');
  });
});
