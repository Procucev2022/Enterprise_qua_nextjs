import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RFQDetails, { daysUntil, lineItemsToCsv } from '@/app/buyer/rfq-details';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES, formatCurrency } from '@/lib/constants';
import type { ExtractedEntity, QuoteComparison, RFQAttachment, RFQItem } from '@/lib/types';

const DETAILS = UI_STRINGS.rfqDetails;

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
const renderDetails = (rfq: RFQItem | null) => render(<RFQDetails rfq={rfq} onBack={onBack} />);

/** The section wrapping a heading, so an assertion is not matched page-wide. */
const sectionFor = (heading: HTMLElement) => heading.closest('section') as HTMLElement;

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

    it('shows the audit marker and when the RFQ was raised', () => {
      renderDetails(buildRFQ());

      expect(screen.getByText(DETAILS.auditImmutable)).toBeInTheDocument();
      expect(
        screen.getByText(formatString(DETAILS.raisedOnStrip, { timestamp: '2026-09-02 11:07:16' }))
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
      ['email_gateway', 'Email Gateway'],
      ['email_upload', 'Emailed Document'],
      ['manual_entry', 'Manual Entry'],
    ])('labels a %s intake as %s', (source, label) => {
      renderDetails(buildRFQ({ source: source as RFQItem['source'] }));
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('shows the source document, email and record id', () => {
      renderDetails(buildRFQ({ sourceFileName: 'requisition.pdf', sourceEmail: 'plant@lt.com' }));

      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText('requisition.pdf')).toBeInTheDocument();
      expect(within(card).getByText('plant@lt.com')).toBeInTheDocument();
      expect(within(card).getByText('rfq-1')).toBeInTheDocument();
    });

    it('marks a blank source document or intake source as unset', () => {
      renderDetails(buildRFQ({ sourceFileName: '   ', sourceEmail: undefined, source: undefined }));

      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getAllByText(DETAILS.unsetValue).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('commercial and delivery card', () => {
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

  describe('follow-up card', () => {
    const withFollowUps = () =>
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
      });

    it('renders the invited and responded tiles and each channel counter', () => {
      renderDetails(withFollowUps());

      const card = sectionFor(screen.getByText(DETAILS.followUpsHeading));
      expect(within(card).getByText('5')).toBeInTheDocument();
      expect(within(card).getByText('3')).toBeInTheDocument();
      expect(within(card).getByText('4 / 5')).toBeInTheDocument();
      expect(within(card).getByText('3 / 5')).toBeInTheDocument();
      expect(within(card).getByText('2 / 5')).toBeInTheDocument();
    });

    // Vendor matching is still Coming Soon, so a freshly saved RFQ has none.
    it('explains that there is nothing to chase yet', () => {
      renderDetails(buildRFQ({ followUpData: undefined }));
      expect(screen.getByText(DETAILS.noFollowUps)).toBeInTheDocument();
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
      expect(screen.getByText(formatString(DETAILS.confidenceReview, { confidence: 50 }))).toBeInTheDocument();
    });

    // A keyed row has no AI confidence, so reporting 0% would misrepresent it.
    it('labels a manually keyed row instead of claiming zero confidence', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ confidence: 0 })] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText(DETAILS.manualConfidence)).toBeInTheDocument();
      expect(within(table).queryByText(/0% /)).not.toBeInTheDocument();
    });

    it('marks a line item with no specification as unset', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ technicalSpecs: '  ' })] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText(DETAILS.unsetValue)).toBeInTheDocument();
    });

    it('narrows the table as the buyer searches', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate valve' } });

      expect(screen.getByText('Flanged Gate Valve')).toBeInTheDocument();
      expect(screen.queryByText('Centrifugal Water Pump 500 GPM')).not.toBeInTheDocument();
      expect(
        screen.getByText(formatString(DETAILS.displayingCount, { shown: 1, total: 2 }))
      ).toBeInTheDocument();
    });

    it('searches the specification and unit as well as the name', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'ASTM' } });
      expect(screen.getByText('Flanged Gate Valve')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'sets' } });
      expect(screen.getByText('Flanged Gate Valve')).toBeInTheDocument();
    });

    it('filters by minor category and offers only the categories present', () => {
      renderDetails(twoItems());

      const filter = screen.getByLabelText(DETAILS.minorFilterAria) as HTMLSelectElement;
      const options = Array.from(filter.options).map((o) => o.value);
      expect(options).toEqual(['all', 'Hoses, Valves & Fittings', 'Pumps & Accessories']);

      fireEvent.change(filter, { target: { value: 'Pumps & Accessories' } });
      expect(screen.getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(screen.queryByText('Flanged Gate Valve')).not.toBeInTheDocument();
    });

    it('reports when the search and filter exclude everything', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'nothing matches' } });

      expect(screen.getByText(DETAILS.noLineItemMatches)).toBeInTheDocument();
      expect(screen.getByText(formatString(DETAILS.displayingCount, { shown: 0, total: 2 }))).toBeInTheDocument();
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
      expect(within(panel).getByText(/2026-09-02/)).toBeInTheDocument();
    });

    it('links each document to the authenticated download route', () => {
      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const link = screen.getByRole('link', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      });
      expect(link).toHaveAttribute('href', '/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef');
      expect(link).toHaveAttribute('target', '_blank');
      // Opening in a new tab without this leaks window.opener to the document.
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
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

      expect(screen.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
      expect(screen.getByText(formatCurrency(4250))).toBeInTheDocument();
      expect(screen.getByText(formatCurrency(425000))).toBeInTheDocument();
      expect(screen.getByText(formatString(DETAILS.leadTimeDays, { days: 14 }))).toBeInTheDocument();
      expect(screen.getByText('Fully Compliant')).toBeInTheDocument();
      expect(screen.getByText('96%')).toBeInTheDocument();
    });

    it('counts the quotations on the All tab', () => {
      renderDetails(buildRFQ({ quotes: [quote(), quote({ vendorId: 'v-002' })] }));

      expect(
        screen.getByRole('button', { name: formatString(DETAILS.quotesTabAll, { count: 2 }) })
      ).toBeInTheDocument();
    });

    // Quotation states are not modelled yet, so the other tabs are honestly empty
    // rather than filtering on a field that does not exist.
    it.each([
      [DETAILS.quotesTabUnderReview],
      [DETAILS.quotesTabShortlisted],
    ])('shows an empty state on the %s tab', (tabTemplate) => {
      renderDetails(buildRFQ({ quotes: [quote()] }));

      fireEvent.click(screen.getByRole('button', { name: formatString(tabTemplate, { count: 0 }) }));

      expect(screen.getByText(DETAILS.noQuotesTabMessage)).toBeInTheDocument();
      expect(screen.queryByText('Apex Industrial Dynamics Pvt Ltd')).not.toBeInTheDocument();
    });

    it('returns to the full list from another tab', () => {
      renderDetails(buildRFQ({ quotes: [quote()] }));

      fireEvent.click(screen.getByRole('button', { name: formatString(DETAILS.quotesTabShortlisted, { count: 0 }) }));
      fireEvent.click(screen.getByRole('button', { name: formatString(DETAILS.quotesTabAll, { count: 1 }) }));

      expect(screen.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
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
});
