import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SupportChatWidget from '@/app/components/SupportChatWidget';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');

describe('SupportChatWidget', () => {
  const mockAddAuditLog = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      addAuditLog: mockAddAuditLog,
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('renders trigger button and opens chat window', () => {
    render(<SupportChatWidget />);
    const trigger = screen.getByLabelText('Open support chat');
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByText('QUA AI Support')).toBeInTheDocument();
    expect(screen.getByText(/Hello!/)).toBeInTheDocument();

    // Close chat
    const closeBtn = screen.getByTitle('Close chat');
    fireEvent.click(closeBtn);
    expect(screen.queryByText('QUA AI Support')).not.toBeInTheDocument();
  });

  it('sends user message and receives standard AI reply for subscriptions', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const input = screen.getByPlaceholderText('Ask a question...');
    fireEvent.change(input, { target: { value: 'tell me about subscription' } });
    fireEvent.submit(input.closest('form')!);

    expect(screen.getByText('tell me about subscription')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(screen.getByText(/Vendor Subscriptions/)).toBeInTheDocument();
  });

  it('handles quick prompt button click for Sourcing Modes', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const quickBtn = screen.getByText('⚡ Sourcing Modes');
    fireEvent.click(quickBtn);

    expect(screen.getByText('What is the difference between Mode 1, 2, and 3?')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(screen.getByText(/3 Sourcing Modes/)).toBeInTheDocument();
  });

  it('handles dissatisfaction and escalates to support agent with audit log', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const quickBtn = screen.getByText('🎧 Agent Support');
    fireEvent.click(quickBtn);

    expect(mockAddAuditLog).toHaveBeenCalledWith(
      expect.stringContaining('Support Chat Escalation'),
      undefined,
      'system'
    );

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.getByText(/Our support agent will connect with you shortly/)).toBeInTheDocument();
    expect(screen.getByText('Support Desk')).toBeInTheDocument();
  });

  it('handles RFQ download prompt', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const quickBtn = screen.getByText('📄 RFQ Download');
    fireEvent.click(quickBtn);

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(screen.getByText(/Download RFQ/)).toBeInTheDocument();
  });

  it('handles generic prompt fallback reply', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const input = screen.getByPlaceholderText('Ask a question...');
    fireEvent.change(input, { target: { value: 'Random query here' } });
    fireEvent.submit(input.closest('form')!);

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(screen.getByText(/Procucev QUA AI streamlines multi-channel/)).toBeInTheDocument();
  });
});
