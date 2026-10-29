import React from 'react';
import { render, screen } from '@testing-library/react';
import Footer from '@/app/components/Footer';
import { usePathname } from 'next/navigation';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

describe('Footer component', () => {
  it('returns null on the /login route', () => {
    (usePathname as jest.Mock).mockReturnValue('/login');
    const { container } = render(<Footer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders footer on other routes with company name', () => {
    (usePathname as jest.Mock).mockReturnValue('/buyer/dashboard');
    render(<Footer />);
    expect(screen.getByText(/Procucev Enterprise Solutions Private Limited/i)).toBeInTheDocument();
    expect(screen.getByText(/Enterprise QUA AI Production Release 2.0/i)).toBeInTheDocument();
  });
});
