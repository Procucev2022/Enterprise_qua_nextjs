import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ModalDismissEntry } from '@/lib/types';
import { backdropDismissProps, useEscapeDismissStack } from '@/lib/useModalDismiss';

function TestModalHarness({
  entries,
  onBackdropClose,
}: {
  entries: ModalDismissEntry[];
  onBackdropClose: () => void;
}): React.ReactElement {
  useEscapeDismissStack(entries);

  return (
    <div data-testid="modal-backdrop" {...backdropDismissProps(onBackdropClose)}>
      <div data-testid="modal-content">
        <button type="button">Inner Action</button>
      </div>
    </div>
  );
}

describe('useModalDismiss', () => {
  it('does not dismiss on Escape when all entries are closed', () => {
    const onClose = jest.fn();
    render(
      <TestModalHarness
        entries={[{ isOpen: false, onClose }]}
        onBackdropClose={jest.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-Escape key presses and dismisses highest-priority open entry on Escape', () => {
    const innerClose = jest.fn();
    const outerClose = jest.fn();

    const { rerender } = render(
      <TestModalHarness
        entries={[
          { isOpen: true, onClose: innerClose },
          { isOpen: true, onClose: outerClose },
        ]}
        onBackdropClose={jest.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(innerClose).not.toHaveBeenCalled();
    expect(outerClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();

    rerender(
      <TestModalHarness
        entries={[
          { isOpen: false, onClose: innerClose },
          { isOpen: true, onClose: outerClose },
        ]}
        onBackdropClose={jest.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
  });

  it('handles stale open state safely if entry closes before Escape fires', () => {
    const onClose = jest.fn();
    const entries: ModalDismissEntry[] = [{ isOpen: true, onClose }];

    render(<TestModalHarness entries={entries} onBackdropClose={jest.fn()} />);
    entries[0].isOpen = false;

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls backdrop onClose only when clicking the backdrop itself, not inner content', () => {
    const onBackdropClose = jest.fn();
    render(
      <TestModalHarness
        entries={[]}
        onBackdropClose={onBackdropClose}
      />
    );

    fireEvent.click(screen.getByTestId('modal-content'));
    fireEvent.click(screen.getByText('Inner Action'));
    expect(onBackdropClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onBackdropClose).toHaveBeenCalledTimes(1);
  });
});

