import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SupportChatWidget from '@/app/components/SupportChatWidget';
import * as storeModule from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import { SUPPORT_CHAT_COPY_CONFIRMATION_MS, SUPPORT_CHAT_ENDPOINT } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/store');

const strings = UI_STRINGS.supportChat;

// The refusal the support endpoint sends when no support service is connected.
const NOT_CONFIGURED_MESSAGE =
  'The AI support assistant is not connected to this server. Your message was not answered and no support ticket was created.';
const NOT_CONFIGURED_BODY = { success: false, status: 'not_configured', reply: null, error: NOT_CONFIGURED_MESSAGE };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function setRole(role: string) {
  (storeModule.useApp as jest.Mock).mockReturnValue({ currentRole: role });
}

function openChat() {
  fireEvent.click(screen.getByLabelText(strings.triggerLabel));
}

function sendText(text: string) {
  const input = screen.getByPlaceholderText(strings.inputPlaceholder);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
}

/** The JSON body and headers of every request the widget has sent to the endpoint. */
function sentRequests() {
  return (global.fetch as jest.Mock).mock.calls
    .filter(([url]) => url === SUPPORT_CHAT_ENDPOINT)
    .map(([, init]) => ({ body: JSON.parse(init.body), headers: init.headers }));
}

describe('SupportChatWidget', () => {
  beforeEach(() => {
    setRole('buyer');
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(NOT_CONFIGURED_BODY, 503));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('opens with a notice that replies come only from the support service', () => {
    render(<SupportChatWidget />);
    openChat();

    expect(screen.getByText(strings.headerTitle)).toBeInTheDocument();
    expect(screen.getByText(strings.intro)).toBeInTheDocument();
    expect(screen.getByText(strings.roleBuyer)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(strings.closeTitle));
    expect(screen.queryByText(strings.headerTitle)).not.toBeInTheDocument();
  });

  it('opens from the hover prompt', () => {
    render(<SupportChatWidget />);

    fireEvent.click(screen.getByText(strings.hoverPrompt));
    expect(screen.getByText(strings.headerTitle)).toBeInTheDocument();
  });

  it.each([
    ['buyer', strings.roleBuyer],
    ['vendor', strings.roleVendor],
    ['category_manager', strings.roleCategoryManager],
    ['admin', strings.roleAdmin],
  ])('labels the %s workspace', (role, label) => {
    setRole(role);
    render(<SupportChatWidget />);
    openChat();

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('sends the message to the support endpoint and shows the reply the service returns', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ success: true, status: 'answered', reply: 'Mode 3 uses the 360° evaluation.' })
    );
    render(<SupportChatWidget />);
    openChat();

    sendText('What is Mode 3?');
    expect(screen.getByText('What is Mode 3?')).toBeInTheDocument();
    expect(await screen.findByText('Mode 3 uses the 360° evaluation.')).toBeInTheDocument();

    expect(global.fetch).toHaveBeenCalledWith(SUPPORT_CHAT_ENDPOINT, expect.objectContaining({ method: 'POST' }));
    expect(sentRequests().map((request) => request.body)).toEqual([{ prompt: 'What is Mode 3?', userRole: 'buyer' }]);
  });

  it('shows the not-configured message from the server and invents no reply, ticket or escalation', async () => {
    render(<SupportChatWidget />);
    openChat();

    sendText('Explain vendor subscription plans');
    expect(await screen.findByText(NOT_CONFIGURED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Vendor Subscriptions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TK-\d+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/support@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/will connect with you/i)).not.toBeInTheDocument();
  });

  it('sends the session token and the signed-in role when a session exists', async () => {
    jest.spyOn(authClient, 'getToken').mockReturnValue('session-token');
    setRole('vendor');
    render(<SupportChatWidget />);
    openChat();
    expect(screen.getByText(strings.roleVendor)).toBeInTheDocument();

    sendText('Hello');
    await screen.findByText(NOT_CONFIGURED_MESSAGE);

    const [request] = sentRequests();
    expect(request.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer session-token' });
    expect(request.body).toEqual({ prompt: 'Hello', userRole: 'vendor' });
  });

  it('sends no Authorization header when there is no session', async () => {
    jest.spyOn(authClient, 'getToken').mockReturnValue(null);
    render(<SupportChatWidget />);
    openChat();

    sendText('Hello');
    await screen.findByText(NOT_CONFIGURED_MESSAGE);

    const [request] = sentRequests();
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('shows the connection message and logs the failure when the request cannot be sent', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    render(<SupportChatWidget />);
    openChat();

    sendText('Hi');
    expect(await screen.findByText(strings.unreachable)).toBeInTheDocument();
    expect(logger.buffer).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'ERROR',
        category: 'SUPPORT_CHAT',
        message: 'Support chat request failed',
      }),
    ]));
  });

  it('shows the generic message when the response is not a support answer', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ success: false }, 500));
    render(<SupportChatWidget />);
    openChat();

    sendText('Hi');
    expect(await screen.findByText(strings.unexpectedResponse)).toBeInTheDocument();
  });

  it('shows the generic message when the response body is not JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    render(<SupportChatWidget />);
    openChat();

    sendText('Hi');
    expect(await screen.findByText(strings.unexpectedResponse)).toBeInTheDocument();
  });

  it('ignores an empty submission and sends nothing', () => {
    render(<SupportChatWidget />);
    openChat();

    sendText('   ');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the quick prompt it shows, without any canned answer', async () => {
    render(<SupportChatWidget />);
    openChat();

    fireEvent.click(screen.getByText(strings.quickSourcingModesLabel));
    expect(await screen.findByText(NOT_CONFIGURED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(strings.quickSourcingModesPrompt)).toBeInTheDocument();
    expect(sentRequests().map((request) => request.body)).toEqual([
      { prompt: strings.quickSourcingModesPrompt, userRole: 'buyer' },
    ]);
  });

  it('disables sending while the service is answering, then re-enables it', async () => {
    let answer: (value: ReturnType<typeof jsonResponse>) => void = () => undefined;
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise((resolve) => {
        answer = resolve;
      })
    );
    render(<SupportChatWidget />);
    openChat();

    sendText('First question');
    expect(screen.getByRole('status', { name: strings.waitingForReply })).toBeInTheDocument();
    expect(screen.getByTitle(strings.sendTitle)).toBeDisabled();
    expect(screen.getByText(strings.quickSubscriptionsLabel)).toBeDisabled();

    await act(async () => {
      answer(jsonResponse(NOT_CONFIGURED_BODY, 503));
    });
    expect(await screen.findByText(NOT_CONFIGURED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clears the composer with the clear button without sending anything', () => {
    render(<SupportChatWidget />);
    openChat();

    const input = screen.getByPlaceholderText(strings.inputPlaceholder);
    fireEvent.change(input, { target: { value: 'half typed' } });
    fireEvent.click(screen.getByLabelText(strings.clearInputLabel));

    expect(input).toHaveValue('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('restart clears the conversation and shows the intro notice again', async () => {
    render(<SupportChatWidget />);
    openChat();

    sendText('Remember this');
    expect(await screen.findByText(NOT_CONFIGURED_MESSAGE)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(strings.restartTitle));
    expect(screen.queryByText('Remember this')).not.toBeInTheDocument();
    expect(screen.queryByText(NOT_CONFIGURED_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByText(strings.intro)).toBeInTheDocument();
  });

  it('maximizes and restores the window', () => {
    render(<SupportChatWidget />);
    openChat();

    fireEvent.click(screen.getByTitle(strings.maximizeTitle));
    fireEvent.click(screen.getByTitle(strings.restoreTitle));
    expect(screen.getByTitle(strings.maximizeTitle)).toBeInTheDocument();
  });

  describe('copying a reply', () => {
    it('confirms the copy and clears the confirmation after the delay', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ success: true, reply: 'Copy this reply.' }));
      render(<SupportChatWidget />);
      openChat();
      sendText('Give me a reply');
      expect(await screen.findByText('Copy this reply.')).toBeInTheDocument();

      jest.useFakeTimers();
      try {
        fireEvent.click(screen.getByTitle(strings.copyTitle));
        await act(async () => {
          await Promise.resolve();
        });
        expect(writeText).toHaveBeenCalledWith('Copy this reply.');
        expect(document.querySelector('svg.lucide-check')).not.toBeNull();

        act(() => {
          jest.advanceTimersByTime(SUPPORT_CHAT_COPY_CONFIRMATION_MS);
        });
        expect(document.querySelector('svg.lucide-check')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('logs a failed copy and shows no confirmation', async () => {
      Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ success: true, reply: 'Copy this reply.' }));
      render(<SupportChatWidget />);
      openChat();
      sendText('Give me a reply');
      expect(await screen.findByText('Copy this reply.')).toBeInTheDocument();

      fireEvent.click(screen.getByTitle(strings.copyTitle));
      await act(async () => {
        await Promise.resolve();
      });

      expect(document.querySelector('svg.lucide-check')).toBeNull();
      expect(logger.buffer).toEqual(expect.arrayContaining([
        expect.objectContaining({
          level: 'WARN',
          category: 'SUPPORT_CHAT',
          message: 'Copying a support chat message failed',
        }),
      ]));
    });
  });
});
