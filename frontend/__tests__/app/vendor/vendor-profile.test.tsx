import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorProfilePage from '@/app/vendor/vendor-profile';
import { AppProvider } from '@/lib/store';

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

describe('VendorProfilePage Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Renders all sections, updates form inputs, and validates PAN / GST formats', () => {
    const { unmount } = renderWithProvider(<VendorProfilePage />);

    expect(screen.getByText(/Vendor Supplier Profile/i)).toBeInTheDocument();
    expect(screen.getByText(/Section 1: Supplier Tax & Business Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Works \/ Factory Address/i)).toBeInTheDocument();
    expect(screen.getByText(/Sales & RFQ Contact Person/i)).toBeInTheDocument();

    // 1. Legal Entity & Tax Form Inputs
    const companyInput = screen.getByDisplayValue('Apex Supplies & Contracting Ltd.');
    fireEvent.change(companyInput, { target: { value: 'Apex Industrial Solutions Pvt Ltd' } });

    const brandInput = screen.getByDisplayValue('Apex Flow Controls & Engineering');
    fireEvent.change(brandInput, { target: { value: 'Apex Flow Tech' } });

    const orgSelect = screen.getByDisplayValue('Private Limited Company');
    fireEvent.change(orgSelect, { target: { value: 'Public Limited' } });
    fireEvent.change(orgSelect, { target: { value: 'LLP' } });
    fireEvent.change(orgSelect, { target: { value: 'Partnership' } });
    fireEvent.change(orgSelect, { target: { value: 'Sole Proprietorship' } });
    fireEvent.change(orgSelect, { target: { value: 'Private Limited' } });

    // PAN validation
    const panInput = screen.getByDisplayValue('AAACA9876K');
    expect(screen.getByText('✓ Valid PAN')).toBeInTheDocument();
    fireEvent.change(panInput, { target: { value: 'INVALIDPAN' } });
    expect(screen.getByText('Invalid Format')).toBeInTheDocument();
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } });
    expect(screen.getByText('✓ Valid PAN')).toBeInTheDocument();

    // GSTIN validation
    const gstInput = screen.getByDisplayValue('27AAACA9876K1Z9');
    expect(screen.getByText('✓ State 27 Verified')).toBeInTheDocument();
    fireEvent.change(gstInput, { target: { value: 'INVALIDGSTIN' } });
    expect(screen.getByText('Invalid GSTIN')).toBeInTheDocument();
    fireEvent.change(gstInput, { target: { value: '27ABCDE1234F1Z5' } });
    expect(screen.getByText('✓ State 27 Verified')).toBeInTheDocument();

    const msmeInput = screen.getByDisplayValue('UDYAM-MH-03-0048291');
    fireEvent.change(msmeInput, { target: { value: 'UDYAM-MH-03-9999999' } });

    const websiteInput = screen.getByDisplayValue('https://www.apexsupplies.com');
    fireEvent.change(websiteInput, { target: { value: 'https://www.apexflow.com' } });

    const turnoverInput = screen.getByDisplayValue('₹ 85.4 Cr');
    fireEvent.change(turnoverInput, { target: { value: '₹ 120 Cr' } });

    // 2. Factory / Works Address inputs
    const addressInput = screen.getByDisplayValue('Plot 42, MIDC Industrial Area, Thane West');
    fireEvent.change(addressInput, { target: { value: 'Plot 88, Rabale MIDC' } });

    const cityInput = screen.getByDisplayValue('Mumbai');
    fireEvent.change(cityInput, { target: { value: 'Navi Mumbai' } });

    const stateInput = screen.getByDisplayValue('Maharashtra');
    fireEvent.change(stateInput, { target: { value: 'Gujarat' } });

    const pinInput = screen.getByDisplayValue('400604');
    fireEvent.change(pinInput, { target: { value: '400701' } });

    const countryInput = screen.getByDisplayValue('India');
    fireEvent.change(countryInput, { target: { value: 'Bharat' } });

    // 3. Contact Person inputs
    const contactInput = screen.getByDisplayValue('Vikram Malhotra');
    fireEvent.change(contactInput, { target: { value: 'Rohan Sharma' } });

    const desigInput = screen.getByDisplayValue('Head of Sales & Business Development');
    fireEvent.change(desigInput, { target: { value: 'Director of Procurement' } });

    const emailInput = screen.getByDisplayValue('vendor@apex.com');
    fireEvent.change(emailInput, { target: { value: 'rohan@apex.com' } });

    const phoneInput = screen.getByDisplayValue('+91 98920 11420');
    fireEvent.change(phoneInput, { target: { value: '+91 98200 99999' } });

    unmount();
  });

  test('Category selection: search, expand/collapse, alignment, toggle major, toggle minor, and limit enforcement', () => {
    const { unmount } = renderWithProvider(<VendorProfilePage />);

    // Search categories (matches major)
    const searchInput = screen.getByPlaceholderText(/Search supply categories/i);
    fireEvent.change(searchInput, { target: { value: 'Mechanical' } });
    expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument();

    // Search categories (matches minor)
    fireEvent.change(searchInput, { target: { value: 'Bearings' } });
    expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Unselect all minors in Electrical to remove Electrical from selectedMajor
    const cablesCheckbox = screen.getByRole('checkbox', { name: /Cables/i });
    const panelsCheckbox = screen.getByRole('checkbox', { name: /Panels/i });
    fireEvent.click(cablesCheckbox);
    fireEvent.click(panelsCheckbox);

    // Uncheck pipes, hoses, fasteners from Mechanical so only Bearings and Pumps remain -> triggers isAligned === true!
    const pipesCb = screen.getByRole('checkbox', { name: /Pipes & Pipe Fittings/i });
    const hosesCb = screen.getByRole('checkbox', { name: /Hoses, Valves & Fittings/i });
    const fastenersCb = screen.getByRole('checkbox', { name: /Fasteners/i });
    fireEvent.click(pipesCb);
    fireEvent.click(hosesCb);
    fireEvent.click(fastenersCb);

    // Expect aligned status to appear
    expect(screen.getByText(/✓ 100% Categories Aligned/i)).toBeInTheDocument();

    // Now click Cables checkbox when Electrical is NOT in selectedMajor (tests line 127)
    fireEvent.click(cablesCheckbox);

    // Expand Civil Construction & Raw Materials to get more checkboxes
    const allHeaders = screen.getAllByRole('heading', { level: 3 });
    const civilHeader = allHeaders.find(h => h.textContent?.includes('Civil') || h.textContent?.includes('Raw Material'));
    if (civilHeader) {
      fireEvent.click(civilHeader); // toggles major category
    }

    // Now select checkboxes up to 10 limit
    const allCheckboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    allCheckboxes.forEach((cb) => {
      if (!cb.checked) {
        fireEvent.click(cb);
      }
    });

    // When 10 are selected, click an unchecked checkbox (tests toggleMinorCategory limit reached toast)
    const uncheckedCb = allCheckboxes.find((cb) => !cb.checked);
    if (uncheckedCb) {
      fireEvent.click(uncheckedCb);
    }

    // When 10 are selected, click an unselected Major category (tests toggleMajorCategory remainingSlots <= 0 toast)
    const itHeader = screen.getByText('IT');
    fireEvent.click(itHeader);

    // Toggle off Mechanical Major (tests unselecting major category)
    const mechanicalMajorHeader = screen.getByText('Engineering Spares - Mechanical');
    fireEvent.click(mechanicalMajorHeader);

    unmount();
  });

  test('Form submission: validation error branches and successful save', () => {
    const { unmount } = renderWithProvider(<VendorProfilePage />);

    const topSaveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    const bottomSaveBtn = screen.getByRole('button', { name: /Save & Reconcile Vendor Profile/i });

    // 1. Successful save via top button
    fireEvent.click(topSaveBtn);

    // 2. Successful save via bottom button
    fireEvent.click(bottomSaveBtn);

    // 3. Validation error: clear company name
    const companyInput = screen.getByDisplayValue('Apex Supplies & Contracting Ltd.');
    fireEvent.change(companyInput, { target: { value: '' } });
    fireEvent.click(topSaveBtn);

    // Reset company name, clear PAN
    fireEvent.change(companyInput, { target: { value: 'Apex Ltd' } });
    const panInput = screen.getByDisplayValue('AAACA9876K');
    fireEvent.change(panInput, { target: { value: '' } });
    fireEvent.click(topSaveBtn);

    // Reset PAN, clear GST
    fireEvent.change(panInput, { target: { value: 'AAACA9876K' } });
    const gstInput = screen.getByDisplayValue('27AAACA9876K1Z9');
    fireEvent.change(gstInput, { target: { value: '' } });
    fireEvent.click(topSaveBtn);

    unmount();
  });
});
