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

const PRICING_RESPONSE = {
  gstPercent: 18,
  gstRate: 0.18,
  buyer: {
    version_1: {
      '6_months': { price: 5499, baseDurationPrice: 32994, gstAmount: 5938.92, totalWithGst: 38932.92 },
      '12_months': { price: 4999, baseDurationPrice: 59988, gstAmount: 10797.84, totalWithGst: 70785.84 },
    },
    version_2: {
      '6_months': { price: 7999, baseDurationPrice: 47994, gstAmount: 8638.92, totalWithGst: 56632.92 },
      '12_months': { price: 7499, baseDurationPrice: 89988, gstAmount: 16197.84, totalWithGst: 106185.84 },
    },
    version_3: {
      '6_months': { price: 10499, baseDurationPrice: 62994, gstAmount: 11338.92, totalWithGst: 74332.92 },
      '12_months': { price: 9999, baseDurationPrice: 119988, gstAmount: 21597.84, totalWithGst: 141585.84 },
    },
  },
  seller: {},
};

function mockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  if (/\/api\/bootstrap/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { vendors: [] } }) });
  }
  if (/\/api\/subscriptions\/pricing$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: PRICING_RESPONSE }) });
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

    expect(await screen.findByText('Remaining: 3 free RFQs')).toBeInTheDocument();
    expect(screen.queryByText(/Used:/i)).not.toBeInTheDocument();
  });

  it('subscribing to a plan opens the real Zoho checkout modal and creates a real payment link on Pay', async () => {
    renderWithProvider(<SubscriptionCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    await screen.findByText('₹7,499');

    const subscribeBtn = screen.getByTestId('subscribe-btn-version_2');
    await act(async () => {
      fireEvent.click(subscribeBtn);
      await Promise.resolve();
    });

    expect(await screen.findByText('Secure Payment')).toBeInTheDocument();
    // The plan is never granted directly via PUT from this button — only a
    // real Zoho payment link is created once the user confirms in the modal.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/buyer-accounts/buyer-int-1',
      expect.objectContaining({ method: 'PUT' })
    );

    const payBtn = screen.getByText(/Pay ₹1,06,185\.84/i);
    await act(async () => {
      fireEvent.click(payBtn);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/buyer-accounts/buyer-int-1/subscription-payment',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'version_2', billingDuration: '12_months' }) })
    );
  });
});
