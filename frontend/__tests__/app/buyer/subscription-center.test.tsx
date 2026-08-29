import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/subscription-center.tsx', () => {
  const mockSetActiveSubscription = jest.fn();
  const mockSetRemainingFreeRFQs = jest.fn();
  const mockShowToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      activeSubscription: 'free_trial',
      setActiveSubscription: mockSetActiveSubscription,
      remainingFreeRFQs: 4,
      setRemainingFreeRFQs: mockSetRemainingFreeRFQs,
      showToast: mockShowToast,
    });
  });

  it('renders free trial header, quota progress bar, and all 3 subscription plans', () => {
    render(<SubscriptionCenter />);

    expect(screen.getByText('Procurement Sourcing Mode Subscriptions')).toBeInTheDocument();
    expect(screen.getByText(/Free Starter Account Active — 5 Free RFQs Included/i)).toBeInTheDocument();
    expect(screen.getByText(/4 of 5 Free RFQs Left/i)).toBeInTheDocument();
    expect(screen.getByText('Version 1 Plan')).toBeInTheDocument();
    expect(screen.getByText('Version 2 Plan')).toBeInTheDocument();
    expect(screen.getByText('Version 3 Plan')).toBeInTheDocument();
  });

  it('handles resetting trial account to default 5 free RFQs', () => {
    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByText(/Reset to Free Account/i));
    expect(mockSetActiveSubscription).toHaveBeenCalledWith('free_trial');
    expect(mockSetRemainingFreeRFQs).toHaveBeenCalledWith(5);
    expect(mockShowToast).toHaveBeenCalledWith('Free Account Restored', expect.any(String), 'info');
  });

  it('subscribes to Version 1, Version 2, and Version 3 plans', () => {
    const { rerender } = render(<SubscriptionCenter />);

    // Subscribe to Version 2
    fireEvent.click(screen.getByText('Subscribe to Version 2'));
    expect(mockSetActiveSubscription).toHaveBeenCalledWith('version_2');
    expect(mockShowToast).toHaveBeenCalledWith('Subscription Activated!', expect.stringContaining('Version 2: Hybrid Sourcing Plan'), 'success');

    // Subscribe to Version 3
    fireEvent.click(screen.getByText('Subscribe to Version 3'));
    expect(mockSetActiveSubscription).toHaveBeenCalledWith('version_3');
    expect(mockShowToast).toHaveBeenCalledWith('Subscription Activated!', expect.stringContaining('Version 3: Autonomous AI Sourcing Plan'), 'success');

    // When activeSubscription is not free_trial, render premium banner for version_1, version_2, version_3
    (useApp as jest.Mock).mockReturnValue({
      activeSubscription: 'version_1',
      setActiveSubscription: mockSetActiveSubscription,
      remainingFreeRFQs: 0,
      setRemainingFreeRFQs: mockSetRemainingFreeRFQs,
      showToast: mockShowToast,
    });

    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Version 1/i)).toBeInTheDocument();

    // Now test version_1 subscription trigger
    fireEvent.click(screen.getByText('Subscribe to Version 2')); // Subscribe to V2 when V1 is active
    expect(mockSetActiveSubscription).toHaveBeenCalledWith('version_2');

    // Test version_2 active banner
    (useApp as jest.Mock).mockReturnValue({
      activeSubscription: 'version_2',
      setActiveSubscription: mockSetActiveSubscription,
      remainingFreeRFQs: 0,
      setRemainingFreeRFQs: mockSetRemainingFreeRFQs,
      showToast: mockShowToast,
    });
    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Version 2/i)).toBeInTheDocument();

    // Test version_3 active banner
    (useApp as jest.Mock).mockReturnValue({
      activeSubscription: 'version_3',
      setActiveSubscription: mockSetActiveSubscription,
      remainingFreeRFQs: 0,
      setRemainingFreeRFQs: mockSetRemainingFreeRFQs,
      showToast: mockShowToast,
    });
    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Version 3/i)).toBeInTheDocument();

    // Test version_1 handleSubscribe toast
    fireEvent.click(screen.getByText('Subscribe to Version 1'));
    expect(mockSetActiveSubscription).toHaveBeenCalledWith('version_1');
    expect(mockShowToast).toHaveBeenCalledWith('Subscription Activated!', expect.stringContaining('Version 1: Client Roster Plan'), 'success');
  });
});
