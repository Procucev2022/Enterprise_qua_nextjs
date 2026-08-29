import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RoleNavigation from '@/app/components/RoleNavigation';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');

describe('RoleNavigation', () => {
  const mockSetActiveScreen = jest.fn();
  const mockOnLogout = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when not logged in', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: false,
      currentRole: 'buyer',
    });

    const { container } = render(
      <RoleNavigation
        activeScreen="command_center"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('covers all active and inactive button states for buyer', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'buyer',
      activeBuyerAccount: { organizationName: 'Tata Motors' },
    });

    const screens = [
      'command_center',
      'ingestion_wizard',
      'vendor_evaluation_summary',
      'vendor_summary',
      'subscription_center',
      'buyer_profile',
      'buyer_directory',
    ];

    screens.forEach((scr) => {
      const { unmount } = render(
        <RoleNavigation
          activeScreen={scr}
          setActiveScreen={mockSetActiveScreen}
          onLogout={mockOnLogout}
        />
      );
      unmount();
    });

    // Test with default buyer account fallback (null)
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'buyer',
      activeBuyerAccount: null,
    });

    render(
      <RoleNavigation
        activeScreen="other"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    expect(screen.getByText('L&T')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Command Center/));
    fireEvent.click(screen.getByText(/AI Ingestion & Mode Wizard/));
    fireEvent.click(screen.getByText(/Evaluation Summary/));
    fireEvent.click(screen.getByText(/Vendor Directory/));
    fireEvent.click(screen.getByText(/Sourcing Subscriptions/));
    fireEvent.click(screen.getByText(/Buyer Profile/));
    fireEvent.click(screen.getByText(/Buyer DB Sync/));
  });

  it('covers all active and inactive button states for category_manager', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'category_manager',
    });

    const cmScreens = [
      'kanban_board',
      'spend_dashboard',
      'buyer_console',
      'vendor_evaluation_summary',
      'vendor_console',
      'category_summary',
    ];

    cmScreens.forEach((scr) => {
      const { unmount } = render(
        <RoleNavigation
          activeScreen={scr}
          setActiveScreen={mockSetActiveScreen}
          onLogout={mockOnLogout}
        />
      );
      unmount();
    });

    render(
      <RoleNavigation
        activeScreen="other"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    expect(screen.getByText('Mechanical Ops')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Operational Kanban/));
    fireEvent.click(screen.getByText(/Spend Analytics/));
    fireEvent.click(screen.getByText(/Buyer RFQ Console/));
    fireEvent.click(screen.getByText(/Mode 3 Evaluations/));
    fireEvent.click(screen.getByText(/Vendor Performance/));
    fireEvent.click(screen.getByText(/Categories & Trends/));
  });

  it('covers all active and inactive button states for vendor', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'vendor',
    });

    const vendorScreens = [
      'vendor_feed',
      'quotation_form',
      'qualification_form',
      'item_catalogue',
      'vendor_subscription',
      'vendor_profile',
    ];

    vendorScreens.forEach((scr) => {
      const { unmount } = render(
        <RoleNavigation
          activeScreen={scr}
          setActiveScreen={mockSetActiveScreen}
          onLogout={mockOnLogout}
        />
      );
      unmount();
    });

    render(
      <RoleNavigation
        activeScreen="other"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    expect(screen.getByText('Apex Supplies')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Opportunity Feed/));
    fireEvent.click(screen.getByText(/Bid Quotes/));
    fireEvent.click(screen.getByText(/360° AI Self-Evaluation/));
    fireEvent.click(screen.getByText(/Item Catalogue/));
    fireEvent.click(screen.getByText(/Subscription Plans/));
    fireEvent.click(screen.getByText(/Vendor Profile/));
  });

  it('covers all active and inactive button states for admin', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'admin',
    });

    const adminScreens = ['infra_control', 'audit_log'];

    adminScreens.forEach((scr) => {
      const { unmount } = render(
        <RoleNavigation
          activeScreen={scr}
          setActiveScreen={mockSetActiveScreen}
          onLogout={mockOnLogout}
        />
      );
      unmount();
    });

    render(
      <RoleNavigation
        activeScreen="other"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    expect(screen.getByText('Compliance & Infra')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Azure Infrastructure & AI/));
    fireEvent.click(screen.getByText(/Immutable Audit Log/));
  });
});
