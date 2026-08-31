import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KanbanBoard from '@/app/category-manager/kanban-board';
import SpendDashboard from '@/app/category-manager/spend-dashboard';
import BuyerConsole from '@/app/category-manager/buyer-console';
import VendorConsole from '@/app/category-manager/vendor-console';
import CategorySummaryDashboard from '@/app/category-manager/category-summary-dashboard';
import { AppProvider, useApp } from '@/lib/store';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function CategoryManagerBranchWrapper({ onMatrix, onEval, onSpend }: any) {
  const { addNewRFQ } = useApp();

  return (
    <>
      <button
        data-testid="test-add-varied-rfqs"
        onClick={() => {
          try {
            addNewRFQ({
              rfqNumber: 'RFQ-2026-PARSE',
              title: 'Parsing RFQ Test',
              category: 'Civil Works',
              sourcingMode: 'mode_1',
              targetDeliveryDate: '2026-10-01',
              budget: 50000,
              extractedEntities: [
                {
                  id: 'ent-p1',
                  itemName: 'Cement Bags',
                  quantity: 100,
                  unit: 'Bags',
                  targetDate: '2026-10-01',
                  technicalSpecs: 'Grade 53 OPC',
                  confidence: 99,
                  category: 'Civil Works',
                  majorCategory: 'Civil Works',
                  minorCategory: 'Cement & Concrete',
                },
              ],
              aiScore: 75,
              autoCirculated: false,
            });
            addNewRFQ({
              rfqNumber: 'RFQ-2026-EVAL',
              title: 'In Evaluation RFQ Test',
              category: 'Engineering Spares - Electrical',
              sourcingMode: 'mode_3',
              targetDeliveryDate: '2026-10-01',
              budget: 75000,
              extractedEntities: [
                {
                  id: 'ent-e1',
                  itemName: 'Circuit Breaker',
                  quantity: 10,
                  unit: 'Units',
                  targetDate: '2026-10-01',
                  technicalSpecs: '400A MCCB',
                  confidence: 98,
                  category: 'Engineering Spares - Electrical',
                  majorCategory: 'Engineering Spares - Electrical',
                  minorCategory: 'Circuit Breakers',
                },
              ],
              aiScore: 85,
              autoCirculated: false,
            });
          } catch (e) {}
        }}
      >
        Add Varied RFQs
      </button>
      <KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={onSpend} />
      <BuyerConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />
      <VendorConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />
    </>
  );
}

describe('Category Manager Screens Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('KanbanBoard Screen', () => {
    test('renders Kanban columns, summary strip, and handles all actions and overrides', async () => {
      const onMatrix = jest.fn();
      const onSpend = jest.fn();

      renderWithProvider(<KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={onSpend} />);

      await waitFor(() => {
        expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Mode & Performance Analytics/i)).toBeInTheDocument();

      const spendBtn = screen.getByRole('button', { name: /Mode & Performance Analytics/i });
      fireEvent.click(spendBtn);
      expect(onSpend).toHaveBeenCalled();

      // Test batch multi-channel chaser override
      const batchBtn = screen.getByRole('button', { name: /Batch Multi-Channel Chaser/i });
      fireEvent.click(batchBtn);

      // Test override AI score
      const overrideBtn = screen.getByRole('button', { name: /Override AI Score/i });
      fireEvent.click(overrideBtn);

      // Test survey modal button and close it
      const surveyBtn = screen.getByRole('button', { name: /Conduct Mode 3 Vendor Survey/i });
      fireEvent.click(surveyBtn);
      expect(screen.getByText(/Mode 3 AI Vendor Survey/i)).toBeInTheDocument();

      const cancelSurveyBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelSurveyBtn);

      // Test open chaser modal (Call) and close it
      const allButtons = screen.getAllByRole('button');
      const callBtn = allButtons.find(b => b.textContent?.includes('Call') && !b.textContent?.includes('Voice'));
      if (callBtn) {
        fireEvent.click(callBtn);
        expect(screen.getByText(/Dispatch AI Follow-Up/i)).toBeInTheDocument();
        const cancelChaserBtn = screen.getByRole('button', { name: /Cancel/i });
        fireEvent.click(cancelChaserBtn);
      }

      // Test open chaser modal (WA)
      const waBtn = allButtons.find(b => b.textContent?.includes('WA'));
      if (waBtn) {
        fireEvent.click(waBtn);
        const cancelWaBtn = screen.getByRole('button', { name: /Cancel/i });
        fireEvent.click(cancelWaBtn);
      }

      // Test open chaser modal (SMS)
      const smsBtn = allButtons.find(b => b.textContent?.includes('SMS') && !b.textContent?.includes('Broadcast'));
      if (smsBtn) {
        fireEvent.click(smsBtn);
        const cancelSmsBtn = screen.getByRole('button', { name: /Cancel/i });
        fireEvent.click(cancelSmsBtn);
      }

      // Test 24h Email button
      const emailBtn = allButtons.find(b => b.textContent?.includes('24h Email'));
      if (emailBtn) {
        fireEvent.click(emailBtn);
      }

      // Test Deep Dive button and close it
      const deepDiveBtn = screen.getByRole('button', { name: /Deep Dive/i });
      fireEvent.click(deepDiveBtn);
      expect(screen.getByText(/RFQ AI Follow-Up Telemetry & Deep Dive/i)).toBeInTheDocument();
      const closeDeepDiveBtn = screen.getByRole('button', { name: /Close Deep Dive/i });
      fireEvent.click(closeDeepDiveBtn);

      // Test Escalate to Buyer
      const escalateBtn = screen.getByRole('button', { name: /Escalate to Buyer/i });
      fireEvent.click(escalateBtn);

      // Test Approve Report
      const approveBtn = screen.getByRole('button', { name: /Approve Report/i });
      fireEvent.click(approveBtn);

      // Test Share Report
      const shareBtn = screen.getByRole('button', { name: /Share Report/i });
      fireEvent.click(shareBtn);

      // Test Matrix ready card click
      const matrixCard = screen.getByText(/RFQ-00421: Matrix Ready/i);
      fireEvent.click(matrixCard);
      expect(onMatrix).toHaveBeenCalled();
    });
  });

  describe('SpendDashboard Screen', () => {
    test('renders Mode Performance & RFQ Analytics metrics and back button', () => {
      const onBack = jest.fn();
      renderWithProvider(<SpendDashboard onBackToKanban={onBack} />);

      expect(screen.getByText(/Mode Performance & RFQ Analytics Dashboard/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Private Client Roster/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Hybrid Base Network/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/360° AI Evaluated Roster/i)[0]).toBeInTheDocument();

      const backBtn = screen.getByRole('button', { name: /Back to Operational Monitoring Kanban/i });
      fireEvent.click(backBtn);
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('BuyerConsole Screen', () => {
    test('renders buyer console with dropdown filters, search, and drill-down expansion', async () => {
      const onMatrix = jest.fn();
      const onEval = jest.fn();

      renderWithProvider(<BuyerConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />);

      await waitFor(() => {
        expect(screen.getByText(/Buyer Wise Command Console & Analytics/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Active Context Selection/i)).toBeInTheDocument();

      // Test search
      const searchInput = screen.getByPlaceholderText(/Search Buyer name or company/i);
      fireEvent.change(searchInput, { target: { value: 'Rajesh' } });
      expect(screen.getAllByText(/Rajesh Nair/i)[0]).toBeInTheDocument();

      // Test company filter dropdown and dependent buyer dropdown
      const selects = screen.getAllByRole('combobox');
      if (selects.length >= 2) {
        // Select company
        fireEvent.change(selects[0], { target: { value: 'Larsen & Toubro Ltd. (L&T)' } });
        // Select buyer within company
        fireEvent.change(selects[1], { target: { value: 'b-001' } });
        // Reset company to all
        fireEvent.change(selects[0], { target: { value: 'all' } });
      }

      // Test buyer with no active RFQs (Amit Kumar Tata)
      fireEvent.change(searchInput, { target: { value: 'Amit' } });
      const amitBuyer = screen.getByText(/Amit Kumar Tata/i);
      fireEvent.click(amitBuyer);
      const reviewBtnsForAmit = screen.queryAllByRole('button', { name: /Review RFQ Details/i });
      if (reviewBtnsForAmit.length > 0) {
        fireEvent.click(reviewBtnsForAmit[0]);
        expect(screen.getByText(/No active RFQ records found for this buyer profile/i)).toBeInTheDocument();
        const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
        fireEvent.click(hideBtn);
      }

      // Test buyer selection and toggle collapse
      fireEvent.change(searchInput, { target: { value: '' } });
      const buyerCard = screen.getAllByText(/Rajesh Nair/i)[0];
      fireEvent.click(buyerCard);

      // Test review RFQ details
      const reviewBtns = screen.queryAllByRole('button', { name: /Review RFQ Details/i });
      if (reviewBtns.length > 0) {
        fireEvent.click(reviewBtns[0]);
        expect(screen.getByText(/Sourcing Details for Larsen & Toubro/i)).toBeInTheDocument();

        // Expand RFQ row
        const rfqRows = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (rfqRows.length > 0) {
          fireEvent.click(rfqRows[0]);

          // Go to Quote Matrix
          const matrixBtn = screen.queryByRole('button', { name: /Go to Quote Matrix/i });
          if (matrixBtn) {
            fireEvent.click(matrixBtn);
            expect(onMatrix).toHaveBeenCalled();
          }

          // Review Survey Evaluation if available
          const evalBtn = screen.queryByRole('button', { name: /Review Survey Evaluation/i });
          if (evalBtn) {
            fireEvent.click(evalBtn);
            expect(onEval).toHaveBeenCalled();
          }

          // Collapse RFQ row
          fireEvent.click(rfqRows[0]);
        }

        // Toggle Hide Details
        const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
        fireEvent.click(hideBtn);
      }
    });
  });

  describe('VendorConsole Screen', () => {
    test('renders vendor console with performance cards, search, and drill-down', async () => {
      const onMatrix = jest.fn();
      const onEval = jest.fn();

      renderWithProvider(<VendorConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />);

      await waitFor(() => {
        expect(screen.getByText(/Vendor Summary & Performance Analytics/i)).toBeInTheDocument();
      });

      expect(screen.getAllByText(/Apex Supplies Ltd\./i)[0]).toBeInTheDocument();

      // Test search
      const searchInput = screen.getByPlaceholderText(/Search Vendor name or category/i);
      fireEvent.change(searchInput, { target: { value: 'Kiran' } });
      expect(screen.getAllByText(/Kiran Valve Industries/i)[0]).toBeInTheDocument();

      // Test company filter dropdown and dependent contact dropdown
      const selects = screen.getAllByRole('combobox');
      if (selects.length >= 2) {
        fireEvent.change(selects[0], { target: { value: 'Kiran Valve Industries' } });
        fireEvent.change(selects[1], { target: { value: 'v-002' } });
        fireEvent.change(selects[0], { target: { value: 'all' } });
      }

      // Test vendor with no active bids (Voltas Electro Mech)
      fireEvent.change(searchInput, { target: { value: 'Voltas' } });
      const voltasVendor = screen.getAllByText(/Voltas Electro Mech/i)[0];
      fireEvent.click(voltasVendor);
      const reviewBtnsForVoltas = screen.queryAllByRole('button', { name: /Review Performance/i });
      if (reviewBtnsForVoltas.length > 0) {
        fireEvent.click(reviewBtnsForVoltas[0]);
        expect(screen.getByText(/No active bids or quotes found in category database for this vendor/i)).toBeInTheDocument();
        const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
        fireEvent.click(hideBtn);
      }

      // Test review performance for first vendor
      fireEvent.change(searchInput, { target: { value: '' } });
      const reviewBtns = screen.queryAllByRole('button', { name: /Review Performance/i });
      if (reviewBtns.length > 0) {
        fireEvent.click(reviewBtns[0]);
        expect(screen.getByText(/Sourcing Bid Roster for/i)).toBeInTheDocument();

        // Expand Quote card
        const quoteCards = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (quoteCards.length > 0) {
          fireEvent.click(quoteCards[0]);
          const centralMatrixBtn = screen.queryByRole('button', { name: /Go to Central Quote Matrix/i });
          if (centralMatrixBtn) {
            fireEvent.click(centralMatrixBtn);
            expect(onMatrix).toHaveBeenCalled();
          }

          // Collapse Quote card
          fireEvent.click(quoteCards[0]);
        }

        // Toggle Hide Details
        const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
        fireEvent.click(hideBtn);
      }
    });
  });

  describe('CategorySummaryDashboard Screen', () => {
    test('renders category governance table with timeframe switches, search, and expansion', () => {
      renderWithProvider(<CategorySummaryDashboard />);

      expect(screen.getByText(/Category Governance & Demand-Supply Analytics/i)).toBeInTheDocument();
      expect(screen.getAllByText(/13 Major/i)[0]).toBeInTheDocument();

      // Timeframe switches
      const sevenDaysBtn = screen.getByRole('button', { name: /7 Days/i });
      fireEvent.click(sevenDaysBtn);

      const thirtyDaysBtn = screen.getByRole('button', { name: /30 Days/i });
      fireEvent.click(thirtyDaysBtn);

      const ninetyDaysBtn = screen.getByRole('button', { name: /90 Days/i });
      fireEvent.click(ninetyDaysBtn);

      const oneEightyDaysBtn = screen.getByRole('button', { name: /180 Days/i });
      fireEvent.click(oneEightyDaysBtn);

      const oneYearBtn = screen.getByRole('button', { name: /1 Year/i });
      fireEvent.click(oneYearBtn);

      // Search filter
      const searchInput = screen.getByPlaceholderText(/Search category, buyer, or vendor/i);
      fireEvent.change(searchInput, { target: { value: 'Civil' } });
      expect(screen.getAllByText(/Civil Works/i)[0]).toBeInTheDocument();

      // Expand category row
      const detailsBtns = screen.getAllByRole('button', { name: /Details/i });
      if (detailsBtns.length > 0) {
        fireEvent.click(detailsBtns[0]);
      }

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
    });
  });

  describe('Category Manager Combined Branch Coverage', () => {
    test('exercises varied RFQ statuses and empty state branches across all 3 screens', async () => {
      renderWithProvider(<CategoryManagerBranchWrapper onMatrix={jest.fn()} onEval={jest.fn()} onSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId('test-add-varied-rfqs')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('test-add-varied-rfqs'));

      // Expand the newly added parsing and eval RFQs in buyer console
      const rfqCards = screen.queryAllByText(/RFQ-2026-PARSE|RFQ-2026-EVAL/i);
      for (const card of rfqCards) {
        fireEvent.click(card);
      }
    });
  });
});
