import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VendorRatingRevisionModal from '@/app/components/VendorRatingRevisionModal';
import * as storeModule from '@/lib/store';
import { VendorRatingRevisionEmailPayload } from '@/lib/types';

jest.mock('@/lib/store');

describe('VendorRatingRevisionModal', () => {
  const mockSetRatingRevisionEmailModalOpen = jest.fn();
  const mockShowToast = jest.fn();

  const sampleRevisionEmail: VendorRatingRevisionEmailPayload = {
    vendorName: 'Apex Industrial Dynamics Pvt Ltd',
    vendorContactPerson: 'Rajesh Nair',
    vendorEmail: 'rajesh@apexindustrial.in',
    buyerCompany: 'Tata Motors Commercial Vehicles Ltd.',
    buyerContactName: 'Vikram Malhotra',
    buyerContactEmail: 'sourcing.commercial@tatamotors.com',
    qualityScore: 95,
    costScore: 90,
    deliveryScore: 92,
    buyerAverage: 92.3,
    previousScore: 88.0,
    newCompositeScore: 90.2,
    newRating: 4.5,
    remarks: 'Outstanding delivery on recent slurry pumps batch.',
    shaSignature: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    dispatchedAt: '2026-08-29 11:30 UTC',
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when modal is closed or payload is null', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedRatingRevisionEmail: null,
      ratingRevisionEmailModalOpen: false,
      setRatingRevisionEmailModalOpen: mockSetRatingRevisionEmailModalOpen,
      showToast: mockShowToast,
    });

    const { container } = render(<VendorRatingRevisionModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders vendor rating revision details when open and allows closing from header X and done button', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedRatingRevisionEmail: sampleRevisionEmail,
      ratingRevisionEmailModalOpen: true,
      setRatingRevisionEmailModalOpen: mockSetRatingRevisionEmailModalOpen,
      showToast: mockShowToast,
    });

    render(<VendorRatingRevisionModal />);

    expect(screen.getByText('Vendor Rating Revision Email Notification')).toBeInTheDocument();
    expect(screen.getByText(/Outstanding delivery on recent slurry pumps batch/)).toBeInTheDocument();
    expect(screen.getByText('95 / 100')).toBeInTheDocument();
    expect(screen.getByText('90 / 100')).toBeInTheDocument();
    expect(screen.getByText('92 / 100')).toBeInTheDocument();

    const topXBtn = screen.getAllByRole('button')[0];
    fireEvent.click(topXBtn);
    expect(mockSetRatingRevisionEmailModalOpen).toHaveBeenCalledWith(false);

    const closeBtn = screen.getByText('Done / Close Preview');
    fireEvent.click(closeBtn);
    expect(mockSetRatingRevisionEmailModalOpen).toHaveBeenCalledWith(false);
  });

  it('handles copy email text to clipboard with timer reset', () => {
    jest.useFakeTimers();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedRatingRevisionEmail: sampleRevisionEmail,
      ratingRevisionEmailModalOpen: true,
      setRatingRevisionEmailModalOpen: mockSetRatingRevisionEmailModalOpen,
      showToast: mockShowToast,
    });

    render(<VendorRatingRevisionModal />);

    const copyBtn = screen.getByText(/Copy Email Text/);
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Copied to Clipboard', expect.any(String), 'success');

    act(() => {
      jest.advanceTimersByTime(2600);
    });
    jest.useRealTimers();
  });

  it('handles print action with iframe and fallback', () => {
    jest.useFakeTimers();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedRatingRevisionEmail: sampleRevisionEmail,
      ratingRevisionEmailModalOpen: true,
      setRatingRevisionEmailModalOpen: mockSetRatingRevisionEmailModalOpen,
      showToast: mockShowToast,
    });

    window.print = jest.fn();

    render(<VendorRatingRevisionModal />);

    const printBtn = screen.getByText(/Print/);
    fireEvent.click(printBtn);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Fallback branch when printable element missing
    const origGetElementById = document.getElementById;
    document.getElementById = jest.fn().mockReturnValue(null);
    fireEvent.click(printBtn);
    expect(window.print).toHaveBeenCalled();
    document.getElementById = origGetElementById;

    jest.useRealTimers();
  });
});
