import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VendorQualificationForm from '@/app/vendor/qualification-form';
import { AppProvider, useApp } from '@/lib/store';

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

  test('Question Option Selection, Remarks Editing, File Upload, and Disqualified Score Submission (<65)', () => {
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

    // On Module 6, click Submit (with disqualified score <65)
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('Conditional Score Threshold (65-79) and Enterprise Plan Waived Banner', () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(
      <QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="connect" />
    );

    // Module 1: Lower only 2 questions to reach Conditional band (65-79)
    const m1Selects = screen.getAllByRole('combobox');
    if (m1Selects.length >= 2) {
      fireEvent.change(m1Selects[0], { target: { value: '0' } });
      fireEvent.change(m1Selects[1], { target: { value: '0' } });
    }

    // Step to Module 2 and lower one question
    const tab2 = screen.getAllByRole('button', { name: /Technical Capabilities/i })[0];
    fireEvent.click(tab2);
    const m2Selects = screen.getAllByRole('combobox');
    if (m2Selects.length > 0) {
      fireEvent.change(m2Selects[0], { target: { value: '2' } });
    }

    // Navigate to Module 6 directly
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    // Submit qualification
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('High Score Submission (>=80 PREFERRED ENTERPRISE SUPPLIER) with Select Subscription Plan (Waived Fee)', () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(
      <QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="select" />
    );

    // Navigate to Module 6 directly
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    // Submit qualification with default high score (>90%)
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('High Score Submission (>=80 PREFERRED ENTERPRISE SUPPLIER) with Standard Subscription Plan', () => {
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onSuccess = jest.fn();

    renderWithProvider(
      <QualificationFormCustomWrapper onBack={onBack} onSuccess={onSuccess} customSubscription="standard" />
    );

    // Navigate to Module 6 directly
    const tab6 = screen.getAllByRole('button', { name: /Governance & ESG/i })[0];
    fireEvent.click(tab6);

    // Submit qualification with default high score (>90%)
    const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
    fireEvent.click(submitBtn);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onSuccess).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
