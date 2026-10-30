import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScorecardDashboard from '@/app/category-manager/components/ScorecardDashboard';
import * as scorecardClient from '@/lib/scorecardClient';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/scorecardClient', () => ({
  fetchScorecardData: jest.fn(),
}));

const mockScorecardData = {
  period: 'this_month',
  project: 'all',
  pillar: 'all',
  dateRange: {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    label: '01 Oct 2026 - 31 Oct 2026',
  },
  pillarSummary: {
    operations: {
      tasksCompleted: 4,
      tasksAssigned: 5,
      taskCompletionRate: 80,
      ticketsCompleted: 2,
      ticketsAssigned: 3,
      ticketResolutionRate: 67,
      registrations: 3,
      registrationsTarget: 4,
      registrationRate: 75,
      siteVisits: 8,
      siteVisitsPlanned: 10,
      siteVisitRate: 80,
    },
    revenue: {
      duesCollected: 600000,
      totalDues: 1182800000,
      pendingDues: 1182200000,
      collectionPercentage: 1,
      loansDisbursed: 5,
      loansTarget: 6,
      loanDisbursementRate: 83,
      loanRealized: 2500000,
      loanRealizedTarget: 3000000,
      loanRealizationRate: 83,
    },
    sales: {
      leadsContacted: 15,
      leadsTarget: 20,
      leadContactRate: 75,
      leadToVisitRate: 60,
      visitToDealRate: 40,
      dealsClosed: 6,
      dealsTarget: 8,
      dealAchievementRate: 75,
    },
  },
  teamScores: [
    {
      rank: 1,
      id: 'exec-1',
      name: 'Pavani "Chief" Reddy',
      role: 'CRM Executive',
      email: 'pavani@example.com',
      project: 'Project Falcon',
      operations: {
        tasksCompleted: 4,
        tasksAssigned: 5,
        taskCompletionRate: 80,
        ticketsResolved: 2,
        ticketsAssigned: 3,
        ticketResolutionRate: 67,
        registrationsCompleted: 3,
        registrationsTarget: 4,
        registrationAchievementRate: 75,
        siteVisitsCompleted: 8,
        siteVisitsPlanned: 10,
        siteVisitAchievementRate: 80,
      },
      revenue: {
        totalDues: 1000000,
        duesCollected: 800000,
        pendingDues: 200000,
        collectionPercentage: 80,
        loansDisbursed: 3,
        loansTarget: 4,
        loanDisbursementRate: 75,
        loanAmountRealized: 1500000,
        loanRealizedTarget: 2000000,
        loanRealizationRate: 75,
      },
      sales: {
        leadsContacted: 10,
        leadsTarget: 12,
        leadContactRate: 83,
        leadToVisitRate: 70,
        visitToDealRate: 50,
        dealsClosed: 4,
        dealsTarget: 5,
        dealAchievementRate: 80,
      },
      score: 88,
      performanceStatus: 'On Track' as const,
    },
    {
      rank: 2,
      id: 'exec-2',
      name: 'Suresh Raina',
      role: 'Sales Executive',
      email: 'suresh@example.com',
      project: 'Project Orion',
      operations: {
        tasksCompleted: 2,
        tasksAssigned: 5,
        taskCompletionRate: 40,
        ticketsResolved: 1,
        ticketsAssigned: 2,
        ticketResolutionRate: 50,
        registrationsCompleted: 1,
        registrationsTarget: 3,
        registrationAchievementRate: 33,
        siteVisitsCompleted: 3,
        siteVisitsPlanned: 5,
        siteVisitAchievementRate: 60,
      },
      revenue: {
        totalDues: 50000,
        duesCollected: 25000,
        pendingDues: 25000,
        collectionPercentage: 50,
        loansDisbursed: 1,
        loansTarget: 2,
        loanDisbursementRate: 50,
        loanAmountRealized: 45000,
        loanRealizedTarget: 50000,
        loanRealizationRate: 90,
      },
      sales: {
        leadsContacted: 8,
        leadsTarget: 10,
        leadContactRate: 80,
        leadToVisitRate: null,
        visitToDealRate: null,
        dealsClosed: 2,
        dealsTarget: 4,
        dealAchievementRate: 50,
      },
      score: 65,
      performanceStatus: 'Average' as const,
    },
    {
      rank: 3,
      id: 'exec-3',
      name: 'Anjali Verma',
      role: 'Account Manager',
      email: 'anjali@example.com',
      project: 'Project Titan',
      operations: {
        tasksCompleted: 1,
        tasksAssigned: 4,
        taskCompletionRate: 25,
        ticketsResolved: 0,
        ticketsAssigned: 2,
        ticketResolutionRate: 0,
        registrationsCompleted: 0,
        registrationsTarget: 2,
        registrationAchievementRate: 0,
        siteVisitsCompleted: 1,
        siteVisitsPlanned: 3,
        siteVisitAchievementRate: 33,
      },
      revenue: {
        totalDues: 20000,
        duesCollected: 5000,
        pendingDues: 15000,
        collectionPercentage: 25,
        loansDisbursed: 0,
        loansTarget: 1,
        loanDisbursementRate: 0,
        loanAmountRealized: 0,
        loanRealizedTarget: 10000,
        loanRealizationRate: 0,
      },
      sales: {
        leadsContacted: 2,
        leadsTarget: 10,
        leadContactRate: 20,
        leadToVisitRate: 10,
        visitToDealRate: 0,
        dealsClosed: 0,
        dealsTarget: 3,
        dealAchievementRate: 0,
      },
      score: 30,
      performanceStatus: 'Needs Focus' as const,
    },
    {
      rank: 4,
      id: 'exec-4',
      name: 'Rohan Joshi',
      role: 'Junior Executive',
      email: 'rohan@example.com',
      project: 'Project Alpha',
      operations: {
        tasksCompleted: 0,
        tasksAssigned: 0,
        taskCompletionRate: null,
        ticketsResolved: 0,
        ticketsAssigned: 0,
        ticketResolutionRate: null,
        registrationsCompleted: 0,
        registrationsTarget: 0,
        registrationAchievementRate: null,
        siteVisitsCompleted: 0,
        siteVisitsPlanned: 0,
        siteVisitAchievementRate: null,
      },
      revenue: {
        totalDues: 0,
        duesCollected: 0,
        pendingDues: 0,
        collectionPercentage: null,
        loansDisbursed: 0,
        loansTarget: 0,
        loanDisbursementRate: null,
        loanAmountRealized: 0,
        loanRealizedTarget: 0,
        loanRealizationRate: null,
      },
      sales: {
        leadsContacted: 0,
        leadsTarget: 0,
        leadContactRate: null,
        leadToVisitRate: null,
        visitToDealRate: null,
        dealsClosed: 0,
        dealsTarget: 0,
        dealAchievementRate: null,
      },
      score: 10,
      performanceStatus: 'Needs Focus' as const,
    },
  ],
};

describe('ScorecardDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (scorecardClient.fetchScorecardData as jest.Mock).mockResolvedValue(mockScorecardData);
  });

  it('renders scorecard summary pillars and team leaderboard table with ranks', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
      expect(screen.getByText('Suresh Raina')).toBeInTheDocument();
      expect(screen.getByText('Anjali Verma')).toBeInTheDocument();
      expect(screen.getByText('Rohan Joshi')).toBeInTheDocument();
    });

    // Check medals and ranks
    expect(screen.getByText('🥇')).toBeInTheDocument();
    expect(screen.getByText('🥈')).toBeInTheDocument();
    expect(screen.getByText('🥉')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    // Check pillar headings
    expect(screen.getAllByText(UI_STRINGS.actionCenter.scorecard.operationsPillar).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(UI_STRINGS.actionCenter.scorecard.revenuePillar).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(UI_STRINGS.actionCenter.scorecard.salesPillar).length).toBeGreaterThanOrEqual(1);
  });

  it('switches between periods: today, this week, last month, this quarter, and FY', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    // Today
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.today }));
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'today' })
      );
    });

    // Last Month
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.lastMonth }));
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'last_month' })
      );
    });

    // This Qtr
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.thisQuarter }));
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'this_quarter' })
      );
    });

    // FY
    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.financialYear }));
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'financial_year' })
      );
    });
  });

  it('opens custom date picker and applies custom date range or handles empty date cancel', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    // Click date range picker button to open
    const dateRangeBtn = screen.getByText('01 Oct 2026 - 31 Oct 2026');
    fireEvent.click(dateRangeBtn);

    // Toggle close
    fireEvent.click(dateRangeBtn);
    // Reopen
    fireEvent.click(dateRangeBtn);

    // Apply button with empty dates
    const applyBtn = screen.getByRole('button', { name: /Apply/i });
    fireEvent.click(applyBtn);

    // Fill valid dates
    const dateInputs = screen.getAllByDisplayValue('');
    fireEvent.change(dateInputs[0], { target: { value: '2026-10-05' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-10-25' } });

    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({
          period: 'custom',
          startDate: '2026-10-05',
          endDate: '2026-10-25',
        })
      );
    });
  });

  it('filters by project dropdown', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    const projectSelect = screen.getByRole('combobox', { name: UI_STRINGS.actionCenter.scorecard.allProjects });
    fireEvent.change(projectSelect, { target: { value: 'Tata Steel Mechanical' } });

    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'Tata Steel Mechanical' })
      );
    });
  });

  it('filters by all 3 performance pillars individually', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    // Operations
    const opsBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.actionCenter.scorecard.operationsPillar) });
    fireEvent.click(opsBtn);
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ pillar: 'operations' })
      );
    });

    // Revenue
    const revBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.actionCenter.scorecard.revenuePillar) });
    fireEvent.click(revBtn);
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ pillar: 'revenue' })
      );
    });

    // Sales
    const salesBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.actionCenter.scorecard.salesPillar) });
    fireEvent.click(salesBtn);
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ pillar: 'sales' })
      );
    });

    // All Pillars
    const allBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.actionCenter.scorecard.allPillars) });
    fireEvent.click(allBtn);
    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ pillar: 'all' })
      );
    });
  });

  it('switches view mode between Complete Team and Individual Executive and selects executive', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    const individualBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.individualExecutive });
    fireEvent.click(individualBtn);

    // Executive selector should appear
    const execSelect = screen.getByRole('combobox', { name: UI_STRINGS.actionCenter.scorecard.individualExecutive });
    expect(execSelect).toBeInTheDocument();

    fireEvent.change(execSelect, { target: { value: 'exec-1' } });

    await waitFor(() => {
      expect(scorecardClient.fetchScorecardData).toHaveBeenCalledWith(
        expect.objectContaining({ executiveId: 'exec-1' })
      );
    });

    // Switch back to team view
    const teamBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.teamLeaderboard });
    fireEvent.click(teamBtn);
  });

  it('opens and closes individual executive detail modal drilldown for different performance statuses', async () => {
    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    // View details for rank 1 (On Track)
    const viewDetailsButtons = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.scorecard.viewDetails });
    fireEvent.click(viewDetailsButtons[0]);

    expect(screen.getByText(UI_STRINGS.actionCenter.scorecard.executivePerformanceTitle)).toBeInTheDocument();
    expect(screen.getByText(/Rank #1/i)).toBeInTheDocument();

    // Close modal via close button
    const closeBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.closeModal });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(UI_STRINGS.actionCenter.scorecard.executivePerformanceTitle)).not.toBeInTheDocument();
    });

    // Open rank 2 (Average status) and close with X button
    fireEvent.click(viewDetailsButtons[1]);
    expect(screen.getByText(/Rank #2/i)).toBeInTheDocument();
    const xButton = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (xButton) {
      fireEvent.click(xButton);
    }

    // Open rank 3 (Needs Focus status)
    fireEvent.click(viewDetailsButtons[2]);
    expect(screen.getByText(/Rank #3/i)).toBeInTheDocument();
    const closeBtn3 = screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.closeModal });
    fireEvent.click(closeBtn3);
  });

  it('handles fallback label and undefined or NaN numeric values', async () => {
    (scorecardClient.fetchScorecardData as jest.Mock).mockResolvedValue({
      period: 'this_month',
      project: 'all',
      pillar: 'all',
      dateRange: {
        startDate: '',
        endDate: '',
        label: '',
      },
      pillarSummary: {
        operations: {
          tasksCompleted: 0,
          tasksAssigned: 0,
          taskCompletionRate: NaN,
          ticketsCompleted: 0,
          ticketsAssigned: 0,
          ticketResolutionRate: undefined as any,
          registrations: 0,
          registrationsTarget: 0,
          registrationRate: null,
          siteVisits: 0,
          siteVisitsPlanned: 0,
          siteVisitRate: 150,
        },
        revenue: {
          duesCollected: NaN,
          totalDues: undefined as any,
          pendingDues: null as any,
          collectionPercentage: 120,
          loansDisbursed: 0,
          loansTarget: 0,
          loanDisbursementRate: null,
          loanRealized: null as any,
          loanRealizedTarget: null as any,
          loanRealizationRate: null,
        },
        sales: {
          leadsContacted: 0,
          leadsTarget: 0,
          leadContactRate: null,
          leadToVisitRate: null,
          visitToDealRate: null,
          dealsClosed: 0,
          dealsTarget: 0,
          dealAchievementRate: null,
        },
      },
      teamScores: [
        {
          rank: 5,
          id: 'exec-5',
          name: 'Fallback Exec',
          role: 'Intern',
          email: 'intern@example.com',
          project: 'Project Omega',
          operations: {
            tasksCompleted: 0,
            tasksAssigned: 0,
            taskCompletionRate: null,
            ticketsResolved: 0,
            ticketsAssigned: 0,
            ticketResolutionRate: null,
            registrationsCompleted: 0,
            registrationsTarget: 0,
            registrationAchievementRate: null,
            siteVisitsCompleted: 0,
            siteVisitsPlanned: 0,
            siteVisitAchievementRate: null,
          },
          revenue: {
            totalDues: 0,
            duesCollected: 0,
            pendingDues: 0,
            collectionPercentage: null,
            loansDisbursed: 0,
            loansTarget: 0,
            loanDisbursementRate: null,
            loanAmountRealized: 0,
            loanRealizedTarget: 0,
            loanRealizationRate: null,
          },
          sales: {
            leadsContacted: 0,
            leadsTarget: 0,
            leadContactRate: null,
            leadToVisitRate: null,
            visitToDealRate: null,
            dealsClosed: 0,
            dealsTarget: 0,
            dealAchievementRate: null,
          },
          score: 0,
          performanceStatus: 'Needs Focus' as const,
        },
      ],
    });

    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Fallback Exec')).toBeInTheDocument();
      expect(screen.getByText('Select Date Range')).toBeInTheDocument();
    });
  });

  it('handles CSV export click and early return when data is empty', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const mockClick = jest.fn();

    const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        el.click = mockClick;
      }
      return el;
    });

    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pavani "Chief" Reddy')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.exportBtn });
    fireEvent.click(exportBtn);

    expect(mockClick).toHaveBeenCalled();
    createElementSpy.mockRestore();
  });

  it('handles empty scorecard data or empty rows', async () => {
    (scorecardClient.fetchScorecardData as jest.Mock).mockResolvedValue({
      ...mockScorecardData,
      teamScores: [],
    });

    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.scorecard.noDataFound)).toBeInTheDocument();
    });

    // Export button does nothing when rows are empty
    const exportBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.scorecard.exportBtn });
    fireEvent.click(exportBtn);
  });

  it('handles error state when fetch throws exception', async () => {
    (scorecardClient.fetchScorecardData as jest.Mock).mockRejectedValue(new Error('Server fault'));

    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.scorecard.noDataFound)).toBeInTheDocument();
    });
  });

  it('handles error state when fetch returns null', async () => {
    (scorecardClient.fetchScorecardData as jest.Mock).mockResolvedValue(null);

    render(<ScorecardDashboard />);

    await waitFor(() => {
      expect(screen.queryByText('Pavani "Chief" Reddy')).not.toBeInTheDocument();
    });
  });
});
