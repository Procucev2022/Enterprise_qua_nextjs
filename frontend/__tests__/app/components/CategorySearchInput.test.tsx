import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CategorySearchInput from '@/app/components/CategorySearchInput';
import { CATEGORY_SEARCH_RESULT_LIMIT } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { chooseCategory, clearCategory } from '../../../test-fixtures/categorySearch';

const LABEL = UI_STRINGS.manualRfqModal.colMinor;
const OPTIONS = ['Bearings & Accessories', 'Centrifugal Pumps', 'Gear Pumps', 'Pump Accessories', 'Valves'];

type FieldProps = React.ComponentProps<typeof CategorySearchInput>;

function renderField(props: Partial<FieldProps> = {}) {
  const onChange = jest.fn();
  render(
    <CategorySearchInput
      label={LABEL}
      options={OPTIONS}
      value=""
      onChange={onChange}
      placeholder={UI_STRINGS.categorySearch.searchPlaceholder}
      {...props}
    />
  );
  const input = screen.getByRole('combobox', { name: LABEL });
  return { onChange, input };
}

const optionTexts = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('CategorySearchInput', () => {
  it('lists every category when the field is opened, with the total', () => {
    const { input } = renderField();
    fireEvent.click(input);

    expect(screen.getByRole('listbox', { name: LABEL })).toBeInTheDocument();
    expect(optionTexts()).toEqual(OPTIONS);
    expect(screen.getByText(formatString(UI_STRINGS.categorySearch.countAll, { total: OPTIONS.length }))).toBeInTheDocument();
  });

  it('lists only the first results when there are more matches than the limit', () => {
    const many = Array.from({ length: CATEGORY_SEARCH_RESULT_LIMIT + 5 }, (_, index) => `Category ${index + 1}`);
    const { input } = renderField({ options: many });
    fireEvent.click(input);

    expect(screen.getAllByRole('option')).toHaveLength(CATEGORY_SEARCH_RESULT_LIMIT);
    expect(
      screen.getByText(
        formatString(UI_STRINGS.categorySearch.countShowingAll, { shown: CATEGORY_SEARCH_RESULT_LIMIT, total: many.length })
      )
    ).toBeInTheDocument();
  });

  it('says how many matching categories are shown when a search has more matches than the limit', () => {
    const many = Array.from({ length: CATEGORY_SEARCH_RESULT_LIMIT + 5 }, (_, index) => `Category ${index + 1}`);
    const { input } = renderField({ options: many });
    fireEvent.change(input, { target: { value: 'category' } });

    expect(screen.getAllByRole('option')).toHaveLength(CATEGORY_SEARCH_RESULT_LIMIT);
    expect(
      screen.getByText(
        formatString(UI_STRINGS.categorySearch.countShowingMatches, {
          shown: CATEGORY_SEARCH_RESULT_LIMIT,
          total: many.length,
        })
      )
    ).toBeInTheDocument();
  });

  it('lists the matching categories as the user types', () => {
    const { input } = renderField();
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'pump' } });

    expect(optionTexts()).toEqual(['Pump Accessories', 'Centrifugal Pumps', 'Gear Pumps']);
    expect(screen.getByText(formatString(UI_STRINGS.categorySearch.countMatching, { total: 3 }))).toBeInTheDocument();
  });

  it('says so when no category matches, and offers no list to point at', () => {
    const { input } = renderField();
    fireEvent.change(input, { target: { value: 'bearing bolts' } });

    expect(screen.getByText(UI_STRINGS.categorySearch.noMatches)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-controls');
  });

  it('chooses a category when it is picked, and closes the list', () => {
    const { input, onChange } = renderField();
    chooseCategory(input, 'Gear Pumps');

    expect(onChange).toHaveBeenCalledWith('Gear Pumps');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves the highlight with the arrow keys, and picks the highlighted category with Enter', () => {
    const { input, onChange } = renderField();
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Centrifugal Pumps');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Centrifugal Pumps');
  });

  it('keeps the highlight on the first and the last category at the ends of the list', () => {
    const { input } = renderField();
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(OPTIONS[0]);

    for (let step = 0; step < OPTIONS.length + 2; step += 1) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(OPTIONS[OPTIONS.length - 1]);
  });

  it('opens the list with ArrowDown when it is closed', () => {
    const { input } = renderField();
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('moves the highlight to a category under the pointer', () => {
    const { input } = renderField();
    fireEvent.click(input);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Valves' }));

    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Valves');
  });

  it('never submits the surrounding form from this field, and picks nothing when there is no match', () => {
    const { input, onChange } = renderField();

    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    fireEvent.change(input, { target: { value: 'bearing bolts' } });
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes the list on Escape without letting the key reach an enclosing dialog', () => {
    const onDialogKeyDown = jest.fn();
    render(
      <div onKeyDown={onDialogKeyDown}>
        <CategorySearchInput label={LABEL} options={OPTIONS} value="" onChange={jest.fn()} placeholder="" />
      </div>
    );
    const input = screen.getByRole('combobox', { name: LABEL });
    fireEvent.click(input);
    expect(screen.getByRole('listbox', { name: LABEL })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: LABEL })).not.toBeInTheDocument();
    expect(onDialogKeyDown).not.toHaveBeenCalled();
  });

  it('shows the chosen category again when the field loses focus, and discards text that was not picked', () => {
    const { input, onChange } = renderField({ value: 'Gear Pumps' });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(input).toHaveValue('xyz');

    fireEvent.blur(input);

    expect(input).toHaveValue('Gear Pumps');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('searches only the text typed after the chosen category, when the first keystroke lands after it', () => {
    const { input } = renderField({ value: 'Gear Pumps' });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'Gear Pumpss' } });

    expect(input).toHaveValue('s');
  });

  it('shows the chosen category as the text, and clears it with the clear button', () => {
    const { input, onChange } = renderField({ value: 'Valves' });

    expect(input).toHaveValue('Valves');
    clearCategory(input);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows no clear button when nothing is chosen', () => {
    renderField({ value: '' });

    expect(screen.queryByRole('button', { name: UI_STRINGS.categorySearch.clearAria })).not.toBeInTheDocument();
  });

  it('does not open or accept text while disabled', () => {
    const { input } = renderField({ value: 'Valves', disabled: true });

    expect(input).toBeDisabled();
    expect(screen.queryByRole('button', { name: UI_STRINGS.categorySearch.clearAria })).not.toBeInTheDocument();
    fireEvent.click(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marks the field as required and invalid for assistive technology', () => {
    const { input } = renderField({ required: true, invalid: true });

    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the chosen category as the placeholder of the empty field', () => {
    const { input } = renderField({ value: 'Valves', placeholder: 'Search category…' });

    expect(input).toHaveAttribute('placeholder', 'Valves');
  });

  it('shows the given placeholder while no category is chosen', () => {
    const { input } = renderField({ value: '', placeholder: 'Search category…' });

    expect(input).toHaveAttribute('placeholder', 'Search category…');
  });

  it('points the field at the highlighted category for assistive technology', () => {
    const { input } = renderField();
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const highlighted = screen.getByRole('option', { selected: true });
    expect(input).toHaveAttribute('aria-activedescendant', highlighted.id);
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });
});
