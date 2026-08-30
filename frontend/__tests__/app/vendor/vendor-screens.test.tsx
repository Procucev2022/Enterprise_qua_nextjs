import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ItemCatalogue from '@/app/vendor/item-catalogue';
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import VendorQualificationForm from '@/app/vendor/qualification-form';
import QuotationForm from '@/app/vendor/quotation-form';
import VendorProfilePage from '@/app/vendor/vendor-profile';
import VendorSubscriptionCenter from '@/app/vendor/vendor-subscription';
import { AppProvider, useApp } from '@/lib/store';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

describe('Vendor Screens Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ItemCatalogue Screen', () => {
    test('renders catalogue, adds a product, filters category, performs bulk simulation and deletes product', () => {
      renderWithProvider(<ItemCatalogue />);

      expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
      expect(screen.getByText(/Catalogue Capacity/i)).toBeInTheDocument();

      // Add a product
      const nameInput = screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/i);
      const skuInput = screen.getByPlaceholderText(/^SKU-PUMP-500$/i);
      const priceInput = screen.getByPlaceholderText(/^850$/);
      const leadTimeInput = screen.getByPlaceholderText(/^5$/);
      const moqInput = screen.getByPlaceholderText(/^10$/);

      fireEvent.change(nameInput, { target: { value: 'High Pressure Cryo Valve' } });
      fireEvent.change(skuInput, { target: { value: 'SKU-CRYO-900' } });
      fireEvent.change(priceInput, { target: { value: '1200' } });
      fireEvent.change(leadTimeInput, { target: { value: '7' } });
      fireEvent.change(moqInput, { target: { value: '5' } });

      const addBtn = screen.getByRole('button', { name: /Add Item/i });
      fireEvent.click(addBtn);

      expect(screen.getByText(/SKU-CRYO-900/i)).toBeInTheDocument();

      // Category filter dropdown
      const categorySelect = screen.getByRole('combobox');
      fireEvent.change(categorySelect, { target: { value: 'Valves' } });
      fireEvent.change(categorySelect, { target: { value: 'All' } });

      // Test Bulk Excel Import
      const bulkBtn = screen.getByRole('button', { name: /Simulate Bulk Excel Import/i });
      fireEvent.click(bulkBtn);

      // Test Summary filter toggle
      const summaryBtn = screen.getByRole('button', { name: /Summary:/i });
      fireEvent.click(summaryBtn);
      fireEvent.click(summaryBtn);

      // Delete an item
      const deleteBtns = screen.queryAllByTitle(/Delete Product/i);
      if (deleteBtns.length > 0) {
        fireEvent.click(deleteBtns[0]);
      }
    });
  });

  describe('OpportunityFeed Screen', () => {
    test('renders opportunity feed, handles search, filters, download RFQ, and modal upgrade flows', () => {
      const onBid = jest.fn();
      const onEval = jest.fn();
      const onSub = jest.fn();

      renderWithProvider(
        <OpportunityFeed
          onNavigateToBidForm={onBid}
          onNavigateToEvaluation={onEval}
          onNavigateToSubscription={onSub}
        />
      );

      expect(screen.getByText(/Vendor Workspace & Opportunity Feed/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Apex Supplies Ltd\./i)[0]).toBeInTheDocument();

      // Test search inputs
      const searchInputs = screen.getAllByPlaceholderText(/Specs, location, keywords\.\.\./i);
      if (searchInputs.length > 0) {
        fireEvent.change(searchInputs[0], { target: { value: 'Pumps' } });
        fireEvent.change(searchInputs[0], { target: { value: '' } });
      }

      // Test category dropdowns
      const selects = screen.getAllByRole('combobox');
      if (selects.length > 0) {
        fireEvent.change(selects[0], { target: { value: 'Mechanical & Fluid Equipment' } });
        fireEvent.change(selects[0], { target: { value: 'all' } });
      }

      // Test download RFQ
      const downloadBtns = screen.queryAllByRole('button', { name: /Download RFQ/i });
      if (downloadBtns.length > 0) {
        fireEvent.click(downloadBtns[0]);
      }

      // Test express interest / bid
      const bidBtns = screen.queryAllByRole('button', { name: /Submit Online Bid|Express Interest/i });
      if (bidBtns.length > 0) {
        fireEvent.click(bidBtns[0]);
      }

      // Test self-evaluation banner button
      const evalBtn = screen.getByRole('button', { name: /Start Self-Evaluation|View AI Rating/i });
      fireEvent.click(evalBtn);
      expect(onEval).toHaveBeenCalled();
    });
  });

  describe('VendorQualificationForm Screen', () => {
    test('navigates through 6 module tabs, updates question scores/remarks and submits qualification', () => {
      jest.useFakeTimers();
      const onBack = jest.fn();
      const onSuccess = jest.fn();

      renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

      expect(screen.getByText(/360-Degree AI Self-Evaluation/i)).toBeInTheDocument();
      expect(screen.getByText(/Module 1: Commercial Terms/i)).toBeInTheDocument();

      // Module 1 to Module 2
      const nextBtn = screen.getByRole('button', { name: /Next Module/i });
      fireEvent.click(nextBtn);
      expect(screen.getByText(/Module 2: Technical Capabilities/i)).toBeInTheDocument();

      // Previous button
      const prevBtn = screen.getByRole('button', { name: /Previous Module/i });
      fireEvent.click(prevBtn);
      expect(screen.getByText(/Module 1: Commercial Terms/i)).toBeInTheDocument();

      // Jump directly to Module 6
      const m6Tab = screen.getByRole('button', { name: /6 Governance & ESG/i });
      fireEvent.click(m6Tab);

      // Remarks input
      const remarkInputs = screen.queryAllByPlaceholderText(/Add comments or compliance reference/i);
      if (remarkInputs.length > 0) {
        fireEvent.change(remarkInputs[0], { target: { value: 'Compliant with ISO 14001 ESG' } });
      }

      // Submit Final Qualification
      const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
      fireEvent.click(submitBtn);

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(onSuccess).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('QuotationForm Screen', () => {
    test('renders submitted quotations, downloads RFQ, and interacts with buyer modal', () => {
      const onBack = jest.fn();
      renderWithProvider(<QuotationForm onBack={onBack} />);

      expect(screen.getByText(/Sourcing Enquiries & Quotation Tracking/i)).toBeInTheDocument();
      expect(screen.getAllByText(/RFQs Received/i)[0]).toBeInTheDocument();

      // Test Download RFQ button inside table
      const dlBtns = screen.queryAllByRole('button', { name: /Download RFQ/i });
      if (dlBtns.length > 0) {
        fireEvent.click(dlBtns[0]);
      }

      // Open buyer contact details modal
      const infoBtns = screen.queryAllByTitle(/Buyer Details/i);
      if (infoBtns.length > 0) {
        fireEvent.click(infoBtns[0]);
        expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();

        // Copy button in modal
        const copyBtns = screen.queryAllByRole('button', { name: /Copy/i });
        if (copyBtns.length > 0) {
          fireEvent.click(copyBtns[0]);
        }

        const closeBtns = screen.getAllByRole('button', { name: /Close/i });
        if (closeBtns.length > 0) {
          fireEvent.click(closeBtns[closeBtns.length - 1]);
        }
      }

      const backBtn = screen.getByRole('button', { name: /Back to Opportunity Feed/i });
      fireEvent.click(backBtn);
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('VendorProfilePage Screen', () => {
    test('renders profile form, modifies inputs, toggles categories, and saves vendor profile', () => {
      renderWithProvider(<VendorProfilePage />);

      expect(screen.getByText(/Vendor Supplier Profile/i)).toBeInTheDocument();
      expect(screen.getByText(/Section 1: Supplier Tax & Business Details/i)).toBeInTheDocument();

      // Input changes
      const inputs = screen.getAllByRole('textbox');
      if (inputs.length > 0) {
        fireEvent.change(inputs[0], { target: { value: 'Apex Global Supplies Ltd.' } });
      }

      // Save profile
      const saveBtn = screen.getAllByRole('button', { name: /Save Supplier Profile|Save & Reconcile/i })[0];
      fireEvent.click(saveBtn);
    });
  });

  describe('VendorSubscriptionCenter Screen', () => {
    test('renders all subscription plans, allows switching between models and resetting quota', () => {
      renderWithProvider(<VendorSubscriptionCenter />);

      expect(screen.getByText(/Vendor Subscription Plans & Quotas/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Premium Model/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Connect Model/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Select Model/i)[0]).toBeInTheDocument();

      // Switch to Connect Model
      const connectBtn = screen.getByRole('button', { name: /Switch to Connect Model/i });
      fireEvent.click(connectBtn);

      // Switch to Select Model
      const selectBtn = screen.getByRole('button', { name: /Switch to Select Model/i });
      fireEvent.click(selectBtn);

      // Switch to Premium Model
      const premBtn = screen.getByRole('button', { name: /Switch to Premium Model/i });
      fireEvent.click(premBtn);

      // Reset Quota Counter
      const resetBtn = screen.getByRole('button', { name: /Reset Quota Counter/i });
      fireEvent.click(resetBtn);
    });
  });
});
