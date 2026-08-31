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

  it('renders hover card with all known buyer contacts in DB on mouse enter for category_manager', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    const buyers = [
      { name: 'Larsen & Toubro Ltd.', contact: 'Rajesh Sharma' },
      { name: 'Tata Projects Ltd.', contact: 'Vikram Malhotra' },
      { name: 'Reliance Industries', contact: 'Anil Deshmukh' },
      { name: 'Shapoorji Pallonji', contact: 'Sandeep Varma' },
    ];

    buyers.forEach((b) => {
      const { unmount } = render(<CompanyHoverTooltip name={b.name} type="buyer" />);
      const trigger = screen.getByText(b.name);
      fireEvent.mouseEnter(trigger);
      expect(screen.getByText(b.contact)).toBeInTheDocument();
      expect(screen.getByText('Enterprise Buyer')).toBeInTheDocument();
      fireEvent.mouseLeave(trigger);
      unmount();
    });
  });

  it('renders hover card with all known vendor contacts in DB on mouse enter for category_manager', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    const vendors = [
      { name: 'Apex Supplies Ltd.', contact: 'Srinivas Rao' },
      { name: 'WPIL Pumps Ltd.', contact: 'Amitabh Sen' },
      { name: 'Kirloskar Brothers', contact: 'Milind Kulkarni' },
      { name: 'Havells Switchgear', contact: 'Rohan Kapoor' },
    ];

    vendors.forEach((v) => {
      const { unmount } = render(<CompanyHoverTooltip name={v.name} type="vendor" />);
      const trigger = screen.getByText(v.name);
      fireEvent.mouseEnter(trigger);
      expect(screen.getByText(v.contact)).toBeInTheDocument();
      expect(screen.getByText('Verified Supplier')).toBeInTheDocument();
      fireEvent.mouseLeave(trigger);
      unmount();
    });
  });

  it('generates fallback deterministic contact for unknown buyer and vendor and special characters and empty names', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'category_manager',
    });

    // Unknown buyer with children
    const { unmount } = render(
      <CompanyHoverTooltip name="Unknown Global Energy Corp" type="buyer">
        <span>Custom Child Element</span>
      </CompanyHoverTooltip>
    );

    const trigger = screen.getByText('Custom Child Element');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText('Enterprise Buyer')).toBeInTheDocument();
    expect(screen.getByText('Lead Procurement Manager')).toBeInTheDocument();
    unmount();

    // Unknown vendor without children
    const { unmount: unmount2 } = render(<CompanyHoverTooltip name="Custom Dynamics Ltd" type="vendor" />);
    const customTrigger = screen.getByText('Custom Dynamics Ltd');
    fireEvent.mouseEnter(customTrigger);
    expect(screen.getByText('Verified Supplier')).toBeInTheDocument();
    unmount2();

    // Unknown buyer without children
    const { unmount: unmount3 } = render(<CompanyHoverTooltip name="Beta Corp Sourcing" type="buyer" />);
    const betaTrigger = screen.getByText('Beta Corp Sourcing');
    fireEvent.mouseEnter(betaTrigger);
    expect(screen.getByText('Enterprise Buyer')).toBeInTheDocument();
    unmount3();

    // Non-alphanumeric domain name
    const { unmount: unmount4 } = render(<CompanyHoverTooltip name="*** $$$" type="vendor"><span>Special</span></CompanyHoverTooltip>);
    const specialTrigger = screen.getByText('Special');
    fireEvent.mouseEnter(specialTrigger);
    expect(screen.getByText(/@company\.com/)).toBeInTheDocument();
    unmount4();

    // Empty name with buyer type
    const { unmount: unmount5 } = render(<CompanyHoverTooltip name="" type="buyer"><span>EmptyBuyer</span></CompanyHoverTooltip>);
    const emptyBuyer = screen.getByText('EmptyBuyer');
    fireEvent.mouseEnter(emptyBuyer);
    expect(screen.getByText('Enterprise Buyer')).toBeInTheDocument();
    unmount5();

    // Empty name with vendor type
    render(<CompanyHoverTooltip name="" type="vendor"><span>EmptyVendor</span></CompanyHoverTooltip>);
    const emptyVendor = screen.getByText('EmptyVendor');
    fireEvent.mouseEnter(emptyVendor);
    expect(screen.getByText('Verified Supplier')).toBeInTheDocument();
  });
});
