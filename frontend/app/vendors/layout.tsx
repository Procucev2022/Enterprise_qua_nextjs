import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Enterprise Vendor Directory | Procucev',
  description:
    'Browse and discover verified industrial manufacturers, suppliers, and distributors across India. No login required — public access to the Procucev Enterprise Vendor Network.',
  openGraph: {
    title: 'Enterprise Vendor Directory | Procucev',
    description:
      'Search and filter 80,000+ verified B2B industrial vendors by category, state, and rating.',
    type: 'website',
  },
};

export default function VendorsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
