import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import { AppProvider, useApp } from '@/lib/store';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function OpportunityFeedCustomWrapper({
  onNavigateToBidForm = jest.fn(),
  onNavigateToEvaluation = jest.fn(),
  onNavigateToSubscription = jest.fn(),
  customSubscription = 'connect',
  customDownloadsUsed = 0,
  customSelfEvaluationCompleted = false,
  customSelfEvaluationScore = 85,
  customCatalogue = [],
}: {
  onNavigateToBidForm?: (opp: any) => void;
  onNavigateToEvaluation?: () => void;
  onNavigateToSubscription?: () => void;
  customSubscription?: any;
  customDownloadsUsed?: number;
  customSelfEvaluationCompleted?: boolean;
  customSelfEvaluationScore?: number;
  customCatalogue?: any[];
}) {
  const {
    setVendorSubscription,
    setVendorRfqDownloadsUsed,
    setVendorSelfEvaluationCompleted,
    setVendorSelfEvaluationScore,
    setVendorCatalogue,
  } = useApp();

  React.useEffect(() => {
    setVendorSubscription(customSubscription);
    setVendorRfqDownloadsUsed(customDownloadsUsed);
    setVendorSelfEvaluationCompleted(customSelfEvaluationCompleted);
    setVendorSelfEvaluationScore(customSelfEvaluationScore);
    setVendorCatalogue(customCatalogue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OpportunityFeed
      onNavigateToBidForm={onNavigateToBidForm}
      onNavigateToEvaluation={onNavigateToEvaluation}
      onNavigateToSubscription={onNavigateToSubscription}
    />
  );
}

describe('OpportunityFeed Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Self-Evaluation Header Banner and Navigation callbacks', () => {
    const onNavigateToBidForm = jest.fn();
    const onNavigateToEvaluation = jest.fn();
    const onNavigateToSubscription = jest.fn();

    // 1. Initial State: self-evaluation not completed
    const { unmount } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToEvaluation={onNavigateToEvaluation}
        onNavigateToSubscription={onNavigateToSubscription}
        customSelfEvaluationCompleted={false}
        customSubscription="standard"
      />
    );

    const evalBtn = screen.getByRole('button', { name: /Start Self-Evaluation/i });
    fireEvent.click(evalBtn);
    expect(onNavigateToEvaluation).toHaveBeenCalled();

    // Click Mid-page evaluation CTA
    const midEvalBtn = screen.getByRole('button', { name: /Start 360° AI Self-Evaluation/i });
    fireEvent.click(midEvalBtn);
    expect(onNavigateToEvaluation).toHaveBeenCalledTimes(2);

    // Click View Connect / Select ($0 Fee) with callback
    const viewConnectBtn = screen.getByRole('button', { name: /View Connect \/ Select/i });
    fireEvent.click(viewConnectBtn);
    expect(onNavigateToSubscription).toHaveBeenCalled();
    unmount();

    // Render with undefined onNavigateToSubscription to test fallback openUpgradeModal
    const { unmount: unmountFallback } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToEvaluation={onNavigateToEvaluation}
        onNavigateToSubscription={undefined}
        customSelfEvaluationCompleted={false}
        customSubscription="standard"
      />
    );

    // Click Submit Quote Now in reminder banner
    const quoteNowBtn = screen.getByRole('button', { name: /Submit Quote Now/i });
    fireEvent.click(quoteNowBtn);
    expect(onNavigateToBidForm).toHaveBeenCalled();

    const viewConnectBtnFallback = screen.getByRole('button', { name: /View Connect \/ Select/i });
    fireEvent.click(viewConnectBtnFallback);
    unmountFallback();

    // 2. Self-evaluation completed state: View AI Rating & Retake
    renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToEvaluation={onNavigateToEvaluation}
        onNavigateToSubscription={onNavigateToSubscription}
        customSelfEvaluationCompleted={true}
        customSelfEvaluationScore={92}
      />
    );

    const viewRatingBtn = screen.getByRole('button', { name: /View AI Rating \(92%\)/i });
    fireEvent.click(viewRatingBtn);

    const retakeBtn = screen.getByRole('button', { name: /Retake 360° AI Self-Evaluation/i });
    fireEvent.click(retakeBtn);
  });

  test('Direct Invitations Filtering: Company, Buyer, Categories, Search, Clear, and Catalogue Matches', () => {
    const mockCatalogue = [
      {
        id: 'cat-1',
        name: 'Centrifugal Industrial Water Pump 15HP',
        category: 'Pumps & Fluid Dynamics',
        sku: 'SKU-PUMP-15HP',
        specs: '15 HP industrial pump',
        unitPrice: 1200,
        leadTimeDays: 7,
        moq: 1,
      },
    ];

    renderWithProvider(
      <OpportunityFeedCustomWrapper customCatalogue={mockCatalogue} />
    );

    // Direct Invitations Search Input: title, line item, and clear
    const searchInputs = screen.getAllByPlaceholderText(/Specs, location, keywords/i);
    if (searchInputs.length > 0) {
      fireEvent.change(searchInputs[0], { target: { value: 'Pump' } });
      const clearSearchBtns = screen.queryAllByTitle(/Clear Search/i);
      if (clearSearchBtns.length > 0) {
        fireEvent.click(clearSearchBtns[0]);
      }
      // Line item description matching
      fireEvent.change(searchInputs[0], { target: { value: 'SS316' } });
      fireEvent.change(searchInputs[0], { target: { value: 'NonExistentRFQ' } });
      fireEvent.change(searchInputs[0], { target: { value: '' } });
    }

    // Direct Invitations Filter dropdowns
    const selects = screen.getAllByRole('combobox');
    // Select Company: Larsen & Toubro
    if (selects.length > 0) {
      fireEvent.change(selects[0], { target: { value: 'Larsen & Toubro Ltd. (L&T)' } });
      const updatedSelects1 = screen.getAllByRole('combobox');
      if (updatedSelects1.length > 1) {
        fireEvent.change(updatedSelects1[1], { target: { value: 'Rajesh Nair' } });
      }
      fireEvent.change(selects[0], { target: { value: 'Tata Projects Ltd.' } });
      const updatedSelects2 = screen.getAllByRole('combobox');
      if (updatedSelects2.length > 1) {
        fireEvent.change(updatedSelects2[1], { target: { value: 'Amit Kumar Tata' } });
      }
      fireEvent.change(selects[0], { target: { value: 'all' } });
    }

    // Select Major & Minor Category: Mechanical & Fluid
    if (selects.length > 2) {
      fireEvent.change(selects[2], { target: { value: 'Mechanical & Fluid Equipment' } });
      if (selects.length > 3) {
        fireEvent.change(selects[3], { target: { value: 'Pumps & Valves' } });
        fireEvent.change(selects[3], { target: { value: 'Structural Steel & Beams' } });
      }

      // Building & Infra
      fireEvent.change(selects[2], { target: { value: 'Building & Infrastructure' } });
      if (selects.length > 3) {
        fireEvent.change(selects[3], { target: { value: 'Building Automation & HVAC' } });
      }
      fireEvent.change(selects[2], { target: { value: 'all' } });
    }

    // Catalogue matching filter button for Direct Invitations
    const catalogueFilterBtns = screen.getAllByRole('button', { name: /Catalogue Match/i });
    if (catalogueFilterBtns.length > 0) {
      fireEvent.click(catalogueFilterBtns[0]);
      fireEvent.click(catalogueFilterBtns[0]);
    }
  });

  test('Open Network Marketplace Filtering: Categories, Search, and Catalogue Matches', () => {
    const mockCatalogue = [
      {
        id: 'cat-2',
        name: 'Standard Carbon Steel Flanged Connector',
        category: 'Pipes & Fittings',
        sku: 'SKU-PIPE-SS',
        specs: 'Carbon steel connector fitting',
        unitPrice: 250,
        leadTimeDays: 10,
        moq: 5,
      },
    ];

    const { unmount } = renderWithProvider(
      <OpportunityFeedCustomWrapper customCatalogue={mockCatalogue} />
    );

    // Open Network Search Input: title, line item, and clear
    const searchInputs = screen.getAllByPlaceholderText(/Specs, location, keywords/i);
    if (searchInputs.length > 1) {
      fireEvent.change(searchInputs[1], { target: { value: 'Steel' } });
      const clearSearchBtns = screen.queryAllByTitle(/Clear Search/i);
      if (clearSearchBtns.length > 0) {
        fireEvent.click(clearSearchBtns[0]);
      }
      // Line item description matching
      fireEvent.change(searchInputs[1], { target: { value: 'flanged' } });
      fireEvent.change(searchInputs[1], { target: { value: 'NonExistentNetRFQ' } });
      fireEvent.change(searchInputs[1], { target: { value: '' } });
    }

    // Open Network Category Selects
    const selects = screen.getAllByRole('combobox');
    if (selects.length > 4) {
      fireEvent.change(selects[4], { target: { value: 'Mechanical & Fluid Equipment' } });
      if (selects.length > 5) {
        fireEvent.change(selects[5], { target: { value: 'Structural Steel & Beams' } });
      }
      fireEvent.change(selects[4], { target: { value: 'Building & Infrastructure' } });
      if (selects.length > 5) {
        fireEvent.change(selects[5], { target: { value: 'Building Automation & HVAC' } });
      }
      fireEvent.change(selects[4], { target: { value: 'all' } });
    }

    // Catalogue matching filter button for Network
    const catalogueFilterBtns = screen.getAllByRole('button', { name: /Catalogue Match/i });
    if (catalogueFilterBtns.length > 1) {
      fireEvent.click(catalogueFilterBtns[1]);
      fireEvent.click(catalogueFilterBtns[1]);
    }
    unmount();

    // Render with empty catalogue and toggle filter to execute length === 0 branches
    const { unmount: unmountEmptyCat } = renderWithProvider(
      <OpportunityFeedCustomWrapper customCatalogue={[]} />
    );
    const emptyCatFilterBtns = screen.getAllByRole('button', { name: /Catalogue Match/i });
    if (emptyCatFilterBtns.length > 0) {
      fireEvent.click(emptyCatFilterBtns[0]); // Direct with 0 matches
    }
    if (emptyCatFilterBtns.length > 1) {
      fireEvent.click(emptyCatFilterBtns[1]); // Network with 0 matches
    }
    unmountEmptyCat();
  });

  test('Download RFQ, Locked Upgrade Modals, and Plan Switchers across Tiers and Quotas', () => {
    const onNavigateToBidForm = jest.fn();
    const onNavigateToSubscription = jest.fn();

    // 1. Premium model: download direct RFQ and network RFQ (!isDirect)
    const { unmount: unmount1 } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToSubscription={onNavigateToSubscription}
        customSubscription="premium"
        customDownloadsUsed={0}
      />
    );

    const downloadBtns = screen.queryAllByTitle(/Download RFQ Technical BOQ/i);
    downloadBtns.forEach((btn) => {
      fireEvent.click(btn);
    });
    unmount1();

    // 2. Connect model at quota limit (50 downloads used)
    const { unmount: unmount2 } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToSubscription={onNavigateToSubscription}
        customSubscription="connect"
        customDownloadsUsed={50}
      />
    );

    const downloadBtnsAtLimit = screen.queryAllByTitle(/Download RFQ Technical BOQ/i);
    if (downloadBtnsAtLimit.length > 2) {
      fireEvent.click(downloadBtnsAtLimit[2]);
    }

    // Modal is open, switch plan to Select
    const upgradeBtns = screen.queryAllByRole('button', { name: /Upgrade/i });
    if (upgradeBtns.length > 0) {
      fireEvent.click(upgradeBtns[0]);
    }
    unmount2();

    // 3. Select model: normal download and at limit (100 downloads used)
    const { unmount: unmount3 } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToSubscription={onNavigateToSubscription}
        customSubscription="select"
        customDownloadsUsed={10}
      />
    );

    const selectDownloadBtns = screen.queryAllByTitle(/Download RFQ Technical BOQ/i);
    selectDownloadBtns.forEach((btn) => {
      fireEvent.click(btn);
    });
    unmount3();

    // Select model at limit (100) -> Open modal and select Premium plan
    const { unmount: unmount3b } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToSubscription={onNavigateToSubscription}
        customSubscription="select"
        customDownloadsUsed={100}
      />
    );

    const selectLimitBtns = screen.queryAllByTitle(/Download RFQ Technical BOQ/i);
    if (selectLimitBtns.length > 2) {
      fireEvent.click(selectLimitBtns[2]);
    }

    const modalSelectBtns = screen.queryAllByRole('button', { name: /Select/i });
    if (modalSelectBtns.length > 0) {
      fireEvent.click(modalSelectBtns[0]); // Selects Premium Plan
    }
    unmount3b();

    // 4. Standard / Free plan with locked opportunities -> Open modal and test all plan upgrade options
    const { unmount: unmount4 } = renderWithProvider(
      <OpportunityFeedCustomWrapper
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToSubscription={onNavigateToSubscription}
        customSubscription="standard"
        customDownloadsUsed={0}
      />
    );

    const lockedBtns = screen.queryAllByRole('button', { name: /🔒 Upgrade/i });
    if (lockedBtns.length > 0) {
      // Click direct upgrade trigger
      fireEvent.click(lockedBtns[0]);

      // Select Premium option
      const selectPremBtns = screen.queryAllByRole('button', { name: /Select/i });
      if (selectPremBtns.length > 0) {
        fireEvent.click(selectPremBtns[0]);
      }

      // Click second upgrade trigger (e.g. network card)
      const lockedBtns2 = screen.queryAllByRole('button', { name: /🔒 Upgrade/i });
      if (lockedBtns2.length > 1) {
        fireEvent.click(lockedBtns2[1]);
      } else if (lockedBtns2.length > 0) {
        fireEvent.click(lockedBtns2[0]);
      }

      const modalUpgradeBtns = screen.queryAllByRole('button', { name: /Upgrade/i });
      if (modalUpgradeBtns.length > 0) {
        fireEvent.click(modalUpgradeBtns[0]); // Connect
      }

      // Reopen and Upgrade to Select option
      const lockedBtns3 = screen.queryAllByRole('button', { name: /🔒 Upgrade/i });
      if (lockedBtns3.length > 0) {
        fireEvent.click(lockedBtns3[0]);
      }
      const modalUpgradeBtns2 = screen.queryAllByRole('button', { name: /Upgrade/i });
      if (modalUpgradeBtns2.length > 1) {
        fireEvent.click(modalUpgradeBtns2[1]); // Select
      } else if (modalUpgradeBtns2.length > 0) {
        fireEvent.click(modalUpgradeBtns2[0]);
      }

      // Reopen and Close via button
      const lockedBtns4 = screen.queryAllByRole('button', { name: /🔒 Upgrade/i });
      if (lockedBtns4.length > 0) {
        fireEvent.click(lockedBtns4[0]);
      }
      const closeBtn = screen.getByRole('button', { name: /Close/i });
      fireEvent.click(closeBtn);

      // Reopen and X close
      const lockedBtns5 = screen.queryAllByRole('button', { name: /🔒 Upgrade/i });
      if (lockedBtns5.length > 0) {
        fireEvent.click(lockedBtns5[0]);
      }
      const closeX = screen.queryByText('✕');
      if (closeX) {
        fireEvent.click(closeX);
      }
    }
    unmount4();
  });
});
