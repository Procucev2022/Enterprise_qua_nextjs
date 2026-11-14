'use client';

import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import { searchCategoryOptions } from '@/lib/categorySearch';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { CategorySearchInputProps } from '@/lib/types';

const optionId = (listId: string, index: number): string => `${listId}-option-${index}`;

/** The line above the list: how many categories there are, or how many of the matches are shown. */
function describeMatches(shown: number, total: number, searching: boolean): string {
  if (total > shown) {
    const template = searching
      ? UI_STRINGS.categorySearch.countShowingMatches
      : UI_STRINGS.categorySearch.countShowingAll;
    return formatString(template, { shown, total });
  }
  if (searching) return formatString(UI_STRINGS.categorySearch.countMatching, { total });
  return formatString(UI_STRINGS.categorySearch.countAll, { total });
}

/**
 * A search field that chooses one category. As the user types, the matching categories appear below the field.
 * A category is chosen only by picking it from that list, so the field never holds a name outside the taxonomy.
 * Text that was typed but not picked is discarded when the field loses focus.
 */
export default function CategorySearchInput({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  required = false,
  invalid = false,
}: CategorySearchInputProps) {
  const listId = useId();
  // Until the user types, the field shows the chosen category and the list shows every category.
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const searching = typing && typed.trim() !== '';
  const { shown, total } = searchCategoryOptions(options, searching ? typed : '');
  const expanded = open && !disabled;
  const hasList = expanded && shown.length > 0;
  const highlighted = Math.min(activeIndex, Math.max(shown.length - 1, 0));
  const text = typing ? typed : value;

  const choose = (category: string) => {
    onChange(category);
    setTyping(false);
    setTyped('');
    setOpen(false);
    setActiveIndex(0);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    // The first keystroke lands after the chosen category, which the field still shows. Keep only the new text.
    const typedText = !typing && value !== '' && next.startsWith(value) ? next.slice(value.length) : next;
    setTyping(true);
    setTyped(typedText);
    setOpen(true);
    setActiveIndex(0);
  };

  const handleBlur = () => {
    setOpen(false);
    setTyping(false);
    setTyped('');
  };

  const handleClick = () => {
    setOpen(true);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        setActiveIndex(0);
      } else if (shown.length > 0) {
        setActiveIndex(Math.min(highlighted + 1, shown.length - 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(highlighted - 1, 0));
    } else if (event.key === 'Enter') {
      // Enter picks the highlighted category. It never submits the form around this field.
      event.preventDefault();
      if (hasList) choose(shown[highlighted]);
    } else if (event.key === 'Escape' && expanded) {
      // Escape closes the list only, so a dialog around the field stays open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="w-44 max-w-full">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={hasList ? listId : undefined}
          aria-activedescendant={hasList ? optionId(listId, highlighted) : undefined}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={text}
          placeholder={value || placeholder}
          onChange={handleChange}
          onBlur={handleBlur}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={`w-full pl-2.5 pr-6 py-1.5 rounded-lg border bg-white dark:bg-gray-800 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed ${
            invalid ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
          }`}
        />
        {value !== '' && !disabled && (
          <button
            type="button"
            aria-label={UI_STRINGS.categorySearch.clearAria}
            title={UI_STRINGS.categorySearch.clearAria}
            onClick={() => choose('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-gray-200"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-1 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-md overflow-hidden">
          {shown.length > 0 ? (
            <>
              <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">
                {describeMatches(shown.length, total, searching)}
              </p>
              <div id={listId} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto pb-1">
                {shown.map((option, index) => (
                  <div
                    key={option}
                    id={optionId(listId, index)}
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseDown={(event) => {
                      // Keeps focus in the field, so the list does not close before the choice is recorded.
                      event.preventDefault();
                      choose(option);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`px-2.5 py-1.5 text-xs cursor-pointer ${
                      index === highlighted
                        ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200'
                        : 'text-slate-700 dark:text-gray-200'
                    }`}
                  >
                    {option}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="px-2.5 py-2 text-xs text-slate-500 dark:text-gray-400">{UI_STRINGS.categorySearch.noMatches}</p>
          )}
        </div>
      )}
    </div>
  );
}
