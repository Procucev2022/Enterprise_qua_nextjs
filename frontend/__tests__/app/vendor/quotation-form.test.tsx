import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuotationForm from '@/app/vendor/quotation-form';
import { AppProvider, useApp } from '@/lib/store';

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
  },
});

function QuotationFormCustomWrapper({
  onBack,
  onSubmitSuccess,
  customSubscription,
}: {
  onBack: () => void;
  onSubmitSuccess?: () => void;
  customSubscription?: any;
}) {
  const { setVendorSubscription } = useApp();

  React.useEffect(() => {
    if (customSubscription) {
      setVendorSubscription(customSubscription);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QuotationForm
      onBack={onBack}
      onSubmitSuccess={onSubmitSuccess}
    />
  );
}

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

/**
 * Serve a specific RFQ list from GET /api/rfqs.
 *
 * Opportunities are derived from RFQs the API returns rather than from a seeded
 * array, so a test that needs several pricing tiers has to supply the RFQs that
 * produce them. `RFQ-2026-00421` is one this vendor's buyer uploaded (unlocked);
 * the marketplace one is not (locked below premium_network).
 */
function serveVendorRFQs(rfqNumbers: string[]) {
  (global.fetch as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () =>
        /\/api\/rfqs(\?|$)/.test(String(url))
          ? {
              success: true,
              data: rfqNumbers.map((rfqNumber, idx) => ({
                id: `rfq-${idx}`,
                rfqNumber,
                title: `Opportunity ${rfqNumber}`,
                category: 'Engineering Spares - Mechanical',
                sourcingMode: idx === 0 ? 'mode_1' : 'mode_3',
                status: 'Quotes Pending',
                quotesCount: 0,
                budget: 150000,
                targetDeliveryDate: '2026-09-15',
                createdAt: '2026-09-04T10:00:00.000Z',
                deliveryLocation: 'Pune Plant',
                raisedByEmail: 'buyer@procucev.com',
                extractedEntities: [],
                quotes: [],
                chasingActive: false,
              })),
            }
          : { success: true, data: {} },
    })
  );
}

describe('QuotationForm Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
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

  test('Downloads RFQs across locked and unlocked tiers', async () => {
    serveVendorRFQs(['RFQ-2026-00421', 'RFQ-2026-00501']);
    const onBack = jest.fn();

    // Standard subscription: direct RFQs are unlocked, marketplace RFQs are locked
    const { unmount: unmountStandard } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="standard"
      />
    );

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Download RFQ/i }).length).toBeGreaterThan(1)
    );
    const downloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    // First download is unlocked (RFQ-2026-00421 isOwnBuyerRfq)
    fireEvent.click(downloadBtns[0]);
    // 3rd download is locked (RFQ-2026-00501 marketplace)
    if (downloadBtns.length > 2) {
      fireEvent.click(downloadBtns[2]);
    }
    unmountStandard();

    // Premium Network subscription: all RFQs are unlocked
    const { unmount: unmountPremium } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="premium_network"
      />
    );

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Download RFQ/i }).length).toBeGreaterThan(1)
    );
    const unlockedDownloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    if (unlockedDownloadBtns.length > 2) {
      fireEvent.click(unlockedDownloadBtns[2]);
    }
    unmountPremium();
  });

  test('Buyer details modal interactions: open, copy company name with timer, and close', async () => {
    serveVendorRFQs(['RFQ-2026-00421', 'RFQ-2026-00423']);
    const onBack = jest.fn();
    const onSubmitSuccess = jest.fn();

    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={onSubmitSuccess}
        customSubscription="standard"
      />
    );

    // Opportunities are derived from RFQs fetched from the API, so the rows appear
    // only once that request settles. The table element itself renders immediately
    // with an empty body, so waiting on it would resolve before any row exists —
    // wait for the per-row buttons instead.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Buyer Details/i }).length).toBeGreaterThan(1)
    );
    const infoBtns = screen.getAllByRole('button', { name: /Buyer Details/i });
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

    // Open second info button (RFQ-2026-00423 - fallback baseBuyerData)
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
      />
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Buyer Details/i }).length).toBeGreaterThan(0)
    );
    const infoBtnsNoCallback = screen.getAllByRole('button', { name: /Buyer Details/i });
    fireEvent.click(infoBtnsNoCallback[0]);
    const closeBtnNoCallback = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeBtnNoCallback);
    unmountNoCallback();
  });
});
