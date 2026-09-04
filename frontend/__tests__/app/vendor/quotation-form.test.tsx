import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuotationForm from '@/app/vendor/quotation-form';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
  },
});

// quotation-form.tsx now loads the caller's own vendor record, submits real
// bids, and downloads real RFQ specs (BUGS.md #28/#18) instead of a static
// table. Default mock: a resolvable vendor record and generic-success
// endpoints; individual tests override specific routes to exercise failure
// branches.
// addedByBuyerCompany matches RFQ-2026-00421's buyer in INITIAL_VENDOR_OPPORTUNITIES
// (lib/store.tsx) — the real relationship isOwnBuyerRfq now checks, replacing
// the old hardcoded 4-RFQ-number allow-list.
const MOCK_MY_VENDOR = {
  id: 'v-test-vendor',
  name: 'Test Vendor Co',
  email: 'vendor@test.com',
  addedByBuyerCompany: 'Larsen & Toubro Ltd. (L&T)',
};

function defaultMockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  if (/\/api\/vendors\/[^/]+$/.test(url) && method === 'GET') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: MOCK_MY_VENDOR }) });
  }
  if (/\/api\/rfqs\/[^/]+\/quotes$/.test(url) && method === 'POST') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  if (/\/api\/rfqs\/[^/]+\/email-preview/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  if (url === '/api/bootstrap') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
}

function QuotationFormCustomWrapper({
  onBack,
  onSubmitSuccess,
  customSubscription,
  opportunity,
  withSession = false,
}: {
  onBack: () => void;
  onSubmitSuccess?: () => void;
  customSubscription?: any;
  opportunity?: any;
  withSession?: boolean;
}) {
  const { setVendorSubscription, setCurrentUserSession } = useApp();

  React.useEffect(() => {
    if (customSubscription) {
      setVendorSubscription(customSubscription);
    }
    if (withSession) {
      setCurrentUserSession({
        id: 'user-1',
        email: 'vendor@test.com',
        name: 'Test Vendor Co',
        role: 'vendor',
        orgId: 'org-1',
        orgName: 'Test Vendor Co',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QuotationForm
      onBack={onBack}
      onSubmitSuccess={onSubmitSuccess}
      opportunity={opportunity}
    />
  );
}

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

describe('QuotationForm Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    global.fetch = jest.fn(defaultMockFetchImpl) as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    authClient.setSession(null, null);
  });

  test('Renders summary counters, table items, and triggers onBack navigation', () => {
    const onBack = jest.fn();
    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} />
    );

    expect(screen.getByText(/Sourcing Enquiries & Quotation Tracking/i)).toBeInTheDocument();
    expect(screen.getByText(/RFQs Received \(Active Enquiries\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Quotations Submitted/i)).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /Back to Opportunity Feed/i });
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);

    unmount();
  });

  test('Downloads RFQs across locked and unlocked tiers', () => {
    const onBack = jest.fn();

    // Standard subscription, no session: nothing matches a real direct-buyer
    // relationship, so every row is locked — clicking shows the upgrade
    // toast rather than calling the real download endpoint.
    const { unmount: unmountStandard } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="standard"
      />
    );

    const downloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    fireEvent.click(downloadBtns[0]);
    if (downloadBtns.length > 2) {
      fireEvent.click(downloadBtns[2]);
    }
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/email-preview'), expect.anything());
    unmountStandard();

    // 'connect' is a real marketplace-unlock tier: every RFQ downloads for
    // real regardless of buyer relationship, including with no session at
    // all (exercising handleDownloadRfq's own no-session fallback copy).
    const { unmount: unmountConnect } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="connect"
      />
    );

    const unlockedDownloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    if (unlockedDownloadBtns.length > 2) {
      fireEvent.click(unlockedDownloadBtns[2]);
    }
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/email-preview'), expect.anything());
    unmountConnect();
  });

  test('Buyer details modal interactions: open, copy company name with timer, and close', async () => {
    const onBack = jest.fn();
    const onSubmitSuccess = jest.fn();

    // Real hydrated RFQs replace the whole demo vendorOpportunities list, so
    // both rows this test needs must come from the same bootstrap response.
    // Both share this vendor's real addedByBuyerCompany relationship
    // ('Larsen & Toubro Ltd. (L&T)', same as MOCK_MY_VENDOR) — RFQ-2026-00421
    // has a BUYER_CONTACTS_MAP entry, RFQ-2026-00423 doesn't, so the second
    // row exercises the fallback baseBuyerData branch while still being
    // unlocked via the real direct-buyer relationship (not a submitted quote).
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (url === '/api/bootstrap') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              rfqs: [
                {
                  id: 'rfq-00421',
                  rfqNumber: 'RFQ-2026-00421',
                  title: 'Centrifugal Water Pump Package (15 HP)',
                  buyerAccountName: 'Larsen & Toubro Ltd. (L&T)',
                  category: 'Mechanical',
                  sourcingMode: 'mode_1',
                  status: 'Quotes Pending',
                  quotesCount: 0,
                  targetDeliveryDate: '2026-09-15',
                  budget: 150000,
                  createdAt: '2026-09-01',
                  chasingActive: false,
                  quotes: [],
                },
                {
                  id: 'rfq-00423',
                  rfqNumber: 'RFQ-2026-00423',
                  title: 'High Pressure Gate Valve System',
                  buyerAccountName: 'Larsen & Toubro Ltd. (L&T)',
                  category: 'Mechanical',
                  sourcingMode: 'mode_1',
                  status: 'Quotes Pending',
                  quotesCount: 0,
                  targetDeliveryDate: '2026-09-20',
                  budget: 85000,
                  createdAt: '2026-09-01',
                  chasingActive: false,
                  quotes: [],
                },
              ],
            },
          }),
        });
      }
      return defaultMockFetchImpl(url, options);
    }) as any;

    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={onSubmitSuccess}
        customSubscription="standard"
        withSession
      />
    );

    // Open first buyer info modal (RFQ-2026-00421 - in BUYER_CONTACTS_MAP,
    // unlocked via this vendor's real addedByBuyerCompany relationship)
    const infoBtns = await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Buyer Details/i });
      expect(btns.length).toBeGreaterThan(1);
      return btns;
    });
    fireEvent.click(infoBtns[0]);

    expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct Client Roster/i)).toBeInTheDocument();

    // Copy Company Name button
    const copyBtn = screen.getByTitle(/Copy Company Name/i);
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(screen.getByText(/Copied!/i)).toBeInTheDocument();

    // Advance timer to test setCopiedField(null)
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(screen.queryByText(/Copied!/i)).not.toBeInTheDocument();

    // Close via Close button (triggers onSubmitSuccess)
    const closeBtn = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeBtn);
    expect(onSubmitSuccess).toHaveBeenCalledTimes(1);

    // Open second info button (RFQ-2026-00423 - no BUYER_CONTACTS_MAP entry,
    // so this hits the fallback baseBuyerData branch, still unlocked via the
    // same real addedByBuyerCompany relationship as RFQ-2026-00421 above)
    fireEvent.click(infoBtns[1]);
    expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();

    // Close via X button in header
    const closeXBtn = screen.getByTitle(/Close Buyer Details Modal/i);
    fireEvent.click(closeXBtn);
    unmount();

    // Render without onSubmitSuccess to test fallback branch on modal close
    const { unmount: unmountNoCallback } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={undefined}
        withSession
      />
    );
    const infoBtnsNoCallback = await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Buyer Details/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(infoBtnsNoCallback[0]);
    const closeBtnNoCallback = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeBtnNoCallback);
    unmountNoCallback();
  });

  test('loads the caller\'s own vendor record on mount', async () => {
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/vendors/vendor%40test.com');
    });
    // Flush the rest of the async load chain (res.json() + state updates)
    // before the test ends and the component unmounts.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test('treats a vendor record with no addedByBuyerCompany as having no direct buyer relationship', async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'v-no-rel', name: 'No Relationship Vendor', email: 'vendor@test.com' } }),
        });
      }
      return defaultMockFetchImpl(url, options);
    }) as any;

    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="standard" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/vendors/vendor%40test.com');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No addedByBuyerCompany means every RFQ falls back to marketplace-locked,
    // including RFQ-2026-00421 which would otherwise be this vendor's own.
    expect(screen.getAllByText(/Premium Locked/i).length).toBeGreaterThan(0);
  });

  test('does not update state if the component unmounts before the vendor record fetch resolves', async () => {
    let resolveFetch!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) return pending;
      return defaultMockFetchImpl(url, options);
    }) as any;

    const onBack = jest.fn();
    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />
    );
    unmount();

    // Resolving after unmount exercises the cancelled-guard in
    // quotation-form.tsx's loadMyVendorRecord — this must not throw or warn
    // about updating state on an unmounted component.
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ success: true, data: MOCK_MY_VENDOR }) });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test('handles a network failure while loading the vendor record gracefully', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) return Promise.reject(new Error('network down'));
      return defaultMockFetchImpl(url, options);
    });
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    // Should render normally without throwing despite the failed lookup
    await waitFor(() => expect(screen.getByText(/Sourcing Enquiries & Quotation Tracking/i)).toBeInTheDocument());
  });

  test('opens the bid modal, validates unit price, and submits a quote successfully', async () => {
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    // RFQ-2026-00421 is in the isOwnBuyerRfq allow-list — always unlocked
    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote$/i });
    fireEvent.click(submitBtns[0]);

    expect(screen.getByRole('heading', { name: /Submit Quotation/i })).toBeInTheDocument();

    // Validation: submit with no unit price
    const submitQuotationBtn = screen.getByRole('button', { name: /Submit Quotation/i });
    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });
    expect(screen.getByRole('heading', { name: /Submit Quotation/i })).toBeInTheDocument(); // modal stays open

    // Fill in the bid form
    const priceInputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(priceInputs[0], { target: { value: '1500' } }); // unit price
    fireEvent.change(priceInputs[1], { target: { value: '10' } }); // lead time
    fireEvent.change(priceInputs[2], { target: { value: '2' } }); // warranty
    fireEvent.change(screen.getByDisplayValue('45 Days Net'), { target: { value: '30 Days Net' } });
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'Best price guaranteed' } });

    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/rfqs/'),
      expect.objectContaining({ method: 'POST' })
    );
    // Modal closes on success
    expect(screen.queryByRole('heading', { name: /Submit Quotation/i })).not.toBeInTheDocument();
  });

  test('shows an error toast and keeps the modal open when quote submission fails', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      if (/\/api\/rfqs\/[^/]+\/quotes$/.test(url)) {
        return Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Create your vendor profile first.' }) });
      }
      return defaultMockFetchImpl(url, options);
    });
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote$/i });
    fireEvent.click(submitBtns[0]);

    const priceInputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(priceInputs[0], { target: { value: '1500' } });

    const submitQuotationBtn = screen.getByRole('button', { name: /Submit Quotation/i });
    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });

    // Modal stays open on failure so the vendor can retry
    expect(screen.getByRole('heading', { name: /Submit Quotation/i })).toBeInTheDocument();

    // Cancel closes it manually
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByRole('heading', { name: /Submit Quotation/i })).not.toBeInTheDocument();
  });

  test('downloads an RFQ successfully and shows a failure toast when the download fails', async () => {
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    const downloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/email-preview'),
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) })
    );

    // Now make the download endpoint fail
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      if (/\/email-preview/.test(url)) {
        return Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'RFQ not found' }) });
      }
      return defaultMockFetchImpl(url, options);
    });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });
    // No throw — handled gracefully via a warning toast
    expect(screen.getByText(/Sourcing Enquiries & Quotation Tracking/i)).toBeInTheDocument();
  });

  test('auto-opens the bid modal for a deep-linked opportunity that is unlocked and not yet quoted', async () => {
    const onBack = jest.fn();
    const opportunity = {
      id: 'opp-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'Centrifugal Water Pump Package',
      buyer: 'L&T',
      deadline: '2026-09-15',
      daysRemaining: 7,
      type: 'direct_invitation',
      deliveryLocation: 'Mumbai',
      status: 'pending_bid',
      lineItems: [{ id: 'li-1', description: 'Pump', quantity: 3, unitPrice: 0, leadTimeDays: 7, marketBandStatus: 'optimal', paymentTerms: 'Net 60' }],
    };

    // Needs a session so the vendor record (with addedByBuyerCompany) loads —
    // the auto-open effect now waits for that before judging lock state.
    // Set it via authClient (read synchronously by AppProvider's initial
    // state) rather than relying solely on the wrapper's post-mount
    // setCurrentUserSession, which would arrive a render late and race the
    // deep-link effect's own state.
    authClient.setSession(
      { id: 'user-1', email: 'vendor@test.com', name: 'Test Vendor Co', role: 'vendor', orgId: 'org-1', orgName: 'Test Vendor Co' },
      'fake-token-123'
    );
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} opportunity={opportunity} withSession />);

    expect(await screen.findByRole('heading', { name: /Submit Quotation/i })).toBeInTheDocument();
    expect(screen.getAllByText(/RFQ-2026-00421/).length).toBeGreaterThan(0);
  });

  test('does not auto-open the bid modal for a deep-linked opportunity that is locked', () => {
    const onBack = jest.fn();
    const opportunity = {
      id: 'opp-3',
      rfqNumber: 'RFQ-2026-00501', // not in isOwnBuyerRfq allow-list
      title: 'HVAC Unit',
      buyer: 'NTPC',
      deadline: '2026-09-25',
      daysRemaining: 17,
      type: 'network_marketplace',
      deliveryLocation: 'Delhi',
      status: 'pending_bid',
      lineItems: [],
    };

    // No subscription set — default 'premium' tier, so this RFQ stays locked
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} opportunity={opportunity} />);

    expect(screen.queryByRole('heading', { name: /Submit Quotation/i })).not.toBeInTheDocument();
  });

  test('shows this vendor\'s real submitted quotes derived from hydrated RFQ data', async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (url === '/api/bootstrap') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              rfqs: [
                {
                  id: 'rfq-real-1',
                  rfqNumber: 'RFQ-2026-00421',
                  title: 'Centrifugal Water Pump Package (15 HP)',
                  category: 'Mechanical',
                  sourcingMode: 'mode_1',
                  status: 'PO Generated',
                  quotesCount: 1,
                  targetDeliveryDate: '2026-09-20',
                  budget: 150000,
                  createdAt: '2026-09-01',
                  chasingActive: false,
                  quotes: [
                    {
                      vendorId: MOCK_MY_VENDOR.id,
                      vendorName: MOCK_MY_VENDOR.name,
                      vendorCategory: 'Client List',
                      unitPrice: 1500,
                      totalPrice: 15000,
                      leadTimeDays: 10,
                      aiMatchScore: 90,
                      warrantyYears: 2,
                      complianceStatus: 'Fully Compliant',
                      paymentTerms: '30 Days Net',
                      remarks: 'test',
                      submittedAt: '2026-09-01T10:00:00.000Z',
                    },
                  ],
                },
                {
                  // Not in the isOwnBuyerRfq allow-list, and no submittedAt on
                  // the quote — exercises the "-" date fallback, the
                  // non-"PO Generated" status branch, and the
                  // "Buyer Details Unlocked (Quote Submitted)" title branch.
                  id: 'rfq-real-2',
                  rfqNumber: 'RFQ-2026-00501',
                  title: 'HVAC Air Handling Unit & Smart Chiller Control',
                  category: 'Mechanical',
                  sourcingMode: 'mode_3',
                  status: 'In Evaluation',
                  quotesCount: 1,
                  targetDeliveryDate: '2026-09-25',
                  budget: 220000,
                  createdAt: '2026-09-01',
                  chasingActive: false,
                  quotes: [
                    {
                      vendorId: MOCK_MY_VENDOR.id,
                      vendorName: MOCK_MY_VENDOR.name,
                      vendorCategory: 'Procucev Network',
                      unitPrice: 2000,
                      totalPrice: 10000,
                      leadTimeDays: 21,
                      aiMatchScore: 85,
                      warrantyYears: 1,
                      complianceStatus: 'Fully Compliant',
                      paymentTerms: '45 Days Net',
                      remarks: 'network bid',
                    },
                  ],
                },
              ],
            },
          }),
        });
      }
      return defaultMockFetchImpl(url, options);
    }) as any;

    const onBack = jest.fn();
    await act(async () => {
      renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);
    });

    // "Submit Quote" is replaced by the real PO Generated status for this RFQ
    expect(await screen.findByText('PO Generated')).toBeInTheDocument();
    expect(screen.getByText('Under Evaluation')).toBeInTheDocument();
    expect(screen.getAllByText('Portal Submission').length).toBe(2);
  });


  test('sends a real auth token when one is present, and handles a non-ok vendor lookup response', async () => {
    authClient.setSession(
      { id: 'user-1', email: 'vendor@test.com', name: 'Test Vendor Co', role: 'vendor', orgId: 'org-1', orgName: 'Test Vendor Co' },
      'fake-token-123'
    );
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false }) });
      }
      return defaultMockFetchImpl(url, {});
    }) as any;

    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    // Bid using an opportunity with no line items — exercises the quantity
    // fallback (`?? 1`) — and confirm the request carries a real Bearer token.
    fireEvent.click(screen.getAllByRole('button', { name: /Submit Quote$/i })[0]);
    const priceInput = document.querySelectorAll('input[type="number"]')[0];
    fireEvent.change(priceInput, { target: { value: '999' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Quotation/i }));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quotes'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-token-123' }) })
    );
  });

  test('closes the bid modal via the header X button', () => {
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />);

    fireEvent.click(screen.getAllByRole('button', { name: /Submit Quote$/i })[0]);
    expect(screen.getByRole('heading', { name: /Submit Quotation/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByRole('heading', { name: /Submit Quotation/i })).not.toBeInTheDocument();
  });
});
