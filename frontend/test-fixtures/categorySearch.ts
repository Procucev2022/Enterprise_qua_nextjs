import { fireEvent, screen, within } from '@testing-library/react';
import { UI_STRINGS } from '../lib/uiStrings';

/**
 * Picks a category in a line item's category search field the way a buyer does: open the field, search for the
 * category, then pick it from the matching list. The field is cleared first, so the search starts from the typed
 * text alone, as it does when a buyer selects the old text and types over it.
 */
export function chooseCategory(field: HTMLElement, category: string): void {
  fireEvent.click(field);
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.change(field, { target: { value: category } });
  // Look only inside this field's own wrapper, so a native option elsewhere on the page cannot match.
  const wrapper = field.parentElement?.parentElement ?? field;
  fireEvent.mouseDown(within(wrapper).getByRole('option', { name: category }));
}

/** Clears the chosen category with the field's clear button. */
export function clearCategory(field: HTMLElement): void {
  const container = field.parentElement;
  if (!container) throw new Error('The category field has no container holding its clear button.');
  fireEvent.click(within(container).getByRole('button', { name: UI_STRINGS.categorySearch.clearAria }));
}
