import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionCenterSubNav from '@/app/category-manager/components/ActionCenterSubNav';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('ActionCenterSubNav', () => {
  const mockOnSelectTab = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all action center tabs with correct labels and badges', () => {
    render(
      <ActionCenterSubNav
        activeTab="tasks"
        onSelectTab={mockOnSelectTab}
        tasksCount={5}
        ticketsCount={2}
        approvalsCount={4}
      />
    );

    // Verify presence of main tabs
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.internalTasks)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.tickets)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.approvals)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.scorecard)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.documentTracker)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.loans)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.registrations)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.paymentDues)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.expiringHolds)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.leads)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.actionCenter.tabs.siteVisits)).toBeInTheDocument();

    // Verify badges
    expect(screen.getByText('5')).toBeInTheDocument(); // tasksCount
    expect(screen.getByText('2')).toBeInTheDocument(); // ticketsCount
    expect(screen.getByText('4')).toBeInTheDocument(); // approvalsCount
    expect(screen.getAllByText('99+').length).toBeGreaterThanOrEqual(1); // documentTracker / paymentDues
  });

  it('triggers onSelectTab callback when a tab is clicked', () => {
    render(
      <ActionCenterSubNav
        activeTab="tasks"
        onSelectTab={mockOnSelectTab}
      />
    );

    const ticketsTab = screen.getByText(UI_STRINGS.actionCenter.tabs.tickets);
    fireEvent.click(ticketsTab);
    expect(mockOnSelectTab).toHaveBeenCalledWith('tickets');

    const scorecardTab = screen.getByText(UI_STRINGS.actionCenter.tabs.scorecard);
    fireEvent.click(scorecardTab);
    expect(mockOnSelectTab).toHaveBeenCalledWith('scorecard');

    const approvalsTab = screen.getByText(UI_STRINGS.actionCenter.tabs.approvals);
    fireEvent.click(approvalsTab);
    expect(mockOnSelectTab).toHaveBeenCalledWith('approvals');

    const loansTab = screen.getByText(UI_STRINGS.actionCenter.tabs.loans);
    fireEvent.click(loansTab);
    expect(mockOnSelectTab).toHaveBeenCalledWith('loans');
  });

  it('applies active styling to the currently active tab', () => {
    const { rerender } = render(
      <ActionCenterSubNav
        activeTab="scorecard"
        onSelectTab={mockOnSelectTab}
      />
    );

    const scorecardBtn = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.scorecard) });
    expect(scorecardBtn).toHaveAttribute('aria-selected', 'true');
    expect(scorecardBtn.className).toContain('text-indigo-600');

    // Change active tab
    rerender(
      <ActionCenterSubNav
        activeTab="tickets"
        onSelectTab={mockOnSelectTab}
      />
    );

    const ticketsBtn = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.tickets) });
    expect(ticketsBtn).toHaveAttribute('aria-selected', 'true');
  });

  it('handles default props safely when counts are omitted', () => {
    render(
      <ActionCenterSubNav
        activeTab="tasks"
        onSelectTab={mockOnSelectTab}
      />
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
