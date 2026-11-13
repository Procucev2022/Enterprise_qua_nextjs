import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VendorEvaluationSummary, { isBuyerUploaded, isProcucevVendor } from '@/app/buyer/vendor-evaluation-summary';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT, VENDOR_EVALUATION_GATE_SCORE, VENDOR_EVALUATION_PILLARS } from '@/lib/constants';
import type {
  QuestionEvaluationItem,
  VendorEntry,
  VendorEvaluationDocument,
  VendorEvaluationRecord,
} from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

const mockedUseApp = useApp as jest.Mock;
const SUMMARY = UI_STRINGS.vendorEvaluationSummary;
const NOT_RECORDED = UI_STRINGS.recordPlaceholders.notRecorded;
const NOT_EVALUATED = UI_STRINGS.recordPlaceholders.notEvaluated;
const PICKER_LABEL = SUMMARY.pickerAriaLabel;
const SEARCH_PLACEHOLDER = SUMMARY.searchPlaceholder;

const QUESTIONS: QuestionEvaluationItem[] = [
  {
    refId: 'M1-Q1',
    pillarId: 'M1',
    pillarName: 'Commercial Terms',
    criteria: 'Payment terms compliance',
    attachmentName: 'terms.pdf',
    attachmentVerified: true,
    score: 4.8,
    weightedScore: 6,
    remarks: 'Confirmed Net 45 days.',
  },
  {
    refId: 'M2-Q1',
    pillarId: 'M2',
    pillarName: 'Technical Capabilities',
    criteria: 'Machining precision DIN standard',
    attachmentName: 'spec.pdf',
    attachmentVerified: false,
    score: 4.5,
    weightedScore: 3.5,
    remarks: 'All CNC tolerances within 0.01mm.',
  },
  {
    refId: 'M3-Q1',
    pillarId: 'M3',
    pillarName: 'Quality & Warranty',
    criteria: 'ISO 9001 certification',
    attachmentName: 'iso.pdf',
    attachmentVerified: true,
    score: 5,
    weightedScore: 5,
    remarks: 'Valid through 2028.',
  },
  {
    refId: 'M4-Q1',
    pillarId: 'M4',
    pillarName: 'Operational Delivery',
    criteria: 'On-time delivery performance history',
    attachmentName: 'log.xlsx',
    attachmentVerified: true,
    score: 4.6,
    weightedScore: 4.8,
    remarks: '98.5% on-time dispatch.',
  },
  {
    refId: 'M5-Q1',
    pillarId: 'M5',
    pillarName: 'Financial Stability',
    criteria: 'Audited financial balance sheets',
    attachmentName: 'audit.pdf',
    attachmentVerified: true,
    score: 4.7,
    weightedScore: 2.5,
    remarks: 'Positive working capital.',
  },
  {
    refId: 'M6-Q1',
    pillarId: 'M6',
    pillarName: 'Governance & ESG',
    criteria: 'ESG environmental policy adherence',
    attachmentName: '',
    attachmentVerified: false,
    score: 4.5,
    weightedScore: 2.5,
    remarks: 'Zero environmental violations.',
  },
];

function moduleScore(weightedScore: number, remarks: string) {
  return { score: weightedScore * 4, maxScore: 100, weight: 0, weightedScore, remarks };
}

function buildDocuments(count: number): VendorEvaluationDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i + 1}`,
    name: `Compliance_Doc_${i + 1}.pdf`,
    type: 'Quality Assurance',
    uploadDate: '2026-02-28',
    verified: i % 2 === 0,
    status: i % 2 === 0 ? 'Verified' : 'Pending Review',
  }));
}

function buildRecord(overrides: Partial<VendorEvaluationRecord> = {}): VendorEvaluationRecord {
  return {
    id: 'eval-1',
    vendorId: 'VN-100',
    vendorName: 'Alpha Pumps Ltd.',
    contactPerson: 'Asha Rao',
    email: 'asha@alpha.test',
    phone: '+91 90000 00001',
    category: 'Mechanical',
    submissionDate: '2026-02-28',
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    overallScore: 94,
    moduleScores: {
      commercial: moduleScore(23.5, 'Fixed price for 12 months.'),
      technical: moduleScore(14.2, 'Robotic CNC lines in use.'),
      quality: moduleScore(19.1, 'ISO 9001 certified.'),
      delivery: moduleScore(18.8, 'Committed lead time.'),
      financial: moduleScore(9.4, 'Positive working capital.'),
      governance: moduleScore(9, 'ESG policy in force.'),
    },
    documents: [],
    questionBreakdown: QUESTIONS,
    systemAction: 'Full Qualification Approved',
    ...overrides,
  };
}

function buildVendor(overrides: Partial<VendorEntry>): VendorEntry {
  return {
    id: '',
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    majorCategory: '',
    minorCategories: [],
    location: '',
    rating: 0,
    source: 'buyer_uploaded',
    ...overrides,
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  const store = {
    buyerVendors: [],
    vendorEvaluations: [],
    setActiveEvaluationRecord: jest.fn(),
    showToast: jest.fn(),
    ...overrides,
  };
  mockedUseApp.mockReturnValue(store);
  return store;
}

describe('isBuyerUploaded and isProcucevVendor', () => {
  it('treats missing supplier input as a Procucev supplier', () => {
    expect(isBuyerUploaded(null)).toBe(false);
    expect(isBuyerUploaded(undefined)).toBe(false);
    expect(isProcucevVendor(null)).toBe(true);
    expect(isProcucevVendor(undefined)).toBe(true);
  });

  it.each(['buyer_uploaded', 'vendor_master_ingestion', 'historical_purchase_dump', 'buyer_manual', 'buyer_excel', 'buyer', 'bulk_buyer_feed', 'ingestion_batch', 'po_purchase_dump'])(
    'classifies source %s as buyer-uploaded',
    (source) => {
      expect(isBuyerUploaded({ source })).toBe(true);
      expect(isProcucevVendor({ source })).toBe(false);
    }
  );

  it('classifies a supplier by its buyer ownership fields', () => {
    expect(isBuyerUploaded({ source: 'any', addedByBuyerCompany: 'Acme Ltd' })).toBe(true);
    expect(isBuyerUploaded({ source: 'any', buyerId: 'buyer-1' })).toBe(true);
    expect(isBuyerUploaded({ source: 'any', buyerAccountId: 'acc-1' })).toBe(true);
  });

  it('does not treat a Procucev source or a supplier with no ownership as buyer-uploaded', () => {
    expect(isBuyerUploaded({ source: 'procucev_network' })).toBe(false);
    expect(isBuyerUploaded({})).toBe(false);
    expect(isProcucevVendor({ source: 'procucev_network' })).toBe(true);
  });

  it('never infers ownership from the supplier id prefix', () => {
    for (const id of ['v-hist-001', 'v-navin-002', 'vm-003', 'v-ingest-004', 'v-buyer-005']) {
      expect(isBuyerUploaded({ id, source: 'any' } as Partial<VendorEntry>)).toBe(false);
    }
  });
});

describe('buyer evaluation summary: full evaluation record', () => {
  it('shows the record\'s own identity, contact, score and status', () => {
    mockStore();
    const onBack = jest.fn();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} onBack={onBack} />);

    expect(screen.getAllByText('Alpha Pumps Ltd.').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('VN-100')).not.toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('PREFERRED ENTERPRISE SUPPLIER')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('asha@alpha.test')).toBeInTheDocument();
    expect(screen.getByText('+91 90000 00001')).toBeInTheDocument();
    expect(screen.getByText(/2026-02-28/)).toBeInTheDocument();
    expect(screen.getByText('Full Qualification Approved')).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.gateUnlocked, { score: VENDOR_EVALUATION_GATE_SCORE }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: SUMMARY.backAction }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('no longer offers the export, override, CAPA or preview actions', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ documents: buildDocuments(2) })} />);

    expect(screen.queryByText(/Export PDF Report/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Override AI Score/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Trigger CAPA Action/)).not.toBeInTheDocument();
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
  });

  it('shows each pillar with its name, weight and the score and remarks from the record', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} />);

    for (const pillar of VENDOR_EVALUATION_PILLARS) {
      expect(screen.getAllByText(pillar.name).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByText(formatString(SUMMARY.pillarPoints, { score: 23.5, weight: 25 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.pillarPoints, { score: 9, weight: 10 }))).toBeInTheDocument();
    expect(screen.getByText('Fixed price for 12 months.')).toBeInTheDocument();
    expect(screen.getByText('ESG policy in force.')).toBeInTheDocument();
    expect(screen.queryByText(NOT_EVALUATED)).not.toBeInTheDocument();
  });

  it('lists the first attachments and counts the rest against the list limit', () => {
    mockStore();
    const documents = buildDocuments(14);
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ documents })} />);

    expect(screen.getByText(`Compliance_Doc_${VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT}.pdf`)).toBeInTheDocument();
    expect(screen.queryByText('Compliance_Doc_13.pdf')).not.toBeInTheDocument();
    const rest = documents.length - VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT;
    expect(screen.getByText(formatString(SUMMARY.docMoreCount, { count: rest }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.attachmentsSummaryTotal, { verified: 7, total: 14 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.documentsHeading, { count: 14 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.documentsBadgeVerified, { verified: 7, total: 14 }))).toBeInTheDocument();
    expect(screen.getAllByText(SUMMARY.docStatusVerified).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(SUMMARY.attachmentPendingReview).length).toBeGreaterThanOrEqual(1);
  });
});

describe('buyer evaluation summary: criteria matrix', () => {
  it('filters the matrix by pillar and shows every criterion for all pillars', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} />);

    fireEvent.click(screen.getByRole('button', { name: 'M1' }));
    expect(screen.getByText('Payment terms compliance')).toBeInTheDocument();
    expect(screen.queryByText('Machining precision DIN standard')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    expect(screen.getByText('Machining precision DIN standard')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'M3' }));
    expect(screen.getByText('ISO 9001 certification')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'M4' }));
    expect(screen.getByText('On-time delivery performance history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'M5' }));
    expect(screen.getByText('Audited financial balance sheets')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'M6' }));
    expect(screen.getByText('ESG environmental policy adherence')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: SUMMARY.filterAll }));
    expect(screen.getByText('Payment terms compliance')).toBeInTheDocument();
    expect(screen.getByText('Machining precision DIN standard')).toBeInTheDocument();
  });

  it('shows the attachment state, score and remarks of each criterion', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} />);

    expect(screen.getByText('terms.pdf')).toBeInTheDocument();
    expect(screen.getAllByText(SUMMARY.attachmentVerifiedBadge).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(SUMMARY.attachmentPendingReview).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(SUMMARY.noAttachmentOnRecord).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(formatString(SUMMARY.scoreOutOfFive, { score: '4.8' }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.weightedPercent, { value: '6.00' }))).toBeInTheDocument();
    expect(screen.getByText('"Confirmed Net 45 days."')).toBeInTheDocument();
  });

  it('lists each pillar with its weight, and marks every score not evaluated when the record has no criteria', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ questionBreakdown: [] })} />);

    expect(screen.getByText(SUMMARY.matrixNoScores)).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.pillarCriteriaName, { name: 'Commercial Terms', weight: 25 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.pillarCriteriaName, { name: 'Governance & ESG', weight: 10 }))).toBeInTheDocument();
    // Six matrix rows with two score cells each, plus one attachment status per pillar card.
    expect(screen.getAllByText(NOT_EVALUATED)).toHaveLength(18);
    expect(screen.getAllByText(SUMMARY.noCriteriaOnRecord)).toHaveLength(6);
    expect(screen.queryByText('0.0 / 5.0')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment terms compliance')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'M3' }));
    expect(screen.getByText(formatString(SUMMARY.pillarCriteriaName, { name: 'Quality & Warranty', weight: 20 }))).toBeInTheDocument();
    expect(screen.queryByText(formatString(SUMMARY.pillarCriteriaName, { name: 'Commercial Terms', weight: 25 }))).not.toBeInTheDocument();
  });

  it('shows the pillar score as not evaluated when the record has no module scores', () => {
    mockStore();
    const record = buildRecord({
      questionBreakdown: [],
      moduleScores: undefined as unknown as VendorEvaluationRecord['moduleScores'],
    });
    render(<VendorEvaluationSummary evaluationRecord={record} />);

    expect(screen.queryByText('24 / 25 pts')).not.toBeInTheDocument();
    expect(screen.queryByText('Fixed price for 12 months.')).not.toBeInTheDocument();
    // Six pillar scores, six attachment statuses and twelve matrix score cells.
    expect(screen.getAllByText(NOT_EVALUATED)).toHaveLength(24);
    expect(screen.getAllByText(NOT_RECORDED).length).toBeGreaterThanOrEqual(6);
  });

  it('shows each criterion with a missing reference, text or score as not recorded or not evaluated', () => {
    mockStore();
    const sparse = {
      refId: '',
      pillarId: 'M1',
      pillarName: 'Commercial Terms',
      criteria: '',
      attachmentName: '',
      attachmentVerified: false,
      score: undefined,
      weightedScore: undefined,
      remarks: '   ',
    } as unknown as QuestionEvaluationItem;
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ questionBreakdown: [sparse] })} />);

    expect(screen.getAllByText(NOT_RECORDED).length).toBeGreaterThanOrEqual(3);
    // Two score cells on the sparse criterion, plus one attachment status for each of M2 to M6 (no criteria).
    expect(screen.getAllByText(NOT_EVALUATED)).toHaveLength(7);
  });

  it('summarises each pillar\'s attachments from the criteria the record holds', () => {
    mockStore();
    const questions: QuestionEvaluationItem[] = [
      { ...QUESTIONS[0], refId: 'M1-Q1', attachmentName: 'a.pdf', attachmentVerified: true },
      { ...QUESTIONS[0], refId: 'M1-Q2', attachmentName: 'b.pdf', attachmentVerified: false },
      { ...QUESTIONS[1], refId: 'M2-Q1', attachmentName: '', attachmentVerified: false },
      { ...QUESTIONS[2], refId: 'M3-Q1', attachmentName: 'c.pdf', attachmentVerified: true },
    ];
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ questionBreakdown: questions })} />);

    expect(screen.getByText(formatString(SUMMARY.attachmentsUploaded, { uploaded: 2, total: 2 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.attachmentsVerified, { verified: 1, uploaded: 2 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.attachmentsUploaded, { uploaded: 0, total: 1 }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.attachmentsUploaded, { uploaded: 1, total: 1 }))).toBeInTheDocument();
    expect(screen.getByText(SUMMARY.attachmentsAllVerified)).toBeInTheDocument();
    // M4, M5 and M6 have no criteria on the record.
    expect(screen.getAllByText(SUMMARY.noCriteriaOnRecord)).toHaveLength(3);
    expect(screen.getAllByText(NOT_EVALUATED)).toHaveLength(3);
  });
});

describe('buyer evaluation summary: values not on record', () => {
  it('shows not recorded for missing contact, email, phone and category, and leaves out the submitted line', () => {
    mockStore();
    const record = buildRecord({
      vendorId: '',
      contactPerson: '',
      email: '   ',
      phone: '',
      category: '',
      submissionDate: '',
    });
    render(<VendorEvaluationSummary evaluationRecord={record} />);

    expect(screen.getAllByText(NOT_RECORDED).length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText(SUMMARY.submittedLabel, { exact: false })).not.toBeInTheDocument();
    for (const invented of ['Authorized Representative', 'Enterprise Supplier', 'General Industrial', 'N/A', 'v-001', '2026-03-01']) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument();
    }
  });

  it('shows not recorded for contact fields the record leaves blank', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ contactPerson: '', email: '' })} />);

    expect(screen.getAllByText(NOT_RECORDED).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('+91 90000 00001')).toBeInTheDocument();
  });

  it('reads a numeric score sent as text and treats other text as not evaluated', () => {
    mockStore();
    const { unmount } = render(
      <VendorEvaluationSummary evaluationRecord={buildRecord({ overallScore: '88' as unknown as number })} />
    );
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.gateUnlocked, { score: VENDOR_EVALUATION_GATE_SCORE }))).toBeInTheDocument();
    unmount();

    for (const score of ['abc', '   ', null]) {
      const view = render(
        <VendorEvaluationSummary evaluationRecord={buildRecord({ overallScore: score as unknown as number })} />
      );
      expect(screen.getByText(SUMMARY.scoreNotApplicable)).toBeInTheDocument();
      // The gate status still reads not evaluated, because the overall score is missing.
      expect(screen.getByText(NOT_EVALUATED)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('shows the gate as locked below the threshold, with the status the record holds', () => {
    mockStore();
    render(
      <VendorEvaluationSummary
        evaluationRecord={buildRecord({ overallScore: 72, status: 'CONDITIONAL / UNDER REVIEW' })}
      />
    );

    expect(screen.getByText('CONDITIONAL / UNDER REVIEW')).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.gateLocked, { score: VENDOR_EVALUATION_GATE_SCORE }))).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('shows a disqualified status and shows any other status exactly as written', () => {
    mockStore();
    const { unmount } = render(
      <VendorEvaluationSummary evaluationRecord={buildRecord({ overallScore: 54, status: 'DISQUALIFIED SUPPLIER' })} />
    );
    expect(screen.getByText('DISQUALIFIED SUPPLIER')).toBeInTheDocument();
    unmount();

    render(
      <VendorEvaluationSummary
        evaluationRecord={buildRecord({ status: 'NON-COMPLIANT / REJECTED' as unknown as VendorEvaluationRecord['status'] })}
      />
    );
    expect(screen.getByText('NON-COMPLIANT / REJECTED')).toBeInTheDocument();
  });

  it('shows a not-evaluated status when the record holds no status', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ status: undefined as unknown as VendorEvaluationRecord['status'] })} />);

    expect(screen.getAllByText(NOT_EVALUATED).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('94%')).toBeInTheDocument();
  });

  it('shows the document area as empty when the record holds no attachments', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ documents: [] })} />);

    expect(screen.getAllByText(SUMMARY.documentsEmptyTitle)).toHaveLength(3);
    expect(screen.getByText(SUMMARY.documentsEmptyBody)).toBeInTheDocument();
  });

  it('shows not recorded for attachment fields the record leaves blank', () => {
    mockStore();
    const blank = { id: 'doc-blank', name: '', type: '', uploadDate: '', verified: false, status: '' } as unknown as VendorEvaluationDocument;
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ documents: [blank] })} />);

    expect(screen.getAllByText(NOT_RECORDED).length).toBeGreaterThanOrEqual(4);
  });
});

describe('buyer evaluation summary: supplier picker', () => {
  const alpha = buildVendor({ id: 'v-101', name: 'Alpha Machining Works', majorCategory: 'Mechanical' });
  const beta = buildVendor({ id: 'v-102', name: 'Beta Polymer Systems', majorCategory: 'Polymers', source: 'buyer_manual' });
  const gamma = buildVendor({ id: 'v-103', name: 'Gamma Fabrication', majorCategory: 'Fabrication' });
  const procucev = buildVendor({ id: 'v-900', name: 'Procucev Net Co', source: 'procucev_network' });
  const betaRecord = buildRecord({
    id: 'eval-beta',
    vendorId: 'v-102',
    vendorName: 'Beta Polymer Systems',
    category: 'Polymers',
    overallScore: 76,
    status: 'CONDITIONAL / UNDER REVIEW',
  });
  const gammaRecord = buildRecord({
    id: 'eval-gamma',
    vendorId: 'v-103',
    vendorName: 'Gamma Fabrication',
    category: 'Fabrication',
    overallScore: 94,
  });

  it('lists buyer-uploaded suppliers, and selecting one with an evaluation shows its record', () => {
    const store = mockStore({
      buyerVendors: [alpha, beta, gamma, procucev],
      vendorEvaluations: [betaRecord, gammaRecord],
    });
    render(<VendorEvaluationSummary />);

    expect(screen.getAllByText('Alpha Machining Works').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Internal Vendor')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.queryByRole('button', { name: /Procucev Net Co/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gamma Fabrication/ })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'Beta' } });
    expect(screen.getByText(formatString(SUMMARY.foundOne, { count: 1 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Beta Polymer Systems/ }));

    expect(store.setActiveEvaluationRecord).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'v-102' }));
    expect(store.showToast).toHaveBeenCalledWith(
      SUMMARY.companySelectedTitle,
      formatString(SUMMARY.companySelectedMessage, { name: 'Beta Polymer Systems' }),
      'info'
    );
    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText('CONDITIONAL / UNDER REVIEW')).toBeInTheDocument();
  });

  it('shows a supplier without an evaluation with its own details and every score not evaluated', () => {
    const store = mockStore({ buyerVendors: [alpha, beta], vendorEvaluations: [betaRecord] });
    render(<VendorEvaluationSummary />);

    expect(screen.getAllByText('Alpha Machining Works').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(NOT_EVALUATED).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Authorized Representative')).not.toBeInTheDocument();
    expect(store.setActiveEvaluationRecord).not.toHaveBeenCalled();
    expect(screen.getByText(SUMMARY.scoreNotApplicable)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    fireEvent.click(screen.getByRole('button', { name: /Beta Polymer Systems/ }));
    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    fireEvent.click(screen.getByRole('button', { name: /Alpha Machining Works/ }));
    expect(store.setActiveEvaluationRecord).toHaveBeenLastCalledWith(null);
  });

  it('shows each listed supplier score, or not evaluated when it has none', () => {
    mockStore({ buyerVendors: [alpha, beta, gamma], vendorEvaluations: [betaRecord, gammaRecord] });
    render(<VendorEvaluationSummary />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.getByRole('button', { name: /Alpha Machining Works/ })).toHaveTextContent(SUMMARY.scoreNotApplicable);
    expect(screen.getByRole('button', { name: /Beta Polymer Systems/ })).toHaveTextContent('76%');
    expect(screen.getByRole('button', { name: /Gamma Fabrication/ })).toHaveTextContent('94%');
  });

  it('lists every supplier when none is buyer-uploaded', () => {
    mockStore({ buyerVendors: [procucev] });
    render(<VendorEvaluationSummary />);

    expect(screen.getByText('Procucev Vendor')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.getByRole('button', { name: /Procucev Net Co/ })).toHaveTextContent(SUMMARY.optionTagProcucev);
  });

  it('shows the no-match message for a search that finds nothing', () => {
    mockStore({ buyerVendors: [alpha] });
    render(<VendorEvaluationSummary />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'Nonexistent Corp' } });
    expect(screen.getByText(formatString(SUMMARY.noSearchMatch, { query: 'Nonexistent Corp' }))).toBeInTheDocument();
    expect(screen.getByText(formatString(SUMMARY.foundMany, { count: 0 }))).toBeInTheDocument();
  });

  it('shows the no-suppliers message when the picker has nothing to list', () => {
    mockStore({ vendorEvaluations: [buildRecord({ vendorId: '' })] });
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ vendorId: '' })} />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.getByText(SUMMARY.noSuppliers)).toBeInTheDocument();
  });

  it('closes the picker on an outside click and keeps it open for a click inside', () => {
    mockStore({ buyerVendors: [alpha] });
    render(<VendorEvaluationSummary />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    fireEvent.mouseDown(screen.getByPlaceholderText(SEARCH_PLACEHOLDER));
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('shows the not-recorded placeholder in the toast for a supplier with no name', () => {
    const store = mockStore({ buyerVendors: [alpha, buildVendor({ id: 'v-nameless', name: '' })] });
    render(<VendorEvaluationSummary />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(NOT_RECORDED) }));
    expect(store.showToast).toHaveBeenCalledWith(
      SUMMARY.companySelectedTitle,
      formatString(SUMMARY.companySelectedMessage, { name: NOT_RECORDED }),
      'info'
    );
  });

  it('selects a supplier without touching the store when no record setter is provided', () => {
    const store = mockStore({ buyerVendors: [alpha, beta], setActiveEvaluationRecord: undefined });
    render(<VendorEvaluationSummary />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    fireEvent.click(screen.getByRole('button', { name: /Beta Polymer Systems/ }));
    expect(store.showToast).toHaveBeenCalled();
    expect(screen.getAllByText('Beta Polymer Systems').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a selection that is still listed when the supplier list changes', () => {
    mockStore({ buyerVendors: [alpha, beta] });
    const { rerender } = render(<VendorEvaluationSummary />);
    expect(screen.getAllByText('Alpha Machining Works').length).toBeGreaterThanOrEqual(1);

    mockStore({ buyerVendors: [beta] });
    rerender(<VendorEvaluationSummary />);
    expect(screen.getAllByText('Beta Polymer Systems').length).toBeGreaterThanOrEqual(1);
  });

  it('skips a supplier with no id and an evaluation with no vendor id', () => {
    mockStore({
      buyerVendors: [buildVendor({ id: '', name: 'No Id Supplier' }), alpha, gamma],
      vendorEvaluations: [buildRecord({ vendorId: '', vendorName: 'Unlisted Record' }), gammaRecord],
    });
    render(<VendorEvaluationSummary />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.queryByRole('button', { name: /No Id Supplier/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlisted Record/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gamma Fabrication/ })).toBeInTheDocument();
  });

  it('keeps the record passed in listed even when it is not a buyer upload', () => {
    mockStore({ buyerVendors: [alpha] });
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ vendorId: 'v-900', vendorName: 'Procucev Net Co' })} />);

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.getByRole('button', { name: /Procucev Net Co/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alpha Machining Works/ })).toBeInTheDocument();
  });

  it('shows the stored evaluation for the first listed supplier when no record is passed', () => {
    mockStore({ vendorEvaluations: [buildRecord({ vendorId: 'EVAL-STORE-1', vendorName: 'Store Resolved Vendor' })] });
    render(<VendorEvaluationSummary />);

    expect(screen.getAllByText('Store Resolved Vendor').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('94%')).toBeInTheDocument();
  });

  it('shows the first stored evaluation when no supplier can be listed', () => {
    mockStore({ vendorEvaluations: [buildRecord({ vendorId: '', vendorName: 'Unlisted Vendor' })] });
    render(<VendorEvaluationSummary />);

    expect(screen.getAllByText('Unlisted Vendor').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty state when the store holds no suppliers, evaluations or record', () => {
    mockStore({ buyerVendors: undefined, vendorEvaluations: undefined });
    render(<VendorEvaluationSummary />);

    expect(screen.getByText(SUMMARY.noEvaluationTitle)).toBeInTheDocument();
  });
});

describe('buyer evaluation summary: empty state', () => {
  it('explains that no evaluation record is selected, with a back action only when one is given', () => {
    mockStore();
    const onBack = jest.fn();
    const { unmount } = render(<VendorEvaluationSummary evaluationRecord={null} />);

    expect(screen.getByText(SUMMARY.noEvaluationTitle)).toBeInTheDocument();
    expect(screen.getByText(SUMMARY.noEvaluationBody)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SUMMARY.backAction })).not.toBeInTheDocument();
    unmount();

    render(<VendorEvaluationSummary evaluationRecord={null} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: SUMMARY.backAction }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the summary without a back action when none is given', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} />);

    expect(screen.queryByRole('button', { name: SUMMARY.backAction })).not.toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
  });
});

describe('buyer evaluation summary: failed reference load', () => {
  it('shows the load failure with a retry instead of the empty state', () => {
    const refreshFromDB = jest.fn();
    mockStore({ isLoadingDB: false, dbConnected: false, refreshFromDB });
    render(<VendorEvaluationSummary />);

    expect(screen.getByText(SUMMARY.loadFailedTitle)).toBeInTheDocument();
    expect(screen.getByText(SUMMARY.loadFailedBody)).toBeInTheDocument();
    expect(screen.queryByText(SUMMARY.noEvaluationTitle)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: SUMMARY.retryAction }));
    expect(refreshFromDB).toHaveBeenCalledTimes(1);
  });

  it('warns that the figures may be out of date when a summary is still shown after a failed load', () => {
    mockStore({ isLoadingDB: false, dbConnected: false });
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(SUMMARY.loadFailedStale);
    expect(screen.getByText('94%')).toBeInTheDocument();
  });

  it('shows the empty state, not a failure, while the load is still running', () => {
    mockStore({ isLoadingDB: true, dbConnected: false });
    render(<VendorEvaluationSummary />);

    expect(screen.getByText(SUMMARY.noEvaluationTitle)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('buyer evaluation summary: vendor code, overall score and submitted line', () => {
  const alpha = buildVendor({ id: 'v-101', name: 'Alpha Machining Works', majorCategory: 'Mechanical' });
  const beta = buildVendor({ id: 'v-102', name: 'Beta Polymer Systems', majorCategory: 'Polymers', source: 'buyer_manual' });

  it('does not show the vendor code in the details card or in the supplier picker, and keeps the category', () => {
    mockStore({ buyerVendors: [alpha, beta], vendorEvaluations: [] });
    render(
      <VendorEvaluationSummary
        evaluationRecord={buildRecord({ vendorId: 'v-102', vendorName: 'Beta Polymer Systems', category: 'Polymers' })}
      />
    );

    expect(screen.getAllByText('Polymers').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('v-102')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(PICKER_LABEL));
    expect(screen.getByRole('button', { name: /Alpha Machining Works/ })).toBeInTheDocument();
    expect(screen.queryByText('v-101')).not.toBeInTheDocument();
    expect(screen.queryByText('v-102')).not.toBeInTheDocument();
  });

  it('shows NA as the overall score when the record holds none', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord({ overallScore: null as unknown as number })} />);

    expect(screen.getByText(SUMMARY.scoreLabel)).toBeInTheDocument();
    expect(screen.getByText(SUMMARY.scoreNotApplicable)).toBeInTheDocument();
    expect(screen.queryByText('94%')).not.toBeInTheDocument();
  });

  it('leaves out the submitted line when the record holds no submission date', () => {
    mockStore();
    for (const submissionDate of ['', '   ']) {
      const view = render(<VendorEvaluationSummary evaluationRecord={buildRecord({ submissionDate })} />);
      expect(screen.queryByText(SUMMARY.submittedLabel, { exact: false })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('shows the submitted line with the recorded submission date', () => {
    mockStore();
    render(<VendorEvaluationSummary evaluationRecord={buildRecord()} />);

    expect(screen.getByText(`${SUMMARY.submittedLabel} 2026-02-28`)).toBeInTheDocument();
  });
});
