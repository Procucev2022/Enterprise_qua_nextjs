'use client';

import React, { useState, useEffect } from 'react';
import { STANDARD_APPROVAL_INITIATORS, INITIATOR_OTHER_OPTION } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

export interface InitiatorSelectFieldProps {
  id?: string;
  label?: string;
  required?: boolean;
  value: string;
  onChange: (name: string, id?: string) => void;
  options?: readonly string[];
  placeholder?: string;
  customPlaceholder?: string;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
}

export default function InitiatorSelectField({
  id = 'approval-initiator-select',
  label,
  required = true,
  value,
  onChange,
  options = STANDARD_APPROVAL_INITIATORS,
  placeholder = UI_STRINGS.actionCenter?.tasks?.selectAssignee || 'Select Initiator...',
  customPlaceholder = 'Enter initiator name...',
  className = '',
  selectClassName = '',
  inputClassName = '',
}: InitiatorSelectFieldProps) {
  const isStandardOption = options.some((opt) => opt === value);
  const [isOtherSelected, setIsOtherSelected] = useState<boolean>(!isStandardOption && Boolean(value));
  const [customName, setCustomName] = useState<string>(!isStandardOption ? value : '');

  useEffect(() => {
    if (options.some((opt) => opt === value)) {
      setIsOtherSelected(false);
      setCustomName('');
    } else if (value && value !== INITIATOR_OTHER_OPTION) {
      setIsOtherSelected(true);
      setCustomName(value);
    }
  }, [value, options]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    if (selected === INITIATOR_OTHER_OPTION) {
      setIsOtherSelected(true);
      onChange(customName, customName);
    } else {
      setIsOtherSelected(false);
      onChange(selected, selected);
    }
  };

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomName(val);
    onChange(val, val);
  };

  const selectVal = isOtherSelected ? INITIATOR_OTHER_OPTION : (isStandardOption ? value : '');

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="block font-semibold text-slate-700 dark:text-slate-300 text-xs mb-1">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <select
        id={id}
        value={selectVal}
        onChange={handleSelectChange}
        required={required && !isOtherSelected}
        className={`w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer text-xs ${selectClassName}`}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        <option value={INITIATOR_OTHER_OPTION}>{INITIATOR_OTHER_OPTION}</option>
      </select>

      {isOtherSelected && (
        <input
          type="text"
          id={`${id}-custom`}
          value={customName}
          onChange={handleCustomInputChange}
          placeholder={customPlaceholder}
          required={required}
          className={`w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-lg text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 animate-in fade-in duration-100 ${inputClassName}`}
        />
      )}
    </div>
  );
}
