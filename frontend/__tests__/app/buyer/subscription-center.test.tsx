import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import { useApp } from '@/lib/store';
import { fetchSubscriptionPricing } from '@/lib/subscriptionPaymentClient';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/subscriptionPaymentClient', () => ({
  fetchSubscriptionPricing: jest.fn(),
}));

const mockPricingConfig = {
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
    (fetchSubscriptionPricing as jest.Mock).mockResolvedValue(mockPricingConfig);
    mockStore();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'ent-123' } }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  it('renders free trial header, quota progress bar, and all 3 subscription plans with strikethrough original prices', async () => {
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Free Starter Account — 5 Free RFQs Included/i)).toBeInTheDocument();
    expect(screen.getByText(/Remaining: 4 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Used: 1 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText('Silver Plan')).toBeInTheDocument();
    expect(screen.getByText('Gold Plan')).toBeInTheDocument();
    expect(screen.getByText('Diamond Plan')).toBeInTheDocument();

    const v1Original = screen.getByText('₹50,000');
    const v2Original = screen.getByText('₹75,000');
    const v3Original = screen.getByText('₹1,00,000');
    expect(v1Original).toBeInTheDocument();
    expect(v1Original).toHaveClass('line-through');
    expect(v2Original).toBeInTheDocument();
    expect(v2Original).toHaveClass('line-through');
    expect(v3Original).toBeInTheDocument();
    expect(v3Original).toHaveClass('line-through');
  });

  it('handles fetchSubscriptionPricing returning null or being unmounted', async () => {
    (fetchSubscriptionPricing as jest.Mock).mockResolvedValue(null);
    const { unmount } = render(<SubscriptionCenter />);
    unmount();
  });

  it('renders the Free Starter Account banner with remaining and used quotas', () => {
    mockStore({ activeSubscription: 'free_trial', remainingFreeRFQs: 4 });
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Free Starter Account — 5 Free RFQs Included/i)).toBeInTheDocument();
    expect(screen.getByText('Used: 1 / 5')).toBeInTheDocument();
    expect(screen.getByText('Remaining: 4 / 5')).toBeInTheDocument();
    expect(screen.getByText(/Every new buyer account receives/i)).toBeInTheDocument();
  });

  it('renders active plan status badge instead of free quota alert when on a paid plan', () => {
    mockStore({ activeSubscription: 'version_1' });
    render(<SubscriptionCenter />);

    expect(screen.queryByText(/Free Starter Account — 5 Free RFQs Included/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Active Premium Plan: Silver Plan/i)).toBeInTheDocument();
  });

  it('clicking a paid plan opens the real Zoho checkout modal and can be closed', async () => {
    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByTestId('subscribe-btn-version_2'));
    await waitFor(() => expect(screen.getByText('Secure Payment')).toBeInTheDocument());
    expect(mockCreateBuyerPaymentLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Secure Payment')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('subscribe-btn-version_3'));
    await waitFor(() => expect(screen.getByText('Secure Payment')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancel'));
  });

  it('renders the active-plan banner and disables the button for the currently active paid plan', () => {
    mockStore({ activeSubscription: 'version_1', remainingFreeRFQs: 0, activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'version_1', remainingFreeRFQs: 0 } });
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Active Premium Plan: Silver Plan/i)).toBeInTheDocument();
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

  it('renders active premium plan banners for version_1, version_2, and version_3', () => {
    mockStore({ activeSubscription: 'version_1' });
    const { rerender } = render(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Silver Plan/i)).toBeInTheDocument();

    mockStore({ activeSubscription: 'version_2' });
    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Gold Plan/i)).toBeInTheDocument();

    mockStore({ activeSubscription: 'version_3' });
    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Diamond Plan/i)).toBeInTheDocument();
  });

  it('switches between 12-month and 6-month durations and updates prices dynamically', () => {
    render(<SubscriptionCenter />);

    expect(screen.getByText('₹50,000')).toBeInTheDocument();
    expect(screen.getByText('₹75,000')).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000')).toBeInTheDocument();
    expect(screen.getByText('₹4,999')).toBeInTheDocument();
    expect(screen.getByText('₹7,499')).toBeInTheDocument();
    expect(screen.getByText('₹9,999')).toBeInTheDocument();
    expect(screen.getAllByText('per month').length).toBe(3);
    expect(screen.getAllByText('+ 18% GST').length).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: '6 Months' }));

    expect(screen.getByText('₹5,499')).toBeInTheDocument();
    expect(screen.getByText('₹7,999')).toBeInTheDocument();
    expect(screen.getByText('₹10,499')).toBeInTheDocument();
    expect(screen.getAllByText('per month').length).toBe(3);
    expect(screen.getAllByText('+ 18% GST').length).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: /12 Months/i }));
    expect(screen.getByText('₹4,999')).toBeInTheDocument();
    expect(screen.getByText('₹7,499')).toBeInTheDocument();
    expect(screen.getByText('₹9,999')).toBeInTheDocument();
  });

  it('opens checkout modal with 6-month price multiplied by 6 months plus 18% GST', async () => {
    mockCreateBuyerPaymentLink.mockResolvedValueOnce('https://payments.zoho.in/mock-buyer-6m');
    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByRole('button', { name: '6 Months' }));
    fireEvent.click(screen.getByTestId('subscribe-btn-version_1'));

    await waitFor(() => expect(screen.getByText('Secure Payment')).toBeInTheDocument());
    expect(screen.getByText('₹32,994 (₹5,499 × 6 months)')).toBeInTheDocument();
    expect(screen.getByText('₹5,938.92')).toBeInTheDocument();
    expect(screen.getAllByText('₹38,932.92').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('6 Months').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByText(/Pay ₹38,932\.92/i));

    await waitFor(() => {
      expect(mockCreateBuyerPaymentLink).toHaveBeenCalledWith('version_1', '6_months');
    });
  });

  it('handles enterprise modal open, field changes, close X button, cancel button, and validation', async () => {
    mockStore({
      activeBuyerAccount: {
        id: 'buyer-ent-2',
        brandName: 'Brand Corp',
        corporateEmail: 'corp@brand.com',
        phone: '+91 99988 77665',
      },
      currentUserSession: null,
    });

    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByTestId('enterprise-contact-btn'));
    expect(screen.getByText('For Customizations and Bulk Contracts')).toBeInTheDocument();

    const companyInput = screen.getByDisplayValue('Brand Corp');
    const emailInput = screen.getByDisplayValue('corp@brand.com');
    const mobileInput = screen.getByDisplayValue('+91 99988 77665');

    fireEvent.change(companyInput, { target: { value: 'Updated Brand Corp' } });
    fireEvent.change(emailInput, { target: { value: 'updated@brand.com' } });
    fireEvent.change(mobileInput, { target: { value: '+91 99900 11223' } });

    expect(companyInput).toHaveValue('Updated Brand Corp');
    expect(emailInput).toHaveValue('updated@brand.com');
    expect(mobileInput).toHaveValue('+91 99900 11223');

    // Close via Cancel
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('For Customizations and Bulk Contracts')).not.toBeInTheDocument();

    // Reopen and Close via X
    fireEvent.click(screen.getByTestId('enterprise-contact-btn'));
    expect(screen.getByText('For Customizations and Bulk Contracts')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByText('For Customizations and Bulk Contracts')).not.toBeInTheDocument();

    // Reopen and test validation with empty fields
    fireEvent.click(screen.getByTestId('enterprise-contact-btn'));
    const companyInput2 = screen.getByDisplayValue('Updated Brand Corp');
    const form = companyInput2.closest('form')!;
    fireEvent.change(companyInput2, { target: { value: '' } });
    fireEvent.submit(form);
    expect(mockShowToast).toHaveBeenCalledWith('Missing Details', expect.any(String), 'warning');

    // Fill company, leave email empty
    fireEvent.change(companyInput2, { target: { value: 'Valid Co' } });
    const emailInput2 = screen.getByDisplayValue('updated@brand.com');
    fireEvent.change(emailInput2, { target: { value: '' } });
    fireEvent.submit(form);
    expect(mockShowToast).toHaveBeenCalledWith('Missing Details', expect.any(String), 'warning');

    // Fill email, leave mobile empty
    fireEvent.change(emailInput2, { target: { value: 'valid@co.com' } });
    const mobileInput2 = screen.getByDisplayValue('+91 99900 11223');
    fireEvent.change(mobileInput2, { target: { value: '' } });
    fireEvent.submit(form);
    expect(mockShowToast).toHaveBeenCalledWith('Missing Details', expect.any(String), 'warning');
  });

  it('handles enterprise submission with existing localStorage items and done button', async () => {
    localStorage.setItem('procucev_enterprise_inquiries', JSON.stringify([{ id: 'existing-inq' }]));
    mockStore({
      activeBuyerAccount: {
        id: 'buyer-ent-1',
        organizationName: 'Tata Power Ltd',
        corporateEmail: 'procurement@tatapower.com',
        mobileNumber: '+91 98765 43210',
      },
      currentUserSession: {
        id: 'user-1',
        name: 'Rohan Sharma',
        email: 'procurement@tatapower.com',
        role: 'buyer',
        orgId: 'buyer-ent-1',
        orgName: 'Tata Power Ltd',
        mobile: '+91 98765 43210',
      },
    });

    render(<SubscriptionCenter />);
    fireEvent.click(screen.getByTestId('enterprise-contact-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Submit Enquiry/i }));

    await waitFor(() => {
      expect(screen.getByText('Enquiry Received!')).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem('procucev_enterprise_inquiries') || '[]');
    expect(stored.length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Enquiry Received!')).not.toBeInTheDocument();
  });

  it('handles enterprise submission when response has no data and localStorage has corrupted non-array', async () => {
    localStorage.setItem('procucev_enterprise_inquiries', '{"invalid": "shape"}');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }), // json.data is undefined
    });
    mockStore({
      activeBuyerAccount: null,
      currentUserSession: null,
    });

    render(<SubscriptionCenter />);
    fireEvent.click(screen.getByTestId('enterprise-contact-btn'));

    const companyInput = screen.getByLabelText(/Company Name/i);
    const emailInput = screen.getByLabelText(/Email ID/i);
    const mobileInput = screen.getByLabelText(/Mobile Number/i);

    fireEvent.change(companyInput, { target: { value: 'Fallback Corp' } });
    fireEvent.change(emailInput, { target: { value: 'fall@back.com' } });
    fireEvent.change(mobileInput, { target: { value: '+91 98765 00000' } });

    fireEvent.click(screen.getByRole('button', { name: /Submit Enquiry/i }));

    await waitFor(() => {
      expect(screen.getByText('Enquiry Received!')).toBeInTheDocument();
    });
  });

  it('handles pricing config missing individual plan entries', async () => {
    (fetchSubscriptionPricing as jest.Mock).mockResolvedValue({
      buyer: {
        version_1: {}, // empty durations
      },
    });
    render(<SubscriptionCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Silver Plan')).toBeInTheDocument();
  });

  it('handles enterprise submission when fetch fails with network error and corrupt localStorage', async () => {
    localStorage.setItem('procucev_enterprise_inquiries', '{"corrupt": true}');
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
    mockStore({
      activeBuyerAccount: null,
      currentUserSession: {
        id: 'user-solo',
        orgName: 'Solo Org',
        email: 'solo@org.com',
        mobile: '+91 99112 23344',
      },
    });

    render(<SubscriptionCenter />);
    fireEvent.click(screen.getByTestId('enterprise-contact-btn'));
    fireEvent.click(screen.getByRole('button', { name: /Submit Enquiry/i }));

    await waitFor(() => {
      expect(screen.getByText('Enquiry Received!')).toBeInTheDocument();
    });
    expect(mockShowToast).toHaveBeenCalledWith('Enquiry Submitted', expect.any(String), 'success');
  });
});
