import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import { AppProvider } from '@/lib/store';
import { authClient } from '@/lib/authClient';

/**
 * Integration-style coverage for store.tsx's createBuyerPaymentLink and the
 * real GET /api/buyer-accounts/active sync — the mocked-useApp suite
 * (subscription-center.test.tsx) can't reach these since it never renders a
 * real AppProvider. Mirrors vendor-screens.test.tsx's approach for
 * createVendorPaymentLink.
 */
function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

const ACTIVE_ACCOUNT = {
  id: 'buyer-int-1',
  organizationId: 'org-1',
  organizationName: 'Integration Test Buyer Co',
  corporateEmail: 'buyer@procucev.com',
  subscriptionPlan: 'free_trial',
  remainingFreeRFQs: 3,
};

function mockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  if (/\/api\/bootstrap/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { vendors: [] } }) });
  }
  if (/\/api\/buyer-accounts\/active$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: ACTIVE_ACCOUNT }) });
  }
  if (/\/api\/buyer-accounts\/buyer-int-1\/subscription-payment$/.test(url) && method === 'POST') {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: { paymentUrl: 'https://payments.zoho.in/mock-buyer', paymentLinkId: 'pl-int-1', status: 'CREATED' } }),
    });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
}

describe('SubscriptionCenter (real AppProvider integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(mockFetchImpl) as any;
    authClient.setSession(
      { id: 'u-buyer-1', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-1', orgName: 'Integration Test Buyer Co' },
      'jwt-token'
    );
  });

  afterEach(() => {
    authClient.setSession(null, null);
  });

  it('syncs the real subscriptionPlan/remainingFreeRFQs from GET /api/buyer-accounts/active', async () => {
    renderWithProvider(<SubscriptionCenter />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(await screen.findByText(/3 of 5 Free RFQs Left/i)).toBeInTheDocument();
  });

  it('createBuyerPaymentLink calls the real endpoint and redirects on success', async () => {
    renderWithProvider(<SubscriptionCenter />);
    await act(async () => {
      await Promise.resolve();
    });

    // Version 1 is the account's free-trial-equivalent card here (disabled,
    // "Active Free Trial") since the account is on free_trial — Version 2 is
    // the first actually-subscribable paid plan.
    fireEvent.click(screen.getByText('Subscribe to Version 2'));
    const payBtn = screen.getByRole('button', { name: /Pay \$499/i });
    await act(async () => {
      fireEvent.click(payBtn);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/buyer-accounts/buyer-int-1/subscription-payment',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'version_2' }) })
    );
  });

  it('createBuyerPaymentLink shows a warning when payment-link creation fails', async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/buyer-accounts\/buyer-int-1\/subscription-payment$/.test(url)) {
        return Promise.resolve({ ok: false, status: 502, json: async () => ({ success: false, error: 'Zoho is unreachable.' }) });
      }
      return mockFetchImpl(url, options);
    }) as any;

    renderWithProvider(<SubscriptionCenter />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText('Subscribe to Version 2'));
    const payBtn = screen.getByRole('button', { name: /Pay \$499/i });
    await act(async () => {
      fireEvent.click(payBtn);
      await Promise.resolve();
    });

    expect(screen.getByText(/Could not start checkout/i)).toBeInTheDocument();
  });
});
