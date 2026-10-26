/**
 * Companion to enterprise-inquiries.test.tsx.
 *
 * The primary suite renders the happy path: a populated server list, the status tabs,
 * a search and one note save. This file drives what it leaves out: the cold start (the
 * bundled starter lead) and the merge with cached leads, malformed server and cache
 * payloads, the refresh action, the search clear controls, status changes from the list
 * and from the dialog (server saved, server unreachable, unusable server answer), the
 * "last handled by" rules, note saving, and the fallbacks for leads with a missing
 * timestamp or an unrecognised status.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnterpriseInquiriesConsole, { type EnterpriseInquiry } from '@/app/category-manager/enterprise-inquiries';
import { formatIndianDateTime } from '@/lib/constants';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

type User = ReturnType<typeof userEvent.setup>;

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface PatchRequest {
  url: string;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

interface Routes {
  /** Answer to GET /api/enterprise-inquiries. */
  list: () => Promise<unknown>;
  /** Answer to PATCH /api/enterprise-inquiries/:id. When omitted the connection drops. */
  patch?: (id: string, body: Record<string, unknown>) => Promise<unknown>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const mockUseApp = useApp as jest.Mock;
const mockShowToast = jest.fn();
const fetchMock = jest.fn();
const originalFetch = global.fetch;

const STORAGE_KEY = 'procucev_enterprise_inquiries';
const LIST_URL = '/api/enterprise-inquiries?limit=100';
const SESSION_NAME = 'Vikas Sharma';
const DEFAULT_HANDLER = 'Category Manager';
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SEED_COMPANY = 'Procucev Navin Buyer';
const SEED_HEADING = /^Procucev\s+Navin Buyer$/;

// The console hard-codes its copy (none of it lives in UI_STRINGS), so it is asserted literally.
const COPY = {
  refresh: 'Refresh Leads',
  refreshing: 'Refreshing...',
  searchPlaceholder: /Search by company name, email, or phone/i,
  emptyTitle: 'No Enterprise Contract Inquiries Found',
  emptyGuidance: /When buyers click "Contact Us" on the Enterprise Contracts banner/,
  clearSearch: 'Clear Search',
  manage: /Manage & Notes/,
  modalSubtitle: 'Enterprise Contracts Inquiry Details',
  statusLabel: 'Lead Status:',
  notesLabel: 'Category Manager Notes:',
  saveNotes: 'Save Notes',
  saving: 'Saving...',
  close: 'Close',
  emailLabel: 'Email ID:',
  mobileLabel: 'Mobile Number:',
  lastHandledBy: 'Last Handled By:',
  receivedAt: 'Received At:',
  internalNotes: 'Internal Notes:',
  recent: 'Recent',
  newBadge: 'New \u2014 Action Required',
  contactedBadge: 'Contacted',
  whatsappChat: 'WhatsApp Chat',
  callNow: 'Call Now',
  whatsapp: 'WhatsApp',
  sendEmail: 'Send Email',
  toastTitle: 'Lead Updated',
  toastMessage: 'Enterprise inquiry details saved.',
} as const;

const unmatchedSearchMessage = (query: string): string =>
  `No enterprise inquiries match "${query}". Try clearing your search.`;

// Caption printed under each KPI number; the number is the element just before it.
const KPI = {
  total: 'submissions',
  pending: 'need outreach',
  talks: 'in talks',
  converted: 'converted',
} as const;

const ALPHA: EnterpriseInquiry = {
  id: 'inq-alpha',
  companyName: 'Alpha Castings & Forgings',
  email: 'sourcing@alpha-castings.example',
  mobile: '+91 98200-12345',
  buyerAccountId: 'buyer-alpha',
  notes: 'Wants SAP Ariba integration.',
  status: 'NEW',
  createdAt: '2026-10-15T09:00:00Z',
};

const BRAVO: EnterpriseInquiry = {
  id: 'inq-bravo',
  companyName: 'Bravo Motors Ltd',
  email: 'commercial@bravo-motors.example',
  mobile: '+91 98450 67890',
  status: 'IN_DISCUSSION',
  createdAt: '2026-10-14T14:30:00Z',
  contactedBy: 'Asha Rao',
  contactedAt: '2026-10-14T16:00:00Z',
};

const CHARLIE: EnterpriseInquiry = {
  id: 'inq-charlie',
  companyName: 'Charlie Energy Ltd',
  email: 'contracts@charlie-energy.example',
  mobile: '+91 97120 44556',
  status: 'CONTRACT_SIGNED',
  createdAt: '2026-10-10T11:00:00Z',
};

const DELTA: EnterpriseInquiry = {
  id: 'inq-delta',
  companyName: 'Delta Polymers Pvt Ltd',
  email: 'buying@delta-polymers.example',
  mobile: '+91 90000 11111',
  status: 'CONTACTED',
  createdAt: '2026-10-08T08:00:00Z',
};

const ECHO: EnterpriseInquiry = {
  id: 'inq-echo',
  companyName: 'Echo Textiles Ltd',
  email: 'procurement@echo-textiles.example',
  mobile: '+91 90000 22222',
  status: 'CLOSED',
  createdAt: '2026-10-05T07:00:00Z',
};

const CACHED_NEWER: EnterpriseInquiry = {
  id: 'inq-cached-newer',
  companyName: 'Foxtrot Cached Newer Ltd',
  email: 'hello@foxtrot-newer.example',
  mobile: '+91 90000 33333',
  status: 'NEW',
  createdAt: '2026-11-01T08:00:00Z',
};

const CACHED_OLDER: EnterpriseInquiry = {
  id: 'inq-cached-older',
  companyName: 'Golf Cached Older Ltd',
  email: 'hello@golf-older.example',
  mobile: '+91 90000 44444',
  status: 'CONTACTED',
  createdAt: '2026-09-01T08:00:00Z',
};

// A record from a newer API: a status this build has no label for, and no timestamp.
const MYSTERY: EnterpriseInquiry = {
  id: 'inq-mystery',
  companyName: 'Hotel Mystery Works',
  email: 'info@mystery-works.example',
  mobile: '+91 90000 55555',
  status: 'ARCHIVED' as unknown as EnterpriseInquiry['status'],
  createdAt: '',
};

// A row the console cannot key: it has no id.
const ROW_WITHOUT_ID = {
  companyName: 'Row Without Id',
  email: 'noid@example.test',
  mobile: '+91 90000 66666',
  status: 'NEW',
  createdAt: '2026-10-12T08:00:00Z',
};

function setSession(session: { name?: string } | null): void {
  mockUseApp.mockReturnValue({ showToast: mockShowToast, currentUserSession: session });
}

const okJson = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

const unreadableJson = () => ({
  ok: true,
  status: 200,
  json: async (): Promise<never> => {
    throw new SyntaxError('Unexpected end of JSON input');
  },
});

const listing = (data: unknown): Promise<unknown> => Promise.resolve(okJson({ success: true, data }));

const dropped = (): Promise<never> => Promise.reject(new TypeError('Failed to fetch'));

/** A PATCH answer that echoes the request, with fields only the server would add or change. */
const echoPatch =
  (serverFields: Record<string, unknown> = {}) =>
  (id: string, body: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(okJson({ success: true, data: { id, ...body, ...serverFields } }));

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function routeFetch({ list, patch }: Routes): void {
  fetchMock.mockImplementation((url: string, init?: FetchInit) => {
    if (init?.method === 'PATCH') {
      const id = decodeURIComponent(url.split('/').pop() ?? '');
      return patch ? patch(id, JSON.parse(init.body ?? '{}')) : dropped();
    }
    return list();
  });
}

function patchRequests(): PatchRequest[] {
  const calls = fetchMock.mock.calls as Array<[string, FetchInit | undefined]>;
  return calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([url, init]) => ({
      url,
      headers: init?.headers,
      body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>,
    }));
}

function cachedLeads(): EnterpriseInquiry[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as EnterpriseInquiry[];
}

/** Company names of the listed leads, top to bottom. Only valid while the dialog is closed. */
function headingNames(): string[] {
  return screen
    .getAllByRole('heading', { level: 3 })
    .map((heading) => (heading.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function kpi(caption: string): string {
  return screen.getByText(caption).previousElementSibling?.textContent ?? '';
}

async function renderLoaded(): Promise<User> {
  const user = userEvent.setup();
  render(<EnterpriseInquiriesConsole />);
  // The refresh control stays disabled and reads "Refreshing..." until the first load settles.
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(LIST_URL);
    expect(screen.getByRole('button', { name: COPY.refresh })).toBeEnabled();
  });
  return user;
}

describe('EnterpriseInquiriesConsole coverage companion', () => {
  let storageSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    mockShowToast.mockClear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    localStorage.removeItem(STORAGE_KEY);
    setSession({ name: SESSION_NAME });
  });

  afterEach(() => {
    storageSpy?.mockRestore();
    storageSpy = undefined;
    global.fetch = originalFetch;
    localStorage.removeItem(STORAGE_KEY);
  });

  describe('loading leads', () => {
    it('falls back to the bundled starter lead and caches it when the server has no leads', async () => {
      routeFetch({ list: () => listing([]) });
      await renderLoaded();

      expect(screen.getByRole('heading', { name: SEED_HEADING })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(kpi(KPI.total)).toBe('1');
      expect(kpi(KPI.pending)).toBe('1');
      expect(cachedLeads()).toHaveLength(1);
    });

    it('merges cached leads with the starter lead, newest first, when the server is unreachable', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([CACHED_OLDER, CACHED_NEWER]));
      routeFetch({ list: dropped });
      await renderLoaded();

      expect(headingNames()).toEqual([CACHED_NEWER.companyName, SEED_COMPANY, CACHED_OLDER.companyName]);
      expect(cachedLeads().map((cached) => cached.id)).toEqual([
        CACHED_NEWER.id,
        expect.any(String),
        CACHED_OLDER.id,
      ]);
    });

    it('skips unusable cached entries and keeps the valid cached lead', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([null, ROW_WITHOUT_ID, CACHED_OLDER]));
      routeFetch({ list: () => listing([]) });
      await renderLoaded();

      expect(headingNames()).toEqual([SEED_COMPANY, CACHED_OLDER.companyName]);
      expect(screen.queryByText(ROW_WITHOUT_ID.companyName)).not.toBeInTheDocument();
    });

    it('prefers the server copy of a lead, keeps cached-only leads and drops server rows without an id', async () => {
      const staleCopy = { ...BRAVO, companyName: 'Stale Cached Bravo' };
      localStorage.setItem(STORAGE_KEY, JSON.stringify([staleCopy, CACHED_NEWER]));
      routeFetch({ list: () => listing([null, ROW_WITHOUT_ID, ALPHA, BRAVO]) });
      await renderLoaded();

      expect(headingNames()).toEqual([CACHED_NEWER.companyName, ALPHA.companyName, BRAVO.companyName]);
      expect(screen.queryByText('Stale Cached Bravo')).not.toBeInTheDocument();
      expect(screen.queryByText(ROW_WITHOUT_ID.companyName)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: SEED_HEADING })).not.toBeInTheDocument();
      expect(cachedLeads().map((cached) => cached.id)).toEqual([CACHED_NEWER.id, ALPHA.id, BRAVO.id]);
    });

    it.each([
      { label: 'reports failure', answer: () => Promise.resolve(okJson({ success: false, data: [ALPHA] })) },
      {
        label: 'carries data that is not a list',
        answer: () => Promise.resolve(okJson({ success: true, data: { items: [ALPHA] } })),
      },
      { label: 'is an empty body', answer: () => Promise.resolve(okJson(null)) },
      { label: 'cannot be parsed', answer: () => Promise.resolve(unreadableJson()) },
    ])('ignores a server answer that $label and shows the starter lead', async ({ answer }) => {
      routeFetch({ list: answer });
      await renderLoaded();

      expect(headingNames()).toEqual([SEED_COMPANY]);
      expect(screen.queryByText(ALPHA.companyName)).not.toBeInTheDocument();
    });

    it.each([
      { label: 'an object rather than a list', stored: JSON.stringify({ id: 'inq-lone' }) },
      { label: 'text that is not valid JSON', stored: 'not-json{' },
    ])('ignores a cached value that is $label and rewrites the cache from the server', async ({ stored }) => {
      localStorage.setItem(STORAGE_KEY, stored);
      routeFetch({ list: () => listing([ALPHA]) });
      await renderLoaded();

      expect(headingNames()).toEqual([ALPHA.companyName]);
      expect(cachedLeads().map((cached) => cached.id)).toEqual([ALPHA.id]);
    });

    it('still lists leads and saves changes when the browser refuses to store the cache', async () => {
      storageSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });
      routeFetch({ list: () => listing([ALPHA]), patch: echoPatch() });
      const user = await renderLoaded();
      expect(headingNames()).toEqual([ALPHA.companyName]);

      const status = screen.getByRole('combobox');
      await user.selectOptions(status, 'CONTACTED');

      await waitFor(() => expect(kpi(KPI.pending)).toBe('0'));
      expect(status).toHaveValue('CONTACTED');
      expect(mockShowToast).toHaveBeenCalledWith(COPY.toastTitle, COPY.toastMessage, 'success');
    });
  });

  describe('refreshing leads', () => {
    it('reloads from the server and disables Refresh Leads while the request is open', async () => {
      let serverLeads: EnterpriseInquiry[] = [ALPHA];
      routeFetch({ list: () => listing(serverLeads) });
      const user = await renderLoaded();
      expect(headingNames()).toEqual([ALPHA.companyName]);

      const pending = createDeferred<unknown>();
      fetchMock.mockImplementationOnce(() => pending.promise);
      serverLeads = [ALPHA, BRAVO];
      await user.click(screen.getByRole('button', { name: COPY.refresh }));

      expect(screen.getByRole('button', { name: COPY.refreshing })).toBeDisabled();

      await act(async () => {
        pending.resolve(okJson({ success: true, data: serverLeads }));
      });

      expect(await screen.findByRole('heading', { name: BRAVO.companyName })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: COPY.refresh })).toBeEnabled();
      expect(headingNames()).toEqual([ALPHA.companyName, BRAVO.companyName]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([LIST_URL, LIST_URL]);
    });
  });

  describe('search and status tabs', () => {
    it('counts leads per status and lists them newest first whatever order the server sends', async () => {
      routeFetch({ list: () => listing([CHARLIE, ECHO, ALPHA, DELTA, BRAVO]) });
      await renderLoaded();

      expect(headingNames()).toEqual([
        ALPHA.companyName,
        BRAVO.companyName,
        CHARLIE.companyName,
        DELTA.companyName,
        ECHO.companyName,
      ]);
      expect(kpi(KPI.total)).toBe('5');
      expect(kpi(KPI.pending)).toBe('1');
      // Contacted and In Discussion leads are both "in talks".
      expect(kpi(KPI.talks)).toBe('2');
      expect(kpi(KPI.converted)).toBe('1');
      expect(screen.getByRole('button', { name: /^All Leads\s*5$/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^New\s*1$/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Signed\s*1$/ })).toBeInTheDocument();
    });

    it('lists one status per tab, so a Contacted lead only appears under All Leads', async () => {
      routeFetch({ list: () => listing([ALPHA, BRAVO, CHARLIE, DELTA, ECHO]) });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /In Discussion/ }));
      expect(headingNames()).toEqual([BRAVO.companyName]);

      await user.click(screen.getByRole('button', { name: /^New\s*1$/ }));
      expect(headingNames()).toEqual([ALPHA.companyName]);

      await user.click(screen.getByRole('button', { name: /^Signed\s*1$/ }));
      expect(headingNames()).toEqual([CHARLIE.companyName]);

      await user.click(screen.getByRole('button', { name: /^All Leads/ }));
      expect(headingNames()).toHaveLength(5);
    });

    it('points managers to the Subscription Center banner when a tab has no leads', async () => {
      routeFetch({ list: () => listing([ALPHA]) });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /^Signed/ }));

      expect(screen.getByText(COPY.emptyTitle)).toBeInTheDocument();
      expect(screen.getByText(COPY.emptyGuidance)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: COPY.clearSearch })).not.toBeInTheDocument();
    });

    it('matches search text on notes and mobile number, ignoring case and padding, and ignores blank queries', async () => {
      routeFetch({ list: () => listing([ALPHA, BRAVO, CHARLIE]) });
      const user = await renderLoaded();
      const search = screen.getByPlaceholderText(COPY.searchPlaceholder);

      await user.type(search, '  ARIBA ');
      expect(headingNames()).toEqual([ALPHA.companyName]);

      await user.clear(search);
      await user.type(search, '97120 44');
      expect(headingNames()).toEqual([CHARLIE.companyName]);

      await user.clear(search);
      await user.type(search, '   ');
      expect(headingNames()).toHaveLength(3);
    });

    it('clears the search from the inline clear control, which only shows while a query is typed', async () => {
      routeFetch({ list: () => listing([ALPHA, BRAVO]) });
      const user = await renderLoaded();
      const search = screen.getByPlaceholderText(COPY.searchPlaceholder);

      // The inline clear control has no accessible name, so it is the only nameless button here.
      expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();

      await user.type(search, 'bravo');
      expect(headingNames()).toEqual([BRAVO.companyName]);

      await user.click(screen.getByRole('button', { name: '' }));

      expect(search).toHaveValue('');
      expect(headingNames()).toEqual([ALPHA.companyName, BRAVO.companyName]);
      expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();
    });

    it('explains an unmatched search with the typed query and restores the list from Clear Search', async () => {
      routeFetch({ list: () => listing([ALPHA, BRAVO]) });
      const user = await renderLoaded();
      const search = screen.getByPlaceholderText(COPY.searchPlaceholder);

      await user.type(search, 'zzz-unknown');

      expect(screen.getByText(COPY.emptyTitle)).toBeInTheDocument();
      expect(screen.getByText(unmatchedSearchMessage('zzz-unknown'))).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: COPY.clearSearch }));

      expect(search).toHaveValue('');
      expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
      expect(headingNames()).toEqual([ALPHA.companyName, BRAVO.companyName]);
    });
  });

  describe('lead rows and dialog', () => {
    it('links each lead to call, WhatsApp and email using a cleaned number and an encoded name', async () => {
      routeFetch({ list: () => listing([ALPHA]) });
      await renderLoaded();

      expect(screen.getByRole('link', { name: ALPHA.mobile })).toHaveAttribute('href', 'tel:+919820012345');
      expect(screen.getByRole('link', { name: ALPHA.email })).toHaveAttribute(
        'href',
        `mailto:${ALPHA.email}?subject=Enterprise%20Contract%20Inquiry%20-%20Procucev`
      );
      const whatsapp = screen.getByRole('link', { name: COPY.whatsappChat });
      expect(whatsapp).toHaveAttribute(
        'href',
        'https://wa.me/+919820012345?text=Hi%20Alpha%20Castings%20%26%20Forgings%2C%20thank%20you%20for%20your%20interest%20in%20Procucev%20Enterprise%20Contracts.'
      );
      expect(whatsapp).toHaveAttribute('target', '_blank');
      expect(whatsapp).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('opens the dialog with contact shortcuts, lead details and who last handled the lead', async () => {
      routeFetch({ list: () => listing([BRAVO]) });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: COPY.manage }));

      expect(screen.getByText(COPY.modalSubtitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: COPY.callNow })).toHaveAttribute('href', 'tel:+919845067890');
      expect(screen.getByRole('link', { name: COPY.whatsapp })).toHaveAttribute(
        'href',
        'https://wa.me/+919845067890?text=Hi%20Bravo%20Motors%20Ltd%2C%20thank%20you%20for%20your%20interest%20in%20Procucev%20Enterprise%20Contracts.'
      );
      expect(screen.getByRole('link', { name: COPY.sendEmail })).toHaveAttribute(
        'href',
        `mailto:${BRAVO.email}?subject=Procucev%20Enterprise%20Contracts%20-%20Discussion`
      );
      expect(screen.getByText(COPY.emailLabel).parentElement).toHaveTextContent(BRAVO.email);
      expect(screen.getByText(COPY.mobileLabel).parentElement).toHaveTextContent(BRAVO.mobile);
      expect(screen.getByText(COPY.receivedAt).parentElement).toHaveTextContent(
        formatIndianDateTime(BRAVO.createdAt)
      );
      expect(screen.getByText(COPY.lastHandledBy).parentElement).toHaveTextContent('Asha Rao');
      expect(screen.getByLabelText(COPY.statusLabel)).toHaveValue('IN_DISCUSSION');
    });

    it('closes the dialog from the header icon and from the footer Close button', async () => {
      routeFetch({ list: () => listing([ALPHA]) });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: COPY.manage }));
      const [headerClose, footerClose] = screen.getAllByRole('button', { name: COPY.close });
      expect(headerClose).toHaveAttribute('aria-label', COPY.close);
      expect(footerClose).toHaveTextContent(COPY.close);

      await user.click(headerClose);
      expect(screen.queryByText(COPY.modalSubtitle)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: COPY.manage }));
      expect(screen.getByText(COPY.modalSubtitle)).toBeInTheDocument();

      await user.click(screen.getAllByRole('button', { name: COPY.close })[1]);
      expect(screen.queryByText(COPY.modalSubtitle)).not.toBeInTheDocument();
    });

    it('prefills notes from the lead, starts blank without notes, and drops unsaved edits on reopening', async () => {
      routeFetch({ list: () => listing([ALPHA, CHARLIE]) });
      const user = await renderLoaded();
      const [manageAlpha, manageCharlie] = screen.getAllByRole('button', { name: COPY.manage });

      await user.click(manageAlpha);
      const notes = screen.getByLabelText(COPY.notesLabel);
      expect(notes).toHaveValue(ALPHA.notes);
      fireEvent.change(notes, { target: { value: 'Unsaved draft' } });
      expect(notes).toHaveValue('Unsaved draft');
      await user.click(screen.getAllByRole('button', { name: COPY.close })[1]);

      await user.click(manageCharlie);
      expect(screen.getByLabelText(COPY.notesLabel)).toHaveValue('');
      await user.click(screen.getAllByRole('button', { name: COPY.close })[1]);

      await user.click(manageAlpha);
      expect(screen.getByLabelText(COPY.notesLabel)).toHaveValue(ALPHA.notes);
    });
  });

  describe('leads with missing or unexpected fields', () => {
    it('treats an unknown status as New and a missing timestamp as Recent, in the list and the dialog', async () => {
      routeFetch({ list: () => listing([MYSTERY]) });
      const user = await renderLoaded();

      expect(headingNames()).toEqual([MYSTERY.companyName]);
      expect(screen.getByText(COPY.newBadge)).toBeInTheDocument();
      expect(screen.getAllByText(COPY.recent)).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: COPY.manage }));

      expect(screen.getAllByText(COPY.recent)).toHaveLength(2);
      expect(screen.getByText(COPY.receivedAt).parentElement).toHaveTextContent(COPY.recent);
      expect(screen.getByLabelText(COPY.notesLabel)).toHaveValue('');
    });
  });

  describe('changing a lead status', () => {
    it('sends the status and handler to an encoded URL, then shows the record the server saved', async () => {
      const spaced: EnterpriseInquiry = { ...ALPHA, id: 'inq/alpha 1' };
      routeFetch({
        list: () => listing([spaced, BRAVO]),
        patch: echoPatch({ contactedAt: '2026-10-16T10:00:00Z' }),
      });
      const user = await renderLoaded();
      expect(kpi(KPI.pending)).toBe('1');

      const [spacedStatus] = screen.getAllByRole('combobox');
      await user.selectOptions(spacedStatus, 'CONTACTED');
      await waitFor(() => expect(kpi(KPI.pending)).toBe('0'));

      expect(spacedStatus).toHaveValue('CONTACTED');
      expect(patchRequests()).toEqual([
        {
          url: '/api/enterprise-inquiries/inq%2Falpha%201',
          headers: { 'Content-Type': 'application/json' },
          body: { status: 'CONTACTED', contactedBy: SESSION_NAME },
        },
      ]);
      expect(kpi(KPI.talks)).toBe('2');
      // The status dropdown also has a "Contacted" option, so only the badge span is matched.
      expect(screen.getByText(COPY.contactedBadge, { selector: 'span' })).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(COPY.toastTitle, COPY.toastMessage, 'success');
      expect(cachedLeads().find((cached) => cached.id === spaced.id)).toMatchObject({
        status: 'CONTACTED',
        contactedBy: SESSION_NAME,
        contactedAt: '2026-10-16T10:00:00Z',
      });
    });

    it('applies the change locally and credits the signed-in handler when the server cannot be reached', async () => {
      routeFetch({ list: () => listing([ALPHA, BRAVO]), patch: dropped });
      const user = await renderLoaded();

      const [alphaStatus] = screen.getAllByRole('combobox');
      await user.selectOptions(alphaStatus, 'IN_DISCUSSION');
      await waitFor(() => expect(kpi(KPI.talks)).toBe('2'));

      expect(alphaStatus).toHaveValue('IN_DISCUSSION');
      expect(kpi(KPI.pending)).toBe('0');
      expect(mockShowToast).toHaveBeenCalledWith(COPY.toastTitle, COPY.toastMessage, 'success');
      expect(cachedLeads().find((cached) => cached.id === ALPHA.id)).toMatchObject({
        status: 'IN_DISCUSSION',
        contactedBy: SESSION_NAME,
        contactedAt: expect.stringMatching(ISO_TIMESTAMP),
        updatedAt: expect.stringMatching(ISO_TIMESTAMP),
      });

      await user.click(screen.getAllByRole('button', { name: COPY.manage })[0]);
      expect(screen.getByText(COPY.lastHandledBy).parentElement).toHaveTextContent(SESSION_NAME);
    });

    it.each([
      {
        label: 'reports failure',
        answer: () => Promise.resolve(okJson({ success: false, error: 'Validation failed' })),
      },
      { label: 'has no record', answer: () => Promise.resolve(okJson({ success: true })) },
      { label: 'cannot be parsed', answer: () => Promise.resolve(unreadableJson()) },
    ])('keeps the change locally when the save answer $label', async ({ answer }) => {
      routeFetch({ list: () => listing([ALPHA]), patch: answer });
      const user = await renderLoaded();

      const status = screen.getByRole('combobox');
      await user.selectOptions(status, 'CLOSED');
      await waitFor(() => expect(kpi(KPI.pending)).toBe('0'));

      expect(status).toHaveValue('CLOSED');
      expect(patchRequests()).toHaveLength(1);
      expect(mockShowToast).toHaveBeenCalledWith(COPY.toastTitle, COPY.toastMessage, 'success');
      expect(cachedLeads()[0]).toMatchObject({
        id: ALPHA.id,
        status: 'CLOSED',
        contactedBy: SESSION_NAME,
        updatedAt: expect.stringMatching(ISO_TIMESTAMP),
      });
    });

    it.each([
      { label: 'server saved the change', session: null, patch: echoPatch() },
      { label: 'server was unreachable', session: { name: '' }, patch: dropped },
    ])('credits the default handler when the session has no name and the $label', async ({ session, patch }) => {
      setSession(session);
      routeFetch({ list: () => listing([ALPHA]), patch });
      const user = await renderLoaded();

      await user.selectOptions(screen.getByRole('combobox'), 'CONTACTED');
      await waitFor(() => expect(kpi(KPI.talks)).toBe('1'));

      expect(patchRequests()[0].body).toEqual({ status: 'CONTACTED', contactedBy: DEFAULT_HANDLER });
      await user.click(screen.getByRole('button', { name: COPY.manage }));
      expect(screen.getByText(COPY.lastHandledBy).parentElement).toHaveTextContent(DEFAULT_HANDLER);
    });

    it('keeps the earlier handler when a lead is moved back to New while offline', async () => {
      routeFetch({ list: () => listing([BRAVO]), patch: dropped });
      const user = await renderLoaded();

      const status = screen.getByRole('combobox');
      await user.selectOptions(status, 'NEW');
      await waitFor(() => expect(kpi(KPI.pending)).toBe('1'));

      expect(status).toHaveValue('NEW');
      expect(cachedLeads()[0]).toMatchObject({
        status: 'NEW',
        contactedBy: BRAVO.contactedBy,
        contactedAt: BRAVO.contactedAt,
      });
      await user.click(screen.getByRole('button', { name: COPY.manage }));
      expect(screen.getByText(COPY.lastHandledBy).parentElement).toHaveTextContent('Asha Rao');
    });

    it('updates the open dialog and the list together when the status is changed in the dialog', async () => {
      routeFetch({
        list: () => listing([ALPHA, BRAVO]),
        patch: echoPatch({ contactedBy: 'Billing Desk' }),
      });
      const user = await renderLoaded();

      await user.click(screen.getAllByRole('button', { name: COPY.manage })[0]);
      const dialogStatus = screen.getByLabelText(COPY.statusLabel);
      expect(dialogStatus).toHaveValue('NEW');
      expect(screen.queryByText(COPY.lastHandledBy)).not.toBeInTheDocument();

      await user.selectOptions(dialogStatus, 'CONTRACT_SIGNED');
      await waitFor(() => expect(kpi(KPI.converted)).toBe('1'));

      expect(dialogStatus).toHaveValue('CONTRACT_SIGNED');
      expect(screen.getAllByRole('combobox')[0]).toHaveValue('CONTRACT_SIGNED');
      // The server's own record wins over what the console would have stamped.
      expect(screen.getByText(COPY.lastHandledBy).parentElement).toHaveTextContent('Billing Desk');
      expect(screen.getByText(COPY.modalSubtitle)).toBeInTheDocument();
      expect(patchRequests().map((request) => request.body)).toEqual([
        { status: 'CONTRACT_SIGNED', contactedBy: SESSION_NAME },
      ]);
    });

    it('leaves the open dialog alone when a different lead is updated from the list', async () => {
      routeFetch({ list: () => listing([ALPHA, BRAVO]), patch: echoPatch() });
      const user = await renderLoaded();

      await user.click(screen.getAllByRole('button', { name: COPY.manage })[0]);
      const [, bravoStatus] = screen.getAllByRole('combobox');
      await user.selectOptions(bravoStatus, 'CLOSED');
      await waitFor(() => expect(kpi(KPI.talks)).toBe('0'));

      expect(bravoStatus).toHaveValue('CLOSED');
      expect(screen.getByLabelText(COPY.statusLabel)).toHaveValue('NEW');
      expect(screen.queryByText(COPY.lastHandledBy)).not.toBeInTheDocument();
      expect(patchRequests().map((request) => request.url)).toEqual([`/api/enterprise-inquiries/${BRAVO.id}`]);
    });
  });

  describe('saving notes', () => {
    it('trims the notes, shows Saving... while the request is open and updates the lead preview', async () => {
      const pending = createDeferred<unknown>();
      routeFetch({ list: () => listing([ALPHA]), patch: () => pending.promise });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: COPY.manage }));
      fireEvent.change(screen.getByLabelText(COPY.notesLabel), {
        target: { value: '  Agreed 15% volume rebate.  ' },
      });
      await user.click(screen.getByRole('button', { name: COPY.saveNotes }));

      expect(await screen.findByRole('button', { name: COPY.saving })).toBeDisabled();
      expect(patchRequests().map((request) => request.body)).toEqual([
        { notes: 'Agreed 15% volume rebate.', contactedBy: SESSION_NAME },
      ]);

      await act(async () => {
        pending.resolve(
          okJson({
            success: true,
            data: { id: ALPHA.id, notes: 'Agreed 15% volume rebate.', contactedBy: SESSION_NAME },
          })
        );
      });

      expect(await screen.findByRole('button', { name: COPY.saveNotes })).toBeEnabled();
      expect(screen.getByText(COPY.internalNotes).parentElement).toHaveTextContent('Agreed 15% volume rebate.');
      expect(screen.getByText(COPY.modalSubtitle)).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith(COPY.toastTitle, COPY.toastMessage, 'success');
    });

    it('saves notes locally without crediting a handler when the server cannot be reached', async () => {
      routeFetch({ list: () => listing([CHARLIE]), patch: dropped });
      const user = await renderLoaded();
      expect(screen.queryByText(COPY.internalNotes)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: COPY.manage }));
      fireEvent.change(screen.getByLabelText(COPY.notesLabel), {
        target: { value: '  Call back on Monday.  ' },
      });
      await user.click(screen.getByRole('button', { name: COPY.saveNotes }));

      expect(await screen.findByText(COPY.internalNotes)).toBeInTheDocument();
      expect(screen.getByText(COPY.internalNotes).parentElement).toHaveTextContent('Call back on Monday.');
      expect(screen.queryByText(COPY.lastHandledBy)).not.toBeInTheDocument();
      expect(cachedLeads()[0]).toMatchObject({ id: CHARLIE.id, notes: 'Call back on Monday.' });
      expect(cachedLeads()[0]).not.toHaveProperty('contactedBy');
      expect(mockShowToast).toHaveBeenCalledWith(COPY.toastTitle, COPY.toastMessage, 'success');
    });
  });
});
