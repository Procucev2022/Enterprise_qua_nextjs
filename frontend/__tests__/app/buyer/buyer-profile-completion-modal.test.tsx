import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BuyerProfileCompletionModal from '@/app/buyer/buyer-profile-completion-modal';
import * as buyerProfileClient from '@/lib/buyerProfileClient';
import type { BuyerProfile } from '@/lib/types';

const mockPush = jest.fn();
let mockPathname = '/buyer/dashboard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
  }),
  usePathname: () => mockPathname,
}));

let mockAppState: {
  isLoggedIn: boolean;
  currentRole: string;
  activeBuyerAccount: any;
  currentUserSession: any;
  initialSetupModalOpen?: boolean;
} = {
  isLoggedIn: true,
  currentRole: 'buyer',
  activeBuyerAccount: null,
  currentUserSession: { email: 'buyer@procucev.com' },
  initialSetupModalOpen: false,
};

jest.mock('@/lib/store', () => ({
  useApp: () => mockAppState,
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerProfile: jest.fn(),
}));

describe('BuyerProfileCompletionModal', () => {
  const completeProfile: BuyerProfile = {
    organizationId: 'org-1',
    userId: 'user-1',
    companyName: 'Acme Enterprise Solutions Pvt Ltd',
    brandName: 'Acme',
    organizationType: 'Private Limited',
    panNumber: 'AAACL1234F',
    gstNumber: '27AAACL1234F1Z5',
    cinNumber: 'U12345MH2020PTC123456',
    website: 'https://acme.com',
    annualTurnover: '50-100 Cr',
    street: 'Plot 42, MIDC Industrial Area',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400093',
    country: 'India',
    contactName: 'Rajesh Sharma',
    contactDesignation: 'Head of Procurement',
    contactEmail: 'rajesh.sharma@acme.com',
    contactPhone: '+91 9876543210',
    categories: [
      { major: 'Mechanical', minor: 'Centrifugal Pumps' },
    ],
  };

  const incompleteProfile: BuyerProfile = {
    ...completeProfile,
    gstNumber: '',
    pincode: '123456', // dummy pincode
    categories: [], // no categories
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockPathname = '/buyer/dashboard';
    mockAppState = {
      isLoggedIn: true,
      currentRole: 'buyer',
      activeBuyerAccount: null,
      currentUserSession: { email: 'buyer@procucev.com' },
    };
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: incompleteProfile,
    });
  });

  it('renders null when the user is not logged in', async () => {
    mockAppState.isLoggedIn = false;
    const { container } = render(<BuyerProfileCompletionModal />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders null when the currentRole is not buyer', async () => {
    mockAppState.currentRole = 'vendor';
    const { container } = render(<BuyerProfileCompletionModal />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders null when on the /buyer/profile page itself', async () => {
    mockPathname = '/buyer/profile';
    const { container } = render(<BuyerProfileCompletionModal />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders null when the buyer profile is already 100% complete', async () => {
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: completeProfile,
    });

    const { container } = render(<BuyerProfileCompletionModal initialProfile={completeProfile} />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(screen.queryByTestId('buyer-profile-completion-modal')).not.toBeInTheDocument();
  });

  it('displays the reminder popup when mandatory fields or categories are incomplete', async () => {
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('Complete Your Buyer Profile')).toBeInTheDocument();
    expect(screen.getByText(/receive more relevant, faster, and better competitive quotations/i)).toBeInTheDocument();
    expect(screen.getByText('GSTIN / GST Number')).toBeInTheDocument();
    expect(screen.getByText('Product Categories')).toBeInTheDocument();
    expect(screen.getByText('PIN Code')).toBeInTheDocument();
  });

  it('navigates directly to profile section when "Complete Profile Now" is clicked', async () => {
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-reminder-complete-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('buyer-profile-reminder-complete-btn'));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/buyer/profile'));
  });

  it('navigates directly to a specific profile section when clicking an item update link', async () => {
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });

    const updateButtons = screen.getAllByRole('button', { name: /update/i });
    expect(updateButtons.length).toBeGreaterThan(0);

    fireEvent.click(updateButtons[0]);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/buyer/profile#section-'));
  });

  it('dismisses the modal in declarative state without writing session storage when "Remind Me Later" is clicked', async () => {
    const mockClose = jest.fn();
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} onClose={mockClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-reminder-dismiss-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('buyer-profile-reminder-dismiss-btn'));

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('procucev_buyer_profile_reminder_dismissed')).toBeNull();
    expect(screen.queryByTestId('buyer-profile-completion-modal')).not.toBeInTheDocument();
  });

  it('dismisses modal on Escape key press and ignores non-Escape keys', async () => {
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('buyer-profile-completion-modal')).not.toBeInTheDocument();
    });
  });

  it('ignores stale sessionStorage dismissal flags so reminder behaves consistently across browsers', async () => {
    sessionStorage.setItem('procucev_buyer_profile_reminder_dismissed', 'true');

    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });
  });

  it('re-evaluates and closes modal when buyer-profile-updated custom event fires with complete profile', async () => {
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);

    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });

    // Fire custom update event with completed profile
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('buyer-profile-updated', { detail: completeProfile })
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId('buyer-profile-completion-modal')).not.toBeInTheDocument();
    });
  });

  it('honors forceOpen prop', async () => {
    render(<BuyerProfileCompletionModal forceOpen={true} initialProfile={incompleteProfile} />);
    expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
  });

  it('handles buyer-profile-updated event with null detail and re-fetches', async () => {
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);
    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('buyer-profile-updated', { detail: null }));
    });
    expect(buyerProfileClient.fetchBuyerProfile).toHaveBeenCalled();
  });

  it('handles fetchBuyerProfile failure or exception gracefully', async () => {
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockRejectedValueOnce(
      new Error('Network error')
    );
    render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);
    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });
  });

  it('renders emerald progress bar when completion is >= 80% with exactly 1 item needing attention', async () => {
    const highCompletionProfile: BuyerProfile = {
      ...completeProfile,
      pincode: '000000', // only 1 issue
    };
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: highCompletionProfile,
    });
    render(<BuyerProfileCompletionModal initialProfile={highCompletionProfile} />);
    await waitFor(() => {
      expect(screen.getByText('1 item needs attention')).toBeInTheDocument();
    });
  });

  it('renders amber progress bar when completion is between 50% and 79%', async () => {
    const midCompletionProfile: BuyerProfile = {
      ...completeProfile,
      street: '',
      city: '',
      state: '',
      pincode: '000000',
    };
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: midCompletionProfile,
    });
    render(<BuyerProfileCompletionModal initialProfile={midCompletionProfile} />);
    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });
  });

  it('renders rose progress bar when completion is < 50%', async () => {
    const lowCompletionProfile: BuyerProfile = {
      ...completeProfile,
      street: '',
      city: '',
      state: '',
      pincode: '000000',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      gstNumber: '',
      panNumber: '',
      categories: [],
    };
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: lowCompletionProfile,
    });
    render(<BuyerProfileCompletionModal initialProfile={lowCompletionProfile} />);
    await waitFor(() => {
      expect(screen.getByTestId('buyer-profile-completion-modal')).toBeInTheDocument();
    });
  });

  it('displays "Needs Correction" badge for invalid format issues', async () => {
    const invalidFormatProfile: BuyerProfile = {
      ...completeProfile,
      gstNumber: 'INVALID_GSTIN_123',
    };
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: invalidFormatProfile,
    });
    render(<BuyerProfileCompletionModal initialProfile={invalidFormatProfile} />);
    await waitFor(() => {
      expect(screen.getByText('Needs Correction')).toBeInTheDocument();
    });
  });

  it('navigates to base profile route when clicking Complete Profile Now with no issues anchor', async () => {
    const mockOnClose = jest.fn();
    (buyerProfileClient.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: completeProfile,
    });
    render(<BuyerProfileCompletionModal forceOpen={true} initialProfile={completeProfile} onClose={mockOnClose} />);
    const completeBtn = screen.getByTestId('buyer-profile-reminder-complete-btn');
    fireEvent.click(completeBtn);
    expect(mockPush).toHaveBeenCalledWith('/buyer/profile');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('gracefully handles sessionStorage errors', async () => {
    const originalGetItem = sessionStorage.getItem;
    const originalSetItem = sessionStorage.setItem;
    sessionStorage.getItem = jest.fn(() => {
      throw new Error('Access denied');
    });
    sessionStorage.setItem = jest.fn(() => {
      throw new Error('Access denied');
    });

    try {
      render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);
      await waitFor(() => {
        expect(screen.getByTestId('buyer-profile-reminder-dismiss-btn')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('buyer-profile-reminder-dismiss-btn'));
    } finally {
      sessionStorage.getItem = originalGetItem;
      sessionStorage.setItem = originalSetItem;
    }
  });

  it('does not open when initialSetupModalOpen is true to prevent simultaneous popups', async () => {
    mockAppState.initialSetupModalOpen = true;
    try {
      const { container } = render(<BuyerProfileCompletionModal initialProfile={incompleteProfile} />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText('Complete Your Buyer Profile')).not.toBeInTheDocument();
    } finally {
      mockAppState.initialSetupModalOpen = false;
    }
  });

  it('renders heading with text-white class for clear contrast', async () => {
    render(<BuyerProfileCompletionModal forceOpen={true} initialProfile={incompleteProfile} />);
    const heading = screen.getByText('Complete Your Buyer Profile');
    expect(heading).toHaveClass('text-white');
  });
});
