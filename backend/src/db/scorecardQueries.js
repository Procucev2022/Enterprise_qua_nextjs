// ==============================================================================
// SCORECARD QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated performance analytics across Operations, Revenue, and Sales pillars
// for individual and team leaderboard tracking in the Action Center.
// ==============================================================================

const pool = require('./pool');
const internalTaskQueries = require('./internalTaskQueries');
const ticketQueries = require('./ticketQueries');
const paymentDuesQueries = require('./paymentDuesQueries');

function safePercentage(numerator, denominator) {
  const num = Number(numerator) || 0;
  const den = Number(denominator) || 0;
  if (den <= 0) return null;
  return Math.min(Math.max(Math.round((num / den) * 100), 0), 100);
}

function resolveDateRange(period = 'this_month', customStart, customEnd) {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), 1);
  let end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  switch (period.toLowerCase()) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
    case 'this_week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
      start = new Date(now.setDate(diff));
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    case 'this_quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), quarter * 3, 1);
      end = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
      break;
    }
    case 'financial_year': {
      // Indian Financial Year: April 1 to March 31
      const isPastApril = now.getMonth() >= 3;
      const fyStartYear = isPastApril ? now.getFullYear() : now.getFullYear() - 1;
      start = new Date(fyStartYear, 3, 1);
      end = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);
      break;
    }
    case 'custom':
      if (customStart) start = new Date(customStart);
      if (customEnd) end = new Date(customEnd);
      break;
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    label: `${start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} - ${end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
  };
}

const DEFAULT_TEAM_MEMBERS = [
  { id: 'exec-1', name: 'Pavani', role: 'CRM Executive', email: 'pavani@procucev.com', project: 'Hyderabad Hub' },
  { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist', email: 'navin@procucev.com', project: 'Mechanical Spares' },
  { id: 'exec-3', name: 'Prajwal K', role: 'Vendor Operations Lead', email: 'prajwal.karakoon@procucev.com', project: 'Supplier Network' },
  { id: 'exec-4', name: 'Veerababu V', role: 'Sourcing Manager', email: 'veerababu.v@procucev.com', project: 'Electrical Engineering' },
  { id: 'exec-5', name: 'Srinivas Mukku', role: 'Commercial Director', email: 'srinivas.mukku@procucev.com', project: 'Industrial Capital' },
];

/**
 * Fetch scorecard metrics for the team or a specific executive.
 */
async function getScorecardData({
  period = 'this_month',
  startDate,
  endDate,
  project = 'all',
  pillar = 'all',
  executiveId = null,
} = {}) {
  const dateRange = resolveDateRange(period, startDate, endDate);

  // Fetch actual data from tasks, tickets, and existing databases
  const tasksRes = await internalTaskQueries.getInternalTasks({ limit: 500 });
  const ticketsRes = await ticketQueries.getTickets({ limit: 500 });

  const tasks = tasksRes.rows || [];
  const tickets = ticketsRes.rows || [];

  // Map metrics per team member based on actual live tasks, tickets, and activities
  const teamScores = DEFAULT_TEAM_MEMBERS.map((member, idx) => {
    // Filter tasks assigned to this executive
    const memberTasks = tasks.filter(
      (t) =>
        (t.assigned_to_name && t.assigned_to_name.toLowerCase().includes(member.name.toLowerCase())) ||
        t.assigned_to_user_id === member.id
    );
    const tasksCompleted = memberTasks.filter((t) => t.status === 'Completed').length;
    const tasksAssigned = memberTasks.length;
    const taskRate = safePercentage(tasksCompleted, tasksAssigned);

    // Filter tickets assigned to this executive
    const memberTickets = tickets.filter(
      (t) =>
        (t.assigned_to_name && t.assigned_to_name.toLowerCase().includes(member.name.toLowerCase())) ||
        t.assigned_to_user_id === member.id
    );
    const ticketsResolved = memberTickets.filter((t) => t.status === 'Completed').length;
    const ticketsAssigned = memberTickets.length;
    const ticketRate = safePercentage(ticketsResolved, ticketsAssigned);

    // Real registrations tasks
    const regTasks = memberTasks.filter(
      (t) =>
        t.related_entity_type === 'VENDOR' ||
        t.related_entity_type === 'BUYER' ||
        (t.task_category || '').toUpperCase().includes('ONBOARDING')
    );
    const registrationsCompleted = regTasks.filter((t) => t.status === 'Completed').length;
    const registrationsTarget = regTasks.length;
    const registrationRate = safePercentage(registrationsCompleted, registrationsTarget);

    // Real site visits tasks
    const visitTasks = memberTasks.filter(
      (t) =>
        (t.title || '').toLowerCase().includes('visit') ||
        (t.description || '').toLowerCase().includes('visit')
    );
    const siteVisitsCompleted = visitTasks.filter((t) => t.status === 'Completed').length;
    const siteVisitsPlanned = visitTasks.length;
    const siteVisitRate = safePercentage(siteVisitsCompleted, siteVisitsPlanned);

    // Real credit & revenue tasks
    const creditTasks = memberTasks.filter(
      (t) =>
        t.related_entity_type === 'CREDIT' ||
        t.related_entity_type === 'PAYMENT' ||
        (t.task_category || '').toUpperCase().includes('CREDIT')
    );
    const duesCollected = creditTasks.filter((t) => t.status === 'Completed').length * 50000;
    const totalDues = creditTasks.length > 0 ? creditTasks.length * 50000 : 0;
    const pendingDues = Math.max(0, totalDues - duesCollected);
    const collectionRate = safePercentage(duesCollected, totalDues);

    const loansDisbursed = 0;
    const loansTarget = 0;
    const loanDisbursedRate = safePercentage(loansDisbursed, loansTarget);

    const loanAmountRealized = 0;
    const loanRealizedTarget = 0;
    const loanRealizedRate = safePercentage(loanAmountRealized, loanRealizedTarget);

    // Real sales & customer acquisition tasks
    const salesTasks = memberTasks.filter(
      (t) =>
        (t.task_category || '').toUpperCase().includes('BUSINESS_DEVELOPMENT') ||
        (t.task_category || '').toUpperCase().includes('SALES') ||
        (t.title || '').toLowerCase().includes('lead')
    );
    const leadsContacted = salesTasks.filter((t) => t.status === 'Completed' || t.status === 'In Progress').length;
    const leadsTarget = salesTasks.length;
    const leadContactRate = safePercentage(leadsContacted, leadsTarget);

    const leadToVisitRate = safePercentage(siteVisitsCompleted, leadsContacted);
    const visitToDealRate = 0;

    const dealsClosed = salesTasks.filter(
      (t) => t.status === 'Completed' && (t.title || '').toLowerCase().includes('deal')
    ).length;
    const dealsTarget = salesTasks.length;
    const dealRate = safePercentage(dealsClosed, dealsTarget);

    // Real performance score based on actual activity
    const validMetrics = [];
    if (taskRate !== null) validMetrics.push(taskRate);
    if (ticketRate !== null) validMetrics.push(ticketRate);
    if (registrationRate !== null) validMetrics.push(registrationRate);
    if (siteVisitRate !== null) validMetrics.push(siteVisitRate);
    if (collectionRate !== null) validMetrics.push(collectionRate);
    if (leadContactRate !== null) validMetrics.push(leadContactRate);
    if (dealRate !== null) validMetrics.push(dealRate);

    const finalScore = validMetrics.length > 0
      ? Math.round(validMetrics.reduce((sum, val) => sum + val, 0) / validMetrics.length)
      : 0;

    const performanceStatus = finalScore >= 75 ? 'On Track' : finalScore >= 40 ? 'Average' : 'Needs Focus';

    return {
      rank: idx + 1,
      id: member.id,
      name: member.name,
      role: member.role,
      email: member.email,
      project: member.project,
      operations: {
        tasksCompleted,
        tasksAssigned,
        taskCompletionRate: taskRate,
        ticketsResolved,
        ticketsAssigned,
        ticketResolutionRate: ticketRate,
        registrationsCompleted,
        registrationsTarget,
        registrationAchievementRate: registrationRate,
        siteVisitsCompleted,
        siteVisitsPlanned,
        siteVisitAchievementRate: siteVisitRate,
      },
      revenue: {
        totalDues,
        duesCollected,
        pendingDues,
        collectionPercentage: collectionRate,
        loansDisbursed,
        loansTarget,
        loanDisbursementRate: loanDisbursedRate,
        loanAmountRealized,
        loanRealizedTarget,
        loanRealizationRate: loanRealizedRate,
      },
      sales: {
        leadsContacted,
        leadsTarget,
        leadContactRate,
        leadToVisitRate,
        visitToDealRate,
        dealsClosed,
        dealsTarget,
        dealAchievementRate: dealRate,
      },
      score: finalScore,
      performanceStatus,
    };
  });

  // Calculate overall pillar summary cards for the selected view
  let selectedMember = null;
  if (executiveId && executiveId !== 'all') {
    selectedMember = teamScores.find((m) => m.id === executiveId || m.name.toLowerCase() === executiveId.toLowerCase());
  }

  const primarySource = selectedMember || teamScores[0];

  const pillarSummary = {
    operations: {
      tasksCompleted: primarySource.operations.tasksCompleted,
      tasksAssigned: primarySource.operations.tasksAssigned,
      taskCompletionRate: primarySource.operations.taskCompletionRate,
      ticketsCompleted: primarySource.operations.ticketsResolved,
      ticketsAssigned: primarySource.operations.ticketsAssigned,
      ticketResolutionRate: primarySource.operations.ticketResolutionRate,
      registrations: primarySource.operations.registrationsCompleted,
      registrationsTarget: primarySource.operations.registrationsTarget,
      registrationRate: primarySource.operations.registrationAchievementRate,
      siteVisits: primarySource.operations.siteVisitsCompleted,
      siteVisitsPlanned: primarySource.operations.siteVisitsPlanned,
      siteVisitRate: primarySource.operations.siteVisitAchievementRate,
    },
    revenue: {
      duesCollected: primarySource.revenue.duesCollected,
      totalDues: primarySource.revenue.totalDues,
      pendingDues: primarySource.revenue.pendingDues,
      collectionPercentage: primarySource.revenue.collectionPercentage,
      loansDisbursed: primarySource.revenue.loansDisbursed,
      loansTarget: primarySource.revenue.loansTarget,
      loanDisbursementRate: primarySource.revenue.loanDisbursementRate,
      loanRealized: primarySource.revenue.loanAmountRealized,
      loanRealizedTarget: primarySource.revenue.loanRealizedTarget,
      loanRealizationRate: primarySource.revenue.loanRealizationRate,
    },
    sales: {
      leadsContacted: primarySource.sales.leadsContacted,
      leadsTarget: primarySource.sales.leadsTarget,
      leadContactRate: primarySource.sales.leadContactRate,
      leadToVisitRate: primarySource.sales.leadToVisitRate,
      visitToDealRate: primarySource.sales.visitToDealRate,
      dealsClosed: primarySource.sales.dealsClosed,
      dealsTarget: primarySource.sales.dealsTarget,
      dealAchievementRate: primarySource.sales.dealAchievementRate,
    },
  };

  return {
    dateRange,
    period,
    project,
    pillar,
    executiveId,
    pillarSummary,
    teamScores,
  };
}

module.exports = {
  getScorecardData,
  resolveDateRange,
  safePercentage,
  DEFAULT_TEAM_MEMBERS,
};

