import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RfqUpgradePlanModal from '@/app/buyer/RfqUpgradePlanModal';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');
jest.mock('@/lib/subscriptionPaymentClient', () => ({
  fetchSubscriptionPricing: jest.fn().mockResolvedValue({
    buyer: {
      version_1: {
        '12_months': { price: 4999, baseDurationPrice: 59988, gstAmount: 10797.84, totalWithGst: 70785.84 },
        '6_months': { price: 5499, baseDurationPrice: 32994, gstAmount: 5938.92, totalWithGst: 38932.92 },
      },
      version_2: {
        '12_months': { price: 7499, baseDurationPrice: 89988, gstAmount: 16197.84, totalWithGst: 106185.84 },
        '6_months': { price: 7999, baseDurationPrice: 47994, gstAmount: 8638.92, totalWithGst: 56632.92 },
      },
      version_3: {
        '12_months': { price: 9999, baseDurationPrice: 119988, gstAmount: 21597.84, totalWithGst: 141585.84 },
        '6_months': { price: 10499, baseDurationPrice: 62994, gstAmount: 11338.92, totalWithGst: 74332.92 },
      },
    },
  }),
}));

describe('RfqUpgradePlanModal', () => {
  const mockCreateBuyerPaymentLink = jest.fn();
  const mockShowToast = jest.fn();
  const mockOnClose = jest.fn();
  const mockOnSwitchToMode0 = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      createBuyerPaymentLink: mockCreateBuyerPaymentLink,
      showToast: mockShowToast,
    });
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <RfqUpgradePlanModal
        isOpen={false}
        onClose={mockOnClose}
        targetMode="mode_1"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders required warning message and details when targeting Mode 1', async () => {
    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_1"
        remainingCredits={0}
        onSwitchToMode0={mockOnSwitchToMode0}
      />
    );

    // Exact warning prompt requirement: "You don't have credits to publish the RFQ in Mode XX"
    expect(screen.getByTestId('rfq-upgrade-warning-banner')).toBeInTheDocument();
    expect(screen.getByText(/You don't have credits to publish the RFQ in Mode 1/i)).toBeInTheDocument();

    // Plan & amount details
    expect(screen.getAllByText(/Silver Plan/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Total Amount to Upgrade/i)).toBeInTheDocument();

    // Payment options towards it
    expect(screen.getByText(/Instant UPI & QR/i)).toBeInTheDocument();
    expect(screen.getByText(/Cards & Net Banking/i)).toBeInTheDocument();
    expect(screen.getByText(/Corporate Wire \/ NEFT/i)).toBeInTheDocument();
    expect(screen.getByText(/Zoho Secure Gateway/i)).toBeInTheDocument();
  });

  it('renders required warning message when targeting Mode 2', () => {
    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_2"
        remainingCredits={0}
      />
    );

    expect(screen.getByText(/You don't have credits to publish the RFQ in Mode 2/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Gold Plan/i).length).toBeGreaterThan(0);
  });

  it('renders required warning message when targeting Mode 3', () => {
    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_3"
        remainingCredits={0}
      />
    );

    expect(screen.getByText(/You don't have credits to publish the RFQ in Mode 3/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Diamond Plan/i).length).toBeGreaterThan(0);
  });

  it('allows toggling between 12 months and 6 months billing durations', async () => {
    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_1"
      />
    );

    const sixMonthsBtn = screen.getByRole('button', { name: /6 Months Plan/i });
    fireEvent.click(sixMonthsBtn);

    await waitFor(() => {
      expect(screen.getByText(/Base Subscription \(6 Months\)/i)).toBeInTheDocument();
    });
  });

  it('calls createBuyerPaymentLink on proceed to pay', async () => {
    mockCreateBuyerPaymentLink.mockResolvedValue('https://checkout.zoho.in/procucev-silver-12m');

    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_1"
      />
    );

    const payBtn = screen.getByRole('button', { name: /Proceed to Pay/i });
    fireEvent.click(payBtn);

    await waitFor(() => {
      expect(mockCreateBuyerPaymentLink).toHaveBeenCalledWith('version_1', '12_months');
    });
  });

  it('triggers onSwitchToMode0 when buyer opts to use Mode 0 for free', () => {
    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_2"
        onSwitchToMode0={mockOnSwitchToMode0}
      />
    );

    const freeModeBtn = screen.getByRole('button', { name: /Publish in Mode 0 \(Free\)/i });
    fireEvent.click(freeModeBtn);

    expect(mockOnSwitchToMode0).toHaveBeenCalled();
  });
});
