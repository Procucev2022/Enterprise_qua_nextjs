import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RoleNavigation from '@/app/components/RoleNavigation';
import * as storeModule from '@/lib/store';
import { ROLE_SIDEBAR_NAV, SIDEBAR_LAYOUT } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { UserRole } from '@/lib/types';

jest.mock('@/lib/store');

const NAV = UI_STRINGS.navigation;

describe('RoleNavigation Sidebar Dashboard', () => {
  const mockSetActiveScreen = jest.fn();
  const mockOnScreenChange = jest.fn();
  const mockOnLogout = jest.fn();

  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'buyer',
      activeBuyerAccount: null,
      vendorSubscription: 'premium',
      ...overrides,
    });
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when the session is not authenticated', () => {
    mockStore({ isLoggedIn: false });

    const { container } = render(
      <RoleNavigation
        activeScreen="command_center"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders a flush full-height rail with grouped modules and no workspace header card', () => {
    mockStore();

    render(
      <RoleNavigation
        activeScreen="command_center"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    const rail = screen.getByRole('complementary', { name: NAV.navLandmarkLabel });
    expect(rail.className).toContain(SIDEBAR_LAYOUT.STICKY_OFFSET_CLASS);
    expect(rail.className).toContain(SIDEBAR_LAYOUT.HEIGHT_CLASS);
    expect(rail.className).toContain(SIDEBAR_LAYOUT.WIDTH_CLASS);
    // Flush edges: no rounded card shell or outer gutters
    expect(rail.className).not.toContain('rounded');
    expect(rail.className).not.toContain('lg:top-[88px]');

    // Collapse / expand affordances are removed
    expect(screen.queryByRole('button', { name: /Collapse|Expand/i })).not.toBeInTheDocument();

    expect(screen.getByText(NAV.groups.buyerSourcing)).toBeInTheDocument();
    expect(screen.getByText(NAV.groups.buyerEvaluation)).toBeInTheDocument();
    expect(screen.getByText(NAV.groups.buyerAccount)).toBeInTheDocument();
    expect(
      screen.getByText(formatString(NAV.modulesCountTemplate, { count: ROLE_SIDEBAR_NAV.buyer.length }))
    ).toBeInTheDocument();

    // Active module is flagged for assistive technology
    expect(screen.getByRole('button', { name: /Screen 1\.1/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Screen 1\.2/ })).not.toHaveAttribute('aria-current');
  });

  it('falls back to the buyer module rail when no role is resolved', () => {
    mockStore({ currentRole: undefined });

    render(<RoleNavigation activeScreen="command_center" setActiveScreen={mockSetActiveScreen} />);

    expect(screen.getByRole('button', { name: /Screen 1\.1/ })).toBeInTheDocument();
    // Sign Out is omitted when no logout handler is supplied
    expect(screen.queryByRole('button', { name: NAV.signOut })).not.toBeInTheDocument();
  });

  it.each<[UserRole]>([['buyer'], ['category_manager'], ['vendor'], ['admin']])(
    'renders every %s module and dispatches screen changes',
    (role) => {
      const items = ROLE_SIDEBAR_NAV[role];

      // Cover active + inactive visual states for each module of the role
      items.forEach((item) => {
        mockStore({ currentRole: role });
        const { unmount } = render(
          <RoleNavigation
            activeScreen={item.id}
            setActiveScreen={mockSetActiveScreen}
            onLogout={mockOnLogout}
          />
        );
        expect(screen.getByRole('button', { name: `${item.screenTag}: ${item.label}` })).toHaveAttribute(
          'aria-current',
          'page'
        );
        unmount();
      });

      mockSetActiveScreen.mockClear();
      mockStore({ currentRole: role });
      render(
        <RoleNavigation
          activeScreen="unmatched_screen"
          setActiveScreen={mockSetActiveScreen}
          onScreenChange={mockOnScreenChange}
          onLogout={mockOnLogout}
        />
      );

      items.forEach((item) => {
        const button = screen.getByRole('button', { name: `${item.screenTag}: ${item.label}` });
        expect(screen.getByText(item.label)).toBeInTheDocument();
        expect(screen.getByText(item.description)).toBeInTheDocument();
        expect(screen.getByText(item.shortTag)).toBeInTheDocument();
        fireEvent.click(button);
        expect(mockSetActiveScreen).toHaveBeenCalledWith(item.id);
        expect(mockOnScreenChange).toHaveBeenCalledWith(item.id);
      });

      expect(mockSetActiveScreen).toHaveBeenCalledTimes(items.length);
    }
  );

  it('opens the mobile drawer and closes it via the overlay, close button and navigation', () => {
    mockStore();

    render(
      <RoleNavigation
        activeScreen="command_center"
        setActiveScreen={mockSetActiveScreen}
        onLogout={mockOnLogout}
      />
    );

    const openBtn = screen.getByRole('button', { name: NAV.openMenu });
    expect(openBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: NAV.dismissOverlay })).not.toBeInTheDocument();

    // Open -> dismiss via backdrop overlay
    fireEvent.click(openBtn);
    expect(screen.getByRole('button', { name: NAV.openMenu })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: NAV.dismissOverlay }));
    expect(screen.queryByRole('button', { name: NAV.dismissOverlay })).not.toBeInTheDocument();

    // Open -> dismiss via explicit close control
    fireEvent.click(screen.getByRole('button', { name: NAV.openMenu }));
    fireEvent.click(screen.getByRole('button', { name: NAV.closeMenu }));
    expect(screen.getByRole('button', { name: NAV.openMenu })).toHaveAttribute('aria-expanded', 'false');

    // Open -> auto-dismiss after selecting a module
    fireEvent.click(screen.getByRole('button', { name: NAV.openMenu }));
    fireEvent.click(screen.getByRole('button', { name: /Screen 1\.4/ }));
    expect(mockSetActiveScreen).toHaveBeenCalledWith('vendor_summary');
    expect(screen.getByRole('button', { name: NAV.openMenu })).toHaveAttribute('aria-expanded', 'false');
  });

  it('invokes the logout handler from the rail footer', () => {
    mockStore({ currentRole: 'admin' });

    render(
      <RoleNavigation
        activeScreen="infra_control"
        onScreenChange={mockOnScreenChange}
        onLogout={mockOnLogout}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: NAV.signOut }));
    expect(mockOnLogout).toHaveBeenCalledTimes(1);

    // Screen change works when only the onScreenChange callback is provided
    fireEvent.click(screen.getByRole('button', { name: /Screen 4\.2/ }));
    expect(mockOnScreenChange).toHaveBeenCalledWith('audit_log');
    expect(mockSetActiveScreen).not.toHaveBeenCalled();
  });
});
