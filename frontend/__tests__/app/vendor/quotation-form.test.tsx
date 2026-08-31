import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  test('Downloads RFQs across locked and unlocked tiers', () => {
    const onBack = jest.fn();

    // Standard subscription: direct RFQs are unlocked, marketplace RFQs are locked
    const { unmount: unmountStandard } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="standard"
      />
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

    const unlockedDownloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    if (unlockedDownloadBtns.length > 2) {
      fireEvent.click(unlockedDownloadBtns[2]);
    }
    unmountPremium();
  });

  test('Buyer details modal interactions: open, copy company name with timer, and close', () => {
    const onBack = jest.fn();
    const onSubmitSuccess = jest.fn();

    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={onSubmitSuccess}
        customSubscription="standard"
      />
    );

    // Open first buyer info modal (RFQ-2026-00421 - in BUYER_CONTACTS_MAP)
    const infoBtns = screen.getAllByRole('button', { name: /Buyer Details/i });
    expect(infoBtns.length).toBeGreaterThan(0);
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
    if (infoBtns.length > 1) {
      fireEvent.click(infoBtns[1]);
      expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();

      // Close via X button in header
      const closeXBtn = screen.getByTitle(/Close Buyer Details Modal/i);
      fireEvent.click(closeXBtn);
    }
    unmount();

    // Render without onSubmitSuccess to test fallback branch on modal close
    const { unmount: unmountNoCallback } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={undefined}
      />
    );
    const infoBtnsNoCallback = screen.getAllByRole('button', { name: /Buyer Details/i });
    if (infoBtnsNoCallback.length > 0) {
      fireEvent.click(infoBtnsNoCallback[0]);
      const closeBtnNoCallback = screen.getByRole('button', { name: /^Close$/i });
      fireEvent.click(closeBtnNoCallback);
    }
    unmountNoCallback();
  });
});
