import type { Metadata } from 'next';
import WhatsAppAnalyticsView from './WhatsAppAnalyticsView';

export const metadata: Metadata = {
  title: 'WhatsApp Analytics | Category Manager',
  description: 'Real-time conversational telemetry and bot analytics',
};

export default function WhatsAppAnalyticsPage() {
  return <WhatsAppAnalyticsView />;
}
