import type { Metadata } from 'next';

// Page metadata. It names no supplier count and makes no claim about verification, because
// the directory only opens after a Procucev email sign-in.
export const metadata: Metadata = {
  title: 'Enterprise Vendor Directory | Procucev',
  description:
    'Browse industrial manufacturers, suppliers, and distributors across India. Access requires a Procucev sign-in.',
  openGraph: {
    title: 'Enterprise Vendor Directory | Procucev',
    description:
      'Search and filter industrial suppliers by category, state, and rating. Access requires a Procucev sign-in.',
    type: 'website',
  },
};

export default function VendorsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
