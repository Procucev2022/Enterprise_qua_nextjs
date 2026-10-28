import { fireEvent, render, screen } from '@testing-library/react';
import VendorDetailsModal from '@/app/category-manager/VendorDetailsModal';
import { useApp } from '@/lib/store';
import type { QuoteComparison, RFQAssignedVendor, RFQItem, VendorEntry } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));

const vendor: VendorEntry = {
  id: 'directory-vendor', name: 'Resolution Supplies', contactPerson: 'Directory Contact',
  email: 'directory@example.com', phone: '9876543210', majorCategory: 'Electrical',
  minorCategories: [], location: 'Pune', rating: 4.5, source: 'procucev_network',
};
const assigned: RFQAssignedVendor = {
  id: vendor.id, name: vendor.name, contactPerson: 'Invited Contact',
  email: 'invite@example.com', phone: '9123456780', city: 'Chennai',
};
const quote: QuoteComparison = {
  vendorId: vendor.id, vendorName: vendor.name, vendorCategory: 'Client List',
  unitPrice: 100, totalPrice: 1000, leadTimeDays: 5, aiMatchScore: 95,
  warrantyYears: 0, paymentTerms: '', complianceStatus: 'Fully Compliant', remarks: 'Resolution quotation details',
};
const rfq: RFQItem = {
  id: 'resolution-rfq', rfqNumber: 'RFQ-RESOLUTION', title: 'Electrical equipment',
  category: 'Electrical', sourcingMode: 'mode_1', status: 'Quotes Pending',
  quotesCount: 1, targetDeliveryDate: '2026-12-01', budget: 1000,
  createdAt: '2026-10-01', chasingActive: false, extractedEntities: [],
  quotes: [quote], assignedVendors: [assigned],
};

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({ buyerVendors: [] });
});

describe('VendorDetailsModal record resolution', () => {
  test.each([
    { vendorId: vendor.id },
    { quote },
    { vendorName: `  ${vendor.name.toUpperCase()}  ` },
    { quote: { ...quote, vendorId: 'different-id' } },
    { assignedVendor: { ...assigned, id: 'different-id' } },
  ])('matches directory details through each supported identity: %j', (identity) => {
    (useApp as jest.Mock).mockReturnValue({ buyerVendors: [{ ...vendor, id: 'unrelated', name: 'Unrelated' }, vendor] });
    render(<VendorDetailsModal isOpen onClose={jest.fn()} {...identity} />);
    expect(screen.getByText(vendor.email)).toBeInTheDocument();
    expect(screen.getByText(vendor.contactPerson)).toBeInTheDocument();
  });

  test.each([
    { vendorId: assigned.id },
    { quote },
    { vendorName: ` ${assigned.name.toUpperCase()} ` },
    { quote: { ...quote, vendorId: 'different-id' } },
  ])('recovers contact details from the invite list through each supported identity: %j', (identity) => {
    render(<VendorDetailsModal isOpen onClose={jest.fn()} {...identity}
      rfq={{ ...rfq, assignedVendors: [{ id: 'unrelated', name: 'Unrelated' }, assigned] }} />);
    expect(screen.getByText(assigned.email || '')).toBeInTheDocument();
    expect(screen.getByText(assigned.contactPerson || '')).toBeInTheDocument();
    expect(screen.getByText(assigned.city || '')).toBeInTheDocument();
  });

  test('uses the matched directory identifier to resolve an invite with a different display name', () => {
    (useApp as jest.Mock).mockReturnValue({ buyerVendors: [vendor] });
    render(<VendorDetailsModal isOpen onClose={jest.fn()} vendorName={vendor.name}
      rfq={{ ...rfq, assignedVendors: [{ ...assigned, name: 'Legacy trading name' }] }} />);
    expect(screen.getByText(vendor.email)).toBeInTheDocument();
    expect(screen.getByText(/Resolution quotation details/)).toBeInTheDocument();
  });

  test('matches legacy invite and quote names when their identifiers differ from the directory record', () => {
    (useApp as jest.Mock).mockReturnValue({ buyerVendors: [{ ...vendor, email: '', phone: '', location: '' }] });
    render(<VendorDetailsModal isOpen onClose={jest.fn()} vendorId={vendor.id}
      rfq={{ ...rfq,
        assignedVendors: [{ id: 'unrelated', name: 'Unrelated' }, { ...assigned, id: 'legacy-invite' }],
        quotes: [{ ...quote, vendorId: 'unrelated', vendorName: 'Unrelated' }, { ...quote, vendorId: 'legacy-quote' }],
      }} />);
    expect(screen.getByText(assigned.email || '')).toBeInTheDocument();
    expect(screen.getByText(/Resolution quotation details/)).toBeInTheDocument();
  });

  test.each([
    { vendorId: quote.vendorId },
    { vendorName: ` ${quote.vendorName.toUpperCase()} ` },
    { assignedVendor: { ...assigned, id: 'legacy-invite' } },
  ])('resolves a quotation without a direct quote prop: %j', (identity) => {
    render(<VendorDetailsModal isOpen onClose={jest.fn()} {...identity}
      rfq={{ ...rfq, quotes: [{ ...quote, vendorId: 'unrelated', vendorName: 'Unrelated' }, quote] }} />);
    expect(screen.getByText(/Resolution quotation details/)).toBeInTheDocument();
  });

  test('derives contact designation, mobile and tax identifiers from legacy directory fields', () => {
    const legacy = { ...vendor, phone: '', source: 'buyer_manual', gst: '27ABCDE1234F1Z5', pan: 'CUSTOMPAN1', mobile: '9000012345' };
    (useApp as jest.Mock).mockReturnValue({ buyerVendors: [legacy] });
    render(<VendorDetailsModal isOpen onClose={jest.fn()} vendorId={legacy.id} />);
    expect(screen.getByText(legacy.mobile)).toBeInTheDocument();
    expect(screen.getByText(legacy.gst)).toBeInTheDocument();
    expect(screen.getByText(legacy.pan)).toBeInTheDocument();
  });

  test('renders when the store is unavailable and closes only on Escape or backdrop clicks', () => {
    (useApp as jest.Mock).mockReturnValue(undefined);
    const onClose = jest.fn();
    render(<VendorDetailsModal isOpen onClose={onClose} vendorName={vendor.name}
      rfq={{ ...rfq, assignedVendors: [], quotes: [], deliveryLocation: 'Hyderabad, Telangana' }} />);
    expect(screen.getByText('Hyderabad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('heading', { name: vendor.name }));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
