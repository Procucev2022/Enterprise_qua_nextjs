import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/subscription-center.tsx', () => {
  const mockShowToast = jest.fn();
  const mockRefreshActiveBuyerAccount = jest.fn();
  const mockCreateBuyerPaymentLink = jest.fn();
  const mockCheckBuyerPaymentLinkStatus = jest.fn();
  const originalFetch = global.fetch;

  function mockStore(overrides: Record<string, unknown> = {}) {
    (useApp as jest.Mock).mockReturnValue({
      activeSubscription: 'free_trial',
      remainingFreeRFQs: 4,
      showToast: mockShowToast,
      activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 4 },
      refreshActiveBuyerAccount: mockRefreshActiveBuyerAccount,
      createBuyerPaymentLink: mockCreateBuyerPaymentLink,
      checkBuyerPaymentLinkStatus: mockCheckBuyerPaymentLinkStatus,
      ...overrides,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

  it('resets the trial account via a real PUT request and re-syncs from the backend', async () => {
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/buyer-accounts/buyer-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 }) })
    );
    expect(mockRefreshActiveBuyerAccount).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Free Account Restored', expect.any(String), 'info');
  });

  it('shows a warning and skips the request when there is no active buyer account', async () => {
    mockStore({ activeBuyerAccount: null });
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Reset Failed', expect.any(String), 'warning');
  });

  it('shows a warning when the reset request fails server-side', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Nope.' }) });
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Reset Failed', 'Nope.', 'warning');
    expect(mockRefreshActiveBuyerAccount).not.toHaveBeenCalled();
  });

  it('falls back to a default message when the failed reset response has no error text', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => null });
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Reset Failed', 'Could not reset your account. Please try again.', 'warning');
  });

  it('attaches the session token to the reset request when one is held', async () => {
    const originalGetToken = authClient.getToken;
    authClient.getToken = jest.fn().mockReturnValue('jwt-token');
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt-token' });
    authClient.getToken = originalGetToken;
  });

  it('falls back to a default message when the reset response body cannot be read', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error('not json'); } });
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Reset Failed', 'Could not reset your account. Please try again.', 'warning');
  });

  it('shows a warning when the reset request throws (network failure)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    render(<SubscriptionCenter />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Reset to Free Account/i));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Reset Failed', expect.any(String), 'warning');
  });

  it('clicking a paid plan opens the real Zoho checkout modal, not an instant local flip', async () => {
    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByText('Subscribe to Version 2'));
    expect(screen.getByText(/Secure Payment/i)).toBeInTheDocument();
    expect(screen.getByText('Version 2: Hybrid Sourcing Plan')).toBeInTheDocument();

    const payBtn = screen.getByRole('button', { name: /Pay ₹5/i });
    mockCreateBuyerPaymentLink.mockResolvedValue('https://payments.zoho.in/buyer-mock');
    await act(async () => {
      fireEvent.click(payBtn);
      await Promise.resolve();
    });
    expect(mockCreateBuyerPaymentLink).toHaveBeenCalledWith('version_2');
  });

  it('closes the checkout modal via Cancel without paying', () => {
    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByText('Subscribe to Version 3'));
    expect(screen.getByText(/Secure Payment/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText(/Secure Payment/i)).not.toBeInTheDocument();
    expect(mockCreateBuyerPaymentLink).not.toHaveBeenCalled();
  });

  it('renders the active-plan banner and disables the button for the currently active paid plan', () => {
    mockStore({ activeSubscription: 'version_1', remainingFreeRFQs: 0, activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'version_1', remainingFreeRFQs: 0 } });
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Active Premium Plan: Version 1/i)).toBeInTheDocument();
    expect(screen.getByText('Active Subscription')).toBeInTheDocument();
  });

  it('shows a toast and re-syncs when the real payment link status comes back PAID, then strips the query param', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('PAID');
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockCheckBuyerPaymentLinkStatus).toHaveBeenCalledWith('pl-1');
      expect(mockShowToast).toHaveBeenCalledWith('Payment Received', expect.any(String), 'success');
      expect(mockRefreshActiveBuyerAccount).toHaveBeenCalled();
      expect(window.location.search).toBe('');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('shows a cancelled toast when the real payment link status comes back CANCELED, preserving any other query params', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('CANCELED');
    window.history.pushState({}, '', '/buyer/subscription-center?ref=email&linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Payment Cancelled', expect.any(String), 'info');
      expect(mockRefreshActiveBuyerAccount).not.toHaveBeenCalled();
      expect(window.location.search).toBe('?ref=email');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('shows an expired toast when the real payment link status comes back EXPIRED', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('EXPIRED');
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Payment Link Expired', expect.any(String), 'warning');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('shows a processing toast when the status is still unresolved (CREATED, or the lookup failed)', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue(null);
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Payment Processing', expect.any(String), 'info');
      expect(mockRefreshActiveBuyerAccount).toHaveBeenCalled();
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('does nothing on mount when there is no linkId query param', async () => {
    render(<SubscriptionCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockRefreshActiveBuyerAccount).not.toHaveBeenCalled();
    expect(mockCheckBuyerPaymentLinkStatus).not.toHaveBeenCalled();
  });

  it('waits for activeBuyerAccount to load before resolving the payment link status', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('PAID');
    mockStore({ activeBuyerAccount: null });
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      const { rerender } = render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockCheckBuyerPaymentLinkStatus).not.toHaveBeenCalled();

      mockStore({ activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 4 } });
      rerender(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockCheckBuyerPaymentLinkStatus).toHaveBeenCalledWith('pl-1');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });
});
