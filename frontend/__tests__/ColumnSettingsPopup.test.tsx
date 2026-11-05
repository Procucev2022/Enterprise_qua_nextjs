import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ColumnSettingsPopup, { type ColumnDef } from '../app/category-manager/components/ColumnSettingsPopup';

describe('ColumnSettingsPopup', () => {
  const sampleColumns: ColumnDef[] = [
    { key: 'col1', label: 'Column 1', visible: true, required: true },
    { key: 'col2', label: 'Column 2', visible: true },
    { key: 'col3', label: 'Column 3', visible: false },
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ColumnSettingsPopup
        isOpen={false}
        onClose={jest.fn()}
        columns={sampleColumns}
        onSave={jest.fn()}
        onReset={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders columns and title when isOpen is true', () => {
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={jest.fn()}
        columns={sampleColumns}
        onSave={jest.fn()}
        onReset={jest.fn()}
        title="Custom Columns"
      />
    );
    expect(screen.getByText('Custom Columns')).toBeInTheDocument();
    expect(screen.getByText('Column 1')).toBeInTheDocument();
    expect(screen.getByText('Column 2')).toBeInTheDocument();
    expect(screen.getByText('Column 3')).toBeInTheDocument();
  });

  it('toggles column visibility when optional checkbox is clicked', () => {
    const onSave = jest.fn();
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={jest.fn()}
        columns={sampleColumns}
        onSave={onSave}
        onReset={jest.fn()}
      />
    );

    const checkbox = screen.getByLabelText('Toggle column: Column 2');
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith([
      { key: 'col1', label: 'Column 1', visible: true, required: true },
      { key: 'col2', label: 'Column 2', visible: false },
      { key: 'col3', label: 'Column 3', visible: false },
    ]);
  });

  it('disables toggling for required columns', () => {
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={jest.fn()}
        columns={sampleColumns}
        onSave={jest.fn()}
        onReset={jest.fn()}
      />
    );

    const requiredCheckbox = screen.getByLabelText('Toggle column: Column 1');
    expect(requiredCheckbox).toBeDisabled();
  });

  it('handles reset to default', () => {
    const onReset = jest.fn();
    const onClose = jest.fn();
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={onClose}
        columns={sampleColumns}
        onSave={jest.fn()}
        onReset={onReset}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    expect(onReset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('handles escape key to close', () => {
    const onClose = jest.fn();
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={onClose}
        columns={sampleColumns}
        onSave={jest.fn()}
        onReset={jest.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('handles backdrop click to close', () => {
    const onClose = jest.fn();
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={onClose}
        columns={sampleColumns}
        onSave={jest.fn()}
        onReset={jest.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it('handles drag and drop reordering', () => {
    const onSave = jest.fn();
    render(
      <ColumnSettingsPopup
        isOpen={true}
        onClose={jest.fn()}
        columns={sampleColumns}
        onSave={onSave}
        onReset={jest.fn()}
      />
    );

    const dragItem = screen.getByText('Column 1').closest('div[draggable="true"]')!;
    const dropTarget = screen.getByText('Column 3').closest('div[draggable="true"]')!;

    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(dragItem, { dataTransfer });
    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });
    fireEvent.dragEnd(dragItem);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalled();
  });
});

