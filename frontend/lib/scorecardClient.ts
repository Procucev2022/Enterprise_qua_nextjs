import { authClient } from './authClient';
import type { ScorecardData } from './types';

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

/**
 * Fetch scorecard performance data for team or individual executive.
 */
export async function fetchScorecardData(params: ScorecardParams = {}): Promise<ScorecardData | null> {
  try {
    const query = new URLSearchParams();
    if (params.period) query.set('period', params.period);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.project && params.project !== 'all') query.set('project', params.project);
    if (params.pillar && params.pillar !== 'all') query.set('pillar', params.pillar);
    if (params.executiveId && params.executiveId !== 'all') query.set('executiveId', params.executiveId);

    const res = await fetch(`/api/scorecard?${query.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

