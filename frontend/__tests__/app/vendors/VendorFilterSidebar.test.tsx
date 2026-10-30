import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VendorFilterSidebar, { FilterSection, formatCategoryLabel } from '@/app/vendors/VendorFilterSidebar';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { PublicVendorFilterState } from '@/lib/types';

const S = UI_STRINGS.publicVendorDirectory;

const DEFAULT_FILTER: PublicVendorFilterState = {
  search: '',
  category: 'all',
  state: 'all',
  minRating: 0,
  verifiedOnly: false,
  page: 1,
  pageSize: 20,
};

const CATEGORIES = ['Mechanical & Fluid Equipment', 'Engineering Spares - Electrical'];
const STATES = ['Maharashtra', 'Gujarat', 'Karnataka'];

describe('formatCategoryLabel', () => {
  test('returns empty string for falsy input', () => {
    expect(formatCategoryLabel('')).toBe('');
  });

  test('returns the string unchanged if it already contains uppercase letters', () => {
    expect(formatCategoryLabel('Mechanical & Fluid Equipment')).toBe('Mechanical & Fluid Equipment');
    expect(formatCategoryLabel('ABC')).toBe('ABC');
  });

  test('title-cases a fully lowercase string', () => {
    expect(formatCategoryLabel('pumps and valves')).toBe('Pumps And Valves');
  });
});

describe('FilterSection', () => {
  test('renders label and children', () => {
    render(
      <FilterSection id="test-id" label="Test Label">
        <span data-testid="child">Child</span>
      </FilterSection>
    );
    expect(screen.getByText('Test Label')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  test('renders children even when label is empty string', () => {
    render(
      <FilterSection label="">
        <span data-testid="child2">Child</span>
      </FilterSection>
    );
    expect(screen.getByTestId('child2')).toBeInTheDocument();
  });
});

describe('VendorFilterSidebar', () => {
  const onUpdateFilter = jest.fn();
  const onClearFilters = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function renderSidebar(overrides: Partial<Parameters<typeof VendorFilterSidebar>[0]> = {}) {
    return render(
      <VendorFilterSidebar
        filter={DEFAULT_FILTER}
        hasActiveFilters={false}
        onUpdateFilter={onUpdateFilter}
        onClearFilters={onClearFilters}
        categories={CATEGORIES}
        states={STATES}
        {...overrides}
      />
    );
  }

  test('renders heading, category, state, rating, and verified filter controls', () => {
    renderSidebar();
    expect(screen.getByText(S.filterHeading)).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('State / Region')).toBeInTheDocument();
    expect(screen.getByText(S.ratingFilterLabel)).toBeInTheDocument();
    expect(screen.getByText(S.verifiedOnlyLabel)).toBeInTheDocument();
  });

  test('renders all category options including All Categories', () => {
    renderSidebar();
    expect(screen.getByText(S.allCategories)).toBeInTheDocument();
    expect(screen.getByText('Mechanical & Fluid Equipment')).toBeInTheDocument();
    expect(screen.getByText('Engineering Spares - Electrical')).toBeInTheDocument();
  });

  test('renders all state options including All States', () => {
    renderSidebar();
    expect(screen.getByText(S.allStates)).toBeInTheDocument();
    expect(screen.getByText('Maharashtra')).toBeInTheDocument();
    expect(screen.getByText('Gujarat')).toBeInTheDocument();
  });

  test('calls onUpdateFilter with category when category select changes (desktop)', () => {
    renderSidebar();
    const select = screen.getByDisplayValue(S.allCategories);
    fireEvent.change(select, { target: { value: 'Mechanical & Fluid Equipment' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ category: 'Mechanical & Fluid Equipment' });
  });

  test('calls onUpdateFilter with state when state select changes', () => {
    renderSidebar();
    const select = screen.getByDisplayValue(S.allStates);
    fireEvent.change(select, { target: { value: 'Maharashtra' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ state: 'Maharashtra' });
  });

  test('calls onUpdateFilter with minRating when rating select changes', () => {
    renderSidebar();
    const select = screen.getByDisplayValue(S.allRatings);
    fireEvent.change(select, { target: { value: '4' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ minRating: 4 });
  });

  test('calls onUpdateFilter with verifiedOnly true when checkbox is checked', () => {
    renderSidebar();
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onUpdateFilter).toHaveBeenCalledWith({ verifiedOnly: true });
  });

  test('shows Clear Filters button on desktop when hasActiveFilters is true and calls onClearFilters', () => {
    renderSidebar({ hasActiveFilters: true });
    const clearBtn = screen.getByText(S.clearFilters);
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  test('does not show Clear Filters button when hasActiveFilters is false', () => {
    renderSidebar({ hasActiveFilters: false });
    expect(screen.queryByText(S.clearFilters)).not.toBeInTheDocument();
  });

  test('falls back to MAJOR_CATEGORIES when no categories prop is provided', () => {
    renderSidebar({ categories: undefined });
    // Should still render the All Categories option
    expect(screen.getByText(S.allCategories)).toBeInTheDocument();
  });

  test('falls back to INDIAN_STATES when no states prop provided', () => {
    renderSidebar({ states: undefined });
    expect(screen.getByText(S.allStates)).toBeInTheDocument();
  });

  test('prepends active category to list when it is not in provided categories', () => {
    renderSidebar({
      filter: { ...DEFAULT_FILTER, category: 'Custom Category XYZ' },
    });
    expect(screen.getByText('Custom Category XYZ')).toBeInTheDocument();
  });

  test('prepends active state to list when it is not in provided states', () => {
    renderSidebar({
      filter: { ...DEFAULT_FILTER, state: 'Telangana' },
      states: ['Maharashtra'],
    });
    expect(screen.getByText('Telangana')).toBeInTheDocument();
  });

  // ── Mobile mode ──────────────────────────────────────────────────────────

  test('renders close button in mobile mode when onCloseMobile is provided', () => {
    const onCloseMobile = jest.fn();
    renderSidebar({ isMobile: true, onCloseMobile });
    const closeBtn = screen.getByLabelText('Close filters');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  test('does not render close button in mobile mode when onCloseMobile is not provided', () => {
    renderSidebar({ isMobile: true });
    expect(screen.queryByLabelText('Close filters')).not.toBeInTheDocument();
  });

  test('calls onCloseMobile after selecting category in mobile mode', () => {
    const onCloseMobile = jest.fn();
    renderSidebar({ isMobile: true, onCloseMobile });
    const select = screen.getByDisplayValue(S.allCategories);
    fireEvent.change(select, { target: { value: 'Engineering Spares - Electrical' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ category: 'Engineering Spares - Electrical' });
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  test('calls onCloseMobile after selecting state in mobile mode', () => {
    const onCloseMobile = jest.fn();
    renderSidebar({ isMobile: true, onCloseMobile });
    const select = screen.getByDisplayValue(S.allStates);
    fireEvent.change(select, { target: { value: 'Gujarat' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ state: 'Gujarat' });
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  test('calls onCloseMobile after changing rating in mobile mode', () => {
    const onCloseMobile = jest.fn();
    renderSidebar({ isMobile: true, onCloseMobile });
    const select = screen.getByDisplayValue(S.allRatings);
    fireEvent.change(select, { target: { value: '3' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ minRating: 3 });
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  test('shows mobile clear filters button when hasActiveFilters and isMobile; clicking calls both onClearFilters and onCloseMobile', () => {
    const onCloseMobile = jest.fn();
    renderSidebar({ isMobile: true, hasActiveFilters: true, onCloseMobile });
    const clearBtns = screen.getAllByText(S.clearFilters);
    // Mobile clear button is the last one rendered
    const mobileClearBtn = clearBtns[clearBtns.length - 1];
    fireEvent.click(mobileClearBtn);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  test('mobile clear filters button: calls onClearFilters even when onCloseMobile is not provided', () => {
    renderSidebar({ isMobile: true, hasActiveFilters: true });
    const clearBtn = screen.getByText(S.clearFilters);
    fireEvent.click(clearBtn);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  test('does not call onCloseMobile on category select if onCloseMobile is not provided in mobile mode', () => {
    renderSidebar({ isMobile: true });
    const select = screen.getByDisplayValue(S.allCategories);
    fireEvent.change(select, { target: { value: 'Mechanical & Fluid Equipment' } });
    expect(onUpdateFilter).toHaveBeenCalledWith({ category: 'Mechanical & Fluid Equipment' });
    // No crash expected — onCloseMobile was not provided
  });
});
