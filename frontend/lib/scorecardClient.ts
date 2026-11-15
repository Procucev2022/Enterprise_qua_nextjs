import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import type { ScorecardData } from './types';

const SCORECARD_LOG_CATEGORY = 'SCORECARD_CLIENT';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ScorecardParams {
  period?: 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'financial_year' | 'custom';
  startDate?: string;
  endDate?: string;
  project?: string;
  pillar?: string;
  executiveId?: string | null;
}

/** Result of the scorecard request. `data` is null when it could not be loaded. */
export interface ScorecardResult {
  data: ScorecardData | null;
  error?: string;
}

/**
 * Fetch scorecard performance data for team or individual executive.
 * On failure `data` is null and `error` says why.
 */
export async function fetchScorecardData(params: ScorecardParams = {}): Promise<ScorecardResult> {
  const resource = UI_STRINGS.dataLoad.resources.scorecard;
  try {
    const query = new URLSearchParams();
    if (params.period) query.set('period', params.period);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.project && params.project !== 'all') query.set('project', params.project);
    if (params.pillar && params.pillar !== 'all') query.set('pillar', params.pillar);
    if (params.executiveId && params.executiveId !== 'all') query.set('executiveId', params.executiveId);

    const res = await fetch(`/api/scorecard?${query.toString()}`, { headers: authHeaders() });
    if (!res.ok) {
      return {
        data: null,
        error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }),
      };
    }
    const json = await res.json();
    if (!json?.data) {
      return {
        data: null,
        error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }),
      };
    }
    return { data: json.data };
  } catch (error: unknown) {
    logger.error('Scorecard request failed', { error }, SCORECARD_LOG_CATEGORY);
    return {
      data: null,
      error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }),
    };
  }
}
