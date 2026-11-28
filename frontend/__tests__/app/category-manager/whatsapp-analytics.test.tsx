import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhatsAppAnalyticsView from '@/app/category-manager/whatsapp-analytics/WhatsAppAnalyticsView';
import WhatsAppAnalyticsPage, { metadata } from '@/app/category-manager/whatsapp-analytics/page';
import { UI_STRINGS } from '@/lib/uiStrings';
import { WHATSAPP_ANALYTICS_EMBED_URL } from '@/lib/constants';

describe('WhatsApp Analytics View & Page Suite', () => {
  const strings = UI_STRINGS.categoryManagerDashboard.whatsapp;

  test('renders header, fallback notice, and open new tab link', () => {
    render(<WhatsAppAnalyticsView />);

    expect(screen.getByText(strings.title)).toBeInTheDocument();
    expect(screen.getByText(strings.fallbackNotice)).toBeInTheDocument();

    const link = screen.getByTestId('open-new-tab-link');
    expect(link).toHaveAttribute('href', WHATSAPP_ANALYTICS_EMBED_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });

  test('displays loading spinner until iframe onLoad fires', () => {
    render(<WhatsAppAnalyticsView />);

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.getByText(strings.loading)).toBeInTheDocument();

    const iframe = screen.getByTestId('whatsapp-analytics-iframe');
    expect(iframe).toHaveAttribute('src', WHATSAPP_ANALYTICS_EMBED_URL);

    fireEvent.load(iframe);

    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
  });

  test('renders page component wrapper cleanly and exports metadata', () => {
    expect(metadata.title).toBe('WhatsApp Analytics | Category Manager');
    expect(metadata.description).toBeDefined();

    render(<WhatsAppAnalyticsPage />);
    expect(screen.getByTestId('whatsapp-analytics-iframe')).toBeInTheDocument();
  });
});
