import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuyerConsole from '@/app/category-manager/buyer-console';
import VendorConsole from '@/app/category-manager/vendor-console';
import { AppProvider } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';

/**
 * Regression coverage for the Category Manager drill-down override bug.
 *
 * Previously the context dropdown unconditionally won over the manual
 * "Hide Details" toggle, so an explicitly collapsed detail panel was
 * immediately re-expanded and could never be dismissed.
 */

const BUYER_COMPANY_LT = 'Larsen & Toubro Ltd. (L&T)';
const BUYER_COMPANY_RIL = 'Reliance Industries Ltd. (RIL)';
const BUYER_ID_RAJESH = 'buyer-1';
const BUYER_ID_SUNITA = 'buyer-2';

const VENDOR_COMPANY_APEX = 'Apex Supplies Ltd.';
const VENDOR_COMPANY_KIRAN = 'Kiran Valve Industries';
const VENDOR_ID_APEX = 'vendor-1';
const VENDOR_ID_KIRAN = 'vendor-2';

const BUYER_PANEL_HEADING = /Sourcing Details for/i;
const VENDOR_PANEL_HEADING = /Sourcing Bid Roster for/i;

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

/** [companySelect, contextSelect] in DOM order within the selector bar. */
function getSelectors(): HTMLSelectElement[] {
  return screen.getAllByRole('combobox') as HTMLSelectElement[];
}

function selectContext(companyValue: string, contextValue: string) {
  const [companySelect] = getSelectors();
  fireEvent.change(companySelect, { target: { value: companyValue } });
  // The dependent dropdown is only enabled once a company is chosen.
  const contextSelect = getSelectors()[1];
  fireEvent.change(contextSelect, { target: { value: contextValue } });
}

function getToggleButton(expandLabel: string) {
  return screen.getByRole('button', {
    name: new RegExp(`${UI_STRINGS.actions.hideDetails}|${expandLabel}`, 'i'),
  });
}

describe('Category Manager drill-down collapse precedence', () => {
  describe('BuyerConsole (Screen 2.3)', () => {
    const expandLabel = UI_STRINGS.actions.reviewRfqDetails;

    async function renderBuyerConsole() {
      const onNavigateToMatrix = jest.fn();
      const onNavigateToEvaluation = jest.fn();
      renderWithProvider(
        <BuyerConsole onNavigateToMatrix={onNavigateToMatrix} onNavigateToEvaluation={onNavigateToEvaluation} />
      );
      await waitFor(() => {
        expect(screen.getByText(/Buyer Wise Command Console & Analytics/i)).toBeInTheDocument();
      });
    }

    test('dropdown selection expands the drill-down panel', async () => {
      await renderBuyerConsole();

      expect(screen.queryByText(BUYER_PANEL_HEADING)).not.toBeInTheDocument();

      selectContext(BUYER_COMPANY_LT, BUYER_ID_RAJESH);

      expect(screen.getByText(BUYER_PANEL_HEADING)).toBeInTheDocument();
    });

    test('toggle label reflects dropdown-driven expansion so a single click collapses', async () => {
      await renderBuyerConsole();

      selectContext(BUYER_COMPANY_LT, BUYER_ID_RAJESH);

      // The card toggle must advertise the panel as open, not offer to re-open it.
      const toggle = getToggleButton(expandLabel);
      expect(toggle).toHaveTextContent(UI_STRINGS.actions.hideDetails);

      fireEvent.click(toggle);

      expect(screen.queryByText(BUYER_PANEL_HEADING)).not.toBeInTheDocument();
    });

    test('manual collapse survives an unchanged dropdown selection', async () => {
      await renderBuyerConsole();

      selectContext(BUYER_COMPANY_LT, BUYER_ID_RAJESH);
      fireEvent.click(getToggleButton(expandLabel));

      expect(screen.queryByText(BUYER_PANEL_HEADING)).not.toBeInTheDocument();

      // Re-applying the same dropdown value must not resurrect the panel.
      const contextSelect = getSelectors()[1];
      fireEvent.change(contextSelect, { target: { value: BUYER_ID_RAJESH } });

      expect(screen.queryByText(BUYER_PANEL_HEADING)).not.toBeInTheDocument();
    });

    test('manual collapse survives a changed dropdown selection', async () => {
      await renderBuyerConsole();

      selectContext(BUYER_COMPANY_LT, BUYER_ID_RAJESH);
      fireEvent.click(getToggleButton(expandLabel));

      selectContext(BUYER_COMPANY_RIL, BUYER_ID_SUNITA);

      expect(screen.queryByText(BUYER_PANEL_HEADING)).not.toBeInTheDocument();
    });

    test('explicit expand after dismissal re-opens the panel', async () => {
      await renderBuyerConsole();

      selectContext(BUYER_COMPANY_LT, BUYER_ID_RAJESH);
      fireEvent.click(getToggleButton(expandLabel));

      const reopenToggle = getToggleButton(expandLabel);
      expect(reopenToggle).toHaveTextContent(expandLabel);

      fireEvent.click(reopenToggle);

      expect(screen.getByText(BUYER_PANEL_HEADING)).toBeInTheDocument();
    });

    test('manual expand and collapse works without any dropdown selection', async () => {
      await renderBuyerConsole();

      const toggles = screen.getAllByRole('button', { name: new RegExp(expandLabel, 'i') });
      fireEvent.click(toggles[0]);
      expect(screen.getByText(BUYER_PANEL_HEADING)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: new RegExp(UI_STRINGS.actions.hideDetails, 'i') }));
      expect(screen.queryByText(BUYER_PANEL_HEADING)).not.toBeInTheDocument();
    });
  });

  describe('VendorConsole (Screen 2.5)', () => {
    const expandLabel = UI_STRINGS.actions.reviewVendorPerformance;

    async function renderVendorConsole() {
      const onNavigateToMatrix = jest.fn();
      renderWithProvider(<VendorConsole onNavigateToMatrix={onNavigateToMatrix} />);
      await waitFor(() => {
        expect(screen.getByText(/Vendor Summary & Performance Analytics/i)).toBeInTheDocument();
      });
    }

    test('dropdown selection expands the drill-down panel', async () => {
      await renderVendorConsole();

      expect(screen.queryByText(VENDOR_PANEL_HEADING)).not.toBeInTheDocument();

      selectContext(VENDOR_COMPANY_APEX, VENDOR_ID_APEX);

      expect(screen.getByText(VENDOR_PANEL_HEADING)).toBeInTheDocument();
    });

    test('toggle label reflects dropdown-driven expansion so a single click collapses', async () => {
      await renderVendorConsole();

      selectContext(VENDOR_COMPANY_APEX, VENDOR_ID_APEX);

      const toggle = getToggleButton(expandLabel);
      expect(toggle).toHaveTextContent(UI_STRINGS.actions.hideDetails);

      fireEvent.click(toggle);

      expect(screen.queryByText(VENDOR_PANEL_HEADING)).not.toBeInTheDocument();
    });

    test('manual collapse survives a changed dropdown selection', async () => {
      await renderVendorConsole();

      selectContext(VENDOR_COMPANY_APEX, VENDOR_ID_APEX);
      fireEvent.click(getToggleButton(expandLabel));

      selectContext(VENDOR_COMPANY_KIRAN, VENDOR_ID_KIRAN);

      expect(screen.queryByText(VENDOR_PANEL_HEADING)).not.toBeInTheDocument();
    });

    test('explicit expand after dismissal re-opens the panel', async () => {
      await renderVendorConsole();

      selectContext(VENDOR_COMPANY_APEX, VENDOR_ID_APEX);
      fireEvent.click(getToggleButton(expandLabel));

      const reopenToggle = getToggleButton(expandLabel);
      expect(reopenToggle).toHaveTextContent(expandLabel);

      fireEvent.click(reopenToggle);

      expect(screen.getByText(VENDOR_PANEL_HEADING)).toBeInTheDocument();
    });

    test('manual expand and collapse works without any dropdown selection', async () => {
      await renderVendorConsole();

      const toggles = screen.getAllByRole('button', { name: new RegExp(expandLabel, 'i') });
      fireEvent.click(toggles[0]);
      expect(screen.getByText(VENDOR_PANEL_HEADING)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: new RegExp(UI_STRINGS.actions.hideDetails, 'i') }));
      expect(screen.queryByText(VENDOR_PANEL_HEADING)).not.toBeInTheDocument();
    });
  });
});
