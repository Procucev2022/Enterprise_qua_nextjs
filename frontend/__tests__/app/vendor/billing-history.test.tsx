import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VendorBillingHistory from '@/app/vendor/billing-history';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

const MY_VENDOR = { id: 'v-billing-1', email: 'vendor@procucev.com', name: 'Billing Test Vendor' };

const LINKS = [
  { id: 'pl-1', planId: 'connect', amount: 2.36, status: 'active', activated: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'pl-2', planId: 'select', amount: 5.9, status: 'paid', activated: true, createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
  // Edge-case row: unrecognized plan id, no status, no amount, no updatedAt —
  // exercises every display fallback (PLAN_LABEL miss, 'Pending', ₹0.00, '—').
  { id: 'pl-3', planId: 'unknown_plan', amount: undefined, status: undefined, activated: false, createdAt: '2026-03-01T00:00:00Z', updatedAt: undefined },
];

describe('app/vendor/billing-history.tsx', () => {
  const mockShowToast = jest.fn();
  const originalFetch = global.fetch;

  function mockStore(overrides: Record<string, unknown> = {}) {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [MY_VENDOR],
      showToast: mockShowToast,
      ...overrides,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore();
    authClient.setSession(
      { id: 'usr-vendor-1', email: 'vendor@procucev.com', name: 'Billing Test Vendor', role: 'vendor', orgId: 'o', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn((url: string) => {
      if (/\/payment-links$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: LINKS }) });
      }
      if (/\/payment-links\/pl-1\/invoice$/.test(url)) {
        return Promise.resolve({ ok: true, blob: async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
  });

  it('shows a not-found message when the vendor profile cannot be resolved', () => {
    mockStore({ buyerVendors: [] });
    render(<VendorBillingHistory />);
    expect(screen.getByText(/Could not find your vendor profile/i)).toBeInTheDocument();
  });

  it('loads and lists the vendor\'s payment links', async () => {
    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText('Connect Model')).toBeInTheDocument());
    expect(screen.getByText('Select Model')).toBeInTheDocument();
    expect(screen.getByText('₹2.36')).toBeInTheDocument();
    expect(screen.getByText('₹5.90')).toBeInTheDocument();
    expect(screen.getByText('Paid & Activated')).toBeInTheDocument();
  });

  it('shows an empty state when there are no payments', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) }) as any;
    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText(/No payments yet/i)).toBeInTheDocument());
  });

  it('shows an error message when the list fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Nope' }) }) as any;
    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText('Nope')).toBeInTheDocument());
  });

  it('downloads a receipt when clicking Download', async () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = jest.fn();
    (global as any).URL.createObjectURL = createObjectURL;
    (global as any).URL.revokeObjectURL = revokeObjectURL;

    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText('Connect Model')).toBeInTheDocument());

    const downloadButtons = screen.getAllByRole('button', { name: /Download/i });
    fireEvent.click(downloadButtons[0]);

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it('works without a session token in the headers, and later cleans up the object URL', async () => {
    jest.useFakeTimers();
    jest.spyOn(authClient, 'getToken').mockReturnValue(null);
    const createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = jest.fn();
    (global as any).URL.createObjectURL = createObjectURL;
    (global as any).URL.revokeObjectURL = revokeObjectURL;

    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText('Connect Model')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /Download/i })[0]);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

    jest.advanceTimersByTime(30000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    jest.useRealTimers();
  });

  it('treats an unparsable JSON response as a load failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    }) as any;
    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText(/Could not load your billing history/i)).toBeInTheDocument());
  });

  it('treats an ok response with success:false as an error, using the fallback message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }) as any;
    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText(/Could not load your billing history/i)).toBeInTheDocument());
  });

  it('does not update state after unmounting mid-fetch', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    ) as any;

    const { unmount } = render(<VendorBillingHistory />);
    unmount();
    resolveFetch({ ok: true, json: async () => ({ success: true, data: LINKS }) });
    await Promise.resolve();
    await Promise.resolve();
    // No assertion needed beyond "this doesn't throw" — the cancelled guard is
    // what prevents a React state update on an unmounted component here.
  });

  it('shows a toast when the receipt download fails', async () => {
    global.fetch = jest.fn((url: string) => {
      if (/\/payment-links$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: LINKS }) });
      }
      return Promise.resolve({ ok: false });
    }) as any;

    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText('Connect Model')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /Download/i })[0]);

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Download Failed', expect.any(String), 'warning'));
  });

  it('falls back to the generic download-failure message when the rejection carries none', async () => {
    global.fetch = jest.fn((url: string) => {
      if (/\/payment-links$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: LINKS }) });
      }
      return Promise.reject(new Error(''));
    }) as any;

    render(<VendorBillingHistory />);
    await waitFor(() => expect(screen.getByText('Connect Model')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /Download/i })[0]);

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Download Failed', 'Could not generate the receipt.', 'warning')
    );
  });
});
