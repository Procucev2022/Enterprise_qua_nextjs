import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VendorEvaluationSummary from '@/app/buyer/vendor-evaluation-summary';
import { useApp } from '@/lib/store';
import { VendorEvaluationRecord } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/vendor-evaluation-summary.tsx', () => {
  const mockShowToast = jest.fn();
  const mockAddAuditLog = jest.fn();
  const mockAddFeedItem = jest.fn();
  const mockOnBack = jest.fn();

  const mockEvaluationRecord: any = {
    id: 'eval-1',
    vendorId: 'VN-APEX-4920',
    vendorName: 'Apex Supplies Ltd.',
    category: 'Piping & Mechanical',
    contactPerson: 'Rajesh Nair',
    email: 'rajesh@apex.in',
    phone: '+91 98201 44820',
    submissionDate: '2026-02-28',
    overallScore: 94,
    status: 'PREFERRED ENTERPRISE SUPPLIER',
    systemAction: 'Auto Direct Dispatch Authorized (Gate Pass > 80% Unlocked)',
    moduleScores: {
      commercial: { weightedScore: 23.5, remarks: 'Acceptable payment terms and commercial pricing.' },
      technical: { weightedScore: 14.2, remarks: 'Extensive machining and pump engineering capacity.' },
      quality: { weightedScore: 19.1, remarks: 'ISO 9001:2015 certified with zero active recalls.' },
      delivery: { weightedScore: 18.8, remarks: 'Dedicated logistics network with real-time tracking.' },
      financial: { weightedScore: 9.4, remarks: 'Stable credit rating with positive EBITDA.' },
      governance: { weightedScore: 9.0, remarks: 'Fully compliant ESG and safety audit records.' },
    },
    questionBreakdown: [
      {
        refId: 'Q-01',
        criteria: 'Payment terms compliance',
        pillarId: 'M1',
        score: 4.8,
        weightedScore: 6.0,
        attachmentName: 'commercial_terms_doc.pdf',
        remarks: 'Confirmed Net 45 Days.',
      },
      {
        refId: 'Q-02',
        criteria: 'Machining precision DIN standard',
        pillarId: 'M2',
        score: 4.5,
        weightedScore: 3.5,
        attachmentName: 'technical_spec_sheet.pdf',
        remarks: 'All CNC tolerances within 0.01mm.',
      },
      {
        refId: 'Q-03',
        criteria: 'ISO 9001 certification',
        pillarId: 'M3',
        score: 5.0,
        weightedScore: 5.0,
        attachmentName: 'iso_9001_cert.pdf',
        remarks: 'Valid through 2028.',
      },
      {
        refId: 'Q-04',
        criteria: 'On-time delivery performance history',
        pillarId: 'M4',
        score: 4.6,
        weightedScore: 4.8,
        attachmentName: 'delivery_log_2025.xlsx',
        remarks: '98.5% on-time dispatch rate.',
      },
      {
        refId: 'Q-05',
        criteria: 'Audited Financial Balance Sheets',
        pillarId: 'M5',
        score: 4.7,
        weightedScore: 2.5,
        attachmentName: 'financial_audit_fy25.pdf',
        remarks: 'Positive working capital.',
      },
      {
        refId: 'Q-06',
        criteria: 'ESG Environmental policy adherence',
        pillarId: 'M6',
        score: 4.5,
        weightedScore: 2.5,
        attachmentName: 'esg_report.pdf',
        remarks: 'Zero environmental violations.',
      },
    ],
    documents: Array.from({ length: 14 }, (_, i) => ({
      id: `doc-${i + 1}`,
      name: `Compliance_Doc_${i + 1}.pdf`,
      type: 'Quality Assurance',
      uploadDate: '2026-02-28',
      status: 'VERIFIED',
      url: `/docs/doc-${i + 1}.pdf`,
    })),
    capaNotes: 'Ensure warranty certificates are refreshed quarterly.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [mockEvaluationRecord],
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      addFeedItem: mockAddFeedItem,
    });
  });

  it('renders fallback when no evaluation record exists', () => {
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [],
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      addFeedItem: mockAddFeedItem,
    });

    render(<VendorEvaluationSummary evaluationRecord={null} />);
    expect(screen.getByText('No evaluation record selected.')).toBeInTheDocument();
  });

  it('renders evaluation report with executive metrics, 6 pillars, questions table, and document list', () => {
    render(<VendorEvaluationSummary evaluationRecord={mockEvaluationRecord} onBack={mockOnBack} />);

    expect(screen.getByText('Mode 3 360-Degree Vendor Evaluation Summary Report')).toBeInTheDocument();
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.getByText('PREFERRED ENTERPRISE SUPPLIER')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('+ 2 additional mandatory documents verified in Azure Blob Storage.')).toBeInTheDocument();

    // Click back button
    fireEvent.click(screen.getByText('Back'));
    expect(mockOnBack).toHaveBeenCalled();

    // Click Export PDF
    fireEvent.click(screen.getByText('Export PDF Report'));
    expect(mockShowToast).toHaveBeenCalledWith('Evaluation PDF Exported', expect.any(String), 'success');

    // Click Document preview
    const previewBtns = screen.getAllByText('Preview');
    fireEvent.click(previewBtns[0]);
    expect(mockShowToast).toHaveBeenCalledWith('Document Opened', expect.stringContaining('Compliance_Doc_1.pdf'), 'info');
  });

  it('filters 24-criteria evaluation table by pillar pills (M1, M2, M3, M4, M5, M6, ALL)', () => {
    render(<VendorEvaluationSummary evaluationRecord={mockEvaluationRecord} />);

    // Filter by M1
    fireEvent.click(screen.getByRole('button', { name: 'M1' }));
    expect(screen.getByText('Payment terms compliance')).toBeInTheDocument();
    expect(screen.queryByText('Machining precision DIN standard')).not.toBeInTheDocument();

    // Filter by M2
    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    expect(screen.getByText('Machining precision DIN standard')).toBeInTheDocument();

    // Filter by M3
    fireEvent.click(screen.getByRole('button', { name: 'M3' }));
    expect(screen.getByText('ISO 9001 certification')).toBeInTheDocument();

    // Filter by M4
    fireEvent.click(screen.getByRole('button', { name: 'M4' }));
    expect(screen.getByText('On-time delivery performance history')).toBeInTheDocument();

    // Filter by M5
    fireEvent.click(screen.getByRole('button', { name: 'M5' }));
    expect(screen.getByText('Audited Financial Balance Sheets')).toBeInTheDocument();

    // Filter by M6
    fireEvent.click(screen.getByRole('button', { name: 'M6' }));
    expect(screen.getByText('ESG Environmental policy adherence')).toBeInTheDocument();

    // Filter by ALL
    fireEvent.click(screen.getByRole('button', { name: 'All 24 Criteria' }));
    expect(screen.getByText('Payment terms compliance')).toBeInTheDocument();
    expect(screen.getByText('Machining precision DIN standard')).toBeInTheDocument();
  });

  it('handles score override workflow with modal, input change, and audit logging', () => {
    render(<VendorEvaluationSummary evaluationRecord={mockEvaluationRecord} />);

    // Open override modal
    fireEvent.click(screen.getByText(/Override AI Score/i));
    expect(screen.getByText(/Override AI Evaluation Score/i)).toBeInTheDocument();

    // Cancel modal
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText(/Override AI Evaluation Score/i)).not.toBeInTheDocument();

    // Reopen and close with X button
    fireEvent.click(screen.getByText(/Override AI Score/i));
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);

    // Reopen, change score, and confirm
    fireEvent.click(screen.getByText(/Override AI Score/i));
    const scoreInput = screen.getByRole('spinbutton');
    fireEvent.change(scoreInput, { target: { value: '88' } });
    fireEvent.click(screen.getByText('Confirm Score Override'));

    // Verify override score updated
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('(Calibrated by CM)')).toBeInTheDocument();
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      expect.stringContaining('Manual Override: Category Manager adjusted Mode 3 360° score for Apex Supplies Ltd. to 88%'),
      'Mode-3-Override'
    );
    expect(mockShowToast).toHaveBeenCalledWith('Score Overridden', expect.any(String), 'success');
  });

  it('triggers CAPA action plan notice', () => {
    render(<VendorEvaluationSummary evaluationRecord={mockEvaluationRecord} />);

    fireEvent.click(screen.getByText(/Trigger CAPA Action/i));
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      expect.stringContaining('Triggered CAPA Action Plan for vendor Apex Supplies Ltd.'),
      'CAPA-Trigger'
    );
    expect(mockAddFeedItem).toHaveBeenCalledWith(
      expect.stringContaining('CAPA Triggered: Apex Supplies Ltd.'),
      expect.any(String),
      'escalation',
      'RFQ-2026-00421',
      'Apex Supplies Ltd.'
    );
    expect(mockShowToast).toHaveBeenCalledWith('CAPA Notice Issued', expect.any(String), 'info');
  });

  it('renders different status badges for conditional and disqualified vendor scores', () => {
    const conditionalRecord: VendorEvaluationRecord = {
      ...mockEvaluationRecord,
      overallScore: 72,
      status: 'CONDITIONAL / UNDER REVIEW',
    };

    const { rerender } = render(<VendorEvaluationSummary evaluationRecord={conditionalRecord} />);
    expect(screen.getByText('CONDITIONAL / UNDER REVIEW')).toBeInTheDocument();

    const disqualifiedRecord: VendorEvaluationRecord = {
      ...mockEvaluationRecord,
      overallScore: 54,
      status: 'DISQUALIFIED SUPPLIER',
    };

    rerender(<VendorEvaluationSummary evaluationRecord={disqualifiedRecord} />);
    expect(screen.getByText('DISQUALIFIED SUPPLIER')).toBeInTheDocument();
  });
});
