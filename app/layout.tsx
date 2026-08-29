import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/store';
import Header from '@/app/components/Header';
import NotificationToast from '@/app/components/NotificationToast';
import StandardRFQEmailModal from '@/app/components/StandardRFQEmailModal';
import VendorRatingRevisionModal from '@/app/components/VendorRatingRevisionModal';

export const metadata: Metadata = {
  title: 'PROCUCEV ENTERPRISE | Enterprise Procurement Platform (QUA AI 2.0)',
  description:
    'End-to-End Enterprise Procurement Platform with AI Ingestion, 3 Sourcing Modes, Autonomous WhatsApp Chasing, Comparative Quote Matrix & Immutable Audit Trail.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light">
      <body className="bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 transition-colors duration-200">
        <AppProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-6">
              {children}
            </main>
            <NotificationToast />
            <StandardRFQEmailModal />
            <VendorRatingRevisionModal />
            <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-[#0b0f19]/80 py-4 text-center text-xs text-slate-500 dark:text-gray-500">
              <div className="max-w-[1600px] mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-slate-700 dark:text-gray-400">PROCUCEV ENTERPRISE SOLUTIONS</span> • Enterprise QUA AI Production Release 2.0
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <span>System Identifier: <span className="mono text-slate-600 dark:text-gray-400">client@procucev.com</span></span>
                  <span>Azure Region: <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Central India (Primary) / West US 2</span></span>
                </div>
              </div>
            </footer>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
