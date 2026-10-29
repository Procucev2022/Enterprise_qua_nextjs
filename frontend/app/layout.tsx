import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/store';
import Header from '@/app/components/Header';
import Footer from '@/app/components/Footer';
import NotificationToast from '@/app/components/NotificationToast';
import StandardRFQEmailModal from '@/app/components/StandardRFQEmailModal';
import VendorRatingRevisionModal from '@/app/components/VendorRatingRevisionModal';

export const metadata: Metadata = {
  title: 'Procucev Enterprise',
  description:
    'End-to-End Enterprise Procurement Platform with AI Ingestion, 3 Sourcing Modes, Autonomous WhatsApp Chasing, Comparative Quote Matrix & Immutable Audit Trail.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 transition-colors duration-200 font-sans"
        suppressHydrationWarning
      >
        <AppProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 w-full flex flex-col">{children}</main>
            <NotificationToast />
            <StandardRFQEmailModal />
            <VendorRatingRevisionModal />
            <Footer />
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
