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

  it('toggles maximize and restore view', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const maxBtn = screen.getByTitle('Maximize view');
    expect(maxBtn).toBeInTheDocument();
    fireEvent.click(maxBtn);

    const restoreBtn = screen.getByTitle('Restore compact view');
    expect(restoreBtn).toBeInTheDocument();
    fireEvent.click(restoreBtn);

    expect(screen.getByTitle('Maximize view')).toBeInTheDocument();
  });

  it('resets conversation when clicking restart button', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const input = screen.getByPlaceholderText('Ask a question...');
    fireEvent.change(input, { target: { value: 'test question' } });
    fireEvent.submit(input.closest('form')!);

    expect(screen.getByText('test question')).toBeInTheDocument();

    const restartBtn = screen.getByTitle('Restart conversation');
    fireEvent.click(restartBtn);

    expect(screen.queryByText('test question')).not.toBeInTheDocument();
    expect(screen.getByText(/Hello!/)).toBeInTheDocument();
  });
});

// ==============================================================================
// ROLE ATTRIBUTION, THE HOVER BADGE, COPY AND CLEAR
// ==============================================================================
// The escalation names the role it came from, so a support desk reading the audit
// log knows whether a buyer or a vendor raised it. The remaining cases cover the
// controls that sit on an open conversation.
// ==============================================================================

describe('SupportChatWidget: escalation attributes the role', () => {
  const mockAddAuditLog = jest.fn();

  /**
   * Escalate the conversation.
   *
   * Triggered by a dissatisfaction keyword rather than by any unrecognised
   * question — an unmatched prompt still gets a canned reply.
   */
  const escalate = () => {
    fireEvent.click(screen.getByLabelText('Open support chat'));
    const input = screen.getByPlaceholderText('Ask a question...');
    fireEvent.change(input, { target: { value: 'this is no help at all' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    act(() => {
      jest.runOnlyPendingTimers();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockAddAuditLog.mockClear();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it.each([
    ['buyer', 'Buyer'],
    ['vendor', 'Vendor'],
    ['category_manager', 'Category Manager'],
    // Anything else is a category manager as far as the escalation is concerned,
    // rather than being reported with a blank role.
    ['admin', 'Category Manager'],
  ])('records a %s escalation as %s', (role, expected) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: role,
      addAuditLog: mockAddAuditLog,
    });

    render(<SupportChatWidget />);
    escalate();

    expect(mockAddAuditLog).toHaveBeenCalledWith(
      expect.stringContaining(expected),
      undefined,
      'system'
    );
  });
});

describe('SupportChatWidget: conversation controls', () => {
  const mockAddAuditLog = jest.fn();
  const writeText = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentRole: 'buyer',
      addAuditLog: mockAddAuditLog,
    });
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // The badge is the second way into the conversation, alongside the round button.
  it('opens the conversation from the hover badge', () => {
    render(<SupportChatWidget />);

    fireEvent.click(screen.getByText(/Need help/i));

    expect(screen.getByText('QUA AI Support')).toBeInTheDocument();
  });

  it('copies a reply and stops confirming after a moment', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const copyButton = screen.getAllByTitle(/Copy/i)[0];
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalled();
    // The tick is the confirmation, and it is not supposed to stay forever.
    expect(document.querySelector('svg.lucide-check')).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(document.querySelector('svg.lucide-check')).toBeNull();
  });

  it('clears a half-typed question without sending it', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const input = screen.getByPlaceholderText('Ask a question...');
    fireEvent.change(input, { target: { value: 'half typed' } });

    // Appears only once there is something to clear, and carries an X rather than
    // a label, so it is located by that icon inside the composer.
    const clear = input.parentElement?.querySelector('button');
    expect(clear).not.toBeNull();
    fireEvent.click(clear as HTMLButtonElement);

    expect(input).toHaveValue('');
    expect(screen.queryByText('half typed')).not.toBeInTheDocument();
  });

  // Submitting an empty box must not post a blank message.
  it('ignores an empty submission', () => {
    render(<SupportChatWidget />);
    fireEvent.click(screen.getByLabelText('Open support chat'));

    const input = screen.getByPlaceholderText('Ask a question...');
    const before = screen.getAllByText(/./).length;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(mockAddAuditLog).not.toHaveBeenCalled();
    expect(screen.getAllByText(/./).length).toBe(before);
  });
});
