// ==============================================================================
// SCORECARD QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated performance analytics across Operations, Revenue, and Sales pillars
// for internal staff. Staff come from the database (the same source as the internal
// assignees endpoint), and tasks and tickets are counted only inside the requested
// date range. A metric the database cannot measure is null. No target, dues, or
// loan figure is assumed.
// ==============================================================================

const internalTaskQueries = require('./internalTaskQueries');
const ticketQueries = require('./ticketQueries');

const SCORECARD_ERRORS = Object.freeze({
  INVALID_CUSTOM_DATE: 'The custom date range needs valid startDate and endDate values.',
});

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

  switch (String(period).toLowerCase()) {
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
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        const error = new Error(SCORECARD_ERRORS.INVALID_CUSTOM_DATE);
        error.code = 'VALIDATION_FAILED';
        error.statusCode = 400;
        throw error;
      }
      break;
    default:
      break;
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    label: `${start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} - ${end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
  };
}

/** True when the record's creation time falls inside the date range. */
function isInDateRange(createdAt, range) {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) return false;
  return time >= new Date(range.startDate).getTime() && time <= new Date(range.endDate).getTime();
}

/** True when a task or ticket is assigned to the staff member, by name or by user id. */
function isAssignedTo(record, member) {
  const recordName = String(record.assigned_to_name || '').toLowerCase();
  const byName = Boolean(member.name) && recordName === String(member.name).toLowerCase();
  const byId = Boolean(member.id) && record.assigned_to_user_id === member.id;
  return byName || byId;
}

function isCompletedRecord(record) {
  return record.status === 'Completed';
}

function buildMemberScore(member, tasks, tickets) {
  const memberTasks = tasks.filter((t) => isAssignedTo(t, member));
  const tasksCompleted = memberTasks.filter(isCompletedRecord).length;
  const tasksAssigned = memberTasks.length;
  const taskRate = safePercentage(tasksCompleted, tasksAssigned);

  const memberTickets = tickets.filter((t) => isAssignedTo(t, member));
  const ticketsResolved = memberTickets.filter(isCompletedRecord).length;
  const ticketsAssigned = memberTickets.length;
  const ticketRate = safePercentage(ticketsResolved, ticketsAssigned);

  const registrationTasks = memberTasks.filter(
    (t) =>
      t.related_entity_type === 'VENDOR' ||
      t.related_entity_type === 'BUYER' ||
      (t.task_category || '').toUpperCase().includes('ONBOARDING')
  );
  const registrationsCompleted = registrationTasks.filter(isCompletedRecord).length;

  const visitTasks = memberTasks.filter(
    (t) => (t.title || '').toLowerCase().includes('visit') || (t.description || '').toLowerCase().includes('visit')
  );
  const siteVisitsCompleted = visitTasks.filter(isCompletedRecord).length;
  const siteVisitsPlanned = visitTasks.length;
  const siteVisitRate = safePercentage(siteVisitsCompleted, siteVisitsPlanned);

  const salesTasks = memberTasks.filter(
    (t) =>
      (t.task_category || '').toUpperCase().includes('BUSINESS_DEVELOPMENT') ||
      (t.task_category || '').toUpperCase().includes('SALES') ||
      (t.title || '').toLowerCase().includes('lead')
  );
  const leadsContacted = salesTasks.filter((t) => t.status === 'Completed' || t.status === 'In Progress').length;
  const leadToVisitRate = safePercentage(siteVisitsCompleted, leadsContacted);
  const dealsClosed = salesTasks.filter(
    (t) => t.status === 'Completed' && (t.title || '').toLowerCase().includes('deal')
  ).length;

  // Only rates measured from recorded activity count toward the score. The score is
  // null when the member has no measurable activity in the period.
  const validMetrics = [taskRate, ticketRate, siteVisitRate].filter((value) => value !== null);
  const score = validMetrics.length > 0
    ? Math.round(validMetrics.reduce((sum, value) => sum + value, 0) / validMetrics.length)
    : null;
  const performanceStatus = score === null ? null : score >= 75 ? 'On Track' : score >= 40 ? 'Average' : 'Needs Focus';

  return {
    rank: null,
    id: member.id,
    name: member.name,
    role: member.role || null,
    email: member.email || null,
    project: member.project || null,
    operations: {
      tasksCompleted,
      tasksAssigned,
      taskCompletionRate: taskRate,
      ticketsResolved,
      ticketsAssigned,
      ticketResolutionRate: ticketRate,
      registrationsCompleted,
      registrationsTarget: null,
      registrationAchievementRate: null,
      siteVisitsCompleted,
      siteVisitsPlanned,
      siteVisitAchievementRate: siteVisitRate,
    },
    revenue: {
      totalDues: null,
      duesCollected: null,
      pendingDues: null,
      collectionPercentage: null,
      loansDisbursed: null,
      loansTarget: null,
      loanDisbursementRate: null,
      loanAmountRealized: null,
      loanRealizedTarget: null,
      loanRealizationRate: null,
    },
    sales: {
      leadsContacted,
      leadsTarget: null,
      leadContactRate: null,
      leadToVisitRate,
      visitToDealRate: null,
      dealsClosed,
      dealsTarget: null,
      dealAchievementRate: null,
    },
    score,
    performanceStatus,
  };
}

function valueOrNull(source, key) {
  return source && source[key] !== undefined ? source[key] : null;
}

/** Pillar cards for the selected executive. Every value is null when there is no staff member. */
function buildPillarSummary(source) {
  const ops = source?.operations;
  const rev = source?.revenue;
  const sales = source?.sales;
  return {
    operations: {
      tasksCompleted: valueOrNull(ops, 'tasksCompleted'),
      tasksAssigned: valueOrNull(ops, 'tasksAssigned'),
      taskCompletionRate: valueOrNull(ops, 'taskCompletionRate'),
      ticketsCompleted: valueOrNull(ops, 'ticketsResolved'),
      ticketsAssigned: valueOrNull(ops, 'ticketsAssigned'),
      ticketResolutionRate: valueOrNull(ops, 'ticketResolutionRate'),
      registrations: valueOrNull(ops, 'registrationsCompleted'),
      registrationsTarget: valueOrNull(ops, 'registrationsTarget'),
      registrationRate: valueOrNull(ops, 'registrationAchievementRate'),
      siteVisits: valueOrNull(ops, 'siteVisitsCompleted'),
      siteVisitsPlanned: valueOrNull(ops, 'siteVisitsPlanned'),
      siteVisitRate: valueOrNull(ops, 'siteVisitAchievementRate'),
    },
    revenue: {
      duesCollected: valueOrNull(rev, 'duesCollected'),
      totalDues: valueOrNull(rev, 'totalDues'),
      pendingDues: valueOrNull(rev, 'pendingDues'),
      collectionPercentage: valueOrNull(rev, 'collectionPercentage'),
      loansDisbursed: valueOrNull(rev, 'loansDisbursed'),
      loansTarget: valueOrNull(rev, 'loansTarget'),
      loanDisbursementRate: valueOrNull(rev, 'loanDisbursementRate'),
      loanRealized: valueOrNull(rev, 'loanAmountRealized'),
      loanRealizedTarget: valueOrNull(rev, 'loanRealizedTarget'),
      loanRealizationRate: valueOrNull(rev, 'loanRealizationRate'),
    },
    sales: {
      leadsContacted: valueOrNull(sales, 'leadsContacted'),
      leadsTarget: valueOrNull(sales, 'leadsTarget'),
      leadContactRate: valueOrNull(sales, 'leadContactRate'),
      leadToVisitRate: valueOrNull(sales, 'leadToVisitRate'),
      visitToDealRate: valueOrNull(sales, 'visitToDealRate'),
      dealsClosed: valueOrNull(sales, 'dealsClosed'),
      dealsTarget: valueOrNull(sales, 'dealsTarget'),
      dealAchievementRate: valueOrNull(sales, 'dealAchievementRate'),
    },
  };
}

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

  const [allTasks, staff, ticketsRes] = await Promise.all([
    internalTaskQueries.listAllInternalTasks(),
    internalTaskQueries.getInternalAssignees(),
    ticketQueries.getTickets({ limit: 500 }),
  ]);

  const tasks = allTasks.filter((t) => isInDateRange(t.created_at, dateRange));
  const tickets = (ticketsRes?.rows || []).filter((t) => isInDateRange(t.created_at, dateRange));

  const teamScores = staff.map((member) => buildMemberScore(member, tasks, tickets));

  // Rank members with a measured score, highest first. Members without a score stay unranked.
  teamScores
    .filter((member) => member.score !== null)
    .sort((a, b) => b.score - a.score)
    .forEach((member, index) => {
      member.rank = index + 1;
    });

  let selectedMember = null;
  if (executiveId && executiveId !== 'all') {
    const wanted = String(executiveId).toLowerCase();
    selectedMember = teamScores.find((m) => m.id === executiveId || String(m.name || '').toLowerCase() === wanted) || null;
  }

  // A named executive who is not on the team yields no summary, not another member's figures.
  const executiveRequested = Boolean(executiveId) && executiveId !== 'all';
  const primarySource = executiveRequested ? selectedMember : (teamScores[0] || null);

  return {
    dateRange,
    period,
    project,
    pillar,
    executiveId,
    pillarSummary: buildPillarSummary(primarySource),
    teamScores,
  };
}

module.exports = {
  getScorecardData,
  resolveDateRange,
  safePercentage,
};
