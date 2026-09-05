import React from 'react';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';
import * as storeModule from '@/lib/store';
import { LOGIN_ROUTE, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { UserRole } from '@/lib/types';

jest.mock('@/lib/store');

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

/**
 * The entry route owns no screens: it only decides where a visitor belongs.
 * Screens themselves now live at their own URLs and are covered by their own
 * component suites.
 */
describe('HomePage entry redirect', () => {
  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: false,
      currentRole: 'buyer',
      ...overrides,
    });
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sends an unauthenticated visitor to the sign-in route', () => {
    mockStore({ isLoggedIn: false });

    render(<HomePage />);

    expect(mockReplace).toHaveBeenCalledWith(LOGIN_ROUTE);
  });

  it('shows a redirect notice rather than any application screen', () => {
    mockStore({ isLoggedIn: false });

    render(<HomePage />);

    expect(screen.getByText(UI_STRINGS.auth.redirecting)).toBeInTheDocument();
  });

  it.each<[UserRole, string]>([
    ['buyer', ROLE_LANDING_ROUTE.buyer],
    ['category_manager', ROLE_LANDING_ROUTE.category_manager],
    ['vendor', ROLE_LANDING_ROUTE.vendor],
    ['admin', ROLE_LANDING_ROUTE.admin],
  ])('routes a signed-in %s to their own landing route', (role, expectedRoute) => {
    mockStore({ isLoggedIn: true, currentRole: role });

    render(<HomePage />);

    expect(mockReplace).toHaveBeenCalledWith(expectedRoute);
  });

  it('falls back to the buyer landing route when the role is unrecognised', () => {
    mockStore({ isLoggedIn: true, currentRole: 'something_else' });

    render(<HomePage />);

    expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
  });
});
