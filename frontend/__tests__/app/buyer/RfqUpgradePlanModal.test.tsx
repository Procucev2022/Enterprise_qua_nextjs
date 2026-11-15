import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import RfqUpgradePlanModal from '@/app/buyer/RfqUpgradePlanModal';
import * as storeModule from '@/lib/store';
import { fetchSubscriptionPricing } from '@/lib/subscriptionPaymentClient';

jest.mock('@/lib/store');
jest.mock('@/lib/subscriptionPaymentClient', () => ({
  fetchSubscriptionPricing: jest.fn().mockResolvedValue({
    gstPercent: 18,
    gstRate: 0.18,
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

  it('calls createBuyerPaymentLink on proceed to pay once the server price has loaded', async () => {
    mockCreateBuyerPaymentLink.mockResolvedValue('https://checkout.zoho.in/procucev-silver-12m');

    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_1"
      />
    );

    const payBtn = await screen.findByRole('button', { name: /Proceed to Pay ₹70,785\.84/i });
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

  it('handles close buttons and remaining credits display', () => {
    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_1"
        remainingCredits={2}
      />
    );

    expect(screen.getByText(/Your free trial allocation \(2 remaining\) is exhausted/i)).toBeInTheDocument();

    const closeHeaderBtn = screen.getByRole('button', { name: /Close modal/i });
    fireEvent.click(closeHeaderBtn);
    expect(mockOnClose).toHaveBeenCalled();

    const cancelBtn = screen.getByRole('button', { name: /Cancel & Keep Editing/i });
    fireEvent.click(cancelBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it('handles unknown targetMode and displays payment initiation failure', async () => {
    mockCreateBuyerPaymentLink.mockResolvedValue(null);

    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode={'unknown_mode' as any}
        remainingCredits={0}
      />
    );

    expect(screen.getByText(/You don't have credits to publish the RFQ in unknown_mode/i)).toBeInTheDocument();

    const payBtn = await screen.findByRole('button', { name: /Proceed to Pay/i });
    fireEvent.click(payBtn);

    await waitFor(() => {
      expect(screen.getByText(/Could not initialize secure payment gateway/i)).toBeInTheDocument();
    });
  });

  it('handles payment link generation exception with fallback message', async () => {
    mockCreateBuyerPaymentLink.mockRejectedValue(new Error('Network payment timeout'));

    render(
      <RfqUpgradePlanModal
        isOpen={true}
        onClose={mockOnClose}
        targetMode="mode_1"
      />
    );

    const payBtn = await screen.findByRole('button', { name: /Proceed to Pay/i });
    fireEvent.click(payBtn);

    await waitFor(() => {
      expect(screen.getByText(/Network payment timeout/i)).toBeInTheDocument();
    });

    // Test rejection with non-Error or empty message to hit fallback
    mockCreateBuyerPaymentLink.mockRejectedValueOnce({});
    fireEvent.click(payBtn);
    await waitFor(() => {
      expect(screen.getByText(/Payment initiation failed\. Please try again\./i)).toBeInTheDocument();
    });
  });

  it('shows the server-priced amount, server GST rate, and computed saving, with no strike-through', async () => {
    const { container } = render(
      <RfqUpgradePlanModal isOpen={true} onClose={mockOnClose} targetMode="mode_1" />
    );

    expect(await screen.findByText('₹4,999')).toBeInTheDocument();
    expect(screen.getByText('₹70,785.84')).toBeInTheDocument();
    expect(screen.getByText('Applicable GST (18%)')).toBeInTheDocument();
    expect(screen.getByText('Save 9%')).toBeInTheDocument();
    expect(container.querySelector('.line-through')).toBeNull();
    expect(screen.queryByText('₹50,000')).not.toBeInTheDocument();
  });

  it('shows an explicit unavailable state and disables payment when the server returns no pricing', async () => {
    (fetchSubscriptionPricing as jest.Mock).mockResolvedValueOnce(null);

    render(<RfqUpgradePlanModal isOpen={true} onClose={mockOnClose} targetMode="mode_1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Plan prices could not be loaded from the server');
    const payBtn = screen.getByRole('button', { name: 'Price unavailable' });
    expect(payBtn).toBeDisabled();
    fireEvent.click(payBtn);
    expect(mockCreateBuyerPaymentLink).not.toHaveBeenCalled();
    expect(screen.getByText('Total Amount to Upgrade').parentElement).toHaveTextContent('—');
    expect(screen.queryByText('₹4,999')).not.toBeInTheDocument();
  });
});



describe('RfqUpgradePlanModal: billing toggle, default target and pricing lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      createBuyerPaymentLink: jest.fn(),
      showToast: jest.fn(),
    });
  });

  it('returns to the 12-month plan after the 6-month plan was chosen', async () => {
    render(<RfqUpgradePlanModal isOpen={true} onClose={jest.fn()} targetMode="mode_1" />);
    // Waits for the server price so the pricing request has settled inside the test.
    await screen.findByText(/\/ month/);

    fireEvent.click(screen.getByRole('button', { name: /6 Months Plan/i }));
    await waitFor(() => expect(screen.getByText(/Base Subscription \(6 Months\)/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /12 Months Plan/i }));
    await waitFor(() => expect(screen.getByText(/Base Subscription \(12 Months\)/i)).toBeInTheDocument());
  });

  it('targets Mode 1 when no target mode is passed', async () => {
    render(<RfqUpgradePlanModal isOpen={true} onClose={jest.fn()} />);
    await screen.findByText(/\/ month/);

    expect(screen.getByText(/publish the RFQ in Mode 1\./)).toBeInTheDocument();
  });

  it('ignores a pricing reply that arrives after the dialog has unmounted', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolvePricing: (value: unknown) => void = () => undefined;
    (fetchSubscriptionPricing as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePricing = resolve;
      })
    );

    const { unmount } = render(<RfqUpgradePlanModal isOpen={true} onClose={jest.fn()} targetMode="mode_1" />);
    unmount();

    await act(async () => {
      resolvePricing({ buyer: { version_1: { '12_months': { price: 4999 } } } });
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
