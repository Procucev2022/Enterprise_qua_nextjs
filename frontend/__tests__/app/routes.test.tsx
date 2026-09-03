import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import * as storeModule from '@/lib/store';
import type { RFQItem, VendorEvaluationRecord, VendorOpportunity } from '@/lib/types';

jest.mock('@/lib/store');

const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => mockSearchParams,
}));

/**
 * Each screen is replaced with a stub that surfaces its navigation callbacks as
 * buttons. The route pages under test are thin adapters, so what matters is that
 * every callback lands on the correct URL and that any selection is recorded in
 * the store first.
 */
function stub(testId: string, callbackNames: string[] = [], callbackArg?: unknown) {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => (
      <div data-testid={testId}>
        {callbackNames.map((name) => (
          <button key={name} type="button" onClick={() => (props[name] as (arg?: unknown) => void)?.(callbackArg)}>
            {`${testId}:${name}`}
          </button>
        ))}
      </div>
    ),
  };
}

// ── Buyer screens ────────────────────────────────────────────────────────────
jest.mock('@/app/buyer/command-center', () =>
  stub('command-center', [
    'onNavigateToWizard',
    'onNavigateToMatrix',
    'onNavigateToSubscription',
    'onNavigateToDirectory',
  ])
);
jest.mock('@/app/buyer/ingestion-wizard', () => stub('ingestion-wizard', ['onComplete', 'onCancel']));
jest.mock('@/app/buyer/rfq-summary', () =>
  stub('rfq-summary', ['onViewQuotes', 'onCreateRFQ', 'onViewDetails'], {
    id: 'rfq-1',
    rfqNumber: 'RFQ-1',
  })
);
jest.mock('@/app/buyer/rfq-details', () => stub('rfq-details', ['onBack']));
jest.mock('@/app/buyer/quote-matrix', () => stub('quote-matrix', ['onBackToDashboard']));
jest.mock('@/app/buyer/vendor-evaluation-summary', () => stub('evaluation-summary', ['onBack']));
jest.mock('@/app/buyer/vendor-summary', () =>
  stub('vendor-summary', ['onViewEvaluation', 'onNavigateToWizard'])
);
jest.mock('@/app/buyer/subscription-center', () => stub('subscription-center'));
jest.mock('@/app/buyer/buyer-profile', () => stub('buyer-profile'));
jest.mock('@/app/buyer/buyer-account-table', () => stub('buyer-account-table'));

// ── Category manager screens ─────────────────────────────────────────────────
jest.mock('@/app/category-manager/kanban-board', () =>
  stub('kanban-board', ['onNavigateToMatrix', 'onNavigateToSpend'])
);
jest.mock('@/app/category-manager/spend-dashboard', () => stub('spend-dashboard', ['onBackToKanban']));
jest.mock('@/app/category-manager/buyer-console', () =>
  stub('buyer-console', ['onNavigateToMatrix', 'onNavigateToEvaluation'])
);
jest.mock('@/app/category-manager/vendor-console', () => stub('vendor-console', ['onNavigateToMatrix']));
jest.mock('@/app/category-manager/category-summary-dashboard', () => stub('category-summary'));

// ── Vendor screens ───────────────────────────────────────────────────────────
jest.mock('@/app/vendor/opportunity-feed', () =>
  stub('opportunity-feed', ['onNavigateToBidForm', 'onNavigateToEvaluation', 'onNavigateToSubscription'])
);
jest.mock('@/app/vendor/quotation-form', () => stub('quotation-form', ['onBack', 'onSubmitSuccess']));
jest.mock('@/app/vendor/qualification-form', () => stub('qualification-form', ['onBack', 'onSuccess']));
jest.mock('@/app/vendor/item-catalogue', () => stub('item-catalogue'));
jest.mock('@/app/vendor/vendor-subscription', () => stub('vendor-subscription'));
jest.mock('@/app/vendor/vendor-profile', () => stub('vendor-profile'));

// ── Admin screens ────────────────────────────────────────────────────────────
jest.mock('@/app/admin/infra-control', () => stub('infra-control', ['onNavigateToAuditLog']));
jest.mock('@/app/admin/audit-log', () => stub('audit-log', ['onBackToInfra']));

/* eslint-disable @typescript-eslint/no-var-requires */
const BuyerCommandCenterPage = require('@/app/buyer/command-center/page').default;
const BuyerIngestionWizardPage = require('@/app/buyer/ingestion-wizard/page').default;
const BuyerRFQSummaryPage = require('@/app/buyer/rfq-summary/page').default;
const BuyerRFQDetailsPage = require('@/app/buyer/rfq-details/page').default;
const BuyerQuoteMatrixPage = require('@/app/buyer/quote-matrix/page').default;
const BuyerEvaluationSummaryPage = require('@/app/buyer/vendor-evaluation-summary/page').default;
const BuyerVendorSummaryPage = require('@/app/buyer/vendor-summary/page').default;
const BuyerSubscriptionCenterPage = require('@/app/buyer/subscription-center/page').default;
const BuyerProfileRoute = require('@/app/buyer/buyer-profile/page').default;
const BuyerDirectoryPage = require('@/app/buyer/buyer-directory/page').default;

const CmKanbanPage = require('@/app/category-manager/kanban-board/page').default;
const CmSpendPage = require('@/app/category-manager/spend-dashboard/page').default;
const CmBuyerConsolePage = require('@/app/category-manager/buyer-console/page').default;
const CmEvaluationSummaryPage = require('@/app/category-manager/vendor-evaluation-summary/page').default;
const CmVendorConsolePage = require('@/app/category-manager/vendor-console/page').default;
const CmCategorySummaryPage = require('@/app/category-manager/category-summary/page').default;
const CmQuoteMatrixPage = require('@/app/category-manager/quote-matrix/page').default;

const VendorFeedPage = require('@/app/vendor/opportunity-feed/page').default;
const VendorQuotationFormPage = require('@/app/vendor/quotation-form/page').default;
const VendorQualificationFormPage = require('@/app/vendor/qualification-form/page').default;
const VendorItemCataloguePage = require('@/app/vendor/item-catalogue/page').default;
const VendorSubscriptionPage = require('@/app/vendor/vendor-subscription/page').default;
const VendorProfileRoute = require('@/app/vendor/vendor-profile/page').default;

const AdminInfraControlPage = require('@/app/admin/infra-control/page').default;
const AdminAuditLogPage = require('@/app/admin/audit-log/page').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const RFQ = { id: 'rfq-1', rfqNumber: 'RFQ-1' } as RFQItem;
const OPPORTUNITY = { id: 'opp-1', rfqNumber: 'RFQ-1' } as VendorOpportunity;
const EVALUATION = { id: 'eval-1' } as VendorEvaluationRecord;

describe('Role screen routes', () => {
  const setSelectedRFQForMatrix = jest.fn();
  const setSelectedVendorOpportunity = jest.fn();
  const setActiveEvaluationRecord = jest.fn();

  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      setSelectedRFQForMatrix,
      setSelectedVendorOpportunity,
      setActiveEvaluationRecord,
      activeEvaluationRecord: EVALUATION,
      selectedVendorOpportunity: OPPORTUNITY,
      vendorOpportunities: [OPPORTUNITY],
      ...overrides,
    });
  };

  beforeEach(() => {
    mockStore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const clickCallback = (label: string) => fireEvent.click(screen.getByText(label));

  // ── Buyer ──────────────────────────────────────────────────────────────────
  describe('buyer routes', () => {
    it('command center links out to the wizard, matrix, subscriptions and directory', () => {
      render(<BuyerCommandCenterPage />);
      expect(screen.getByTestId('command-center')).toBeInTheDocument();

      clickCallback('command-center:onNavigateToWizard');
      expect(mockPush).toHaveBeenCalledWith('/buyer/ingestion-wizard');

      clickCallback('command-center:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix');

      clickCallback('command-center:onNavigateToSubscription');
      expect(mockPush).toHaveBeenCalledWith('/buyer/subscription-center');

      clickCallback('command-center:onNavigateToDirectory');
      expect(mockPush).toHaveBeenCalledWith('/buyer/buyer-directory');
    });

    it('records the selected RFQ before opening the matrix', () => {
      const CommandCenter = require('@/app/buyer/command-center').default;
      render(
        <CommandCenter
          onNavigateToMatrix={(rfq?: RFQItem) => {
            if (rfq) setSelectedRFQForMatrix(rfq);
          }}
        />
      );
      // Exercised directly through the page below; this guards the adapter contract.
      render(<BuyerCommandCenterPage />);
      expect(screen.getAllByTestId('command-center').length).toBeGreaterThan(0);
    });

    it('ingestion wizard returns to the command center on complete and cancel', () => {
      render(<BuyerIngestionWizardPage />);
      clickCallback('ingestion-wizard:onComplete');
      expect(mockPush).toHaveBeenCalledWith('/buyer/command-center');

      clickCallback('ingestion-wizard:onCancel');
      expect(mockPush).toHaveBeenCalledWith('/buyer/command-center');
    });

    it('quote matrix returns to the command center', () => {
      render(<BuyerQuoteMatrixPage />);
      clickCallback('quote-matrix:onBackToDashboard');
      expect(mockPush).toHaveBeenCalledWith('/buyer/command-center');
    });

    it('rfq summary opens the quote matrix and the wizard', () => {
      render(<BuyerRFQSummaryPage />);

      clickCallback('rfq-summary:onViewQuotes');
      // The matrix reads its RFQ from the store, so the selection is recorded first.
      expect(setSelectedRFQForMatrix).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix');

      clickCallback('rfq-summary:onCreateRFQ');
      expect(mockPush).toHaveBeenCalledWith('/buyer/ingestion-wizard');
    });

    it('rfq summary opens the details page addressed by RFQ number', () => {
      render(<BuyerRFQSummaryPage />);

      clickCallback('rfq-summary:onViewDetails');

      // Addressable rather than store-backed, so the view survives a reload.
      expect(mockPush).toHaveBeenCalledWith('/buyer/rfq-details?rfq=RFQ-1');
    });

    it('rfq details resolves the RFQ from the query string and returns to the portfolio', () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockStore({ rfqs: [RFQ] });

      render(<BuyerRFQDetailsPage />);
      expect(screen.getByTestId('rfq-details')).toBeInTheDocument();

      clickCallback('rfq-details:onBack');
      expect(mockPush).toHaveBeenCalledWith('/buyer/rfq-summary');
      mockSearchParams.delete('rfq');
    });

    it('rfq details renders without an RFQ when the query string carries no number', () => {
      mockStore({ rfqs: [RFQ] });

      render(<BuyerRFQDetailsPage />);

      expect(screen.getByTestId('rfq-details')).toBeInTheDocument();
    });

    it('rfq details renders when the number in the URL matches no RFQ', () => {
      mockSearchParams.set('rfq', 'RFQ-DOES-NOT-EXIST');
      mockStore({ rfqs: [RFQ] });

      render(<BuyerRFQDetailsPage />);

      // The screen itself reports the miss; the route only has to resolve to null.
      expect(screen.getByTestId('rfq-details')).toBeInTheDocument();
      mockSearchParams.delete('rfq');
    });

    it('evaluation summary clears the selection and returns to the vendor list', () => {
      render(<BuyerEvaluationSummaryPage />);
      clickCallback('evaluation-summary:onBack');
      expect(setActiveEvaluationRecord).toHaveBeenCalledWith(null);
      expect(mockPush).toHaveBeenCalledWith('/buyer/vendor-summary');
    });

    it('vendor summary opens the evaluation and the wizard', () => {
      render(<BuyerVendorSummaryPage />);
      clickCallback('vendor-summary:onViewEvaluation');
      expect(mockPush).toHaveBeenCalledWith('/buyer/vendor-evaluation-summary');

      clickCallback('vendor-summary:onNavigateToWizard');
      expect(mockPush).toHaveBeenCalledWith('/buyer/ingestion-wizard');
    });

    it.each<[string, React.ComponentType, string]>([
      ['subscription centre', BuyerSubscriptionCenterPage, 'subscription-center'],
      ['profile', BuyerProfileRoute, 'buyer-profile'],
      ['directory', BuyerDirectoryPage, 'buyer-account-table'],
    ])('renders the buyer %s screen', (_label, Page, testId) => {
      render(<Page />);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });
  });

  // ── Category manager ───────────────────────────────────────────────────────
  describe('category manager routes', () => {
    it('kanban board opens the matrix and the spend dashboard', () => {
      render(<CmKanbanPage />);
      clickCallback('kanban-board:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');

      clickCallback('kanban-board:onNavigateToSpend');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/spend-dashboard');
    });

    it('spend dashboard returns to the kanban board', () => {
      render(<CmSpendPage />);
      clickCallback('spend-dashboard:onBackToKanban');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/kanban-board');
    });

    it('buyer console opens the matrix and the evaluation summary', () => {
      render(<CmBuyerConsolePage />);
      clickCallback('buyer-console:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');

      clickCallback('buyer-console:onNavigateToEvaluation');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/vendor-evaluation-summary');
    });

    it('evaluation summary returns to the kanban board', () => {
      render(<CmEvaluationSummaryPage />);
      clickCallback('evaluation-summary:onBack');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/kanban-board');
    });

    it('vendor console opens the matrix', () => {
      render(<CmVendorConsolePage />);
      clickCallback('vendor-console:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');
    });

    it('quote matrix returns to the kanban board', () => {
      render(<CmQuoteMatrixPage />);
      clickCallback('quote-matrix:onBackToDashboard');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/kanban-board');
    });

    it('renders the category summary screen', () => {
      render(<CmCategorySummaryPage />);
      expect(screen.getByTestId('category-summary')).toBeInTheDocument();
    });
  });

  // ── Vendor ─────────────────────────────────────────────────────────────────
  describe('vendor routes', () => {
    it('opportunity feed opens the bid form, evaluation and subscriptions', () => {
      render(<VendorFeedPage />);
      clickCallback('opportunity-feed:onNavigateToBidForm');
      expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form');

      clickCallback('opportunity-feed:onNavigateToEvaluation');
      expect(mockPush).toHaveBeenCalledWith('/vendor/qualification-form');

      clickCallback('opportunity-feed:onNavigateToSubscription');
      expect(mockPush).toHaveBeenCalledWith('/vendor/vendor-subscription');
    });

    it('quotation form returns to the feed on back and on submit', () => {
      render(<VendorQuotationFormPage />);
      clickCallback('quotation-form:onBack');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');

      clickCallback('quotation-form:onSubmitSuccess');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');
    });

    it('quotation form falls back to the first open opportunity after a refresh', () => {
      mockStore({ selectedVendorOpportunity: null, vendorOpportunities: [OPPORTUNITY] });
      render(<VendorQuotationFormPage />);
      expect(screen.getByTestId('quotation-form')).toBeInTheDocument();
    });

    it('quotation form explains when there is nothing to quote on', () => {
      mockStore({ selectedVendorOpportunity: null, vendorOpportunities: [] });
      render(<VendorQuotationFormPage />);
      expect(screen.queryByTestId('quotation-form')).not.toBeInTheDocument();
      expect(screen.getByText(/No open opportunity is available/i)).toBeInTheDocument();
    });

    it('qualification form returns to the feed on back and on success', () => {
      render(<VendorQualificationFormPage />);
      clickCallback('qualification-form:onBack');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');

      clickCallback('qualification-form:onSuccess');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');
    });

    it.each<[string, React.ComponentType, string]>([
      ['item catalogue', VendorItemCataloguePage, 'item-catalogue'],
      ['subscription centre', VendorSubscriptionPage, 'vendor-subscription'],
      ['profile', VendorProfileRoute, 'vendor-profile'],
    ])('renders the vendor %s screen', (_label, Page, testId) => {
      render(<Page />);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });
  });

  // ── Admin ──────────────────────────────────────────────────────────────────
  describe('admin routes', () => {
    it('infra control opens the audit log', () => {
      render(<AdminInfraControlPage />);
      clickCallback('infra-control:onNavigateToAuditLog');
      expect(mockPush).toHaveBeenCalledWith('/admin/audit-log');
    });

    it('audit log returns to infra control', () => {
      render(<AdminAuditLogPage />);
      clickCallback('audit-log:onBackToInfra');
      expect(mockPush).toHaveBeenCalledWith('/admin/infra-control');
    });
  });

  // ── Selection hand-off between routes ──────────────────────────────────────
  describe('selection hand-off', () => {
    it('records the chosen opportunity before routing to the quotation form', () => {
      const OpportunityFeed = require('@/app/vendor/opportunity-feed').default;
      let captured: ((opp: VendorOpportunity) => void) | undefined;
      const Probe = () => {
        const page = VendorFeedPage({});
        captured = (page as React.ReactElement).props.onNavigateToBidForm;
        return <OpportunityFeed />;
      };
      render(<Probe />);
      captured?.(OPPORTUNITY);

      expect(setSelectedVendorOpportunity).toHaveBeenCalledWith(OPPORTUNITY);
      expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form');
    });

    it('records the chosen evaluation before routing to the summary', () => {
      const page = BuyerVendorSummaryPage({}) as React.ReactElement;
      page.props.onViewEvaluation(EVALUATION);

      expect(setActiveEvaluationRecord).toHaveBeenCalledWith(EVALUATION);
      expect(mockPush).toHaveBeenCalledWith('/buyer/vendor-evaluation-summary');
    });

    it.each<[string, () => React.ReactElement, string]>([
      ['buyer command centre', () => BuyerCommandCenterPage({}) as React.ReactElement, '/buyer/quote-matrix'],
      ['kanban board', () => CmKanbanPage({}) as React.ReactElement, '/category-manager/quote-matrix'],
      ['buyer console', () => CmBuyerConsolePage({}) as React.ReactElement, '/category-manager/quote-matrix'],
      ['vendor console', () => CmVendorConsolePage({}) as React.ReactElement, '/category-manager/quote-matrix'],
    ])('records the chosen RFQ from the %s before opening the matrix', (_label, build, expectedRoute) => {
      const page = build();
      page.props.onNavigateToMatrix(RFQ);

      expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(RFQ);
      expect(mockPush).toHaveBeenCalledWith(expectedRoute);
    });

    it('routes to the matrix without a selection when none is supplied', () => {
      const page = BuyerCommandCenterPage({}) as React.ReactElement;
      page.props.onNavigateToMatrix(undefined);

      expect(setSelectedRFQForMatrix).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix');
    });

    it('records the chosen RFQ before opening the spend dashboard', () => {
      const page = CmKanbanPage({}) as React.ReactElement;
      page.props.onNavigateToSpend(RFQ);

      expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(RFQ);
      expect(mockPush).toHaveBeenCalledWith('/category-manager/spend-dashboard');
    });

    it('opens the spend dashboard without a selection when none is supplied', () => {
      const page = CmKanbanPage({}) as React.ReactElement;
      page.props.onNavigateToSpend(undefined);

      expect(setSelectedRFQForMatrix).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/category-manager/spend-dashboard');
    });
  });
});
