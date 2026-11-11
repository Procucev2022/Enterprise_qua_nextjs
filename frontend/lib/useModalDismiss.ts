import { useEffect, useRef, type MouseEvent } from 'react';
import type { ModalDismissEntry } from './types';

/**
 * Attaches a global Escape key listener while at least one modal or drawer in
 * `entries` is open. Dismisses the first open entry in priority order so
 * inner/topmost modals close before underlying drawers or overlays.
 */
export function useEscapeDismissStack(entries: ModalDismissEntry[]): void {
  const entriesRef = useRef<ModalDismissEntry[]>(entries);
  entriesRef.current = entries;

  const hasOpenEntry = entries.some((entry) => entry.isOpen);

  useEffect(() => {
    if (!hasOpenEntry) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      const activeEntry = entriesRef.current.find((entry) => entry.isOpen);
      if (activeEntry) {
        activeEntry.onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasOpenEntry]);
}

/**
 * Returns an `onClick` handler for modal/drawer backdrops that invokes `onClose`
 * only when the backdrop element itself (`event.target === event.currentTarget`)
 * is clicked, leaving clicks inside the dialog content unaffected.
 */
export function backdropDismissProps(onClose: () => void): {
  onClick: (event: MouseEvent<HTMLElement>) => void;
} {
  return {
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
  };
}

