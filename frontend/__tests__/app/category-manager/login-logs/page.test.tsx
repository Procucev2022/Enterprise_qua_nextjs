import React from 'react';
import { render, screen } from '@testing-library/react';
import LoginLogsPage from '@/app/category-manager/login-logs/page';

jest.mock('@/app/category-manager/components/LoginLogsDashboard', () => {
  return function MockLoginLogsDashboard() {
    return <div data-testid="mock-login-logs-dashboard">Mock Login Logs Dashboard</div>;
  };
});

describe('LoginLogsPage', () => {
  it('renders LoginLogsDashboard inside page wrapper container', () => {
    render(<LoginLogsPage />);
    expect(screen.getByTestId('mock-login-logs-dashboard')).toBeInTheDocument();
  });
});
