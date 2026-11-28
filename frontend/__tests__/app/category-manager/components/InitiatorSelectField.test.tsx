import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import InitiatorSelectField from '@/app/category-manager/components/InitiatorSelectField';
import { STANDARD_APPROVAL_INITIATORS, INITIATOR_OTHER_OPTION } from '@/lib/constants';

describe('InitiatorSelectField Component', () => {
  it('renders with default props and displays standard options plus Other', () => {
    const handleChange = jest.fn();
    render(<InitiatorSelectField value="" onChange={handleChange} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('');

    STANDARD_APPROVAL_INITIATORS.forEach((name) => {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: INITIATOR_OTHER_OPTION })).toBeInTheDocument();
  });

  it('renders label and required indicator when label is provided', () => {
    const handleChange = jest.fn();
    render(
      <InitiatorSelectField
        id="test-initiator"
        label="Initiated By"
        required={true}
        value="Govardhan"
        onChange={handleChange}
      />
    );

    expect(screen.getByText('Initiated By')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('id', 'test-initiator');
    expect(select).toHaveValue('Govardhan');
  });

  it('calls onChange with selected standard initiator name', () => {
    const handleChange = jest.fn();
    render(
      <InitiatorSelectField
        id="test-initiator"
        value=""
        onChange={handleChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'Chandan' } });

    expect(handleChange).toHaveBeenCalledWith('Chandan', 'Chandan');
  });

  it('reveals custom text input when Other is selected and triggers onChange', () => {
    const handleChange = jest.fn();
    const { rerender } = render(
      <InitiatorSelectField
        id="test-initiator"
        value=""
        onChange={handleChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: INITIATOR_OTHER_OPTION } });

    expect(handleChange).toHaveBeenCalledWith('', '');

    // Rerender with custom value
    rerender(
      <InitiatorSelectField
        id="test-initiator"
        value="Custom Name"
        onChange={handleChange}
      />
    );

    const customInput = screen.getByPlaceholderText('Enter initiator name...');
    expect(customInput).toBeInTheDocument();
    expect(customInput).toHaveValue('Custom Name');

    fireEvent.change(customInput, { target: { value: 'New Custom Name' } });
    expect(handleChange).toHaveBeenCalledWith('New Custom Name', 'New Custom Name');
  });

  it('switches back from Other to standard option cleanly', () => {
    const handleChange = jest.fn();
    const { rerender } = render(
      <InitiatorSelectField
        id="test-initiator"
        value="Custom Person"
        onChange={handleChange}
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue(INITIATOR_OTHER_OPTION);
    expect(screen.getByPlaceholderText('Enter initiator name...')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'Krishna Chaitanya' } });
    expect(handleChange).toHaveBeenCalledWith('Krishna Chaitanya', 'Krishna Chaitanya');

    rerender(
      <InitiatorSelectField
        id="test-initiator"
        value="Krishna Chaitanya"
        onChange={handleChange}
      />
    );

    expect(screen.queryByPlaceholderText('Enter initiator name...')).not.toBeInTheDocument();
  });

  it('supports custom options array, custom placeholder and custom styling classes', () => {
    const customOptions = ['Alice', 'Bob'] as const;
    const handleChange = jest.fn();
    render(
      <InitiatorSelectField
        id="custom-opts"
        value="Alice"
        onChange={handleChange}
        options={customOptions}
        placeholder="Choose initiator"
        customPlaceholder="Type name..."
        className="wrapper-cls"
        selectClassName="select-cls"
        inputClassName="input-cls"
        required={false}
      />
    );

    expect(screen.getByRole('option', { name: 'Choose initiator' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: INITIATOR_OTHER_OPTION })).toBeInTheDocument();
  });
});
