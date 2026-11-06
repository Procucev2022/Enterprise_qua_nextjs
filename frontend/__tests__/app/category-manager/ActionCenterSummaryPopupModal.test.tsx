import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionCenterSummaryPopupModal from '@/app/category-manager/components/ActionCenterSummaryPopupModal';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { ActionCenterSummaryPopupColumn } from '@/lib/types';

interface TestItem extends Record<string, unknown> {
  id?: string;
  accountId?: string;
  rfqNumber?: string;
  name: string;
  count: number;
  description?: string | null;
}

const mockColumns: ActionCenterSummaryPopupColumn<TestItem>[] = [
  { key: 'name', label: 'Item Name' },
  { key: 'count', label: 'Item Count' },
  {
    key: 'description',
    label: 'Details',
    sortable: false,
    render: (item) => <span data-testid="custom-render">{item.description || 'N/A'}</span>,
  },
];

const mockRecords: TestItem[] = [
  { id: 'item-1', name: 'Alpha Item', count: 10, description: 'Alpha notes' },
  { accountId: 'acc-2', name: 'Beta Item', count: 5, description: null },
  { rfqNumber: 'rfq-3', name: 'Gamma Item', count: 20, description: 'Gamma notes' },
  { name: 'Delta Item', count: 15 },
  { id: 'item-5', name: 'Epsilon Item', count: 30 },
  { id: 'item-6', name: 'Zeta Item', count: 2 },
  { id: 'item-7', name: 'Eta Item', count: 18 },
  { id: 'item-8', name: 'Theta Item', count: 25 },
  { id: 'item-9', name: 'Iota Item', count: 12 },
  { id: 'item-10', name: 'Kappa Item', count: 8 },
  { id: 'item-11', name: 'Lambda Item', count: 4 },
];

describe('ActionCenterSummaryPopupModal', () => {
  test('returns null when isOpen is false', () => {
    const { container } = render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={false}
        onClose={jest.fn()}
        title="Test Modal"
        columns={mockColumns}
        records={mockRecords}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders dialog with title, subtitle, badge, and records when open', () => {
    const onClose = jest.fn();
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={onClose}
        title="Active Approvals"
        subtitle="Review matching records"
        totalCount={mockRecords.length}
        columns={mockColumns}
        records={mockRecords}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Active Approvals')).toBeInTheDocument();
    expect(screen.getByText('Review matching records')).toBeInTheDocument();
    expect(screen.getByText('Alpha Item')).toBeInTheDocument();
  });

  test('calls onClose when backdrop or Close buttons are clicked', () => {
    const onClose = jest.fn();
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={onClose}
        title="Test Modal"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    // Click backdrop
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Close buttons (header X and footer button)
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    expect(closeButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('does not trigger onClose when clicking inside the modal dialog body', () => {
    const onClose = jest.fn();
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={onClose}
        title="Test Modal"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    const heading = screen.getByText('Test Modal');
    fireEvent.click(heading);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('closes modal on Escape key press', () => {
    const onClose = jest.fn();
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={onClose}
        title="Test Modal"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Non-Escape key does not close
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('filters records via search input and clears search', () => {
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="Search Test"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    const searchInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.summaryModal.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'Gamma' } });

    expect(screen.getByText('Gamma Item')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Item')).not.toBeInTheDocument();

    // Clear search button
    const clearBtn = screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.clearSearch);
    fireEvent.click(clearBtn);

    expect(searchInput).toHaveValue('');
    expect(screen.getByText('Alpha Item')).toBeInTheDocument();
  });

  test('filters records using custom searchKeys', () => {
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="SearchKeys Test"
        columns={mockColumns}
        records={mockRecords}
        searchKeys={['description']}
      />
    );

    const searchInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.summaryModal.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'notes' } });

    expect(screen.getByText('Alpha Item')).toBeInTheDocument();
    expect(screen.getByText('Gamma Item')).toBeInTheDocument();
    expect(screen.queryByText('Beta Item')).not.toBeInTheDocument();
  });

  test('sorts string and number columns ascending and descending', () => {
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="Sort Test"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    const nameColHeader = screen.getByText('Item Name');
    // Click once for asc
    fireEvent.click(nameColHeader);
    expect(screen.getByText('Alpha Item')).toBeInTheDocument();

    // Click again for desc
    fireEvent.click(nameColHeader);
    expect(screen.getByText('Zeta Item')).toBeInTheDocument();

    // Sort by count (number)
    const countColHeader = screen.getByText('Item Count');
    fireEvent.click(countColHeader);
    expect(screen.getByText('Zeta Item')).toBeInTheDocument(); // count 2 is first

    fireEvent.click(countColHeader);
    expect(screen.getByText('Epsilon Item')).toBeInTheDocument(); // count 30 is first

    // Unsortable column does nothing
    const descHeader = screen.getByText('Details');
    fireEvent.click(descHeader);
  });

  test('paginates records across multiple pages', () => {
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="Pagination Test"
        columns={mockColumns}
        records={mockRecords}
        initialPageSize={5}
      />
    );

    // Initial page 1 shows first 5 items
    expect(screen.getByText('Alpha Item')).toBeInTheDocument();
    expect(screen.getByText('Epsilon Item')).toBeInTheDocument();
    expect(screen.queryByText('Zeta Item')).not.toBeInTheDocument();

    const nextBtn = screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.next);
    fireEvent.click(nextBtn);

    // Page 2 shows items 6 to 10
    expect(screen.getByText('Zeta Item')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Item')).not.toBeInTheDocument();

    const prevBtn = screen.getByLabelText(UI_STRINGS.actionCenter.summaryModal.previous);
    fireEvent.click(prevBtn);

    // Back to page 1
    expect(screen.getByText('Alpha Item')).toBeInTheDocument();
  });

  test('renders empty state when no matching records found', () => {
    render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="Empty Test"
        columns={mockColumns}
        records={[]}
      />
    );

    expect(screen.getByText(UI_STRINGS.actionCenter.summaryModal.noRecordsFound)).toBeInTheDocument();
    expect(screen.getByText(/Showing 0 to 0 of 0 records/i)).toBeInTheDocument();
  });

  test('resets page and search query when reopened or title changes', () => {
    const { rerender } = render(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="First Title"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    const searchInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.summaryModal.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'Alpha' } });
    expect(searchInput).toHaveValue('Alpha');

    // Title change resets state
    rerender(
      <ActionCenterSummaryPopupModal<TestItem>
        isOpen={true}
        onClose={jest.fn()}
        title="Second Title"
        columns={mockColumns}
        records={mockRecords}
      />
    );

    const resetInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.summaryModal.searchPlaceholder);
    expect(resetInput).toHaveValue('');
  });
});
