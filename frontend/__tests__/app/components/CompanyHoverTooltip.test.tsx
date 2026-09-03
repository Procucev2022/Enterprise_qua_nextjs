import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');

describe('CompanyHoverTooltip', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders simple text for non-category_manager roles without hover tooltip', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
    });

    render(<CompanyHoverTooltip name="Tata Motors" type="buyer" />);
    expect(screen.getByText('Tata Motors')).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText('Tata Motors'));
    expect(screen.queryByText('Enterprise Buyer')).not.toBeInTheDocument();
  });

  it('shows "no contact details on file" instead of fabricating a contact when none is supplied', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    render(<CompanyHoverTooltip name="Reliance Industries" type="buyer" />);
    const trigger = screen.getByText('Reliance Industries');
    fireEvent.mouseEnter(trigger);

    expect(screen.getByText('No contact details on file for this company.')).toBeInTheDocument();
    expect(screen.getByText('Enterprise Buyer')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText('No contact details on file for this company.')).not.toBeInTheDocument();
  });

  it('renders the real contact the caller supplies, without a Verified badge when not marked verified', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    render(
      <CompanyHoverTooltip
        name="Apex Supplies Ltd."
        type="vendor"
        contact={{
          contactPerson: 'Real Contact Person',
          mobile: '+91 90000 00001',
          email: 'real.contact@apexsupplies.in',
        }}
      />
    );
    fireEvent.mouseEnter(screen.getByText('Apex Supplies Ltd.'));

    expect(screen.getByText('Real Contact Person')).toBeInTheDocument();
    expect(screen.getByText('+91 90000 00001')).toBeInTheDocument();
    expect(screen.getByText('real.contact@apexsupplies.in')).toBeInTheDocument();
    expect(screen.getByText('Supplier')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    // Optional fields not supplied are simply omitted, not fabricated.
    expect(screen.queryByText(/Key Account Manager/)).not.toBeInTheDocument();
  });

  it('shows the Verified badge only when the caller explicitly marks the contact verified', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    render(
      <CompanyHoverTooltip
        name="Verified Vendor Co"
        type="vendor"
        contact={{
          contactPerson: 'Verified Person',
          designation: 'Procurement Lead',
          location: 'Pune, Maharashtra',
          verified: true,
        }}
      />
    );
    fireEvent.mouseEnter(screen.getByText('Verified Vendor Co'));

    expect(screen.getByText('Verified Person')).toBeInTheDocument();
    expect(screen.getByText('Procurement Lead')).toBeInTheDocument();
    expect(screen.getByText('Pune, Maharashtra')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('falls back to a generic label and still avoids fabricating contact details for an empty name', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    render(
      <CompanyHoverTooltip name="" type="buyer">
        <span>EmptyBuyer</span>
      </CompanyHoverTooltip>
    );
    fireEvent.mouseEnter(screen.getByText('EmptyBuyer'));

    expect(screen.getByText('Enterprise Partner')).toBeInTheDocument();
    expect(screen.getByText('No contact details on file for this company.')).toBeInTheDocument();
  });
});
