import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/buyer-profile.tsx', () => {
  const mockAddAuditLog = jest.fn();
  const mockShowToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
    });
  });

  it('renders correctly with organization, address, contact, and category sections', () => {
    render(<BuyerProfilePage />);
    expect(screen.getByText('Buyer Organization Profile')).toBeInTheDocument();
    expect(screen.getByText(/Section 1: Organization & Tax Registration/i)).toBeInTheDocument();
    expect(screen.getByText(/Key Procurement Contact Person/i)).toBeInTheDocument();
    expect(screen.getByText(/Section 3: Relevant Procurement Categories/i)).toBeInTheDocument();
  });

  it('handles input changes across all form sections including orgType select', () => {
    render(<BuyerProfilePage />);

    // Section 1: Org Details
    const companyInput = screen.getByDisplayValue('Larsen & Toubro Limited');
    fireEvent.change(companyInput, { target: { value: 'L&T Heavy Infra' } });

    const brandInput = screen.getByDisplayValue('L&T Heavy Engineering & Construction');
    fireEvent.change(brandInput, { target: { value: 'L&T Power & Defense' } });

    const orgTypeSelect = screen.getByDisplayValue('Public Limited Company');
    fireEvent.change(orgTypeSelect, { target: { value: 'Private Limited' } });

    const panInput = screen.getByDisplayValue('AAACL1234F');
    fireEvent.change(panInput, { target: { value: 'BBBCL1234F' } });

    const gstInput = screen.getByDisplayValue('27AAACL1234F1Z5');
    fireEvent.change(gstInput, { target: { value: '27BBBCL1234F1Z5' } });

    const cinInput = screen.getByDisplayValue('L28920MH1946PLC004768');
    fireEvent.change(cinInput, { target: { value: 'L12345MH1946PLC000000' } });

    const websiteInput = screen.getByDisplayValue('https://www.larsentoubro.com');
    fireEvent.change(websiteInput, { target: { value: 'https://www.ltpower.com' } });

    const turnoverInput = screen.getByDisplayValue('₹ 1,80,000 Cr+');
    fireEvent.change(turnoverInput, { target: { value: '₹ 2,00,000 Cr+' } });

    // Section 2: Address
    const streetInput = screen.getByDisplayValue('L&T House, Ballard Estate, N.M. Marg');
    fireEvent.change(streetInput, { target: { value: 'Powai Campus, Gate 1' } });

    const cityInput = screen.getByDisplayValue('Mumbai');
    fireEvent.change(cityInput, { target: { value: 'Navi Mumbai' } });

    const stateInput = screen.getByDisplayValue('Maharashtra');
    fireEvent.change(stateInput, { target: { value: 'Gujarat' } });

    const pinInput = screen.getByDisplayValue('400001');
    fireEvent.change(pinInput, { target: { value: '400076' } });

    const countryInput = screen.getByDisplayValue('India');
    fireEvent.change(countryInput, { target: { value: 'India' } });

    // Section 3: Contact Person
    const contactNameInput = screen.getByDisplayValue('Rajesh Sharma');
    fireEvent.change(contactNameInput, { target: { value: 'Vikram Malhotra' } });

    const desigInput = screen.getByDisplayValue('Chief Procurement Officer (CPO)');
    fireEvent.change(desigInput, { target: { value: 'VP Supply Chain' } });

    const emailInput = screen.getByDisplayValue('buyer@procucev.com');
    fireEvent.change(emailInput, { target: { value: 'vikram@lnt.com' } });

    const phoneInput = screen.getByDisplayValue('+91 98201 44820');
    fireEvent.change(phoneInput, { target: { value: '+91 98201 99999' } });
  });

  it('handles category interactions: search, expand/collapse, major toggle, minor toggle, select all, clear all', () => {
    render(<BuyerProfilePage />);

    // Search categories
    const searchInput = screen.getByPlaceholderText(/Search across all 13 Major/i);
    fireEvent.change(searchInput, { target: { value: 'Civil' } });
    expect(screen.getByText('Civil Works')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Click major category title to toggle on/off
    fireEvent.click(screen.getByText('Civil Works'));
    fireEvent.click(screen.getByText('Civil Works'));

    // Toggle minor category inside Civil Works
    const pilingLabel = screen.getByText('Piling');
    fireEvent.click(pilingLabel);
    fireEvent.click(pilingLabel);

    // Select All and Clear inside Civil Works
    const selectAllBtns = screen.getAllByText('Select All');
    fireEvent.click(selectAllBtns[0]);

    const clearBtns = screen.getAllByText('Clear');
    fireEvent.click(clearBtns[0]);

    // Now Civil Works is unselected. Click Piling (tests line 102: !selectedMajor.includes(majorName))
    fireEvent.click(pilingLabel);

    // Click Piling again to deselect the last minor item (tests line 117: updated.length === 0)
    fireEvent.click(pilingLabel);

    // Click Select All on unselected Civil Works (tests line 125: !selectedMajor.includes(majorName))
    fireEvent.click(selectAllBtns[0]);

    // Toggle expand/collapse of major accordion
    const chevronBtns = screen.getAllByRole('button');
    const chevBtn = chevronBtns.find((b) => b.querySelector('svg.lucide-chevron-down'));
    if (chevBtn) {
      fireEvent.click(chevBtn);
      fireEvent.click(chevBtn);
    }
  });

  it('handles save profile submission and validation errors', () => {
    render(<BuyerProfilePage />);

    // Successful save
    fireEvent.click(screen.getByText('Save Organization Profile'));
    expect(mockAddAuditLog).toHaveBeenCalledWith(expect.stringContaining('Larsen & Toubro Limited'));
    expect(mockShowToast).toHaveBeenCalledWith('Profile Saved Successfully', expect.any(String), 'success');

    // Validation error when companyName is empty
    const companyInput = screen.getByDisplayValue('Larsen & Toubro Limited');
    fireEvent.change(companyInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save Organization Profile'));
    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', expect.any(String), 'warning');
  });
});
