import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import RFQDetails, { daysUntil, lineItemsToCsv } from '@/app/buyer/rfq-details';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES, formatCurrency, formatIndianDate, formatIndianDateTime } from '@/lib/constants';
import type { ExtractedEntity, QuoteComparison, RFQAttachment, RFQItem } from '@/lib/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/buyer/rfq-details',
}));

const mockUpdateRFQ = jest.fn().mockResolvedValue({ success: true, rfq: { id: 'rfq-1', status: 'Closed' } });
const mockExtendRFQ = jest.fn().mockResolvedValue({
  success: true,
  rfq: { id: 'rfq-1', rfqNumber: 'RFQ-2026-00462', closingDeadline: '2026-10-15T18:00:00Z', isExtended: true, extensionHours: 48 },
});
const mockReplyToRFQInquiry = jest.fn().mockResolvedValue({ success: true, rfq: { id: 'rfq-1', inquiries: [] } });
const mockSubmitRFQInquiry = jest.fn().mockResolvedValue({ success: true, inquiry: { id: 'inq-new' } });

const mockGetVendorPresence = jest.fn().mockResolvedValue({
  success: true,
  onlineVendors: [],
  details: {},
});

const mockDownloadFullQuotesExcel = jest.fn();
const mockDownloadSingleVendorQuoteExcel = jest.fn();
jest.mock('@/lib/bidComparisonExport', () => ({
  downloadFullQuotesExcel: (...args: any[]) => mockDownloadFullQuotesExcel(...args),
  downloadSingleVendorQuoteExcel: (...args: any[]) => mockDownloadSingleVendorQuoteExcel(...args),
}));

jest.mock('@/app/category-manager/InviteVendorsModal', () => {
  return function MockInviteVendorsModal(props: any) {
    if (!props.isOpen) return null;
    return (
      <div data-testid="mock-invite-vendors-modal">
        <button onClick={props.onClose}>Close CM Modal</button>
        <button onClick={() => props.onInvited({ ...props.rfq, rfqNumber: props.rfq.rfqNumber }, 3)}>
          Trigger CM Invite
        </button>
      </div>
    );
  };
});

jest.mock('@/lib/rfqClient', () => {
  const actual = jest.requireActual('@/lib/rfqClient');
  return {
    ...actual,
    updateRFQ: (...args: any[]) => mockUpdateRFQ(...args),
    extendRFQ: (...args: any[]) => mockExtendRFQ(...args),
    replyToRFQInquiry: (...args: any[]) => mockReplyToRFQInquiry(...args),
    submitRFQInquiry: (...args: any[]) => mockSubmitRFQInquiry(...args),
  };
});
jest.mock('@/lib/vendorPresenceClient', () => ({
  getVendorPresence: (...args: any[]) => mockGetVendorPresence(...args),
  sendVendorHeartbeat: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/authClient', () => ({ authClient: { getToken: jest.fn() } }));

const DETAILS = UI_STRINGS.rfqDetails;
const mockShowToast = jest.fn();

function entity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Nos',
    targetDate: '2026-09-15',
    technicalSpecs: 'SS316 impeller, ANSI flanged',
    confidence: 95,
    category: 'Pumps & Accessories',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategory: 'Pumps & Accessories',
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteComparison> = {}): QuoteComparison {
  return {
    vendorId: 'v-001',
    vendorName: 'Apex Industrial Dynamics Pvt Ltd',
    vendorCategory: 'Client List',
    unitPrice: 4250,
    totalPrice: 425000,
    leadTimeDays: 14,
    aiMatchScore: 96,
    isBestPrice: true,
    isPreferred: true,
    warrantyYears: 2,
    complianceStatus: 'Fully Compliant',
    paymentTerms: '45 Days Net',
    remarks: 'OEM equivalent',
    ...overrides,
  } as QuoteComparison;
}

function attachment(overrides: Partial<RFQAttachment> = {}): RFQAttachment {
  return {
    id: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedAt: '2026-09-02T11:07:16.000Z',
    ...overrides,
  };
}

function buildRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'rfq-1',
    rfqNumber: 'RFQ-2026-00462',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_2',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 348000,
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    createdAt: '2026-09-02 11:07:16',
    extractedEntities: [entity()],
    quotes: [],
    chasingActive: false,
    source: 'web_portal',
    sourceFileName: 'BOQ.xlsx',
    ...overrides,
  } as RFQItem;
}

const onBack = jest.fn();
const renderDetails = (rfq: RFQItem | null, props: Partial<React.ComponentProps<typeof RFQDetails>> = {}) =>
  render(<RFQDetails rfq={rfq} onBack={onBack} {...props} />);

/**
 * The line-item table.
 *
 * The panel renders a table for wide viewports and a card list for narrow ones,
 * and jsdom has no viewport so both are in the document. Queries are scoped to one
 * of them or they match twice.
 */
const lineItemTable = () => screen.getAllByRole('table')[0];
/** The vendor-quotation table, which is the second one on the page. */
const quotesTable = () => {
  const tables = screen.getAllByRole('table');
  return tables[tables.length - 1];
};

/** The section wrapping a heading, so an assertion is not matched page-wide. */
const sectionFor = (heading: HTMLElement) => heading.closest('section') as HTMLElement;

beforeEach(() => {
  (useApp as jest.Mock).mockReturnValue({
    showToast: mockShowToast,
    refreshFromDB: jest.fn().mockResolvedValue(undefined),
    currentRole: 'buyer',
    buyerVendors: [],
    currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
  });
  (authClient.getToken as jest.Mock).mockReturnValue('test-token');
  mockPush.mockClear();
  mockUpdateRFQ.mockClear();
  mockExtendRFQ.mockClear();
  mockReplyToRFQInquiry.mockClear();
  mockSubmitRFQInquiry.mockClear();
  mockDownloadFullQuotesExcel.mockClear();
  mockDownloadSingleVendorQuoteExcel.mockClear();
  mockShowToast.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Pure helpers
// ══════════════════════════════════════════════════════════════════════════════
describe('daysUntil', () => {
  const today = new Date('2026-09-03T10:00:00Z');

  test.each([
    ['2026-09-30', 27],
    ['2026-09-04', 1],
    ['2026-09-03', 0],
    ['2026-09-01', -2],
  ])('reports %s as %i days out', (target, expected) => {
    expect(daysUntil(target, today)).toBe(expected);
  });

  // Compared at date granularity, so a delivery later the same day is due today
  // rather than already overdue by a fraction of a day.
  test('ignores the time of day', () => {
    expect(daysUntil('2026-09-03', new Date('2026-09-03T23:59:00Z'))).toBe(0);
  });

  test.each(['', 'not-a-date'])('returns null for %p', (target) => {
    expect(daysUntil(target, today)).toBeNull();
  });

  test('defaults to the current date', () => {
    expect(daysUntil(new Date().toISOString().slice(0, 10))).toBe(0);
  });
});

describe('lineItemsToCsv', () => {
  test('emits a header row and one row per line item', () => {
    const csv = lineItemsToCsv([entity(), entity({ id: 'ent-2', itemName: 'Gate Valve' })]);
    const rows = csv.split('\n');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(DETAILS.colItem);
    expect(rows[1]).toContain('Centrifugal Water Pump 500 GPM');
    expect(rows[2]).toContain('Gate Valve');
  });

  // A specification routinely contains commas, and a quote would otherwise end
  // the field early and shift every later column.
  test('quotes every field and escapes embedded quotes', () => {
    const csv = lineItemsToCsv([
      entity({ technicalSpecs: 'SS316, 2" bore, Class 150' }),
    ]);

    expect(csv).toContain('"SS316, 2"" bore, Class 150"');
  });

  test('handles an empty list', () => {
    expect(lineItemsToCsv([]).split('\n')).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('Buyer RFQ Details (Screen 1.4)', () => {
  describe('missing RFQ', () => {
    // Reachable by editing the query string or reloading after the records were
    // cleared, so it explains itself instead of rendering an empty shell.
    it('explains that the RFQ is not in the portfolio and offers a way back', () => {
      renderDetails(null);

      expect(screen.getByText(DETAILS.notFoundTitle)).toBeInTheDocument();
      expect(screen.getByText(DETAILS.notFoundMessage)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: new RegExp(DETAILS.backAction, 'i') }));
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('header and provenance strip', () => {
    it('renders the document badge, RFQ number, title, status and mode code', () => {
      const rfq = buildRFQ();
      renderDetails(rfq);

      expect(screen.getByText(DETAILS.documentTypeBadge)).toBeInTheDocument();
      expect(screen.getByText(rfq.rfqNumber)).toBeInTheDocument();
      expect(screen.getByText(rfq.title)).toBeInTheDocument();
      expect(screen.getAllByText(rfq.status).length).toBeGreaterThan(0);

      const mode = SOURCING_MODES.find((m) => m.id === rfq.sourcingMode);
      expect(screen.getByText(mode!.code)).toBeInTheDocument();
    });

    // badgeColor is a Tailwind class string; it used to be handed to
    // style={{ backgroundColor }}, which the browser dropped as invalid CSS.
    it('applies the sourcing mode colour as a class rather than an inline style', () => {
      const rfq = buildRFQ({ sourcingMode: 'mode_2' });
      renderDetails(rfq);

      const mode = SOURCING_MODES.find((m) => m.id === 'mode_2')!;
      const badge = screen.getByText(mode.code);
      expect(badge.className).toContain('border-emerald-500/40');
      expect(badge.getAttribute('style')).toBeNull();
    });

    it('states when the RFQ was raised', () => {
      renderDetails(buildRFQ());

      expect(
        screen.getByText(
          formatString(DETAILS.raisedOnStrip, {
            timestamp: formatIndianDateTime('2026-09-02 11:07:16'),
          })
        )
      ).toBeInTheDocument();
      // Not the raw UTC string it is stored as.
      expect(screen.queryByText(/2026-09-02 11:07:16/)).not.toBeInTheDocument();
    });

    // An unedited RFQ showing an "edited" timestamp reads as a change nobody made.
    it('reports an edit only once the record has actually changed', () => {
      const { unmount } = renderDetails(
        buildRFQ({ createdAt: '2026-09-02 11:07:16', updatedAt: '2026-09-02 11:07:16' })
      );

      expect(screen.queryByText(/^Edited /)).not.toBeInTheDocument();
      unmount();

      renderDetails(buildRFQ({ updatedAt: '2026-09-06 09:15:00' }));
      expect(
        screen.getByText(
          formatString(DETAILS.updatedOnStrip, {
            timestamp: formatIndianDateTime('2026-09-06 09:15:00'),
          })
        )
      ).toBeInTheDocument();
    });

    it('omits the mode badge when the sourcing mode is unknown', () => {
      renderDetails(buildRFQ({ sourcingMode: 'mode_9' as RFQItem['sourcingMode'] }));

      expect(screen.getByText('RFQ-2026-00462')).toBeInTheDocument();
      SOURCING_MODES.forEach((m) => {
        expect(screen.queryByText(m.code)).not.toBeInTheDocument();
      });
    });

    it('returns to the portfolio from the strip', () => {
      renderDetails(buildRFQ());
      fireEvent.click(screen.getByRole('button', { name: new RegExp(DETAILS.backAction, 'i') }));
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('submission detail card', () => {
    it.each([
      ['web_portal', 'Web Portal Upload'],
      ['email_gateway', 'via Email Upload'],
      ['email_upload', 'Emailed Document'],
      ['manual_entry', 'Manual Entry'],
      ['ai_extraction', 'AI Extraction'],
    ])('labels a %s intake as %s', (source, label) => {
      renderDetails(buildRFQ({ source: source as RFQItem['source'] }));
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('labels an RFQ without explicit source but with aiSummary as AI Extraction', () => {
      renderDetails(buildRFQ({ source: undefined, aiSummary: { headline: 'Test AI', scope: '', risks: [] } as any }));
      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText(DETAILS.sourceAiExtraction || 'AI Extraction')).toBeInTheDocument();
    });

    it('shows the record id', () => {
      renderDetails(buildRFQ({ id: 'rfq-1' }));

      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText('rfq-1')).toBeInTheDocument();
    });

    it('marks a blank intake source as unset when no aiSummary exists', () => {
      renderDetails(buildRFQ({ source: undefined, aiSummary: null }));

      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText(DETAILS.unsetValue)).toBeInTheDocument();
    });
  });

  describe('commercial and delivery card', () => {
    it('displays the saved target delivery date correctly instead of Not provided', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: '2026-11-20', budget: 100000 }));
      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatIndianDate('2026-11-20'))).toBeInTheDocument();
    });

    it('falls back to target_delivery_date or deadline if targetDeliveryDate is not set directly', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: '', ...({ target_delivery_date: '2026-12-15' } as any) }));
      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatIndianDate('2026-12-15'))).toBeInTheDocument();
    });

    it('falls back to line item targetDate if header targetDeliveryDate is unset', () => {
      renderDetails(
        buildRFQ({
          targetDeliveryDate: '',
          extractedEntities: [
            entity({
              id: 'item-1',
              itemName: 'Pipe',
              quantity: 5,
              unit: 'nos',
              majorCategory: 'Mechanical',
              minorCategory: 'Pipes',
              confidence: 95,
              targetDate: '2026-10-30',
            }),
          ],
        })
      );
      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatIndianDate('2026-10-30'))).toBeInTheDocument();
    });

    it('renders the delivery location and pincode', () => {
      renderDetails(buildRFQ());

      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText('Navi Mumbai Plant, Gate 3')).toBeInTheDocument();
      expect(
        within(card).getByText(formatString(DETAILS.deliveryPincodeLabel, { pincode: '400701' }))
      ).toBeInTheDocument();
    });

    it('formats a stated budget as currency', () => {
      renderDetails(buildRFQ({ budget: 348000 }));

      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatCurrency(348000))).toBeInTheDocument();
    });

    // The budget is optional, so zero must read as unstated rather than as a real
    // ceiling of nil that vendors would quote against.
    it('shows an unstated budget as not provided', () => {
      renderDetails(buildRFQ({ budget: 0 }));

      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).queryByText(formatCurrency(0))).not.toBeInTheDocument();
      expect(within(card).getAllByText(DETAILS.unsetValue).length).toBeGreaterThan(0);
    });

    it('counts down to the target delivery date', () => {
      const target = new Date();
      target.setDate(target.getDate() + 12);
      renderDetails(buildRFQ({ targetDeliveryDate: target.toISOString().slice(0, 10) }));

      expect(screen.getByText(formatString(DETAILS.daysRemaining, { days: 12 }))).toBeInTheDocument();
    });

    it('flags a delivery date that has passed', () => {
      const target = new Date();
      target.setDate(target.getDate() - 3);
      renderDetails(buildRFQ({ targetDeliveryDate: target.toISOString().slice(0, 10) }));

      expect(screen.getByText(formatString(DETAILS.overdueBy, { days: 3 }))).toBeInTheDocument();
    });

    it('reports a delivery due today', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: new Date().toISOString().slice(0, 10) }));
      expect(screen.getByText(DETAILS.dueToday)).toBeInTheDocument();
    });

    it('omits the countdown and pincode when neither is set', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: '', deliveryPincode: '', deliveryLocation: undefined }));

      expect(screen.queryByText(/days remaining/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^PIN:/)).not.toBeInTheDocument();
    });
  });

  // The outreach card has been removed. The persisted record carries no
  // follow-up telemetry at all — mapRowToRFQ never returns followUpData — so the
  // card could only ever render its own "awaiting initial trigger" placeholder,
  // which claimed a pipeline state nothing had reported.
  describe('outreach telemetry', () => {
    it('shows no outreach card, even for an RFQ that carries follow-up data', () => {
      renderDetails(
        buildRFQ({
          followUpData: {
            rfqNumber: 'RFQ-2026-00462',
            totalInvited: 5,
            respondedCount: 3,
            callStats: { total: 5, connected: 4, avgDuration: '2m 10s' },
            whatsappStats: { total: 5, delivered: 5, read: 3, replied: 3 },
            smsStats: { total: 5, delivered: 2, clicked: 2 },
            autoChasingEnabled: true,
            vendors: [],
          },
        })
      );

      expect(screen.queryByText('4 / 5')).not.toBeInTheDocument();
      expect(screen.queryByText(/Awaiting initial trigger/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Outreach Analytics/i)).not.toBeInTheDocument();
    });
  });

  describe('line items', () => {
    const twoItems = () =>
      buildRFQ({
        extractedEntities: [
          entity(),
          entity({
            id: 'ent-2',
            itemName: 'Flanged Gate Valve',
            technicalSpecs: 'ASTM A216 WCB body',
            minorCategory: 'Hoses, Valves & Fittings',
            unit: 'Sets',
          }),
        ],
      });

    it('renders every line item with its classification and confidence', () => {
      renderDetails(twoItems());

      // Scoped to the table: the minor category also appears as a filter option.
      const table = screen.getByRole('table');
      expect(within(table).getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(within(table).getByText('Flanged Gate Valve')).toBeInTheDocument();
      expect(within(table).getByText('ASTM A216 WCB body')).toBeInTheDocument();
      expect(within(table).getByText('Hoses, Valves & Fittings')).toBeInTheDocument();
      expect(within(table).getAllByText(formatString(DETAILS.confidenceHigh, { confidence: 95 }))).toHaveLength(2);
    });

    it('flags a low-confidence row as needing review', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ confidence: 50 })] }));
      expect(
        within(lineItemTable()).getByText(formatString(DETAILS.confidenceReview, { confidence: 50 }))
      ).toBeInTheDocument();
    });

    it('numbers the rows', () => {
      renderDetails(twoItems());

      const table = screen.getByRole('table');
      expect(within(table).getByText('1')).toBeInTheDocument();
      expect(within(table).getByText('2')).toBeInTheDocument();
    });

    // Scoped to the footer: the same number also appears as a row quantity.
    const totalQuantity = () =>
      within(screen.getByText(DETAILS.totalQuantityLabel)).getByText(/^\d+$/).textContent;

    it('totals the quantity of the rows on screen', () => {
      renderDetails(twoItems());

      // 12 + 12 from the two fixture rows.
      expect(totalQuantity()).toBe('24');
    });

    it('retotals as the buyer filters', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate valve' } });

      expect(totalQuantity()).toBe('12');
    });

    // A keyed row has no AI confidence, so reporting 0% would misrepresent it.
    it('labels a manually keyed row instead of claiming zero confidence', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ confidence: 0 })] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText(DETAILS.manualConfidence)).toBeInTheDocument();
      expect(within(table).queryByText(/0% /)).not.toBeInTheDocument();
    });

    // The specification is a sub-line under the item it describes, so a blank one
    // is simply left off rather than filling the row with "Not provided".
    it('omits the specification line when the item has none', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ technicalSpecs: '  ' })] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(within(table).queryByText(new RegExp(`^${DETAILS.specsInlineLabel}:`))).not.toBeInTheDocument();
    });

    it('prints the specification under the item it describes', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity()] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText(/SS316 impeller, ANSI flanged/)).toBeInTheDocument();
    });

    it('narrows the table as the buyer searches', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate valve' } });

      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();
      expect(screen.queryByText('Centrifugal Water Pump 500 GPM')).not.toBeInTheDocument();
      expect(
        screen.getByText(formatString(DETAILS.displayingCount, { shown: 1, total: 2 }))
      ).toBeInTheDocument();
    });

    it('searches the specification and unit as well as the name', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'ASTM' } });
      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'sets' } });
      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();
    });

    it('filters by minor category and offers only the categories present', () => {
      renderDetails(twoItems());

      const filter = screen.getByLabelText(DETAILS.minorFilterAria) as HTMLSelectElement;
      const options = Array.from(filter.options).map((o) => o.value);
      expect(options).toEqual(['all', 'Hoses, Valves & Fittings', 'Pumps & Accessories']);

      fireEvent.change(filter, { target: { value: 'Pumps & Accessories' } });
      expect(within(lineItemTable()).getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(screen.queryByText('Flanged Gate Valve')).not.toBeInTheDocument();
    });

    it('reports when the search and filter exclude everything', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'nothing matches' } });

      // Reported in both the table's empty row and the card list's empty state.
      expect(screen.getAllByText(DETAILS.noLineItemMatches).length).toBeGreaterThan(0);
      expect(screen.getByText(formatString(DETAILS.displayingCount, { shown: 0, total: 2 }))).toBeInTheDocument();
    });

    // ── Clearing the filters ─────────────────────────────────────────────────
    // The control appears only once something is filtering, so an untouched table
    // does not carry a button that would do nothing.
    it('offers no clear action until a filter is applied', () => {
      renderDetails(twoItems());

      expect(
        screen.queryByRole('button', { name: DETAILS.clearFiltersAction })
      ).not.toBeInTheDocument();
    });

    it('clears the search and the category filter together', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate' } });
      fireEvent.change(screen.getByLabelText(DETAILS.minorFilterAria), {
        target: { value: 'Hoses, Valves & Fittings' },
      });

      fireEvent.click(screen.getAllByRole('button', { name: DETAILS.clearFiltersAction })[0]);

      expect(screen.getByLabelText(DETAILS.lineItemSearchAria)).toHaveValue('');
      expect(screen.getByLabelText(DETAILS.minorFilterAria)).toHaveValue('all');
      expect(screen.getByText(formatString(DETAILS.displayingCount, { shown: 2, total: 2 }))).toBeInTheDocument();
    });

    it('offers the clear action from the empty result row as well', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'nothing matches' } });
      // One in the toolbar, plus one in each empty state (table row and card list).
      const clearButtons = screen.getAllByRole('button', { name: DETAILS.clearFiltersAction });
      expect(clearButtons.length).toBeGreaterThan(1);

      fireEvent.click(clearButtons[clearButtons.length - 1]);
      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();
    });

    // ── Sorting ──────────────────────────────────────────────────────────────
    // Unsorted by default, because a BOQ's own row order carries meaning the buyer
    // put there.
    describe('sorting', () => {
      const itemNames = () =>
        screen
          .getAllByRole('row')
          .slice(1)
          .map((row) => row.querySelectorAll('td')[1]?.textContent || '');

      const sortBy = (column: string, direction: 'asc' | 'desc' = 'asc') =>
        fireEvent.click(
          screen.getByRole('button', {
            name: formatString(
              direction === 'asc' ? DETAILS.sortAscAria : DETAILS.sortDescAria,
              { column }
            ),
          })
        );

      it('keeps the document order until a column is chosen', () => {
        renderDetails(twoItems());

        expect(itemNames()[0]).toContain('Centrifugal Water Pump 500 GPM');
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'none'
        );
      });

      it('orders by item description and flips on a second click', () => {
        renderDetails(twoItems());

        sortBy(DETAILS.colItem);
        expect(itemNames()[0]).toContain('Centrifugal Water Pump 500 GPM');
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'ascending'
        );

        sortBy(DETAILS.colItem, 'desc');
        expect(itemNames()[0]).toContain('Flanged Gate Valve');
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'descending'
        );
      });

      it('orders by quantity', () => {
        renderDetails(
          buildRFQ({
            extractedEntities: [
              entity({ id: 'a', itemName: 'Bigger order', quantity: 90 }),
              entity({ id: 'b', itemName: 'Smaller order', quantity: 4 }),
            ],
          })
        );

        sortBy(DETAILS.colQty);
        expect(itemNames()[0]).toContain('Smaller order');

        sortBy(DETAILS.colQty, 'desc');
        expect(itemNames()[0]).toContain('Bigger order');
      });

      it('orders by category', () => {
        renderDetails(twoItems());

        sortBy(DETAILS.colCategory);
        // Both share a major, so the minor decides: Hoses before Pumps.
        expect(itemNames()[0]).toContain('Flanged Gate Valve');
      });

      it('orders by required-by date', () => {
        renderDetails(
          buildRFQ({
            extractedEntities: [
              entity({ id: 'a', itemName: 'Later', targetDate: '2026-12-01' }),
              entity({ id: 'b', itemName: 'Sooner', targetDate: '2026-09-05' }),
            ],
          })
        );

        sortBy(DETAILS.colTargetDate);
        expect(itemNames()[0]).toContain('Sooner');

        sortBy(DETAILS.colTargetDate, 'desc');
        expect(itemNames()[0]).toContain('Later');
      });

      // An unanswered date must not displace a real deadline from the top.
      it('sorts rows with no date last in either direction', () => {
        renderDetails(
          buildRFQ({
            extractedEntities: [
              entity({ id: 'a', itemName: 'Undated', targetDate: '' }),
              entity({ id: 'b', itemName: 'Dated', targetDate: '2026-09-05' }),
            ],
          })
        );

        sortBy(DETAILS.colTargetDate);
        expect(itemNames()[0]).toContain('Dated');

        sortBy(DETAILS.colTargetDate, 'desc');
        expect(itemNames()[0]).toContain('Dated');
      });

      it('switching column resets to ascending', () => {
        renderDetails(twoItems());

        sortBy(DETAILS.colItem);
        sortBy(DETAILS.colItem, 'desc');
        sortBy(DETAILS.colQty);

        expect(screen.getByRole('columnheader', { name: /Qty/ })).toHaveAttribute(
          'aria-sort',
          'ascending'
        );
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'none'
        );
      });

      it('sorts the filtered rows, not the whole list', () => {
        renderDetails(twoItems());

        fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate' } });
        sortBy(DETAILS.colItem);

        expect(itemNames()).toHaveLength(1);
        expect(itemNames()[0]).toContain('Flanged Gate Valve');
      });
    });

    it('reports how much was classified automatically', () => {
      renderDetails(
        buildRFQ({ extractedEntities: [entity({ confidence: 95 }), entity({ id: 'ent-2', confidence: 40 })] })
      );

      expect(screen.getByText(formatString(DETAILS.parsedSuccessfully, { percent: 50 }))).toBeInTheDocument();
    });

    it('offers the line items as a CSV download named after the RFQ', () => {
      renderDetails(twoItems());

      const link = screen.getByRole('link', {
        name: formatString(DETAILS.exportCsvAria, { rfqNumber: 'RFQ-2026-00462' }),
      });
      expect(link).toHaveAttribute('download', 'RFQ-2026-00462-line-items.csv');
      // A data URL rather than a generated blob, so no direct DOM calls are needed.
      expect(link.getAttribute('href')).toContain('data:text/csv');
      expect(decodeURIComponent(link.getAttribute('href') || '')).toContain('Flanged Gate Valve');
    });

    it('reports an RFQ that recorded no line items', () => {
      renderDetails(buildRFQ({ extractedEntities: [] }));

      expect(screen.getByText(DETAILS.noLineItems)).toBeInTheDocument();
      expect(screen.queryByText(/Displaying/)).not.toBeInTheDocument();
    });

    it('tolerates an RFQ with no line-item collection at all', () => {
      renderDetails(buildRFQ({ extractedEntities: undefined as unknown as ExtractedEntity[] }));
      expect(screen.getByText(DETAILS.noLineItems)).toBeInTheDocument();
    });
  });

  describe('supporting documents', () => {
    it('lists each attached document with its size and upload date', () => {
      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const panel = sectionFor(screen.getByText(DETAILS.attachmentsHeading));
      expect(within(panel).getByText('annexure.pdf')).toBeInTheDocument();
      expect(within(panel).getByText(/2\.0 KB/)).toBeInTheDocument();
      // The upload date reads in the Indian style, not as the stored ISO string.
      expect(
        within(panel).getByText(
          new RegExp(formatIndianDate('2026-09-02T11:07:16.000Z').replace(/ /g, '\\s'))
        )
      ).toBeInTheDocument();
    });

    // GET /api/rfqs/attachments/:id requires auth, and the session token lives
    // only in localStorage — a plain <a href> can never carry it, so it would
    // always 401 regardless of login state. The button below fetches with the
    // Authorization header manually and opens the result as a blob URL instead.
    it('fetches the attachment with the Authorization header and opens it as a blob URL', async () => {
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      const mockBlob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => mockBlob });

      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const viewBtn = screen.getByRole('button', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      });
      fireEvent.click(viewBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef',
          { headers: { Authorization: 'Bearer test-token' } }
        );
      });
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank', 'noopener,noreferrer'));
    });

    it('shows a toast instead of throwing when the attachment fetch fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const viewBtn = screen.getByRole('button', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      });
      fireEvent.click(viewBtn);

      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
        'Could Not Open Attachment',
        'Could not load the attachment.',
        'warning'
      ));
    });

    it('omits the Authorization header when there is no session token', async () => {
      (authClient.getToken as jest.Mock).mockReturnValue(null);
      global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) });

      renderDetails(buildRFQ({ attachments: [attachment()] }));

      fireEvent.click(screen.getByRole('button', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef', { headers: {} });
      });
    });

    it('omits the upload date when the record carries none', () => {
      renderDetails(buildRFQ({ attachments: [attachment({ uploadedAt: '' })] }));

      expect(screen.getByText('annexure.pdf')).toBeInTheDocument();
      expect(screen.queryByText(/Attached 2026/)).not.toBeInTheDocument();
    });

    it.each([[[]], [undefined]])('reports an RFQ with no documents (%p)', (value) => {
      renderDetails(buildRFQ({ attachments: value as RFQAttachment[] | undefined }));
      expect(screen.getByText(DETAILS.noAttachments)).toBeInTheDocument();
    });
  });

  describe('vendor quotations', () => {
    it('renders each quotation with its pricing, compliance and match score', () => {
      renderDetails(buildRFQ({ quotes: [quote()] }));

      // Scoped to the table: the panel also renders a card list of the same quotes
      // for narrow viewports, and jsdom has no viewport so both are present.
      const table = within(quotesTable());
      expect(table.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
      expect(table.getByText(formatCurrency(4250))).toBeInTheDocument();
      expect(table.getByText(formatCurrency(425000))).toBeInTheDocument();
      expect(table.getByText(formatString(DETAILS.leadTimeDays, { days: 14 }))).toBeInTheDocument();
      expect(table.getByText('Fully Compliant')).toBeInTheDocument();
      expect(table.getByText('96%')).toBeInTheDocument();
    });

    it('counts the quotations it received', () => {
      renderDetails(buildRFQ({ quotes: [quote(), quote({ vendorId: 'v-002' })] }));

      const panel = sectionFor(screen.getByText(DETAILS.quotesHeading));
      expect(within(panel).getByText('2')).toBeInTheDocument();
    });



    // "Under Review" and "Shortlisted" tabs used to sit here with a hardcoded
    // count of zero, because quotation states are not modelled. They are gone.
    it('offers no quotation-state tabs', () => {
      renderDetails(buildRFQ({ quotes: [quote()] }));

      expect(screen.queryByText(/Under Review/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Shortlisted/i)).not.toBeInTheDocument();
    });

    it('explains why no quotations have arrived yet', () => {
      renderDetails(buildRFQ({ quotes: [] }));

      expect(screen.getByText(DETAILS.noQuotes)).toBeInTheDocument();
      expect(screen.getByText(DETAILS.noQuotesMessage)).toBeInTheDocument();
    });

    it('tolerates an RFQ with no quotes collection at all', () => {
      renderDetails(buildRFQ({ quotes: undefined as unknown as QuoteComparison[] }));
      expect(screen.getByText(DETAILS.noQuotes)).toBeInTheDocument();
    });
  });

function makeInquiry(overrides: any = {}): any {
  return {
    id: 'inq-default',
    rfqNumber: 'RFQ-2026-00462',
    vendorId: 'v-default',
    vendorName: 'Default Vendor',
    message: 'Default message',
    createdAt: '2026-09-03T11:00:00Z',
    status: 'open',
    ...overrides,
  };
}

  describe('vendor inquiries & clarifications and assigned suppliers', () => {
    it('hides Assigned Suppliers and Vendor Inquiries for V0 RFQs in buyer view', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_0',
          inquiries: [
            makeInquiry({
              id: 'inq-1',
              vendorId: 'v-net-001',
              vendorName: 'Global Turbines Ltd',
              message: 'Can we offer alternate impeller material?',
            }),
          ],
          assignedVendors: [
            {
              id: 'v-assigned',
              name: 'Assigned Network Supplier',
            } as any,
          ],
        })
      );

      expect(screen.queryByText('Assigned & Invited Suppliers')).not.toBeInTheDocument();
      expect(screen.queryByText('Vendor Inquiries & Clarifications')).not.toBeInTheDocument();
    });

    it('hides Direct Clarification & Inquiry with Buyer for V0 RFQs in vendor view', () => {
      render(
        <RFQDetails
          rfq={buildRFQ({
            sourcingMode: 'mode_0',
            inquiries: [
              makeInquiry({
                id: 'inq-v1',
                vendorId: 'v-partner',
                vendorName: 'Vendor Partner',
                message: 'Existing vendor question',
              }),
            ],
          })}
          onBack={jest.fn()}
          isVendorView={true}
        />
      );

      expect(screen.queryByText('Direct Clarification & Inquiry with Buyer')).not.toBeInTheDocument();
    });

    it('filters out Procucev Network vendors from Vendor Inquiries in buyer view', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          inquiries: [
            makeInquiry({
              id: 'inq-1',
              vendorId: 'v-net-001',
              vendorName: 'Global Turbines Ltd',
              vendorCategory: 'Procucev Network',
              message: 'Can we offer alternate impeller material?',
            }),
            makeInquiry({
              id: 'inq-2',
              vendorId: 'v-hist-002',
              vendorName: 'Local Machine Shop',
              vendorCategory: 'Client List',
              message: 'Delivery timeline query',
            }),
          ],
        })
      );

      expect(screen.getByText('Vendor Inquiries & Clarifications')).toBeInTheDocument();
      expect(screen.getAllByText('Local Machine Shop').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Global Turbines Ltd')).not.toBeInTheDocument();
    });

    it('shows a Procucev vendor confidentially in the assigned supplier panel (name only, no contact)', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_2',
          assignedVendors: [
            {
              id: 'v-assigned',
              name: 'Assigned Network Supplier',
              vendorCategory: 'Procucev Network',
            } as any,
            {
              id: 'v-client',
              name: 'Client Approved Supplier',
              vendorCategory: 'Client List',
            } as any,
          ],
        })
      );

      const panelHeading = screen.getByText('Assigned & Invited Suppliers');
      const panel = panelHeading.closest('section');
      expect(panel).not.toBeNull();
      // The client vendor is listed by name.
      expect(within(panel as HTMLElement).getAllByText('Client Approved Supplier').length).toBeGreaterThanOrEqual(1);
      // The Procucev vendor is hidden on V2 for buyer.
      expect(within(panel as HTMLElement).queryByText('Assigned Network Supplier')).not.toBeInTheDocument();
      expect(within(panel as HTMLElement).queryByText(/Double-Blind/i)).not.toBeInTheDocument();
    });

    it('keeps a V3 Procucev vendor confidential: shows name, category, location, score — hides email, phone, contact', () => {
      // The reported requirement: a V3 Procucev vendor must appear in the panel
      // with its category, location, and match score visible, but its email,
      // phone, and contact person hidden.
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_3',
          assignedVendors: [
            {
              id: 'proc-v3',
              name: 'Confidential Procucev Supplier',
              email: 'secret@procucev-vendor.in',
              phone: '+91 90000 55555',
              contactPerson: 'Hidden Contact',
              vendorCategory: 'Procucev Network',
              majorCategory: 'Engineering Spares - Mechanical',
              location: 'Pune, Maharashtra',
              matchScore: 92,
            } as any,
          ],
        })
      );

      // Scope assertions to the Procucev supplier card so category text from
      // the line-items table does not create ambiguous matches.
      const card = screen.getAllByTestId('assigned-supplier-card').find((c) =>
        within(c).queryByText('Confidential Procucev Supplier')
      ) as HTMLElement;
      expect(card).toBeTruthy();

      // Visible: company name, category, location, and match score.
      expect(within(card).getByText('Confidential Procucev Supplier')).toBeInTheDocument();
      expect(within(card).getByText(/Engineering Spares - Mechanical/)).toBeInTheDocument();
      expect(within(card).getByText(/Pune, Maharashtra/)).toBeInTheDocument();
      expect(within(card).getByText(/92% match/)).toBeInTheDocument();

      // Hidden: contact details appear nowhere in the card.
      expect(within(card).queryByText('secret@procucev-vendor.in')).not.toBeInTheDocument();
      expect(within(card).queryByText('+91 90000 55555')).not.toBeInTheDocument();
      expect(within(card).queryByText(/Hidden Contact/)).not.toBeInTheDocument();
    });

    it('treats an untagged assigned vendor on a V3 RFQ as confidential (hides its email, phone, contact)', () => {
      // Reproduces the live leak: a V3 RFQ whose assigned vendor was populated
      // by the backend and carries email/phone/contact but NO vendorCategory
      // tag and no Procucev source. V3 routes only to the Procucev network, so
      // the details view must still treat it as double-blind.
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_3',
          assignedVendors: [
            {
              id: 'v-untagged',
              name: 'RFQ Procucev Vendor',
              email: 'rfqprocucev@gmail.com',
              phone: '+919866666667',
              contactPerson: 'RFQ Procucev',
            } as any,
          ],
        })
      );

      const card = screen.getAllByTestId('assigned-supplier-card').find((c) =>
        within(c).queryByText('RFQ Procucev Vendor')
      ) as HTMLElement;
      expect(card).toBeTruthy();

      // The company name shows; the double-blind badge is present.
      expect(within(card).getByText('RFQ Procucev Vendor')).toBeInTheDocument();
      expect(within(card).getByText(/Double-Blind/i)).toBeInTheDocument();

      // Category, location, and a match row always render (category falls back to
      // the RFQ's own category when the entry carries none).
      expect(within(card).getByText(/Category:/)).toBeInTheDocument();
      expect(within(card).getByText(/Location:/)).toBeInTheDocument();
      expect(within(card).getByText(/match/i)).toBeInTheDocument();

      // Contact details are hidden despite being present on the record.
      expect(within(card).queryByText('rfqprocucev@gmail.com')).not.toBeInTheDocument();
      expect(within(card).queryByText('+919866666667')).not.toBeInTheDocument();
      expect(within(card).queryByText(/RFQ Procucev$/)).not.toBeInTheDocument();
    });

    describe('category manager assigned-suppliers view (full details + tabs)', () => {
      function renderAsCategoryManager(rfq: RFQItem) {
        (useApp as jest.Mock).mockReturnValue({
          currentRole: 'category_manager',
          showToast: mockShowToast,
          refreshFromDB: jest.fn().mockResolvedValue(undefined),
          buyerVendors: [],
          currentUserSession: { name: 'Cat Manager', email: 'cm@procucev.com', role: 'category_manager' },
        });
        return render(<RFQDetails rfq={rfq} onBack={onBack} />);
      }

      const mixedRfq = () =>
        buildRFQ({
          sourcingMode: 'mode_3',
          assignedVendors: [
            {
              id: 'proc-1',
              name: 'Mamta Electrics',
              email: 'mamta@network.in',
              phone: '+91 90000 10001',
              contactPerson: 'Mamta Rep',
              vendorCategory: 'Procucev Network',
              majorCategory: 'lights',
            } as any,
            {
              id: 'own-1',
              name: 'Amma Solution',
              email: 'amma@buyerco.in',
              phone: '+91 90000 20002',
              contactPerson: 'Amma Rep',
              vendorCategory: 'Client List',
            } as any,
          ],
        });

      it('renders two tabs and defaults to the Procucev tab with full contact details', () => {
        renderAsCategoryManager(mixedRfq());

        const tabs = screen.getByTestId('cm-supplier-tabs');
        expect(screen.getByTestId('cm-tab-procucev')).toHaveTextContent('Procucev Vendors (1)');
        expect(screen.getByTestId('cm-tab-own')).toHaveTextContent("Buyer's Own Vendors (1)");

        // Procucev tab is active by default and shows FULL details (no double-blind).
        expect(within(tabs).getByText('Mamta Electrics')).toBeInTheDocument();
        expect(within(tabs).getByText('mamta@network.in')).toBeInTheDocument();
        expect(within(tabs).getByText('+91 90000 10001')).toBeInTheDocument();
        expect(within(tabs).getByText(/Mamta Rep/)).toBeInTheDocument();
        // No double-blind badge in the category-manager supplier panel.
        expect(within(tabs).queryByText(/Double-Blind/i)).not.toBeInTheDocument();
      });

      it('switches to the Buyer Own Vendors tab and shows that vendor full detail', () => {
        renderAsCategoryManager(mixedRfq());

        fireEvent.click(screen.getByTestId('cm-tab-own'));

        const tabs = screen.getByTestId('cm-supplier-tabs');
        expect(within(tabs).getByText('Amma Solution')).toBeInTheDocument();
        expect(within(tabs).getByText('amma@buyerco.in')).toBeInTheDocument();
        expect(within(tabs).getByText('+91 90000 20002')).toBeInTheDocument();
        // The Procucev vendor is not in this tab's list.
        expect(within(tabs).queryByText('Mamta Electrics')).not.toBeInTheDocument();
      });

      it('shows the assigned-suppliers panel with full detail even for a V0 RFQ', () => {
        // Buyer-side V0 hides this panel (email-direct sourcing), but the
        // category manager must still see the invited vendors on V0.
        renderAsCategoryManager(
          buildRFQ({
            sourcingMode: 'mode_0',
            assignedVendors: [
              {
                id: 'v0-vendor',
                name: 'V0 Network Supplier',
                email: 'v0@network.in',
                phone: '+91 90000 30003',
                contactPerson: 'V0 Rep',
                vendorCategory: 'Procucev Network',
              } as any,
            ],
          })
        );

        expect(screen.getByText('Assigned & Invited Suppliers')).toBeInTheDocument();
        // For V0 RFQ, category manager side hides the tabs and renders vendor cards directly
        expect(screen.queryByTestId('cm-supplier-tabs')).not.toBeInTheDocument();
        const cards = screen.getByTestId('v0-cm-vendor-cards');
        expect(within(cards).getByText('V0 Network Supplier')).toBeInTheDocument();
        expect(within(cards).getByText('v0@network.in')).toBeInTheDocument();
        expect(within(cards).getByText('+91 90000 30003')).toBeInTheDocument();
      });

      it('still hides the suppliers panel from the BUYER on a V0 RFQ', () => {
        // Control: the gate change must not expose the panel to the buyer on V0.
        renderDetails(
          buildRFQ({
            sourcingMode: 'mode_0',
            assignedVendors: [
              { id: 'v0-x', name: 'V0 X', vendorCategory: 'Procucev Network' } as any,
            ],
          })
        );
        expect(screen.queryByText('Assigned & Invited Suppliers')).not.toBeInTheDocument();
      });
    });

    it('allows searching vendors and filtering by status tabs', () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            makeInquiry({
              id: 'inq-open',
              vendorId: 'v-open',
              vendorName: 'Alpha Supplies',
              message: 'Question 1',
              status: 'open',
            }),
            makeInquiry({
              id: 'inq-ans',
              vendorId: 'v-ans',
              vendorName: 'Beta Components',
              message: 'Question 2',
              reply: 'Answer 2',
              status: 'answered',
            }),
          ],
        })
      );

      // Search vendor
      const searchInput = screen.getByPlaceholderText('Search vendor...');
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });
      expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Beta Components')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Click Pending filter
      fireEvent.click(screen.getByRole('button', { name: /Pending \(/i }));
      expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);

      // Click Answered filter
      fireEvent.click(screen.getByRole('button', { name: /Answered \(/i }));
      expect(screen.getAllByText('Beta Components').length).toBeGreaterThanOrEqual(1);

      // Click All filter
      fireEvent.click(screen.getByRole('button', { name: /All \(/i }));
      expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);
    });

    it('displays Online status badge when vendor is active and Offline when inactive', async () => {
      mockGetVendorPresence.mockResolvedValueOnce({
        success: true,
        onlineVendors: ['online-vendor@example.com'],
        details: {
          'online-vendor@example.com': { isOnline: true },
          'offline-vendor@example.com': { isOnline: false },
        },
      });

      renderDetails(
        buildRFQ({
          assignedVendors: [
            {
              id: 'v-online',
              name: 'Online Tech Supplies',
              email: 'online-vendor@example.com',
            } as any,
            {
              id: 'v-offline',
              name: 'Offline Engineering Ltd',
              email: 'offline-vendor@example.com',
            } as any,
          ],
          inquiries: [],
        })
      );

      await waitFor(() => {
        expect(screen.getAllByText(DETAILS.vendorOnline).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(DETAILS.vendorOffline).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('allows switching selected vendor and sending clarification reply in buyer view', async () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            makeInquiry({
              id: 'inq-1',
              vendorId: 'v-1',
              vendorName: 'Alpha Supplies',
              message: 'When is required delivery?',
              status: 'open',
            }),
            makeInquiry({
              id: 'inq-2',
              vendorId: 'v-2',
              vendorName: 'Beta Components',
              message: 'Can we submit partial quote?',
              status: 'open',
            }),
          ],
        })
      );

      // Select Beta Components
      fireEvent.click(screen.getByText('Beta Components'));

      // Find composer textarea
      const composer = screen.getByPlaceholderText(/Type clarification response to/i);
      fireEvent.change(composer, { target: { value: 'Yes, partial quotes are acceptable.' } });

      const sendBtn = screen.getByRole('button', { name: 'Send' });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalled();
      });
    });

    it('renders vendor view and allows vendor to send clarification to buyer', async () => {
      render(
        <RFQDetails
          rfq={buildRFQ({
            inquiries: [
              makeInquiry({
                id: 'inq-v1',
                vendorId: 'v-partner',
                vendorName: 'Vendor Partner',
                message: 'Existing vendor question',
              }),
            ],
          })}
          onBack={jest.fn()}
          isVendorView={true}
        />
      );

      expect(screen.getByText('Direct Clarification & Inquiry with Buyer')).toBeInTheDocument();

      const textarea = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      fireEvent.change(textarea, { target: { value: 'Is warranty mandatory for all line items?' } });

      const sendBtn = screen.getByRole('button', { name: 'Send Inquiry' });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(mockSubmitRFQInquiry).toHaveBeenCalled();
      });
    });

    it('renders empty desk state and allows inviting suppliers', () => {
      renderDetails(
        buildRFQ({
          inquiries: [],
          assignedVendors: [],
          quotes: [],
        })
      );

      expect(screen.getByText('No Vendors or Clarifications Active')).toBeInTheDocument();
      const inviteBtns = screen.getAllByRole('button', { name: /Invite Suppliers/i });
      expect(inviteBtns.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(inviteBtns[0]);
    });

    it('handles RFQ closure when clicking Close RFQ', async () => {
      renderDetails(buildRFQ({ status: 'Quotes Pending' }));

      const closeBtn = screen.queryByRole('button', { name: /Close RFQ/i });
      if (closeBtn) {
        fireEvent.click(closeBtn);
        await waitFor(() => {
          expect(mockUpdateRFQ).toHaveBeenCalledWith('rfq-1', { status: 'Closed' });
        });
      }
    });

    it('does not render Close RFQ button on the vendor side', () => {
      renderDetails(buildRFQ({ status: 'Quotes Pending' }), { isVendorView: true });
      expect(screen.queryByRole('button', { name: /Close RFQ/i })).not.toBeInTheDocument();
    });

    it('on V2 RFQ, hides Procucev network vendor details from the buyer while displaying own vendors', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_2',
          assignedVendors: [
            {
              id: 'own-v-1',
              name: 'My Direct Vendor',
              email: 'direct@supplier.com',
              phone: '+91 91234 56789',
              vendorCategory: 'Fabrication',
              isProcucev: false,
            } as any,
            {
              id: 'proc-v-2',
              name: 'Secret Procucev Vendor',
              email: 'secret@procucev.com',
              phone: '+91 99999 88888',
              vendorCategory: 'Procucev Network',
              isProcucev: true,
            } as any,
          ],
        })
      );

      expect(screen.getByText('Assigned & Invited Suppliers')).toBeInTheDocument();
      // Buyer's own vendor should be rendered
      expect(screen.getAllByText('My Direct Vendor').length).toBeGreaterThanOrEqual(1);
      // Procucev vendor details must be hidden on the buyer side for V2 RFQs
      expect(screen.queryByText('Secret Procucev Vendor')).not.toBeInTheDocument();
      expect(screen.queryByText('secret@procucev.com')).not.toBeInTheDocument();
    });

    it('renders Pre-Purchase Order Finalised banner and omits Close/Extend actions when PO is generated', () => {
      renderDetails(
        buildRFQ({
          id: 'rfq-po-screen',
          rfqNumber: 'RFQ-2026-00421',
          status: 'PO Generated',
          poFinalised: true,
          poNumber: 'PO-2026-00421',
          awardedVendor: 'Apex Supplies Ltd.',
          awardedAmount: 185000,
        })
      );

      expect(screen.getByText(/Pre-Purchase Order Finalised/i)).toBeInTheDocument();
      expect(screen.getAllByText('PO-2026-00421').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/View Finalised Matrix & PO ↗/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Close RFQ/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Extend RFQ/i })).not.toBeInTheDocument();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Extend RFQ, Close RFQ Advanced Workflows, and Header Actions
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Extend & Close RFQ workflows', () => {
    it('opens extend modal, switches duration to +48h, and successfully extends RFQ', async () => {
      const mockRefresh = jest.fn().mockResolvedValue(undefined);
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: mockRefresh,
        currentRole: 'buyer',
        buyerVendors: [],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          id: 'rfq-ext-1',
          rfqNumber: 'RFQ-2026-00999',
          isExtended: false,
          deadline: '2026-10-10T12:00:00Z',
        })
      );

      const extendBtn = screen.getByRole('button', { name: /Extend RFQ/i });
      fireEvent.click(extendBtn);

      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();
      expect(screen.getByText(DETAILS.extendModalTitle)).toBeInTheDocument();

      const btn48 = screen.getByText('+48h');
      fireEvent.click(btn48);

      const confirmBtn = within(modal).getByRole('button', { name: /Confirm Extension/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockExtendRFQ).toHaveBeenCalledWith('rfq-ext-1', 48);
      });
      expect(mockShowToast).toHaveBeenCalledWith(
        DETAILS.extensionSuccessTitle,
        expect.stringContaining('RFQ-2026-00999'),
        'success'
      );
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('handles extend RFQ failure and exception gracefully', async () => {
      mockExtendRFQ.mockResolvedValueOnce({ success: false, error: 'Cannot extend RFQ twice.' });

      renderDetails(buildRFQ({ id: 'rfq-ext-fail', isExtended: false }));
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));

      const modal = screen.getByRole('dialog');
      fireEvent.click(within(modal).getByRole('button', { name: /Confirm Extension/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          DETAILS.extensionFailedTitle,
          'Cannot extend RFQ twice.',
          'warning'
        );
      });

      mockExtendRFQ.mockRejectedValueOnce(new Error('Network error extending RFQ'));
      fireEvent.click(within(modal).getByRole('button', { name: /Confirm Extension/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          DETAILS.extensionFailedTitle,
          'Network error extending RFQ',
          'warning'
        );
      });
    });

    it('cancels extend modal when cancel or close button is clicked', () => {
      renderDetails(buildRFQ({ id: 'rfq-ext-cancel', isExtended: false }));
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));

      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();

      fireEvent.click(within(modal).getAllByRole('button', { name: UI_STRINGS.actions.cancel })[0]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('displays already extended badge when isExtended is true', () => {
      renderDetails(
        buildRFQ({
          id: 'rfq-already-ext',
          isExtended: true,
          extensionHours: 24,
        })
      );

      expect(screen.getByText(formatString(DETAILS.extendedBadge, { hours: 24 }))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Extend RFQ/i })).not.toBeInTheDocument();
    });

    it('handles Close RFQ failure and rejection with warning toast', async () => {
      mockUpdateRFQ.mockResolvedValueOnce({ success: false, error: 'Database locked' });

      renderDetails(buildRFQ({ id: 'rfq-close-fail' }));
      fireEvent.click(screen.getByRole('button', { name: /Close RFQ/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Action Failed', 'Database locked', 'warning');
      });

      mockUpdateRFQ.mockRejectedValueOnce(new Error('Close request timed out'));
      fireEvent.click(screen.getByRole('button', { name: /Close RFQ/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Action Failed', 'Close request timed out', 'warning');
      });
    });

    it('invokes onEdit and onDelete callbacks', () => {
      const onEdit = jest.fn();
      const onDelete = jest.fn();
      const EDIT = UI_STRINGS.rfqEdit;
      renderDetails(buildRFQ({ id: 'rfq-actions' }), { onEdit, onDelete });

      const editBtn = screen.getByLabelText(formatString(EDIT.editAria, { rfqNumber: 'RFQ-2026-00462' }));
      fireEvent.click(editBtn);
      expect(onEdit).toHaveBeenCalled();

      const deleteBtn = screen.getByLabelText(formatString(EDIT.deleteAria, { rfqNumber: 'RFQ-2026-00462' }));
      fireEvent.click(deleteBtn);
      expect(onDelete).toHaveBeenCalled();
    });

    it('syncs props retaining assignedVendors if incoming prop has fewer assigned vendors than local', () => {
      const initialRfq = buildRFQ({
        id: 'rfq-sync',
        assignedVendors: [
          { id: 'v-1', name: 'Vendor One' } as any,
          { id: 'v-2', name: 'Vendor Two' } as any,
        ],
      });
      const { rerender } = renderDetails(initialRfq);

      expect(screen.getAllByText('Vendor One').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Vendor Two').length).toBeGreaterThanOrEqual(1);

      // Rerender with fewer incoming assignedVendors
      rerender(
        <RFQDetails
          rfq={buildRFQ({ id: 'rfq-sync', assignedVendors: [{ id: 'v-1', name: 'Vendor One' } as any] })}
          onBack={onBack}
        />
      );

      // Retains both vendors from previous local state
      expect(screen.getAllByText('Vendor Two').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Status Badges, Mobile Line Items Sorting, and Matrix Navigation
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Status Badges, Mobile Sort, and PO Navigation', () => {
    it.each([
      ['Expired', 'border-rose-200'],
      ['In Evaluation', 'border-blue-200'],
      ['Quotes Received', 'border-blue-200'],
      ['AI Recommended', 'border-emerald-200'],
    ])('renders %s status badge with expected styling', (status, expectedClass) => {
      renderDetails(buildRFQ({ status: status as any }));
      const badges = screen.getAllByText(status);
      expect(badges[0].className).toContain(expectedClass);
    });

    it('handles mobile line items sorting dropdown changes', () => {
      renderDetails(
        buildRFQ({
          extractedEntities: [
            entity({ id: 'ent-a', itemName: 'Alpha Pump', quantity: 50, minorCategory: 'Cat A' }),
            entity({ id: 'ent-z', itemName: 'Zulu Valve', quantity: 10, minorCategory: 'Cat B' }),
          ],
        })
      );

      const mobileSortSelect = screen.getByLabelText(DETAILS.colItem);
      expect(mobileSortSelect).toBeInTheDocument();

      fireEvent.change(mobileSortSelect, { target: { value: 'item:desc' } });
      fireEvent.change(mobileSortSelect, { target: { value: 'quantity:asc' } });
      fireEvent.change(mobileSortSelect, { target: { value: '' } });
    });

    it('navigates to quote matrix when clicking View Finalised Matrix & PO', () => {
      renderDetails(
        buildRFQ({
          status: 'PO Generated',
          poFinalised: true,
          poNumber: 'PO-2026-999',
          rfqNumber: 'RFQ-2026-00462',
        })
      );

      const viewMatrixBtn = screen.getByRole('button', { name: /View Finalised Matrix & PO ↗/i });
      fireEvent.click(viewMatrixBtn);

      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/buyer/quote-matrix?rfq=RFQ-2026-00462'));
    });

    it('navigates to quote matrix from quotes panel toolbar', () => {
      renderDetails(
        buildRFQ({
          rfqNumber: 'RFQ-2026-00462',
          quotes: [quote({ vendorId: 'v-1' })],
        })
      );

      const compareBtn = screen.getByRole('button', { name: /Compare Quotations in Matrix ↗/i });
      fireEvent.click(compareBtn);

      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/buyer/quote-matrix?rfq=RFQ-2026-00462'));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Vendor Quotations Breakdown, Line Items Accordion, and Excel Exports
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Quotations Breakdown, Line Items Accordion, and Excel Exports', () => {
    it('expands and collapses quote line items breakdown in table and mobile view', () => {
      const quoteWithItems = quote({
        vendorId: 'v-with-items',
        vendorName: 'Precision Engineering Ltd',
        vendorCategory: 'Client List',
        lineItemQuotes: [
          {
            lineItemId: 'li-1',
            itemName: 'Precision Impeller',
            quantity: 5,
            unit: 'Units',
            unitPrice: 12000,
            totalPrice: 60000,
          },
        ],
      });

      renderDetails(buildRFQ({ quotes: [quoteWithItems] }));

      // Find toggle button in table
      const expandBtn = screen.getByTitle('Toggle itemized line items');
      expect(expandBtn).toBeInTheDocument();
      fireEvent.click(expandBtn);

      // Line items breakdown should be rendered
      expect(screen.getAllByText(/Line Item Breakdown \(1 items\)/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Precision Impeller').length).toBeGreaterThanOrEqual(1);

      // Collapse it
      fireEvent.click(expandBtn);

      // Find mobile card line item accordion toggle
      const mobileAccordion = screen.getByRole('button', { name: /Line Item Breakdown \(1 items\)/i });
      fireEvent.click(mobileAccordion);
      expect(screen.getAllByText('Precision Impeller').length).toBeGreaterThanOrEqual(1);
    });

    it('triggers Excel downloads for full quotes and single quote', () => {
      const q = quote({
        vendorId: 'v-export',
        lineItemQuotes: [
          {
            lineItemId: 'li-exp',
            itemName: 'Stainless Bolt',
            quantity: 100,
            unit: 'Nos',
            unitPrice: 50,
            totalPrice: 5000,
          },
        ],
      });

      renderDetails(buildRFQ({ quotes: [q] }));

      // Full quotes Excel button in toolbar
      const fullExcelBtn = screen.getByRole('button', { name: /Download Quotes \(Excel\)/i });
      fireEvent.click(fullExcelBtn);
      expect(mockDownloadFullQuotesExcel).toHaveBeenCalled();

      // Single vendor quote Excel button
      const singleExcelBtn = screen.getByTitle('Download this vendor quote as Excel');
      fireEvent.click(singleExcelBtn);
      expect(mockDownloadSingleVendorQuoteExcel).toHaveBeenCalled();

      // Mobile single vendor quote button
      const mobileSingleExcel = screen.getByRole('button', { name: /Download Vendor Quote \(Excel\)/i });
      fireEvent.click(mobileSingleExcel);
      expect(mockDownloadSingleVendorQuoteExcel).toHaveBeenCalledTimes(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // checkIsProcucevVendor Matrix & Vendor Classification
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Vendor Classification (checkIsProcucevVendor)', () => {
    it('classifies based on explicit vendorCategory in activeRfq.quotes', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          quotes: [
            quote({ vendorId: 'v-proc-quote', vendorName: 'Proc Quote Vendor', vendorCategory: 'Procucev Network' }),
            quote({ vendorId: 'v-client-quote', vendorName: 'Client Quote Vendor', vendorCategory: 'Client List' }),
          ],
          assignedVendors: [
            { id: 'v-proc-quote', name: 'Proc Quote Vendor' } as any,
            { id: 'v-client-quote', name: 'Client Quote Vendor' } as any,
          ],
        })
      );

      // In buyer view: Procucev vendor has double-blind card, client vendor has full card
      expect(screen.getByText('🔒 Double-Blind')).toBeInTheDocument();
      expect(screen.getByText('Invited')).toBeInTheDocument();
    });

    it('classifies based on activeRfq.assignedVendors matching category and buyerUploaded status', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [
            { id: 'v-assigned-proc', name: 'Assigned Proc', vendorCategory: 'Procucev - AI Rec' } as any,
            { id: 'v-assigned-client', name: 'Assigned Client', vendorCategory: 'Client List' } as any,
            { id: 'v-assigned-buyer-up', name: 'Buyer Uploaded Vendor', isBuyerUploaded: true } as any,
          ],
        })
      );

      expect(screen.getAllByText('Assigned Proc').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Assigned Client').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Buyer Uploaded Vendor').length).toBeGreaterThanOrEqual(1);
    });

    it('classifies based on buyerVendors in store', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          { id: 'bv-proc', name: 'BV Procucev', isProcucev: true, source: 'procucev_network' },
          { id: 'bv-client', name: 'BV Client', isBuyerUploaded: true, source: 'buyer_excel' },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [
            { id: 'bv-proc', name: 'BV Procucev' } as any,
            { id: 'bv-client', name: 'BV Client' } as any,
          ],
        })
      );

      expect(screen.getAllByText('BV Procucev').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('BV Client').length).toBeGreaterThanOrEqual(1);
    });

    it('resolves score from aiMatchScore or vendor rating', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          { id: 'v-rated', name: 'Rated Vendor', isProcucev: true, rating: 4.5, source: 'procucev_network' },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          quotes: [
            quote({ vendorId: 'v-rated', aiMatchScore: 88, vendorName: 'Rated Vendor' }),
          ],
          assignedVendors: [
            { id: 'v-rated', name: 'Rated Vendor', vendorCategory: 'Procucev Network' } as any,
          ],
        })
      );

      expect(screen.getAllByText(/88% match/i).length).toBeGreaterThanOrEqual(1);
    });

    it('handles assigned vendors passed as string IDs and resolves from buyerVendors', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          {
            id: 'str-v-1',
            name: 'String Resolved Vendor',
            email: 'str@test.com',
            phone: '+91 99999 11111',
            source: 'buyer_uploaded',
          },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: ['str-v-1' as any],
        })
      );

      expect(screen.getAllByText('String Resolved Vendor').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('str@test.com')).toBeInTheDocument();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Inquiries Desk, Chat Messages, Channel Filters, and Fallbacks
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Inquiries Desk & Chat Clarifications', () => {
    it('dispatches vendor question with Enter key in Vendor View and handles API update and fallback', async () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'vendor',
        buyerVendors: [],
        currentUserSession: { id: 'v-curr', name: 'Apex Vendor', email: 'apex@vendor.com', role: 'vendor' },
      });

      renderDetails(
        buildRFQ({
          id: 'rfq-vendor-chat',
          rfqNumber: 'RFQ-2026-00462',
          inquiries: [
            {
              id: 'inq-1',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-curr',
              vendorName: 'Apex Vendor',
              vendorEmail: 'apex@vendor.com',
              message: 'What is the pump casing material?',
              status: 'open',
              createdAt: '2026-09-03T10:00:00Z',
            },
          ],
        }),
        { isVendorView: true }
      );

      const textarea = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      fireEvent.change(textarea, { target: { value: 'Is SS316 mandatory for impeller?' } });

      // Press Enter key without shift
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockSubmitRFQInquiry).toHaveBeenCalledWith(
          'rfq-vendor-chat',
          expect.objectContaining({ message: 'Is SS316 mandatory for impeller?' })
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');

      // Test fallback branch when submitRFQInquiry returns success: false
      mockSubmitRFQInquiry.mockResolvedValueOnce({ success: false });
      fireEvent.change(textarea, { target: { value: 'Second fallback query' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
      });

      // Test exception branch
      mockSubmitRFQInquiry.mockRejectedValueOnce(new Error('Vendor offline'));
      fireEvent.change(textarea, { target: { value: 'Third crashing query' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Dispatch Failed', 'Vendor offline', 'warning');
      });
    });

    it('filters chat channels by pending, answered, and search keyword', () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-open',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-open',
              vendorName: 'Open Supplier',
              vendorEmail: 'open@test.com',
              message: 'Delivery schedule query',
              status: 'open',
              createdAt: '2026-09-03T10:00:00Z',
            },
            {
              id: 'inq-ans',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-ans',
              vendorName: 'Answered Supplier',
              vendorEmail: 'ans@test.com',
              message: 'Warranty query',
              reply: '2 years OEM warranty',
              status: 'answered',
              createdAt: '2026-09-03T10:00:00Z',
            },
          ],
        })
      );

      expect(screen.getAllByText('Open Supplier')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Answered Supplier')[0]).toBeInTheDocument();

      // Filter by Pending
      const pendingBtn = screen.getByRole('button', { name: /Pending \(1\)/i });
      fireEvent.click(pendingBtn);
      expect(screen.getAllByText('Open Supplier')[0]).toBeInTheDocument();
      expect(screen.queryByText('Answered Supplier')).not.toBeInTheDocument();

      // Filter by Answered
      const answeredBtn = screen.getByRole('button', { name: /Answered \(1\)/i });
      fireEvent.click(answeredBtn);
      fireEvent.click(screen.getAllByText('Answered Supplier')[0]);
      expect(screen.queryByText('Open Supplier')).not.toBeInTheDocument();
      expect(screen.getAllByText('Answered Supplier')[0]).toBeInTheDocument();

      // Search keyword
      const allBtn = screen.getByRole('button', { name: /All \(2\)/i });
      fireEvent.click(allBtn);

      const searchInput = screen.getByPlaceholderText(/Search vendor/i);
      fireEvent.change(searchInput, { target: { value: 'Open' } });
      fireEvent.click(screen.getAllByText('Open Supplier')[0]);
      expect(screen.getAllByText('Open Supplier')[0]).toBeInTheDocument();
      expect(screen.queryByText('Answered Supplier')).not.toBeInTheDocument();
    });

    it('buyer sends clarification message via textarea and Enter key with success', async () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-active',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-act',
              vendorName: 'Direct Active Supplier',
              vendorEmail: 'direct@supplier.com',
              message: 'Clarification on flange specs',
              status: 'open',
              createdAt: '2026-09-03T10:00:00Z',
            },
          ],
        })
      );

      const buyerComposer = screen.getByPlaceholderText(/Type clarification response to Direct Active Supplier/i);
      fireEvent.change(buyerComposer, { target: { value: 'ANSI 150 Class flanged is required.' } });
      fireEvent.keyDown(buyerComposer, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalledWith(
          'rfq-1',
          'inq-active',
          expect.objectContaining({ reply: 'ANSI 150 Class flanged is required.' })
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
    });

    it('buyer handles fallback optimistic update when reply returns success false', async () => {
      mockReplyToRFQInquiry.mockResolvedValueOnce({ success: false });

      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-active-fallback',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-act-fb',
              vendorName: 'Fallback Direct Supplier',
              vendorEmail: 'fb@supplier.com',
              message: 'Clarification on lead time',
              status: 'open',
              createdAt: '2026-09-03T10:00:00Z',
            },
          ],
        })
      );

      const buyerComposer = screen.getByPlaceholderText(/Type clarification response to Fallback Direct Supplier/i);
      fireEvent.change(buyerComposer, { target: { value: 'Fallback optimistic message' } });
      fireEvent.keyDown(buyerComposer, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
      });
    });

    it('buyer handles network error when sending clarification', async () => {
      mockReplyToRFQInquiry.mockRejectedValueOnce(new Error('Network drop on reply'));

      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-active-err',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-act-err',
              vendorName: 'Error Direct Supplier',
              vendorEmail: 'err@supplier.com',
              message: 'Clarification on test certificate',
              status: 'open',
              createdAt: '2026-09-03T10:00:00Z',
            },
          ],
        })
      );

      const buyerComposer = screen.getByPlaceholderText(/Type clarification response to Error Direct Supplier/i);
      fireEvent.change(buyerComposer, { target: { value: 'Crashing reply' } });
      fireEvent.keyDown(buyerComposer, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Dispatch Failed', 'Network drop on reply', 'warning');
      });
    });

    it('buyer initiates fresh clarification with vendor when active channel has no inquiryId', async () => {
      mockUpdateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: buildRFQ({
          assignedVendors: [{ id: 'v-assigned-no-inq', name: 'Fresh Vendor', email: 'fresh@test.com' } as any],
        }),
      });

      renderDetails(
        buildRFQ({
          assignedVendors: [{ id: 'v-assigned-no-inq', name: 'Fresh Vendor', email: 'fresh@test.com' } as any],
          inquiries: [],
        })
      );

      const buyerComposer = screen.getByPlaceholderText(/Type clarification response to Fresh Vendor/i);
      fireEvent.change(buyerComposer, { target: { value: 'Please share your datasheet.' } });
      fireEvent.keyDown(buyerComposer, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockUpdateRFQ).toHaveBeenCalledWith(
          'rfq-1',
          expect.objectContaining({ inquiries: expect.any(Array) })
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Buyer Reply Modal
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Buyer Reply Modal', () => {
    it('opens reply modal, submits response with success, fallback, and error handling', async () => {
      const mockInquiry: any = {
        id: 'inq-reply-modal',
        rfqNumber: 'RFQ-2026-00462',
        vendorId: 'v-rep',
        vendorName: 'Pumps & Spares Corp',
        vendorEmail: 'pumps@spares.com',
        message: 'Can delivery be split into 2 batches?',
        status: 'open',
        createdAt: '2026-09-03T10:00:00Z',
      };

      renderDetails(
        buildRFQ({
          inquiries: [mockInquiry],
        })
      );

      const replyBtn = screen.getByRole('button', { name: /Reply/i });
      fireEvent.click(replyBtn);

      expect(screen.getByText(/Answer Vendor Clarification/i)).toBeInTheDocument();
      expect(screen.getByText(/“Can delivery be split into 2 batches\?”/i)).toBeInTheDocument();

      const replyTextarea = screen.getByPlaceholderText(/Provide specific technical, delivery, or commercial clarification/i);
      fireEvent.change(replyTextarea, { target: { value: 'Yes, split delivery is acceptable.' } });

      const sendClarificationBtn = screen.getByRole('button', { name: /Send Clarification/i });
      fireEvent.click(sendClarificationBtn);

      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalledWith(
          'rfq-1',
          'inq-reply-modal',
          expect.objectContaining({ reply: 'Yes, split delivery is acceptable.' })
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith('Clarification Answered', expect.any(String), 'success');
    });

    it('handles fallback and error states in reply modal, and can be cancelled', async () => {
      const mockInquiry: any = {
        id: 'inq-reply-modal-fb',
        rfqNumber: 'RFQ-2026-00462',
        vendorId: 'v-rep',
        vendorName: 'Pumps & Spares Corp',
        vendorEmail: 'pumps@spares.com',
        message: 'Can delivery be split into 2 batches?',
        status: 'open',
        createdAt: '2026-09-03T10:00:00Z',
      };

      // Test fallback when success: false
      mockReplyToRFQInquiry.mockResolvedValueOnce({ success: false });

      const { unmount } = renderDetails(
        buildRFQ({
          inquiries: [mockInquiry],
        })
      );

      fireEvent.click(screen.getByRole('button', { name: /Reply/i }));

      const replyTextarea = screen.getByPlaceholderText(/Provide specific technical, delivery, or commercial clarification/i);
      fireEvent.change(replyTextarea, { target: { value: 'Fallback split reply' } });
      fireEvent.click(screen.getByRole('button', { name: /Send Clarification/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Clarification Answered', expect.any(String), 'success');
      });
      unmount();

      // Test error catch
      mockReplyToRFQInquiry.mockRejectedValueOnce(new Error('Reply server offline'));

      const { unmount: unmount2 } = renderDetails(
        buildRFQ({
          inquiries: [mockInquiry],
        })
      );

      fireEvent.click(screen.getByRole('button', { name: /Reply/i }));

      const replyTextareaErr = screen.getByPlaceholderText(/Provide specific technical, delivery, or commercial clarification/i);
      fireEvent.change(replyTextareaErr, { target: { value: 'Crashing reply' } });
      fireEvent.click(screen.getByRole('button', { name: /Send Clarification/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Reply Failed', 'Reply server offline', 'warning');
      });
      unmount2();

      // Test cancel button
      renderDetails(
        buildRFQ({
          inquiries: [mockInquiry],
        })
      );

      fireEvent.click(screen.getByRole('button', { name: /Reply/i }));
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
      expect(screen.queryByText(/Answer Vendor Clarification/i)).not.toBeInTheDocument();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Category Manager & Buyer Suppliers Modals
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Category Manager & Buyer Suppliers Modals', () => {
    it('category manager switches tabs and opens InviteVendorsModal', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'category_manager',
        buyerVendors: [],
        currentUserSession: { name: 'CM User', email: 'cm@procucev.com', role: 'category_manager' },
      });

      renderDetails(
        buildRFQ({
          assignedVendors: [
            { id: 'proc-1', name: 'CM Procucev Vendor', vendorCategory: 'Procucev Network' } as any,
            { id: 'own-1', name: 'CM Own Vendor', vendorCategory: 'Client List' } as any,
          ],
        })
      );

      const procucevTab = screen.getByTestId('cm-tab-procucev');
      const ownTab = screen.getByTestId('cm-tab-own');

      fireEvent.click(ownTab);
      expect(screen.getAllByText('CM Own Vendor')[0]).toBeInTheDocument();

      fireEvent.click(procucevTab);
      expect(screen.getAllByText('CM Procucev Vendor')[0]).toBeInTheDocument();

      // Open InviteVendorsModal
      const inviteBtn = screen.getByRole('button', { name: /Invite Suppliers/i });
      fireEvent.click(inviteBtn);

      expect(screen.getByTestId('mock-invite-vendors-modal')).toBeInTheDocument();

      // Trigger invite
      fireEvent.click(screen.getByText('Trigger CM Invite'));
      expect(mockShowToast).toHaveBeenCalledWith('Suppliers Assigned', expect.any(String), 'success');
      expect(screen.queryByTestId('mock-invite-vendors-modal')).not.toBeInTheDocument();
    });

    it('buyer opens BuyerInviteSuppliersModal, selects vendors, searches, and saves assignments', async () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          {
            id: 'v-buyer-1',
            name: 'Pumps Private Ltd',
            email: 'priv1@test.com',
            majorCategory: 'Pumps',
            contactPerson: 'Ramesh Kumar',
            source: 'buyer_excel',
          },
          {
            id: 'v-buyer-2',
            name: 'Valves Private Ltd',
            email: 'priv2@test.com',
            majorCategory: 'Valves',
            contactPerson: 'Suresh Patel',
            source: 'buyer_excel',
          },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          assignedVendors: [],
        })
      );

      // Open Buyer Invite Suppliers Modal
      const inviteBtn = screen.getAllByRole('button', { name: /Invite Suppliers/i })[0];
      fireEvent.click(inviteBtn);

      expect(screen.getByText(/Invite Approved Suppliers/i)).toBeInTheDocument();
      expect(screen.getByText(/2 Private Suppliers/i)).toBeInTheDocument();

      // Search vendors
      const searchInput = screen.getByPlaceholderText(/Search by supplier name, email, or category/i);
      fireEvent.change(searchInput, { target: { value: 'Valves' } });
      expect(screen.getByText(/Valves Private Ltd/i)).toBeInTheDocument();
      expect(screen.queryByText(/Pumps Private Ltd/i)).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Click Select All
      const selectAllBtn = screen.getByText('Select All');
      fireEvent.click(selectAllBtn);
      expect(screen.getByText('2 selected')).toBeInTheDocument();

      // Click Deselect All
      const deselectAllBtn = screen.getByText('Deselect All');
      fireEvent.click(deselectAllBtn);
      expect(screen.getByText('0 selected')).toBeInTheDocument();

      // Button disabled when 0 selected
      const assignBtn = screen.getByRole('button', { name: /Assign Suppliers/i });
      expect(assignBtn).toBeDisabled();

      // Select vendor by clicking card
      const vendorCard = screen.getByText(/Pumps Private Ltd/i);
      fireEvent.click(vendorCard);
      expect(screen.getByText('1 selected')).toBeInTheDocument();

      // Assign selected vendor
      const assign1Btn = screen.getByRole('button', { name: /Assign 1 Suppliers/i });
      fireEvent.click(assign1Btn);

      await waitFor(() => {
        expect(mockUpdateRFQ).toHaveBeenCalledWith(
          'rfq-1',
          expect.objectContaining({
            assignedVendors: expect.arrayContaining([
              expect.objectContaining({ id: 'v-buyer-1', name: 'Pumps Private Ltd' }),
            ]),
          })
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith('Suppliers Added', expect.any(String), 'success');
      expect(screen.queryByText(/Invite Approved Suppliers/i)).not.toBeInTheDocument();
    });

    it('handles BuyerInviteSuppliersModal update failure with error display and warning toast', async () => {
      mockUpdateRFQ.mockResolvedValueOnce({ success: false, error: 'Database update failed' });

      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          {
            id: 'v-buyer-err',
            name: 'Error Vendor',
            source: 'buyer_excel',
          },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(buildRFQ({ assignedVendors: [] }));

      const inviteBtn = screen.getAllByRole('button', { name: /Invite Suppliers/i })[0];
      fireEvent.click(inviteBtn);

      fireEvent.click(screen.getByText(/Error Vendor/i));
      fireEvent.click(screen.getByRole('button', { name: /Assign 1 Suppliers/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Assignment Failed', 'Database update failed', 'warning');
      });
      expect(screen.getByText('Database update failed')).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByText(/Invite Approved Suppliers/i)).not.toBeInTheDocument();
    });

    it('displays empty state when buyer has no private suppliers uploaded', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(buildRFQ({ assignedVendors: [] }));

      const inviteBtn = screen.getAllByRole('button', { name: /Invite Suppliers/i })[0];
      fireEvent.click(inviteBtn);

      expect(screen.getByText(/No Private Suppliers Available/i)).toBeInTheDocument();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Branch Booster Suite: vendorChannels, quotes, modals, and edge cases
  // ══════════════════════════════════════════════════════════════════════════════
  describe('RFQ Details Branch Booster Suite', () => {
    it('exercises vendor view channel memo fallbacks with missing session and inquiry timestamps', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'vendor',
        buyerVendors: [],
        currentUserSession: null,
      });

      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-v-fallback-1',
              rfqNumber: 'RFQ-2026-00462',
              message: 'Question without sender or date',
              reply: 'Official reply without replier',
              messages: undefined,
              status: undefined,
            } as any,
            {
              id: 'inq-v-fallback-2',
              rfqNumber: 'RFQ-2026-00462',
              message: 'Second question',
              createdAt: '2026-09-01T10:00:00Z',
              repliedAt: '2026-09-01T12:00:00Z',
              reply: 'Second reply',
              status: 'answered',
            } as any,
          ],
        }),
        { isVendorView: true }
      );

      expect(screen.getAllByText(/Vendor Partner \(Supplier\)/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Buyer Procurement Team \(Buyer\)/i).length).toBeGreaterThanOrEqual(1);
    });

    it('exercises buyer view channel enrichment for contactPerson, phone, and undefined isProcucev', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [],
        currentUserSession: { name: 'Buyer User', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-enrich-1',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-enrich-1',
              vendorName: 'Enrichable Vendor Corp',
              message: 'Need clarity on test spec',
              status: 'open',
            } as any,
          ],
          assignedVendors: [
            {
              id: 'v-enrich-1',
              name: 'Enrichable Vendor Corp',
              contactPerson: 'Harish Mehta',
              phone: '+91 98200 12345',
              vendorCategory: 'Client List',
              source: 'buyer_manual',
            } as any,
          ],
        })
      );

      expect(screen.getByText('Harish Mehta')).toBeInTheDocument();
    });

    it('exercises channel sorting with open status, message count differences, and quoting vendors without vendorId', () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-chan-open',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-chan-open',
              vendorName: 'Open Channel Vendor',
              message: 'Pending question',
              status: 'open',
            } as any,
            {
              id: 'inq-chan-msgs',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-chan-msgs',
              vendorName: 'Vendor With Messages',
              message: 'Has message',
              status: 'answered',
              messages: [{ id: 'm1', senderRole: 'vendor', message: 'Hello', senderName: 'V', timestamp: '2026-09-02' } as any],
            } as any,
          ],
          quotes: [
            {
              vendorName: 'Quoting Vendor Only',
              totalPrice: 150000,
              complianceStatus: 'Fully Compliant',
              leadTimeDays: 7,
            } as any,
          ],
        })
      );

      expect(screen.getAllByText('Quoting Vendor Only')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Open Channel Vendor')[0]).toBeInTheDocument();
    });

    it('exercises quotations hidden view with and without quotesHiddenReason and quotesHiddenUntil', () => {
      renderDetails(
        buildRFQ({
          quotesCount: 3,
          quotesHidden: true,
          quotesHiddenReason: 'Custom sealed bidding protocol active until closing.',
          quotesHiddenUntil: '2026-10-30T15:00:00Z',
          quotes: [],
        })
      );

      expect(screen.getByText(/Custom sealed bidding protocol active/i)).toBeInTheDocument();
      expect(screen.getByText(/Unseals:/i)).toBeInTheDocument();
    });

    it('exercises quotations hidden view default fallback text when reason and until are omitted', () => {
      renderDetails(
        buildRFQ({
          quotesCount: 2,
          quotesHidden: true,
          quotesHiddenReason: undefined,
          quotesHiddenUntil: undefined,
          quotes: [],
        })
      );

      expect(screen.getByText(/Received quotations remain hidden from the buyer for 48 hours/i)).toBeInTheDocument();
      expect(screen.getByText(/After 48 hours/i)).toBeInTheDocument();
    });

    it('exercises quote score breakdown calculations, missing match score fallback, and line item fallbacks', () => {
      renderDetails(
        buildRFQ({
          status: 'PO Generated',
          quotes: [
            {
              vendorId: 'v-calc-1',
              vendorName: 'Precision Engineering Tools',
              isBestPrice: false,
              aiMatchScore: undefined,
              scoreBreakdown: {
                price: { weighted: 36, raw: 80 },
                leadTime: { weighted: 25, raw: 85 },
                warranty: { weighted: 20, raw: 80 },
              },
              paymentTerms: undefined,
              submittedAt: undefined,
              remarks: 'Standard testing included',
              lineItemQuotes: [
                {
                  lineItemId: undefined,
                  description: 'Special Bushing Item',
                  quantity: 50,
                  unit: undefined,
                  unitPrice: 120,
                  totalPrice: 6000,
                } as any,
              ],
            } as any,
          ],
        })
      );

      expect(screen.getAllByText(/Payment terms not specified/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/81%/i)[0]).toBeInTheDocument(); // 36 + 25 + 20
    });

    it('exercises RFQ follow-up outreach telemetry rendering when invited and responded are positive', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'category_manager',
        buyerVendors: [],
        currentUserSession: { name: 'CM Lead', role: 'category_manager' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_0',
          assignedVendors: [{ id: 'v-fo-1', name: 'Vendor 1' } as any],
          followUpData: {
            totalInvited: 10,
            respondedCount: 6,
            lastFollowUp: '2026-09-02T10:00:00Z',
          } as any,
        })
      );

      expect(screen.getByText(/10 Outreach Dispatches/i)).toBeInTheDocument();
      expect(screen.getByText(/6 Responded/i)).toBeInTheDocument();
    });

    it('exercises category manager view with empty supplier tabs', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'category_manager',
        buyerVendors: [],
        currentUserSession: { name: 'CM Lead', role: 'category_manager' },
      });

      const { unmount } = renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [
            { id: 'v-only-client', name: 'Client Supplier', vendorCategory: 'Client List' } as any,
          ],
        })
      );

      expect(screen.getByText(/No Procucev network vendors on this RFQ\./i)).toBeInTheDocument();

      const ownTab = screen.getByTestId('cm-tab-own');
      fireEvent.click(ownTab);
      expect(screen.getAllByText('Client Supplier')[0]).toBeInTheDocument();
      unmount();

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [
            { id: 'v-only-proc', name: 'Network Supplier', vendorCategory: 'Procucev Network' } as any,
          ],
        })
      );

      const ownTab2 = screen.getByTestId('cm-tab-own');
      fireEvent.click(ownTab2);
      expect(screen.getByText(/No buyer's own vendors on this RFQ\./i)).toBeInTheDocument();
    });

    it('exercises BuyerInviteSuppliersModal deep search filters, select all toggle, and unselect toggle', async () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          { id: 'v-buyer-sec1', name: 'Alpha Mechanicals', email: 'alpha@buyer.com', majorCategory: 'Pumps', contactPerson: 'Arun Kumar', source: 'buyer_excel' },
          { id: 'v-buyer-sec2', name: 'Beta Hydraulics', email: 'beta@buyer.com', majorCategory: 'Valves', contactPerson: 'Bhavin Patel', source: 'buyer_excel' },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [],
        })
      );

      const inviteBtn = screen.getAllByRole('button', { name: /Invite Suppliers/i })[0];
      fireEvent.click(inviteBtn);

      const searchInput = screen.getByPlaceholderText(/Search by supplier name/i);

      // Search by email
      fireEvent.change(searchInput, { target: { value: 'alpha@buyer.com' } });
      expect(screen.getByText(/Alpha Mechanicals/i)).toBeInTheDocument();
      expect(screen.queryByText(/Beta Hydraulics/i)).not.toBeInTheDocument();

      // Search by majorCategory
      fireEvent.change(searchInput, { target: { value: 'Valves' } });
      expect(screen.getByText(/Beta Hydraulics/i)).toBeInTheDocument();
      expect(screen.queryByText(/Alpha Mechanicals/i)).not.toBeInTheDocument();

      // Search by contactPerson
      fireEvent.change(searchInput, { target: { value: 'Arun Kumar' } });
      expect(screen.getByText(/Alpha Mechanicals/i)).toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Toggle Select All on
      const selectAllBtn = screen.getByRole('button', { name: /Select All/i });
      fireEvent.click(selectAllBtn);

      // Toggle Select All off (Deselect All)
      const deselectAllBtn = screen.getByRole('button', { name: /Deselect All/i });
      fireEvent.click(deselectAllBtn);

      // Select individual vendor
      fireEvent.click(screen.getByText(/Alpha Mechanicals/i));
      // Unselect individual vendor
      fireEvent.click(screen.getByText(/Alpha Mechanicals/i));

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    });

    it('exercises BuyerInviteSuppliersModal with string rawExistingAssigned resolving from buyerVendors', async () => {
      const mockOnUpdate = jest.fn();
      mockUpdateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: buildRFQ({
          assignedVendors: [
            { id: 'v-str-existing', name: 'Existing String Vendor', email: 'str@buyer.com' } as any,
            { id: 'v-buyer-to-add', name: 'Newly Added Vendor', email: 'new@buyer.com' } as any,
          ],
        }),
      });

      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          { id: 'v-str-existing', name: 'Existing String Vendor', email: 'str@buyer.com', source: 'buyer_excel' },
          { id: 'v-buyer-to-add', name: 'Newly Added Vendor', email: 'new@buyer.com', source: 'buyer_excel' },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: ['v-str-existing' as any],
        }),
        { onUpdate: mockOnUpdate }
      );

      const inviteBtn = screen.getAllByRole('button', { name: /Invite Suppliers/i })[0];
      fireEvent.click(inviteBtn);

      fireEvent.click(screen.getByText(/Newly Added Vendor/i));
      fireEvent.click(screen.getByRole('button', { name: /Assign 1 Suppliers/i }));

      await waitFor(() => {
        expect(mockUpdateRFQ).toHaveBeenCalledWith(
          'rfq-1',
          expect.objectContaining({
            assignedVendors: expect.arrayContaining([
              expect.objectContaining({ id: 'v-str-existing', name: 'Existing String Vendor' }),
              expect.objectContaining({ id: 'v-buyer-to-add', name: 'Newly Added Vendor' }),
            ]),
          })
        );
      });
      expect(mockOnUpdate).toHaveBeenCalled();
    });

    it('exercises chat message sending with onUpdate, vendor submission success, and empty input no-op', async () => {
      const mockOnUpdate = jest.fn();
      mockSubmitRFQInquiry.mockResolvedValueOnce({
        success: true,
        rfq: buildRFQ({
          inquiries: [{ id: 'inq-updated-vendor', rfqNumber: 'RFQ-2026-00462', message: 'Vendor inquiry sent' } as any],
        }),
      });

      renderDetails(
        buildRFQ({
          inquiries: [{ id: 'inq-existing-vendor', rfqNumber: 'RFQ-2026-00462', message: 'First msg' } as any],
        }),
        { isVendorView: true, onUpdate: mockOnUpdate }
      );

      const composer = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);

      // Enter with Shift (should not send)
      fireEvent.change(composer, { target: { value: 'Line 1' } });
      fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
      expect(mockSubmitRFQInquiry).not.toHaveBeenCalled();

      // Enter without Shift sends
      fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });
      await waitFor(() => {
        expect(mockSubmitRFQInquiry).toHaveBeenCalled();
      });
      expect(mockOnUpdate).toHaveBeenCalled();
    });

    it('exercises checkIsProcucevVendor with extra source category_manager_upload and excel', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [
            { id: 'v-cm-src', name: 'CM Uploaded Vendor', source: 'category_manager_upload', vendorCategory: 'Procucev Network' } as any,
            { id: 'v-excel-src', name: 'Excel Uploaded Network', source: 'excel', vendorCategory: 'Procucev - AI Rec' } as any,
          ],
        })
      );

      expect(screen.getByText('CM Uploaded Vendor')).toBeInTheDocument();
      expect(screen.getByText('Excel Uploaded Network')).toBeInTheDocument();
    });

    it('exercises daysUntil and lineItemsToCsv edge cases directly', () => {
      expect(daysUntil('')).toBeNull();
      expect(daysUntil('not-a-valid-date')).toBeNull();
      expect(typeof daysUntil('2099-12-31')).toBe('number');
      expect(typeof daysUntil('2020-01-01')).toBe('number');

      const csvEmpty = lineItemsToCsv([]);
      expect(csvEmpty).toContain('"Item Description"');

      const csvSpecial = lineItemsToCsv([
        entity({
          itemName: 'Pump, with "comma" & quotes',
          technicalSpecs: 'Line 1\nLine 2',
          targetDate: '',
          quantity: 1,
        }),
      ]);
      expect(csvSpecial).toContain('Pump, with ""comma"" & quotes');
    });

    it('exercises useRouter error catch fallback to null', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nextNav = require('next/navigation');
      const orig = nextNav.useRouter;
      nextNav.useRouter = () => {
        throw new Error('RouterContext not available');
      };
      renderDetails(buildRFQ());
      expect(screen.getByText('RFQ-2026-00462')).toBeInTheDocument();
      nextNav.useRouter = orig;
    });

    it('exercises handleCloseRFQ and handleExtendRFQ edge cases', async () => {
      // Close RFQ failure without error message
      mockUpdateRFQ.mockResolvedValueOnce({ success: false, error: '' });
      const { unmount } = renderDetails(buildRFQ());

      const closeBtn = screen.getByRole('button', { name: /Close RFQ/i });
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Action Failed', 'Failed to close RFQ.', 'warning');
      });

      // Close RFQ with empty catch error
      mockUpdateRFQ.mockRejectedValueOnce({});
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Action Failed', 'Failed to close RFQ.', 'warning');
      });
      unmount();

      // Extend RFQ with rfq.deadline instead of closingDeadline
      mockExtendRFQ.mockResolvedValueOnce({
        success: true,
        rfq: { id: 'rfq-1', rfqNumber: 'RFQ-2026-00462', deadline: '2026-11-01T10:00:00Z', isExtended: true },
      });
      const { unmount: unmount2 } = renderDetails(buildRFQ({ isExtended: false }));
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));
      const confirmExtendBtn = screen.getByRole('button', { name: /Confirm Extension/i });
      fireEvent.click(confirmExtendBtn);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          DETAILS.extensionSuccessTitle,
          expect.stringContaining('RFQ-2026-00462'),
          'success'
        );
      });
      unmount2();

      // Extend RFQ with empty deadline strings
      mockExtendRFQ.mockResolvedValueOnce({
        success: true,
        rfq: { id: 'rfq-1', rfqNumber: 'RFQ-2026-00462', isExtended: false },
      });
      const { unmount: unmount3 } = renderDetails(buildRFQ({ isExtended: false }));
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));
      fireEvent.click(screen.getByRole('button', { name: /Confirm Extension/i }));
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          DETAILS.extensionSuccessTitle,
          expect.any(String),
          'success'
        );
      });

      // Cancel button in Extend Modal (covers line 3056)
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));
      const cancelExtendBtn = screen.getAllByRole('button', { name: new RegExp(UI_STRINGS.actions.cancel, 'i') }).slice(-1)[0];
      fireEvent.click(cancelExtendBtn);
      unmount3();

      // Extend RFQ failure with empty error string and empty catch
      mockExtendRFQ.mockResolvedValueOnce({ success: false, error: '' });
      const { unmount: unmount4 } = renderDetails(buildRFQ({ isExtended: false }));
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));
      fireEvent.click(screen.getByRole('button', { name: /Confirm Extension/i }));
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          DETAILS.extensionFailedTitle,
          DETAILS.extensionFailedTitle,
          'warning'
        );
      });
      unmount4();

      mockExtendRFQ.mockRejectedValueOnce({});
      renderDetails(buildRFQ({ isExtended: false }));
      fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));
      fireEvent.click(screen.getByRole('button', { name: /Confirm Extension/i }));
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          DETAILS.extensionFailedTitle,
          DETAILS.extensionFailedTitle,
          'warning'
        );
      });
    });

    it('exercises checkIsProcucevVendor branch matrix comprehensively', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          { id: 'bv-procucev', name: 'Procucev Official BV', isProcucev: true, source: 'procucev_network' },
          { id: 'bv-client-uploaded', name: 'Buyer Uploaded BV', isBuyerUploaded: true, source: 'buyer_excel' },
          { id: 'bv-self-onboarded', name: 'Self Onboarded BV', source: 'self_onboarded' },
          { id: 'v-rated-proc', name: 'Rated Net Vendor', rating: 4.8, isProcucev: true, source: 'procucev_network' },
        ],
        currentUserSession: { name: 'Buyer User', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          quotes: [],
          assignedVendors: [
            // string matches vendorName or vendorId
            'bv-procucev' as any,
            'Buyer Uploaded BV' as any,
            // object matches vendorCategory: Procucev - AI Rec (hits line 544)
            { id: 'v-ai-rec', name: 'AI Rec Vendor', vendorCategory: 'Procucev - AI Rec' } as any,
            // object matches vendorCategory: Client List
            { id: 'v-client-list', name: 'Client List Vendor', vendorCategory: 'Client List' } as any,
            // object is buyer uploaded
            { id: 'v-buyer-up', name: 'Buyer Uploaded Item', isBuyerUploaded: true } as any,
            // object extra source self_onboarded
            { id: 'v-self-onboard', name: 'Self Onboard Item', source: 'self_onboarded' } as any,
            // v-buyer- id prefix
            { id: 'v-buyer-auto', name: 'Auto Buyer Prefix' } as any,
            // hits line 1838 rating-to-matchScore
            { id: 'v-rated-proc', name: 'Rated Net Vendor' } as any,
          ],
        })
      );

      expect(screen.getAllByText('Procucev Official BV')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Buyer Uploaded BV')[0]).toBeInTheDocument();
      expect(screen.getAllByText('AI Rec Vendor')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Client List Vendor')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Buyer Uploaded Item')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Self Onboard Item')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Auto Buyer Prefix')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Rated Net Vendor')[0]).toBeInTheDocument();
    });

    it('exercises vendor view channel mapping with inq.messages and empty inquiries', () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'vendor',
        buyerVendors: [],
        currentUserSession: { id: 'v-sess-1', name: 'Vendor One', email: 'v1@test.com', role: 'vendor' },
      });

      // Render with inq.messages populated
      const { unmount } = renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-with-msgs',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-sess-1',
              vendorEmail: 'v1@test.com',
              messages: [
                {
                  id: 'm1',
                  senderRole: 'vendor',
                  senderName: 'Vendor One',
                  message: 'Pre-existing message',
                  timestamp: '2026-09-01T10:00:00Z',
                },
              ],
            } as any,
          ],
        }),
        { isVendorView: true }
      );
      expect(screen.getByText('Pre-existing message')).toBeInTheDocument();
      unmount();

      // Render with inquiries empty: latestInq is undefined, no_messages
      renderDetails(
        buildRFQ({
          inquiries: [],
        }),
        { isVendorView: true }
      );
      expect(screen.getByPlaceholderText(/Type your clarification or question to the buyer/i)).toBeInTheDocument();
    });

    it('exercises buyer view channel sorting with b open and b messages', () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-closed',
              vendorId: 'v-closed',
              vendorName: 'Closed Inq Vendor',
              status: 'answered',
              messages: [],
            } as any,
            {
              id: 'inq-open-urgent',
              vendorId: 'v-open-urgent',
              vendorName: 'Urgent Open Vendor',
              status: 'open',
              messages: [
                { id: 'm-urg', senderRole: 'vendor', message: 'Urgent msg', timestamp: '2026-09-02' } as any,
              ],
            } as any,
          ],
        })
      );

      expect(screen.getAllByText('Urgent Open Vendor')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Closed Inq Vendor')[0]).toBeInTheDocument();
    });

    it('exercises handleSendChatMessage buyer reply with and without inquiryId, onUpdate, and fallback branches', async () => {
      const mockOnUpdate = jest.fn();
      mockReplyToRFQInquiry.mockResolvedValueOnce({
        success: true,
        rfq: buildRFQ({
          inquiries: [{ id: 'inq-updated-success', message: 'Success inq' } as any],
        }),
      });

      renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-1',
              vendorId: 'v-first',
              vendorName: 'First Vendor',
              message: 'First question',
              status: 'open',
              messages: [{ id: 'm-orig', senderRole: 'vendor', message: 'First question' } as any],
            } as any,
            {
              id: 'inq-2',
              vendorId: 'v-second',
              vendorName: 'Second Vendor',
              message: 'Second question',
              status: 'open',
            } as any,
          ],
        }),
        { onUpdate: mockOnUpdate }
      );

      const composer = screen.getByPlaceholderText(/Type clarification response to First Vendor/i);
      fireEvent.change(composer, { target: { value: 'Confirmed spec' } });
      fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalled();
      });
      expect(mockOnUpdate).toHaveBeenCalled();

      // Buyer fallback branch with success: false (hits return inq branch for inq-2)
      mockReplyToRFQInquiry.mockResolvedValueOnce({ success: false });
      fireEvent.change(composer, { target: { value: 'Second fallback message' } });
      fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
      });

      // Empty text no-op
      fireEvent.change(composer, { target: { value: '   ' } });
      fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });
      expect(mockReplyToRFQInquiry).toHaveBeenCalledTimes(2);
    });

    it('exercises handleSendChatMessage when vendor sends query with activeChannel.inquiryId fallback and empty inquiries fallback', async () => {
      const mockOnUpdate = jest.fn();
      mockSubmitRFQInquiry.mockResolvedValueOnce({ success: false });

      const { unmount } = renderDetails(
        buildRFQ({
          inquiries: [
            {
              id: 'inq-v-chan',
              rfqNumber: 'RFQ-2026-00462',
              vendorId: 'v-vend',
              vendorName: 'Active Channel Vendor',
              message: 'Prior question',
              status: 'open',
            } as any,
          ],
        }),
        { isVendorView: true, onUpdate: mockOnUpdate }
      );

      const composer = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      fireEvent.change(composer, { target: { value: 'Appended question' } });
      fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
      });
      expect(mockOnUpdate).toHaveBeenCalled();
      unmount();

      // Vendor sends when inquiries is empty (hits line 909: updatedInqs.push new inquiry)
      mockSubmitRFQInquiry.mockResolvedValueOnce({ success: false });
      renderDetails(
        buildRFQ({
          inquiries: [],
        }),
        { isVendorView: true, onUpdate: mockOnUpdate }
      );

      const composer2 = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      fireEvent.change(composer2, { target: { value: 'Brand new inquiry from vendor' } });
      fireEvent.keyDown(composer2, { key: 'Enter', shiftKey: false });
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
      });
    });

    it('exercises handleSendReply with empty replyMessage, onUpdate with res.rfq, and fallback onUpdate', async () => {
      const mockOnUpdate = jest.fn();
      const mockInq: any = {
        id: 'inq-rep-full',
        rfqNumber: 'RFQ-2026-00462',
        vendorId: 'v-rep-full',
        vendorName: 'Rep Vendor',
        message: 'Can we split shipment?',
        status: 'open',
      };

      mockReplyToRFQInquiry.mockResolvedValueOnce({
        success: true,
        rfq: buildRFQ({
          id: '',
          rfqNumber: 'RFQ-2026-00462',
          inquiries: [{ id: 'inq-rep-full', status: 'answered', reply: 'Yes, split is fine.' } as any],
        }),
      });

      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [],
        currentUserSession: null,
      });

      const { unmount } = renderDetails(
        buildRFQ({
          id: '',
          rfqNumber: 'RFQ-2026-00462',
          inquiries: [mockInq, { id: 'inq-other', vendorName: 'Other', message: 'Other' } as any],
        }),
        { onUpdate: mockOnUpdate }
      );

      // Open Reply modal
      fireEvent.click(screen.getByRole('button', { name: /Reply/i }));

      // Click X close button on modal (covers line 2882)
      const replyTitle = screen.getByText(/Answer Vendor Clarification/i);
      const modalContainer = replyTitle.closest('div.bg-white') || replyTitle.parentElement;
      const modalXBtn = modalContainer?.querySelector('button');
      if (modalXBtn) fireEvent.click(modalXBtn);

      // Re-open Reply modal
      fireEvent.click(screen.getByRole('button', { name: /Reply/i }));

      const textarea = screen.getByPlaceholderText(/Provide specific technical, delivery, or commercial clarification/i);
      const sendBtn = screen.getByRole('button', { name: /Send Clarification/i });

      // Click with empty message (should be disabled or no-op)
      fireEvent.click(sendBtn);
      expect(mockReplyToRFQInquiry).not.toHaveBeenCalled();

      // Send with text
      fireEvent.change(textarea, { target: { value: 'Yes, split is fine.' } });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalledWith(
          'RFQ-2026-00462',
          'inq-rep-full',
          expect.objectContaining({ reply: 'Yes, split is fine.', repliedBy: 'Procurement Officer' })
        );
      });
      expect(mockOnUpdate).toHaveBeenCalled();
      unmount();

      // Test catch with empty error object
      mockReplyToRFQInquiry.mockRejectedValueOnce({});
      renderDetails(
        buildRFQ({
          id: '',
          rfqNumber: 'RFQ-2026-00462',
          inquiries: [mockInq],
        })
      );
      fireEvent.click(screen.getByRole('button', { name: /Reply/i }));
      const failTextarea = screen.getByPlaceholderText(/Provide specific technical, delivery, or commercial clarification/i);
      fireEvent.change(failTextarea, { target: { value: 'Failing reply' } });
      fireEvent.click(screen.getByRole('button', { name: /Send Clarification/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Reply Failed', 'Failed to dispatch reply.', 'warning');
      });
    });

    it('exercises BuyerInviteSuppliersModal deep edge cases for already assigned and unassigned data', async () => {
      const mockOnUpdate = jest.fn();
      mockUpdateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          id: 'rfq-1',
          assignedVendors: [], // shorter than merged, triggers line 3177 : merged
        },
      });

      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'buyer',
        buyerVendors: [
          // Vendor with name
          { id: 'v-sparse-1', name: 'Sparse Private Vendor', source: 'buyer_excel' },
          // Already assigned vendor
          { id: 'v-already-1', name: 'Already Assigned Supplier', source: 'buyer_excel' },
        ],
        currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
      });

      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          assignedVendors: [
            // object with email only
            { email: 'assigned-email@test.com' } as any,
            // object with name only (hits line 3166 return v)
            { name: 'Assigned By Name' } as any,
            // string vendor that is NOT found in buyerVendors
            'v-unfound-string' as any,
            // already assigned vendor
            { id: 'v-already-1', name: 'Already Assigned Supplier' } as any,
          ],
        }),
        { onUpdate: mockOnUpdate }
      );

      const inviteBtn = screen.getAllByRole('button', { name: /Invite Suppliers/i })[0];
      fireEvent.click(inviteBtn);

      // Click already assigned supplier (triggers line 3131 return)
      fireEvent.click(screen.getAllByText(/Already Assigned Supplier/i).slice(-1)[0]);

      // Click sparse vendor
      fireEvent.click(screen.getAllByText(/Sparse Private Vendor/i).slice(-1)[0]);

      // Click assign button
      const assign1Btn = screen.getAllByRole('button', { name: /Assign 1 Suppliers/i })[0];
      fireEvent.click(assign1Btn);

      await waitFor(() => {
        expect(mockUpdateRFQ).toHaveBeenCalled();
      });
      expect(mockOnUpdate).toHaveBeenCalled();
    });

    it('exercises quote attachments rendering in desktop table and mobile cards', () => {
      renderDetails(
        buildRFQ({
          quotes: [
            quote({
              vendorId: 'v-with-att',
              vendorName: 'Vendor With Attachment',
              attachments: [
                { id: 'qa-1', fileName: 'Proposal_Document.pdf', url: 'https://test.com/doc.pdf' } as any,
              ],
            }),
          ],
        })
      );

      expect(screen.getAllByText(/Vendor With Attachment/i)[0]).toBeInTheDocument();
    });

    it('exercises handleViewAttachment authentication and error paths', async () => {
      // Mock global fetch
      const origFetch = global.fetch;
      const mockOpen = jest.fn();
      window.open = mockOpen;

      // 1. Success path
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: jest.fn().mockResolvedValue(new Blob(['test-pdf'])),
      } as any);

      renderDetails(
        buildRFQ({
          attachments: [
            { id: 'att-1', fileName: 'Technical_Specification.pdf', type: 'application/pdf', size: 1024 } as any,
          ],
        })
      );

      const viewAttBtn = screen.getByRole('button', { name: /Open Technical_Specification\.pdf/i });
      fireEvent.click(viewAttBtn);

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalled();
      });

      // 2. Fetch returns ok: false
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
      } as any);
      fireEvent.click(viewAttBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Could Not Open Attachment',
          'Could not load the attachment.',
          'warning'
        );
      });

      // 3. Fetch throws network error
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection aborted'));
      fireEvent.click(viewAttBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Could Not Open Attachment',
          'Connection aborted',
          'warning'
        );
      });

      global.fetch = origFetch;
    });

    it('exercises line items table sorting by quantity, targetDate with nulls, and category', () => {
      renderDetails(
        buildRFQ({
          extractedEntities: [
            entity({ id: 'li-1', itemName: 'Alpha Pump', quantity: 10, targetDate: '', majorCategory: 'Pumps', minorCategory: 'Centrifugal' }),
            entity({ id: 'li-2', itemName: 'Beta Valve', quantity: 50, targetDate: '2026-10-01', majorCategory: 'Valves', minorCategory: 'Gate' }),
            entity({ id: 'li-3', itemName: 'Gamma Pipe', quantity: 5, targetDate: '2026-09-01', majorCategory: 'Pipes', minorCategory: 'Seamless' }),
          ],
        })
      );

      // Sort by quantity asc then desc
      const qtyHeader = screen.getAllByRole('button', { name: new RegExp(DETAILS.colQty, 'i') })[0];
      fireEvent.click(qtyHeader);
      fireEvent.click(qtyHeader);

      // Sort by targetDate (handles !a.targetDate and !b.targetDate)
      const dateHeader = screen.getAllByRole('button', { name: new RegExp(DETAILS.colTargetDate, 'i') })[0];
      fireEvent.click(dateHeader);
      fireEvent.click(dateHeader);

      // Sort by category
      const catHeader = screen.getAllByRole('button', { name: new RegExp(DETAILS.colCategory, 'i') })[0];
      fireEvent.click(catHeader);
      fireEvent.click(catHeader);

      // Sort by item name
      const itemHeader = screen.getAllByRole('button', { name: new RegExp(DETAILS.colItem, 'i') })[0];
      fireEvent.click(itemHeader);
      fireEvent.click(itemHeader);
    });

    it('exercises target delivery date fallbacks across deliveryDate, deadline, and target_delivery_date', () => {
      const { unmount } = renderDetails(
        buildRFQ({
          targetDeliveryDate: undefined,
          target_delivery_date: '2026-12-01',
        } as any)
      );
      unmount();

      const { unmount: unmount2 } = renderDetails(
        buildRFQ({
          targetDeliveryDate: undefined,
          target_delivery_date: undefined,
          deliveryDate: '2026-11-15',
        } as any)
      );
      unmount2();

      const { unmount: unmount3 } = renderDetails(
        buildRFQ({
          targetDeliveryDate: undefined,
          target_delivery_date: undefined,
          deliveryDate: undefined,
          deadline: '2026-10-25',
        } as any)
      );
      unmount3();

      renderDetails(
        buildRFQ({
          targetDeliveryDate: undefined,
          target_delivery_date: undefined,
          deliveryDate: undefined,
          deadline: undefined,
          extractedEntities: [],
        } as any)
      );
    });

    it('covers Category Manager InviteVendorsModal close and invited callbacks', async () => {
      (useApp as jest.Mock).mockReturnValue({
        showToast: mockShowToast,
        refreshFromDB: jest.fn().mockResolvedValue(undefined),
        currentRole: 'category_manager',
        currentUserSession: { name: 'CM User' },
        buyerVendors: [],
      });
      const onUpdate = jest.fn();
      const { unmount } = renderDetails(buildRFQ(), { onUpdate });

      // Open invite modal via "Assign Suppliers" button
      const inviteBtns = screen.getAllByRole('button', { name: /Assign Suppliers|Invite Suppliers/i });
      fireEvent.click(inviteBtns[0]);

      expect(screen.getByTestId('mock-invite-vendors-modal')).toBeInTheDocument();
      // Click Close CM Modal (covers line 2937)
      fireEvent.click(screen.getByText('Close CM Modal'));
      expect(screen.queryByTestId('mock-invite-vendors-modal')).not.toBeInTheDocument();

      // Open again and trigger CM Invite (covers lines 2938-2943)
      const inviteBtns2 = screen.getAllByRole('button', { name: /Assign Suppliers|Invite Suppliers/i });
      fireEvent.click(inviteBtns2[0]);
      fireEvent.click(screen.getByText('Trigger CM Invite'));
      expect(mockShowToast).toHaveBeenCalledWith('Suppliers Assigned', expect.stringContaining('assigned to RFQ'), 'success');
      expect(onUpdate).toHaveBeenCalled();
      unmount();
    });

    it('downloads single vendor quote excel when Export Items Excel is clicked', () => {
      const qWithLines = quote({
        lineItemQuotes: [
          {
            lineItemId: 'li-1',
            itemName: 'Centrifugal Pump',
            unitPrice: 500,
            quantity: 2,
            totalPrice: 1000,
            leadTimeDays: 7,
            compliance: 'Compliant',
          } as any,
        ],
      });
      const { unmount } = renderDetails(buildRFQ({ quotes: [qWithLines] }));
      const expandBtn = screen.getByTitle('Toggle itemized line items');
      fireEvent.click(expandBtn);
      const exportItemsBtn = screen.getByRole('button', { name: /Export Items Excel/i });
      fireEvent.click(exportItemsBtn);
      expect(mockDownloadSingleVendorQuoteExcel).toHaveBeenCalled();
      unmount();
    });

    it('covers empty clarifications desk invite suppliers button click', () => {
      const { unmount } = renderDetails(buildRFQ({ quotes: [], assignedVendors: [] }));
      const emptyInviteBtns = screen.getAllByRole('button', { name: /Invite Suppliers/i });
      fireEvent.click(emptyInviteBtns[emptyInviteBtns.length - 1]);
      expect(screen.getByText('Invite Approved Suppliers')).toBeInTheDocument();
      unmount();
    });

    it('preserves other inquiries and falls back correctly when updating in chat/reply', async () => {
      const inq1 = {
        id: 'inq-target',
        rfqNumber: 'RFQ-2026-00462',
        rfqId: 'rfq-1',
        vendorId: 'v-channel',
        vendorName: 'Channel Vendor',
        message: 'Question 1',
        createdAt: '2026-09-02T10:00:00Z',
        status: 'open' as const,
      };
      const inq2 = {
        id: 'inq-other',
        rfqNumber: 'RFQ-2026-00462',
        rfqId: 'rfq-1',
        vendorId: 'v-other',
        vendorName: 'Other Vendor',
        message: 'Question 2',
        createdAt: '2026-09-02T10:00:00Z',
        status: 'open' as const,
      };
      mockReplyToRFQInquiry.mockResolvedValueOnce({
        success: true,
        rfq: { id: 'rfq-1', inquiries: [inq1, inq2] },
      });
      const onUpdate = jest.fn();
      const { unmount } = renderDetails(buildRFQ({ inquiries: [inq1, inq2] }), { onUpdate });
      const replyBtn = screen.getByRole('button', { name: /Reply/i });
      fireEvent.click(replyBtn);
      const textarea = screen.getByPlaceholderText(/Provide specific technical/i);
      fireEvent.change(textarea, { target: { value: 'Answer for inq1' } });
      fireEvent.click(screen.getByRole('button', { name: /Send Clarification/i }));
      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalled();
        expect(onUpdate).toHaveBeenCalled();
      });
      unmount();

      // Test chat fallback when updateRFQ returns success: false (covers lines 1015-1016)
      mockUpdateRFQ.mockResolvedValueOnce({ success: false });
      const onUpdateFallback = jest.fn();
      const { unmount: unmount2 } = renderDetails(
        buildRFQ({
          assignedVendors: [{ id: 'v-ch', name: 'Chat Vendor', email: 'ch@vendor.com' } as any],
          inquiries: [],
        }),
        { onUpdate: onUpdateFallback }
      );
      const chatInput = screen.getByPlaceholderText(/Type clarification response to/i);
      fireEvent.change(chatInput, { target: { value: 'Direct chat fallback message' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/i }));
      await waitFor(() => {
        expect(mockUpdateRFQ).toHaveBeenCalled();
        expect(onUpdateFallback).toHaveBeenCalled();
      });
      unmount2();
    });
  });
});

