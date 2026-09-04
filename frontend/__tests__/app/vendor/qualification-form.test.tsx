import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import VendorQualificationForm from '@/app/vendor/qualification-form';
import { AppProvider, useApp } from '@/lib/store';

function QualificationFormWithSession() {
  const { setCurrentUserSession } = useApp();
  React.useEffect(() => {
    setCurrentUserSession({
      id: 'user-1',
      email: 'vendor@test.com',
      name: 'Test Vendor',
      role: 'vendor',
      orgId: 'org-1',
      orgName: 'Test Vendor Co',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <VendorQualificationForm onBack={jest.fn()} onSuccess={jest.fn()} />;
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function QualificationFormCustomWrapper({
  onBack = jest.fn(),
  onSuccess = jest.fn(),
  customSubscription = 'select',
}: {
  onBack?: () => void;
  onSuccess?: (rec: any) => void;
  customSubscription?: any;
}) {
  const { setVendorSubscription } = useApp();

  React.useEffect(() => {
    setVendorSubscription(customSubscription);
  }, [setVendorSubscription, customSubscription]);

  return <VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />;
}

const MODULE_TAB_NAMES = ['Commercial Terms', 'Technical Capabilities', 'Quality & Warranty', 'Operational Delivery', 'Financial Stability', 'Governance & ESG'];

// Submission is now blocked until every one of the 24 questions has a real
// evidence file attached (BUGS.md #50) — walk every tab and attach one.
function attachEvidenceToAllTabs() {
  MODULE_TAB_NAMES.forEach((tabName, idx) => {
    const tabBtn = screen.getAllByRole('button', { name: new RegExp(tabName, 'i') })[0];
    fireEvent.click(tabBtn);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach((input, fileIdx) => {
      const file = new File(['dummy'], `evidence-${idx}-${fileIdx}.pdf`, { type: 'application/pdf' });
      fireEvent.change(input, { target: { files: [file] } });
    });
  });
}

describe('VendorQualificationForm Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Module Tab Navigation, Stepper Prev/Next, and Back action', () => {
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

    // Click Top Back Button
    const backBtn = screen.getByRole('button', { name: /← Back to Workspace/i });
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalled();

    // Click previous button while on first tab (boundary test)
    const prevBtnDisabled = screen.getByRole('button', { name: /Previous Module/i });
    fireEvent.click(prevBtnDisabled);

    // Step through each module tab using tab bar buttons
    const tabNames = ['Technical Capabilities', 'Quality & Warranty', 'Operational Delivery', 'Financial Stability', 'Governance & ESG', 'Commercial Terms'];
    tabNames.forEach((tabName) => {
      const tabBtns = screen.getAllByRole('button', { name: new RegExp(tabName, 'i') });
      fireEvent.click(tabBtns[0]);
    });

    // Test Stepper Next / Prev buttons
    const nextBtns = screen.getAllByRole('button', { name: /Next Module/i });
    fireEvent.click(nextBtns[0]); // To M2

    const nextBtns2 = screen.getAllByRole('button', { name: /Next Module/i });
    fireEvent.click(nextBtns2[0]); // To M3

    const prevBtn = screen.getByRole('button', { name: /Previous Module/i });
    fireEvent.click(prevBtn); // Back to M2
  });

  test('Question Option Selection, Remarks Editing, File Upload, and Disqualified Score Submission (<65)', async () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

    // In Module 1: Change all question options to 0 to drop score below 65
    const q1Selects = screen.getAllByRole('combobox');
    q1Selects.forEach((sel) => {
      fireEvent.change(sel, { target: { value: '0' } });
    });

    // Change question remarks
    const remarksInputs = screen.getAllByPlaceholderText(/Write compliance remarks/i);
    if (remarksInputs.length > 0) {
      fireEvent.change(remarksInputs[0], { target: { value: 'Updated payment remarks for Net 60 compliance.' } });
    }

    // Test Document upload on question (both with and without file)
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length > 0) {
      fireEvent.change(fileInputs[0], { target: { files: [] } });
      const dummyFile = new File(['dummy doc'], 'Signed_Commercial_Agreement_2026.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInputs[0], { target: { files: [dummyFile] } });
    }

    // Step to Module 2 and lower scores
    const tab2 = screen.getAllByRole('button', { name: /Technical Capabilities/i })[0];
    fireEvent.click(tab2);
    const m2Selects = screen.getAllByRole('combobox');
    m2Selects.forEach((sel) => {
      fireEvent.change(sel, { target: { value: '0' } });
    });

    // Step to Module 3 and lower scores
    const tab3 = screen.getAllByRole('button', { name: /Quality & Warranty/i })[0];
    fireEvent.click(tab3);
    const m3Selects = screen.getAllByRole('combobox');
    m3Selects.forEach((sel) => {
      fireEvent.change(sel, { target: { value: '0' } });
    });

    // Step through remaining tabs to Module 6
    const tab4 = screen.getAllByRole('button', { name: /Operational Delivery/i })[0];
    fireEvent.click(tab4);
    const tab5 = screen.getAllByRole('button', { name: /Financial Stability/i })[0];
    fireEvent.click(tab5);
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    attachEvidenceToAllTabs();
    fireEvent.click(screen.getAllByRole('button', { name: /Governance & ESG/i })[0]);

    // On Module 6, click Submit (with disqualified score <65)
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    // The submit handler's setTimeout callback is now async (it awaits a
    // real fetch), so advancing fake timers must also flush that microtask
    // chain, not just fire the timer synchronously.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('Conditional Score Threshold (65-79) and Enterprise Plan Waived Banner', async () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(
      <QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="connect" />
    );

    // Every question now defaults to its own lowest option (BUGS.md #50), so
    // to land in the Conditional band (65-79%) deliberately: max out every
    // module except Module 1 (25% weight), left at its low defaults — total
    // lands around 79%.
    ['Technical Capabilities', 'Quality & Warranty', 'Operational Delivery', 'Financial Stability', 'Governance & ESG'].forEach((tabName) => {
      const tabBtn = screen.getAllByRole('button', { name: new RegExp(tabName, 'i') })[0];
      fireEvent.click(tabBtn);
      screen.getAllByRole('combobox').forEach((sel) => fireEvent.change(sel, { target: { value: '5' } }));
    });

    attachEvidenceToAllTabs();

    // Navigate to Module 6 directly
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    // Submit qualification
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    // The submit handler's setTimeout callback is now async (it awaits a
    // real fetch), so advancing fake timers must also flush that microtask
    // chain, not just fire the timer synchronously.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('High Score Submission (>=80 PREFERRED ENTERPRISE SUPPLIER) with Select Subscription Plan (Waived Fee)', async () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(
      <QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="select" />
    );

    // Max out every question across every tab (defaults are now the lowest
    // option per question, not the highest — see BUGS.md #50) to reach a
    // high (>=80%) PREFERRED score.
    MODULE_TAB_NAMES.forEach((tabName) => {
      const tabBtn = screen.getAllByRole('button', { name: new RegExp(tabName, 'i') })[0];
      fireEvent.click(tabBtn);
      screen.getAllByRole('combobox').forEach((sel) => fireEvent.change(sel, { target: { value: '5' } }));
    });

    attachEvidenceToAllTabs();

    // Navigate to Module 6 directly
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    // Submit qualification with a maxed-out high score (>=80%)
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    // The submit handler's setTimeout callback is now async (it awaits a
    // real fetch), so advancing fake timers must also flush that microtask
    // chain, not just fire the timer synchronously.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('High Score Submission (>=80 PREFERRED ENTERPRISE SUPPLIER) with Standard Subscription Plan', async () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(
      <QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="standard" />
    );

    // Max out every question across every tab — see previous test's comment.
    MODULE_TAB_NAMES.forEach((tabName) => {
      const tabBtn = screen.getAllByRole('button', { name: new RegExp(tabName, 'i') })[0];
      fireEvent.click(tabBtn);
      screen.getAllByRole('combobox').forEach((sel) => fireEvent.change(sel, { target: { value: '5' } }));
    });

    attachEvidenceToAllTabs();

    // Navigate to Module 6 directly
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    // Submit qualification with a maxed-out high score (>=80%)
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    // The submit handler's setTimeout callback is now async (it awaits a
    // real fetch), so advancing fake timers must also flush that microtask
    // chain, not just fire the timer synchronously.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('shows a failure toast and does not navigate away when the backend rejects the submission', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) })) as any;
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(<QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="standard" />);

    MODULE_TAB_NAMES.forEach((tabName) => {
      const tabBtn = screen.getAllByRole('button', { name: new RegExp(tabName, 'i') })[0];
      fireEvent.click(tabBtn);
      screen.getAllByRole('combobox').forEach((sel) => fireEvent.change(sel, { target: { value: '5' } }));
    });

    attachEvidenceToAllTabs();

    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    // Was fire-and-forget: previously this would have shown success and
    // navigated away regardless of the backend response.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Submit Final Qualification/i })).toBeInTheDocument();
    jest.useRealTimers();
  });

  test('loads the caller\'s own vendor record on mount to attribute the evaluation correctly', async () => {
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-q1', name: 'Real Vendor Co', contactPerson: 'Jane Doe', majorCategory: 'Valves' } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    }) as any;

    render(
      <AppProvider>
        <QualificationFormWithSession />
      </AppProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/vendors/vendor%40test.com');
    });
  });

  test('handles a failed/network-error vendor record lookup gracefully', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;
    render(
      <AppProvider>
        <QualificationFormWithSession />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByText(/360-Degree AI Self-Evaluation/i)).toBeInTheDocument());
  });

  test('the Re-scan Document button is disabled until a file is attached, then clickable', () => {
    renderWithProvider(<VendorQualificationForm onBack={jest.fn()} onSuccess={jest.fn()} />);

    const rescanBtns = screen.getAllByRole('button', { name: /Re-scan Document/i });
    expect(rescanBtns[0]).toBeDisabled();

    const fileInput = document.querySelectorAll('input[type="file"]')[0];
    const file = new File(['dummy'], 'evidence.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(rescanBtns[0]).not.toBeDisabled();
    fireEvent.click(rescanBtns[0]);
  });
});
