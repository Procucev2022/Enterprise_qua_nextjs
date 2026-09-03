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

// These screens now call real backend endpoints (vendor profile, catalogue,
// quotes, RFQ download, PO approval) instead of only touching local state.
// A generic success-shaped mock keeps these smoke tests focused on UI
// behavior without needing a running backend.
function mockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  if (/\/api\/catalogue/.test(url) && method === 'GET') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
  }
  if (url === '/api/catalogue' && method === 'POST') {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: `prod-${Math.random().toString(36).slice(2)}`, ...body } }) });
  }
  if (/\/api\/catalogue\/[^/]+$/.test(url) && (method === 'PUT' || method === 'DELETE')) {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'prod-mock', ...body } }) });
  }
  if (/\/api\/vendors\/[^/]+\/categories$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { clientMappedCategories: [], vendorSelectedCategories: [] } }) });
  }
  if (/\/api\/vendors$/.test(url) && method === 'POST') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-mock-1', name: 'Mock Vendor' } }) });
  }
  if (/\/api\/vendors\/[^/]+$/.test(url)) {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false, error: 'Not found' }) });
  }
  if (/\/api\/rfqs\/[^/]+\/quotes$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  if (/\/api\/rfqs\/[^/]+\/email-preview/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  if (/\/api\/rfqs\/[^/]+\/approve-po$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, poNumber: 'PO-2026-MOCK', issueDate: '2026-09-02', shaSignature: 'a'.repeat(64), lineItems: [] }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
}

describe('Vendor Screens Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(mockFetchImpl) as any;
  });

  describe('ItemCatalogue Screen', () => {
    test('renders catalogue, adds a product, filters category, performs bulk simulation and deletes product', async () => {
      renderWithProvider(<ItemCatalogue />);

      expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
      expect(screen.getByText(/Catalogue Capacity/i)).toBeInTheDocument();

      // Wait for the initial (no-session) catalogue load to settle
      await waitFor(() => expect(screen.queryByText(/Saving\.\.\./i)).not.toBeInTheDocument());

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
      await act(async () => {
        fireEvent.click(addBtn);
      });

      await waitFor(() => expect(screen.getByText(/SKU-CRYO-900/i)).toBeInTheDocument());

      // Category filter dropdown
      const categorySelect = screen.getByRole('combobox');
      fireEvent.change(categorySelect, { target: { value: 'Valves' } });
      fireEvent.change(categorySelect, { target: { value: 'All' } });

      // Test Bulk Excel Import
      const bulkBtn = screen.getByRole('button', { name: /Simulate Bulk Excel Import/i });
      await act(async () => {
        fireEvent.click(bulkBtn);
      });

      // Test Summary filter toggle
      const summaryBtn = screen.getByRole('button', { name: /Summary:/i });
      fireEvent.click(summaryBtn);
      fireEvent.click(summaryBtn);

      // Delete an item
      const deleteBtns = screen.queryAllByTitle(/Delete Product/i);
      if (deleteBtns.length > 0) {
        await act(async () => {
          fireEvent.click(deleteBtns[0]);
        });
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
    test('navigates through 6 module tabs, updates question scores/remarks and submits qualification', async () => {
      jest.useFakeTimers();
      const onBack = jest.fn();
      const onSuccess = jest.fn();

      const { container } = renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

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

      // Attach an evidence file to every question on every tab — submission
      // is now blocked (BUGS.md #50) until all 24 questions have real
      // evidence attached, so a smoke test of the full submit flow needs to
      // actually attach one to each.
      const attachFilesOnCurrentTab = () => {
        const fileInputs = container.querySelectorAll('input[type="file"]');
        fileInputs.forEach((input, idx) => {
          const file = new File(['dummy'], `evidence-${idx}.pdf`, { type: 'application/pdf' });
          fireEvent.change(input, { target: { files: [file] } });
        });
      };
      const moduleTabNames = [
        /1 Commercial Terms/i,
        /2 Technical Capabilities/i,
        /3 Quality & Warranty/i,
        /4 Operational Delivery/i,
        /5 Financial Stability/i,
        /6 Governance & ESG/i,
      ];
      moduleTabNames.forEach((name) => {
        fireEvent.click(screen.getByRole('button', { name }));
        attachFilesOnCurrentTab();
      });

      // Jump directly to Module 6 (already attached above)
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

      // The submit handler's setTimeout callback is now async (it awaits a
      // real fetch), so advancing fake timers must also flush that
      // microtask chain, not just fire the timer synchronously.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      expect(onSuccess).toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('blocks submission when evidence is missing', () => {
      const onBack = jest.fn();
      const onSuccess = jest.fn();
      renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

      // Submit only appears on the last module tab
      fireEvent.click(screen.getByRole('button', { name: /6 Governance & ESG/i }));

      const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
      fireEvent.click(submitBtn);

      expect(onSuccess).not.toHaveBeenCalled();
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
    test('renders all subscription plans, allows switching between models (via dummy payment gateway) and resetting quota', () => {
      jest.useFakeTimers();
      renderWithProvider(<VendorSubscriptionCenter />);

      expect(screen.getByText(/Vendor Subscription Plans & Quotas/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Premium Model/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Connect Model/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Select Model/i)[0]).toBeInTheDocument();

      // Connect/Select are paid tiers — clicking now opens the dummy payment
      // gateway modal rather than switching instantly (BUGS.md #44).
      const connectBtn = screen.getByRole('button', { name: /Switch to Connect Model/i });
      fireEvent.click(connectBtn);
      expect(screen.getByText(/Dummy Payment Gateway/i)).toBeInTheDocument();

      const payBtn = screen.getByRole('button', { name: /Pay \$149/i });
      act(() => {
        fireEvent.click(payBtn);
        jest.advanceTimersByTime(1300);
      });
      expect(screen.queryByText(/Dummy Payment Gateway/i)).not.toBeInTheDocument();

      // Now on Connect — Select is a further upgrade, still paid
      const selectBtn = screen.getByRole('button', { name: /Switch to Select Model/i });
      fireEvent.click(selectBtn);
      expect(screen.getByText(/Dummy Payment Gateway/i)).toBeInTheDocument();
      const payBtn2 = screen.getByRole('button', { name: /Pay \$349/i });
      act(() => {
        fireEvent.click(payBtn2);
        jest.advanceTimersByTime(1300);
      });
      expect(screen.queryByText(/Dummy Payment Gateway/i)).not.toBeInTheDocument();

      // Switch back to Premium — free tier, switches instantly, no gateway
      const premBtn = screen.getByRole('button', { name: /Switch to Premium Model/i });
      fireEvent.click(premBtn);
      expect(screen.queryByText(/Dummy Payment Gateway/i)).not.toBeInTheDocument();

      // Reset Quota Counter
      const resetBtn = screen.getByRole('button', { name: /Reset Quota Counter/i });
      fireEvent.click(resetBtn);
      jest.useRealTimers();
    });
  });
});
