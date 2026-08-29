import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationToast from '@/app/components/NotificationToast';
import * as storeModule from '@/lib/store';

jest.mock('@/lib/store');

describe('NotificationToast', () => {
  const mockDismissToast = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when toastMessage is null', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      toastMessage: null,
      dismissToast: mockDismissToast,
    });

    const { container } = render(<NotificationToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders success toast and handles dismiss', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      toastMessage: {
        id: 'toast-1',
        title: 'Success Title',
        description: 'Operation completed',
        type: 'success',
      },
      dismissToast: mockDismissToast,
    });

    render(<NotificationToast />);
    expect(screen.getByText('Success Title')).toBeInTheDocument();
    expect(screen.getByText('Operation completed')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(mockDismissToast).toHaveBeenCalledTimes(1);
  });

  it('renders warning toast', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      toastMessage: {
        id: 'toast-2',
        title: 'Warning Title',
        description: 'Check your input',
        type: 'warning',
      },
      dismissToast: mockDismissToast,
    });

    render(<NotificationToast />);
    expect(screen.getByText('Warning Title')).toBeInTheDocument();
  });

  it('renders default/info toast', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      toastMessage: {
        id: 'toast-3',
        title: 'Info Title',
        description: 'Info description',
        type: 'info',
      },
      dismissToast: mockDismissToast,
    });

    render(<NotificationToast />);
    expect(screen.getByText('Info Title')).toBeInTheDocument();
  });
});
