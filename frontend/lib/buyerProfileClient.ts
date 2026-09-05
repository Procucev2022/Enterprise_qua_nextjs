import { authClient } from './authClient';
import { BUYER_PROFILE_ENDPOINTS } from './constants';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  BuyerProfile,
  BuyerProfileCategory,
  BuyerProfileResult,
  BuyerProfileSaveResult,
  BuyerProfileUpdatePayload,
  CategoryTaxonomyResult,
  MajorMinorCategory,
} from './types';

/**
 * Transport for the buyer organisation profile.
 *
 * The record lives in the shared Procucev identity schema, and the organisation
 * it belongs to is resolved server-side from the session token — the browser
 * never names an organisation, so a tampered payload cannot reach another
 * buyer's profile.
 *
 * Like the other clients in this directory, nothing here falls back to local
 * data — not the profile, and not the category taxonomy. Every value the screen
 * shows is a row that exists in the shared Procucev schema. An unreachable API
 * resolves with `success: false` and copy that says the record was not read or
 * not written, so a backend outage can never be mistaken for a profile that is
 * genuinely blank, for a save that genuinely landed, or for a taxonomy that
 * genuinely has these categories in it.
 */

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Shape of the JSON envelope every buyer-profile endpoint returns. */
interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  categoryCount?: number | null;
  data?: unknown;
}

async function readEnvelope(res: Response): Promise<ApiEnvelope | null> {
  try {
    return (await res.json()) as ApiEnvelope;
  } catch {
    return null;
  }
}

/**
 * Turn a non-success response into a failure the screen can explain.
 *
 * 401 and 403 are singled out because they need different action from the buyer
 * than a transient fault: one means sign in again, the other means this account
 * will never be allowed and there is no point retrying.
 */
function describeFailure(res: Response, body: ApiEnvelope | null): { error: string; fieldErrors?: Record<string, string> } {
  if (res.status === 401) {
    return { error: body?.error || UI_STRINGS.buyerProfile.sessionExpired };
  }
  if (res.status === 403) {
    return { error: body?.error || UI_STRINGS.buyerProfile.notPermitted };
  }
  return {
    error: body?.error || UI_STRINGS.buyerProfile.serverErrorFallback,
    ...(body?.fieldErrors ? { fieldErrors: body.fieldErrors } : {}),
  };
}

/**
 * Read the signed-in buyer's organisation profile.
 */
export async function fetchBuyerProfile(): Promise<BuyerProfileResult> {
  let res: Response;
  try {
    res = await fetch(BUYER_PROFILE_ENDPOINTS.ME, { headers: authHeaders() });
  } catch {
    logger.error('Buyer profile load failed: API unreachable', {}, 'BUYER_PROFILE');
    return { success: false, error: UI_STRINGS.buyerProfile.loadUnreachable };
  }

  const body = await readEnvelope(res);

  if (!res.ok || !body?.success || !body.data) {
    const { error } = describeFailure(res, body);
    logger.error('Buyer profile load rejected', { status: res.status, error }, 'BUYER_PROFILE');
    return {
      success: false,
      status: res.status,
      // A 401/403 message is already a complete instruction, so it is shown as
      // it stands rather than wrapped in "could not be loaded: ...".
      error:
        res.status === 401 || res.status === 403
          ? error
          : formatString(UI_STRINGS.buyerProfile.loadRejected, { reason: error }),
    };
  }

  logger.info('Buyer profile loaded', {}, 'BUYER_PROFILE');
  return { success: true, status: res.status, data: body.data as BuyerProfile };
}

/**
 * Patch the signed-in buyer's organisation profile.
 *
 * Omitted fields keep their stored value, so a caller that renders a subset of
 * the form cannot blank the fields it does not show.
 */
export async function saveBuyerProfile(
  payload: BuyerProfileUpdatePayload
): Promise<BuyerProfileSaveResult> {
  let res: Response;
  try {
    res = await fetch(BUYER_PROFILE_ENDPOINTS.ME, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    logger.error('Buyer profile save failed: API unreachable', {}, 'BUYER_PROFILE');
    return { success: false, error: UI_STRINGS.buyerProfile.saveUnreachable };
  }

  const body = await readEnvelope(res);

  if (!res.ok || !body?.success) {
    const { error, fieldErrors } = describeFailure(res, body);
    logger.error('Buyer profile save rejected', { status: res.status, error }, 'BUYER_PROFILE');
    return {
      success: false,
      status: res.status,
      ...(fieldErrors ? { fieldErrors } : {}),
      error:
        res.status === 401 || res.status === 403
          ? error
          : formatString(UI_STRINGS.buyerProfile.saveRejected, { reason: error }),
    };
  }

  logger.info('Buyer profile saved', { categoryCount: body.categoryCount }, 'BUYER_PROFILE');
  return {
    success: true,
    status: res.status,
    data: (body.data as BuyerProfile) || undefined,
    message: body.message,
    categoryCount: body.categoryCount ?? null,
  };
}

/**
 * Read the major/minor procurement taxonomy the category tree renders.
 *
 * Served from the `category_division` master table, which is the same table the
 * Java p2pservices app reads and the same one RFQ vendor matching resolves
 * against. There is deliberately no bundled fallback: a checkbox the buyer can
 * tick has to correspond to a real category, because the selection is written
 * straight back as `org_division_category` rows and then used to fan RFQs out to
 * vendors. Offering a category the master does not contain would produce a
 * procurement scope that silently matches nothing.
 *
 * A failure therefore yields an empty list plus a reason for the caller to
 * surface, rather than a plausible-looking tree assembled offline.
 */
export async function fetchCategoryTaxonomy(): Promise<CategoryTaxonomyResult> {
  let res: Response;
  try {
    res = await fetch(BUYER_PROFILE_ENDPOINTS.CATEGORIES, { headers: authHeaders() });
  } catch {
    logger.error('Category taxonomy load failed: API unreachable', {}, 'BUYER_PROFILE');
    return { success: false, data: [], error: UI_STRINGS.buyerProfile.loadUnreachable };
  }

  const body = await readEnvelope(res);

  if (!res.ok || !body?.success || !Array.isArray(body.data)) {
    const { error } = describeFailure(res, body);
    logger.error('Category taxonomy load rejected', { status: res.status, error }, 'BUYER_PROFILE');
    return {
      success: false,
      data: [],
      error:
        res.status === 401 || res.status === 403
          ? error
          : formatString(UI_STRINGS.buyerProfile.loadRejected, { reason: error }),
    };
  }

  logger.info('Category taxonomy loaded', { majorCount: body.data.length }, 'BUYER_PROFILE');
  return { success: true, data: body.data as MajorMinorCategory[] };
}

/**
 * Flatten the screen's nested selection into the transport pairs.
 *
 * Only minors under a still-selected major are kept: de-selecting a major leaves
 * its minors behind in the map so the choice can be restored with one click, and
 * those must not be saved.
 */
export function flattenCategorySelection(
  selectedMajor: string[],
  selectedMinor: Record<string, string[]>
): BuyerProfileCategory[] {
  const pairs: BuyerProfileCategory[] = [];
  selectedMajor.forEach((major) => {
    (selectedMinor[major] || []).forEach((minor) => {
      pairs.push({ major, minor });
    });
  });
  return pairs;
}

/**
 * Rebuild the screen's nested selection from stored pairs.
 *
 * A stored pair whose major is blank is skipped: rows like that exist in
 * `org_division_category` from earlier imports, and with no major category they
 * have no accordion row to appear under.
 */
export function expandCategorySelection(categories: BuyerProfileCategory[] | undefined): {
  selectedMajor: string[];
  selectedMinor: Record<string, string[]>;
} {
  const selectedMinor: Record<string, string[]> = {};
  const selectedMajor: string[] = [];

  (categories || []).forEach(({ major, minor }) => {
    if (!major || !minor) return;
    if (!selectedMinor[major]) {
      selectedMinor[major] = [];
      selectedMajor.push(major);
    }
    if (!selectedMinor[major].includes(minor)) {
      selectedMinor[major].push(minor);
    }
  });

  return { selectedMajor, selectedMinor };
}

const buyerProfileClient = {
  fetchBuyerProfile,
  saveBuyerProfile,
  fetchCategoryTaxonomy,
  flattenCategorySelection,
  expandCategorySelection,
};

export default buyerProfileClient;
