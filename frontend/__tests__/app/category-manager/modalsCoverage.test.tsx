import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuyerDetailsModal from '@/app/category-manager/BuyerDetailsModal';
import VendorDetailsModal from '@/app/category-manager/VendorDetailsModal';
import * as storeModule from '@/lib/store';
import type { BuyerAccount, QuoteComparison, RFQAssignedVendor, RFQItem, VendorEntry } from '@/lib/types';

jest.mock('@/lib/store');

const mockBuyerAccount: BuyerAccount = {
  id: 'buyer-1',
  organizationName: 'Larsen & Toubro Limited',
  brandName: 'L&T Heavy Engineering',
  organizationType: 'Public Limited',
  corporateEmail: 'buyer@procucev.com',
  contactPerson: 'Rajesh Sharma',
  contactDesignation: 'Chief Procurement Officer',
  mobileNumber: '+919820144820',
  street: 'L&T House',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  gstin: '27AAACL1234F1Z5',
  panNumber: 'AAACL1234F',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://larsentoubro.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  categories: [{ major: 'Heavy Machinery', minor: 'Pumps' }] as any,
  sourcingMode: 'mode_1',
  subscriptionPlan: 'version_3',
  totalSpend: '₹12,40,000',
  remainingFreeRFQs: 10,
  totalRFQsCreated: 5,
} as any;

const mockVendor: VendorEntry = {
  id: 'v-1',
  name: 'Siemens Energy Ltd',
  contactPerson: 'Karan Mehra',
  phone: '+919811223344',
  email: 'karan@siemens.com',
  majorCategory: 'Electrical Supplies',
  minorCategories: ['Transformers', 'Switchgear'],
  location: 'Vadodara, Gujarat, India',
  rating: 4.9,
  source: 'buyer_manual',
  status: 'PREFERRED ENTERPRISE SUPPLIER',
  score: 95,
  gstin: '24AAAAA0000A1Z5',
};

const mockQuote: QuoteComparison = {
  vendorId: 'v-1',
  vendorName: 'Siemens Energy Ltd',
  vendorCategory: 'Client List',
  unitPrice: 50000,
  totalPrice: 150000,
  leadTimeDays: 14,
  aiMatchScore: 95,
  isBestPrice: true,
  warrantyYears: 2,
  complianceStatus: 'Fully Compliant',
  paymentTerms: 'Net 30 days',
  remarks: 'Includes on-site testing and commissioning',
  submittedAt: '2026-10-10T10:00:00Z',
};

const mockRfq: RFQItem = {
  id: 'rfq-101',
  rfqNumber: 'RFQ-2026-101',
  title: 'Heavy Duty Motors',
  category: 'Electrical Supplies',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 1,
  targetDeliveryDate: '2026-11-30',
  budget: 200000,
  chasingActive: false,
  createdAt: '2026-10-01T00:00:00Z',
  extractedEntities: [],
  quotes: [mockQuote],
  assignedVendors: [
    {
      id: 'v-1',
      name: 'Siemens Energy Ltd',
      contactPerson: 'Karan Mehra',
      email: 'karan@siemens.com',
      phone: '+919811223344',
      city: 'Vadodara',
    },
  ],
  buyerAccountName: 'Larsen & Toubro Limited',
  buyerAccountId: 'buyer-1',
  raisedByEmail: 'buyer@procucev.com',
};

describe('BuyerDetailsModal', () => {
  const originalClipboard = { ...navigator.clipboard };

  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      buyerAccounts: [mockBuyerAccount],
      buyerVendors: [mockVendor],
    });
    // mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
    // mock fetch for buyer profile API
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            companyName: 'Larsen & Toubro Limited',
            brandName: 'L&T Heavy Engineering',
            organizationType: 'Public Limited',
            contactName: 'Rajesh Sharma',
            contactDesignation: 'Chief Procurement Officer',
            contactEmail: 'buyer@procucev.com',
            contactPhone: '+919820144820',
            street: 'L&T House',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
            country: 'India',
            gstNumber: '27AAACL1234F1Z5',
            panNumber: 'AAACL1234F',
            cinNumber: 'L28920MH1946PLC004768',
            website: 'https://larsentoubro.com',
            annualTurnover: 'INR 1,80,000 Cr+',
            categories: [{ major: 'Heavy Machinery', minor: 'Pumps' }],
          },
        }),
    } as any);
  });

  afterAll(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  test('does not render anything when isOpen is false', () => {
    const { container } = render(
      <BuyerDetailsModal isOpen={false} onClose={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders full buyer profile with mandatory contact and location', async () => {
    const handleClose = jest.fn();
    render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={handleClose}
        buyerName="Larsen & Toubro Limited"
        buyerAccountId="buyer-1"
        rfq={mockRfq}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('Larsen & Toubro Limited')[0]).toBeInTheDocument();
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    expect(screen.getByText('buyer@procucev.com')).toBeInTheDocument();
    expect(screen.getByText('+919820144820')).toBeInTheDocument();
    expect(screen.getAllByText(/Mumbai, Maharashtra/i)[0]).toBeInTheDocument();
    expect(screen.getByText('27AAACL1234F1Z5')).toBeInTheDocument();
    expect(screen.getByText('AAACL1234F')).toBeInTheDocument();
    expect(screen.getByText('L28920MH1946PLC004768')).toBeInTheDocument();
    expect(screen.getByText('https://larsentoubro.com')).toBeInTheDocument();
    expect(screen.getByText('INR 1,80,000 Cr+')).toBeInTheDocument();
    expect(screen.getByText(/Heavy Machinery - Pumps/i)).toBeInTheDocument();

    // Copy buttons
    const copyButtons = screen.getAllByRole('button', { name: /Copy/i });
    if (copyButtons.length > 0) {
      fireEvent.click(copyButtons[0]);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    }

    // Close button
    const closeBtn = screen.getByRole('button', { name: /Close modal/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  test('handles backdrop click and escape key', async () => {
    const handleClose = jest.fn();
    const { container } = render(
      <BuyerDetailsModal isOpen={true} onClose={handleClose} />
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    const dialogBackdrop = container.querySelector('[role="dialog"]');
    if (dialogBackdrop) {
      fireEvent.click(dialogBackdrop);
      expect(handleClose).toHaveBeenCalledTimes(2);
    }
  });

  test('renders fallback data when profile fetch fails or returns empty', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        buyerName="Unknown Buyer"
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Unknown Buyer')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Mumbai/i)[0]).toBeInTheDocument();
  });

  test('matches account via buyerName, rfq.buyerAccountName, and rfq.raisedByEmail', async () => {
    // 1. Match by buyerName
    const { unmount: unmount1 } = render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        buyerName="Larsen & Toubro Limited"
      />
    );
    await waitFor(() => expect(screen.getAllByText('Larsen & Toubro Limited')[0]).toBeInTheDocument());
    unmount1();

    // 2. Match by rfq.buyerAccountName
    const { unmount: unmount2 } = render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        rfq={{ ...mockRfq, buyerAccountName: 'Larsen & Toubro Limited', buyerAccountId: undefined }}
      />
    );
    await waitFor(() => expect(screen.getAllByText('Larsen & Toubro Limited')[0]).toBeInTheDocument());
    unmount2();

    // 3. Match by rfq.raisedByEmail
    const { unmount: unmount3 } = render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        rfq={{ ...mockRfq, buyerAccountName: undefined, buyerAccountId: undefined, raisedByEmail: 'buyer@procucev.com' }}
      />
    );
    await waitFor(() => expect(screen.getAllByText('Larsen & Toubro Limited')[0]).toBeInTheDocument());
    unmount3();
  });

  test('clicks all copy buttons and footer close button in BuyerDetailsModal', async () => {
    const handleClose = jest.fn();
    render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={handleClose}
        buyerAccountId="buyer-1"
        rfq={mockRfq}
      />
    );

    await waitFor(() => expect(screen.getAllByText('Larsen & Toubro Limited')[0]).toBeInTheDocument());

    const emailCopy = screen.getByTitle('Copy Email');
    fireEvent.click(emailCopy);

    const phoneCopy = screen.getByTitle('Copy Phone Number');
    fireEvent.click(phoneCopy);

    const addressCopy = screen.getByTitle('Copy Full Location');
    fireEvent.click(addressCopy);

    const gstinCopy = screen.getByTitle('Copy GSTIN');
    fireEvent.click(gstinCopy);

    const panCopy = screen.getByTitle('Copy PAN');
    fireEvent.click(panCopy);

    const cinCopy = screen.getByTitle('Copy CIN');
    fireEvent.click(cinCopy);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(6);

    const footerClose = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(footerClose);
    expect(handleClose).toHaveBeenCalled();
  });

  test('resolves fallbacks from account when liveProfile fields are null', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            companyName: 'Larsen & Toubro Limited',
            brandName: 'Alternative Brand',
            contactName: null,
            contactPhone: null,
            street: null,
            city: null,
            state: null,
            pincode: null,
            gstin: null,
            panNumber: null,
            cinNumber: null,
            categories: null,
          },
        }),
    } as any);

    render(
      <BuyerDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        buyerAccountId="buyer-1"
        rfq={mockRfq}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Alternative Brand/i)).toBeInTheDocument();
    });
  });
});

describe('VendorDetailsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      buyerAccounts: [mockBuyerAccount],
      buyerVendors: [mockVendor],
    });
  });

  test('does not render when isOpen is false', () => {
    const { container } = render(
      <VendorDetailsModal isOpen={false} onClose={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders vendor quotation breakdown and mandatory details', () => {
    const handleClose = jest.fn();
    const handleMatrix = jest.fn();

    render(
      <VendorDetailsModal
        isOpen={true}
        onClose={handleClose}
        vendorName="Siemens Energy Ltd"
        vendorId="v-1"
        quote={mockQuote}
        rfq={mockRfq}
        onNavigateToMatrix={handleMatrix}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Siemens Energy Ltd')[0]).toBeInTheDocument();
    expect(screen.getByText('Karan Mehra')).toBeInTheDocument();
    expect(screen.getByText('karan@siemens.com')).toBeInTheDocument();
    expect(screen.getByText('+919811223344')).toBeInTheDocument();
    expect(screen.getAllByText(/Vadodara, Gujarat/i)[0]).toBeInTheDocument();
    expect(screen.getByText('24AAAAA0000A1Z5')).toBeInTheDocument();
    expect(screen.getByText(/L1 Best Price/i)).toBeInTheDocument();
    expect(screen.getByText(/Net 30 days/i)).toBeInTheDocument();

    // Check minor categories tags
    expect(screen.getByText('Transformers')).toBeInTheDocument();
    expect(screen.getByText('Switchgear')).toBeInTheDocument();

    // Matrix button
    const matrixBtn = screen.getByRole('button', { name: /View Comparative Matrix/i });
    fireEvent.click(matrixBtn);
    expect(handleClose).toHaveBeenCalled();
    expect(handleMatrix).toHaveBeenCalledWith(mockRfq);
  });

  test('clicks all copy buttons and footer close button in VendorDetailsModal', () => {
    const handleClose = jest.fn();
    render(
      <VendorDetailsModal
        isOpen={true}
        onClose={handleClose}
        vendorId="v-1"
        quote={mockQuote}
        rfq={mockRfq}
      />
    );

    const emailCopy = screen.getByTitle('Copy Email');
    fireEvent.click(emailCopy);

    const phoneCopy = screen.getByTitle('Copy Phone Number');
    fireEvent.click(phoneCopy);

    const locationCopy = screen.getByTitle('Copy Vendor Location');
    fireEvent.click(locationCopy);

    const gstinCopy = screen.getByTitle('Copy GSTIN');
    fireEvent.click(gstinCopy);

    const panCopy = screen.getByTitle('Copy PAN');
    fireEvent.click(panCopy);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(5);

    const footerClose = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(footerClose);
    expect(handleClose).toHaveBeenCalled();
  });

  test('matches vendor and quotes from rfq when quote prop is not passed directly', () => {
    render(
      <VendorDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        vendorId="v-1"
        rfq={mockRfq}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Siemens Energy Ltd')[0]).toBeInTheDocument();
    expect(screen.getByText(/Includes on-site testing and commissioning/i)).toBeInTheDocument();
  });

  test('matches vendor by directQuote vendorName and assignedVendor name', () => {
    const { unmount: unmount1 } = render(
      <VendorDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        quote={{ ...mockQuote, vendorId: undefined as any, vendorName: 'Siemens Energy Ltd' }}
      />
    );
    expect(screen.getAllByText('Siemens Energy Ltd')[0]).toBeInTheDocument();
    unmount1();

    const { unmount: unmount2 } = render(
      <VendorDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        assignedVendor={{ id: 'x-temp', name: 'Siemens Energy Ltd' }}
      />
    );
    expect(screen.getAllByText('Siemens Energy Ltd')[0]).toBeInTheDocument();
    unmount2();
  });

  test('renders vendor in uninvited state when no quote and not in assigned vendors', () => {
    render(
      <VendorDetailsModal
        isOpen={true}
        onClose={jest.fn()}
        vendorName="Siemens Energy Ltd"
        rfq={{ ...mockRfq, quotes: [], assignedVendors: [] }}
      />
    );

    expect(screen.getByText(/Empanelled vendor in this category. Has not submitted a quote for this RFQ yet./i)).toBeInTheDocument();
  });

  test('renders vendor in invited state when no quote has been submitted yet', () => {
    const handleClose = jest.fn();
    const assigned: RFQAssignedVendor = {
      id: 'v-new',
      name: 'ABB Power Grids',
      contactPerson: 'Suresh Patel',
      email: 'suresh@abb.com',
      phone: '+919876543210',
      city: 'Bengaluru',
    };

    render(
      <VendorDetailsModal
        isOpen={true}
        onClose={handleClose}
        vendorName="ABB Power Grids"
        assignedVendor={assigned}
        rfq={mockRfq}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('ABB Power Grids')[0]).toBeInTheDocument();
    expect(screen.getByText('Suresh Patel')).toBeInTheDocument();
    expect(screen.getByText('suresh@abb.com')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByText(/Invited to quote against this RFQ/i)).toBeInTheDocument();
  });

  test('handles backdrop click and escape key', () => {
    const handleClose = jest.fn();
    const { container } = render(
      <VendorDetailsModal isOpen={true} onClose={handleClose} />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    const dialogBackdrop = container.querySelector('[role="dialog"]');
    if (dialogBackdrop) {
      fireEvent.click(dialogBackdrop);
      expect(handleClose).toHaveBeenCalledTimes(2);
    }
  });
});
