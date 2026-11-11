import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ActionCenterComposeModal from '@/app/category-manager/components/ActionCenterComposeModal';
import * as actionCenterCommClient from '@/lib/actionCenterCommClient';
import { fetchDocuments } from '@/lib/documentVaultClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { DEFAULT_INTERNAL_MEMBERS } from '@/lib/constants';

jest.mock('@/lib/actionCenterCommClient', () => ({
  dispatchActionCenterCommunication: jest.fn(),
}));

jest.mock('@/lib/documentVaultClient', () => ({
  fetchDocuments: jest.fn().mockReturnValue(new Promise(() => {})),
}));

describe('ActionCenterComposeModal', () => {
  const strings = UI_STRINGS.actionCenter.communicationModal;
  const mockOnClose = jest.fn();
  const mockOnSuccess = jest.fn();
  const mockDispatch = actionCenterCommClient.dispatchActionCenterCommunication as jest.Mock;
  const mockFetchDocuments = fetchDocuments as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when isOpen is false', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={false}
        onClose={mockOnClose}
        entityType="internal_task"
        entityId="tsk-101"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with modal header and default EMAIL form fields when isOpen is true', () => {
    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="internal_task"
        entityId="tsk-101"
        defaultRecipientName="Priya Lead"
        defaultRecipientEmail="priya@example.com"
        defaultSubject="Urgent Task"
        defaultMessage="Please complete the RFQ evaluation."
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(strings.modalTitle)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Priya Lead')).toBeInTheDocument();
    expect(screen.getByDisplayValue('priya@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Urgent Task')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Please complete the RFQ evaluation.')).toBeInTheDocument();
  });

  it('allows user to change inputs: recipientName, recipientEmail, recipientPhone, subject, message', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-edit"
        defaultChannel="BOTH"
      />
    );

    const nameInput = container.querySelector('#compose-recipient-name') as HTMLInputElement;
    const emailInput = container.querySelector('#compose-recipient-email') as HTMLInputElement;
    const phoneInput = container.querySelector('#compose-recipient-phone') as HTMLInputElement;
    const subjectInput = container.querySelector('#compose-subject') as HTMLInputElement;
    const messageInput = container.querySelector('#compose-message') as HTMLTextAreaElement;

    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    fireEvent.change(phoneInput, { target: { value: '9876543210' } });
    fireEvent.change(subjectInput, { target: { value: 'New Subject' } });
    fireEvent.change(messageInput, { target: { value: 'New Message' } });

    expect(nameInput.value).toBe('New Name');
    expect(emailInput.value).toBe('new@example.com');
    expect(phoneInput.value).toBe('9876543210');
    expect(subjectInput.value).toBe('New Subject');
    expect(messageInput.value).toBe('New Message');
  });

  it('switches between channels (EMAIL, SMS, BOTH) updating inputs and SMS character counter', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-202"
        defaultChannel="EMAIL"
      />
    );

    // Initial state: EMAIL has email input but no phone input
    expect(container.querySelector('#compose-recipient-email')).toBeInTheDocument();
    expect(container.querySelector('#compose-recipient-phone')).not.toBeInTheDocument();

    // Switch to SMS
    fireEvent.click(screen.getByText(strings.channelSms));
    expect(container.querySelector('#compose-recipient-phone')).toBeInTheDocument();
    expect(container.querySelector('#compose-recipient-email')).not.toBeInTheDocument();
    expect(container.querySelector('#compose-subject')).not.toBeInTheDocument();

    // Verify SMS character count singular
    const textarea = container.querySelector('#compose-message') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Short SMS text' } });
    expect(screen.getByText(/14 characters \(1 SMS unit\)/i)).toBeInTheDocument();

    // Verify SMS character count plural (> 160 chars)
    const longMsg = 'A'.repeat(165);
    fireEvent.change(textarea, { target: { value: longMsg } });
    expect(screen.getByText(/165 characters \(2 SMS units\)/i)).toBeInTheDocument();

    // Switch to BOTH
    fireEvent.click(screen.getByText(strings.channelBoth));
    expect(container.querySelector('#compose-recipient-email')).toBeInTheDocument();
    expect(container.querySelector('#compose-recipient-phone')).toBeInTheDocument();
    expect(container.querySelector('#compose-subject')).toBeInTheDocument();

    // Switch back to EMAIL
    fireEvent.click(screen.getByText(strings.channelEmail));
    expect(container.querySelector('#compose-recipient-email')).toBeInTheDocument();
    expect(container.querySelector('#compose-recipient-phone')).not.toBeInTheDocument();
  });

  it('validates empty message and displays validation error banner', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="approval"
        entityId="appr-303"
        defaultRecipientEmail="approver@example.com"
        defaultMessage=""
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(strings.validationMessageRequired)).toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('validates empty email when channel is EMAIL or BOTH', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="internal_task"
        entityId="tsk-303"
        defaultRecipientEmail=""
        defaultMessage="Task is ready for review"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(strings.validationEmailRequired)).toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('validates empty phone when channel is SMS or BOTH', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="supplier_dossier"
        entityId="sup-55"
        defaultChannel="SMS"
        defaultRecipientPhone=""
        defaultMessage="Supplier document required"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(strings.validationPhoneRequired)).toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('configures schedule follow-up section with date, priority, assignee, and notes', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-44"
        defaultRecipientEmail="buyer@example.com"
        defaultMessage="Credit line reminder"
      />
    );

    const followupCheckbox = screen.getByLabelText(strings.scheduleFollowupCheckbox);
    expect(followupCheckbox).not.toBeChecked();

    fireEvent.click(followupCheckbox);
    expect(followupCheckbox).toBeChecked();

    // Inputs are visible
    const dateInput = container.querySelector('#compose-followup-date') as HTMLInputElement;
    const prioritySelect = container.querySelector('#compose-followup-priority') as HTMLSelectElement;
    const assigneeSelect = container.querySelector('#compose-followup-assignee') as HTMLSelectElement;
    const notesInput = container.querySelector('#compose-followup-notes') as HTMLInputElement;

    fireEvent.change(dateInput, { target: { value: '2026-11-15' } });
    fireEvent.change(prioritySelect, { target: { value: 'High' } });
    if (DEFAULT_INTERNAL_MEMBERS.length > 1) {
      fireEvent.change(assigneeSelect, { target: { value: DEFAULT_INTERNAL_MEMBERS[1].id } });
    }
    fireEvent.change(notesInput, { target: { value: 'Check buyer response on Monday' } });

    expect(dateInput.value).toBe('2026-11-15');
    expect(prioritySelect.value).toBe('High');
    expect(notesInput.value).toBe('Check buyer response on Monday');
  });

  it('submits form successfully, displays toast, calls onSuccess, and closes after delay', async () => {
    jest.useFakeTimers();
    mockDispatch.mockResolvedValueOnce({
      success: true,
      communication: { id: 'comm-999', channel: 'EMAIL' },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
        entityType="ticket"
        entityId="tkt-88"
        defaultRecipientName="Sarah Connor"
        defaultRecipientEmail="sarah@example.com"
        defaultSubject="Resolution Details"
        defaultMessage="We resolved your ticket."
      />
    );

    // Toggle follow-up
    fireEvent.click(screen.getByLabelText(strings.scheduleFollowupCheckbox));
    const dateInput = container.querySelector('#compose-followup-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-11-20' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ticket',
        entityId: 'tkt-88',
        channel: 'EMAIL',
        recipientName: 'Sarah Connor',
        recipientEmail: 'sarah@example.com',
        subject: 'Resolution Details',
        message: 'We resolved your ticket.',
        scheduleFollowup: expect.objectContaining({
          dueDate: '2026-11-20',
          priority: 'Medium',
        }),
      })
    );

    // Toast status shown
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(mockOnSuccess).toHaveBeenCalledTimes(1);

    // Advance timer for auto close
    act(() => {
      jest.advanceTimersByTime(1200);
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('handles submission when channel is BOTH and SMS', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: true,
      communication: { id: 'comm-both', channel: 'BOTH' },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="payment_due"
        entityId="pd-77"
        defaultChannel="BOTH"
        defaultRecipientEmail="accounts@vendor.com"
        defaultRecipientPhone="9876543210"
        defaultMessage="Payment is pending confirmation"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: 'BOTH',
            recipientEmail: 'accounts@vendor.com',
            recipientPhone: '9876543210',
          })
        );
      },
      { timeout: 10000 }
    );

    await waitFor(
      () => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  });

  it('handles submission when channel is SMS with fallback assigneeName', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: true,
      communication: { id: 'comm-sms', channel: 'SMS' },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="payment_due"
        entityId="pd-88"
        defaultChannel="SMS"
        defaultRecipientPhone="9876543210"
        defaultMessage="Payment is pending confirmation"
      />
    );

    // Toggle follow-up without assignedMember match
    fireEvent.click(screen.getByLabelText(strings.scheduleFollowupCheckbox));
    const dateInput = container.querySelector('#compose-followup-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-12-10' } });
    const assigneeSelect = container.querySelector('#compose-followup-assignee') as HTMLSelectElement;
    fireEvent.change(assigneeSelect, { target: { value: 'non-existing-member-id' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: 'SMS',
            recipientPhone: '9876543210',
            scheduleFollowup: expect.objectContaining({
              assigneeName: 'Assignee',
            }),
          })
        );
      },
      { timeout: 10000 }
    );

    await waitFor(
      () => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  });

  it('handles submission error from API result', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: false,
      error: 'Telecom gateway rejected SMS',
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-fail"
        defaultChannel="SMS"
        defaultRecipientPhone="9876543210"
        defaultMessage="Test failure"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
    expect(screen.getByText('Telecom gateway rejected SMS')).toBeInTheDocument();
  });

  it('handles unexpected dispatch exception gracefully', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('Fatal network drop'));

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-exc"
        defaultRecipientEmail="exc@example.com"
        defaultMessage="Test exception"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
    expect(screen.getByText(strings.errorToast)).toBeInTheDocument();
  });

  it('triggers onClose when close icon button and cancel button are clicked', () => {
    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-cancel"
      />
    );

    const cancelButtons = screen.getAllByRole('button', { name: strings.btnCancel });
    expect(cancelButtons).toHaveLength(2);

    fireEvent.click(cancelButtons[0]);
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.click(cancelButtons[1]);
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it('validates empty followupDueDate when scheduleFollowup is enabled', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="internal_task"
        entityId="tsk-due"
        defaultRecipientEmail="test@example.com"
        defaultMessage="Test message"
      />
    );

    fireEvent.click(screen.getByLabelText(strings.scheduleFollowupCheckbox));
    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(strings.validationFollowupDueDateRequired || 'A due date is required when scheduling a follow-up task.')).toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('displays partial delivery banner when one channel succeeds and one fails', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: false,
      emailResult: { success: true },
      smsResult: { success: false, error: 'Network timeout' },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-partial"
        defaultChannel="BOTH"
        defaultRecipientEmail="partial@example.com"
        defaultRecipientPhone="9876543210"
        defaultMessage="Partial test message"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/Partial delivery: Email: Sent \| SMS: Failed \(Network timeout\)/i)).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  });

  it('displays partial delivery banner when SMS succeeds and Email fails without error detail', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: false,
      emailResult: { success: false },
      smsResult: { success: true },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-partial-sms"
        defaultChannel="BOTH"
        defaultRecipientEmail="partial@example.com"
        defaultRecipientPhone="9876543210"
        defaultMessage="Partial test message 2"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/Partial delivery: Email: Failed \(Unsent\) \| SMS: Sent/i)).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  });

  it('displays per-channel error message when all channels fail', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: false,
      emailResult: { success: false, error: 'SMTP connection failed' },
      smsResult: { success: false, error: 'Recipient rate limited' },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="ticket"
        entityId="tkt-all-fail"
        defaultChannel="BOTH"
        defaultRecipientEmail="fail@example.com"
        defaultRecipientPhone="9876543210"
        defaultMessage="Fail test message"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/SMTP connection failed \| Recipient rate limited/i)).toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  });

  it('submits form with EMAIL channel and calls onSuccess and triggers onClose after delay', async () => {
    jest.useFakeTimers();
    mockDispatch.mockResolvedValueOnce({
      success: true,
      communication: { id: 'comm-email', channel: 'EMAIL' },
    });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
        entityType="internal_task"
        entityId="tsk-email"
        defaultChannel="EMAIL"
        defaultRecipientEmail="email@example.com"
        defaultMessage="Email message"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    act(() => {
      jest.advanceTimersByTime(1300);
    });

    expect(mockOnClose).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('allows changing followup priority and adding followup notes', () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="internal_task"
        entityId="tsk-opts"
        defaultRecipientEmail="test@example.com"
        defaultMessage="Test message"
      />
    );

    fireEvent.click(screen.getByLabelText(strings.scheduleFollowupCheckbox));
    const prioritySelect = container.querySelector('#compose-followup-priority') as HTMLSelectElement;
    fireEvent.change(prioritySelect, { target: { value: 'Critical' } });
    expect(prioritySelect.value).toBe('Critical');

    const notesInput = container.querySelector('#compose-followup-notes') as HTMLInputElement;
    fireEvent.change(notesInput, { target: { value: 'Urgent follow-up note' } });
    expect(notesInput.value).toBe('Urgent follow-up note');
  });

  it('displays warning notice and retains modal open when followupError is returned', async () => {
    mockDispatch.mockResolvedValueOnce({
      success: true,
      communication: { id: 'comm-fol-err', channel: 'EMAIL' },
      followupError: 'Assignee queue unavailable',
    });

    const testOnClose = jest.fn();
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={testOnClose}
        onSuccess={mockOnSuccess}
        entityType="internal_task"
        entityId="tsk-fol-err"
        defaultChannel="EMAIL"
        defaultRecipientEmail="email@example.com"
        defaultMessage="Email message"
      />
    );

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText(/Notification was dispatched successfully, but scheduling the follow-up task failed/i)
      ).toBeInTheDocument();
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(testOnClose).not.toHaveBeenCalled();
    });
  });
  it('selects commercial conversion scenarios and call outcome drafts with auto-attachments', async () => {
    const { fetchDocuments } = require('@/lib/documentVaultClient');
    (fetchDocuments as jest.Mock).mockResolvedValueOnce([
      {
        id: 'doc_vault_1',
        documentName: 'Enterprise Sourcing ROI Deck',
        fileName: 'roi.pdf',
        fileSize: 1024000,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        isActive: true,
      },
    ]);

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-test-123"
        defaultRecipientName="Acme Industrial"
        defaultRecipientEmail="procurement@acme.com"
        defaultChannel="EMAIL"
      />
    );

    const scenarioSelect = container.querySelector('#compose-scenario') as HTMLSelectElement;
    expect(scenarioSelect).toBeInTheDocument();

    // Select conversion scenario
    fireEvent.change(scenarioSelect, { target: { value: 'buyer_conversion_followup' } });

    await waitFor(() => {
      const subjectInput = container.querySelector('#compose-subject') as HTMLInputElement;
      expect(subjectInput.value).toContain('Procurement Optimization & Commercial Plan for Acme Industrial');
    });

    // Select call outcome scenario
    fireEvent.change(scenarioSelect, { target: { value: 'buyer_call_outcome_connected' } });

    await waitFor(() => {
      const subjectInput = container.querySelector('#compose-subject') as HTMLInputElement;
      expect(subjectInput.value).toContain('Discussion Recap & Commercial Proposal for Acme Industrial');
    });
  });

  it('supports attaching local files directly and removing attachment chips', async () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-test-123"
        defaultRecipientEmail="procurement@acme.com"
        defaultChannel="EMAIL"
        defaultAttachments={[
          {
            id: 'existing-att-1',
            documentName: 'Initial Spec Sheet',
            fileName: 'spec.pdf',
            category: 'compliance',
          },
        ]}
      />
    );

    expect(screen.getByText('Initial Spec Sheet')).toBeInTheDocument();

    // Attach local file
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      const localFile = new File(['local data'], 'one_off_doc.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [localFile] } });
      await waitFor(() => {
        expect(screen.getByText(/one off doc/i)).toBeInTheDocument();
      });
    }

    // Remove attachment chip
    const removeBtns = screen.getAllByTitle(strings.removeAttachmentTooltip || 'Remove attachment');
    fireEvent.click(removeBtns[0]!);
    expect(screen.queryByText('Initial Spec Sheet')).not.toBeInTheDocument();
  });

  it('interacts with document vault dropdown to attach and detach documents', async () => {
    const mockVaultDocs = [
      {
        id: 'vault-doc-1',
        documentName: 'Enterprise SLA Contract',
        fileName: 'sla_contract.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        category: 'legal_compliance',
        fileUrl: '/docs/sla.pdf',
        isActive: true,
      },
    ];
    mockFetchDocuments.mockResolvedValueOnce(mockVaultDocs);

    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-vault-test"
        defaultRecipientEmail="buyer@example.com"
        defaultChannel="EMAIL"
      />
    );

    const dropdownToggle = screen.getByText('Select from Document Vault...');
    fireEvent.click(dropdownToggle);

    await waitFor(() => {
      expect(screen.getByText('Enterprise SLA Contract')).toBeInTheDocument();
    });

    const docOption = screen.getByText('Enterprise SLA Contract');
    fireEvent.click(docOption);

    await waitFor(() => {
      expect(screen.getAllByText('1 document(s) attached').length).toBeGreaterThan(0);
    });

    const docOptionInDropdown = screen.getAllByText('Enterprise SLA Contract')[0]!;
    fireEvent.click(docOptionInDropdown);
    await waitFor(() => {
      expect(screen.getByText('Select from Document Vault...')).toBeInTheDocument();
    });
  });

  it('renders empty dropdown message when vault has no active documents or fetch rejects', async () => {
    mockFetchDocuments.mockResolvedValueOnce([]);

    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-empty-vault"
        defaultRecipientEmail="empty@example.com"
        defaultChannel="EMAIL"
      />
    );

    fireEvent.click(screen.getByText('Select from Document Vault...'));

    await waitFor(() => {
      expect(screen.getByText('No active documents available in Document Vault.')).toBeInTheDocument();
    });

    mockFetchDocuments.mockRejectedValueOnce(new Error('Network error'));
    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-fail-vault"
        defaultRecipientEmail="fail@example.com"
        defaultChannel="EMAIL"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Select from Document Vault...').length).toBeGreaterThan(0);
    });
  });

  it('initializes with defaultScenarioId and interpolates content on load', async () => {
    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-scenario-init"
        defaultRecipientName="Global Corp"
        defaultRecipientEmail="global@corp.com"
        defaultScenarioId="buyer_call_outcome_no_answer"
        defaultChannel="EMAIL"
      />
    );

    await waitFor(() => {
      const select = container.querySelector('#compose-scenario') as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(select.value).toBe('buyer_call_outcome_no_answer');
    });

    // Change to empty option
    const select = container.querySelector('#compose-scenario') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(select.value).toBe('');

    // Change to custom
    fireEvent.change(select, { target: { value: 'custom' } });
    expect(select.value).toBe('custom');
  });

  it('displays SMS character counter warning when message exceeds 160 characters', () => {
    const longMessage = 'A'.repeat(165);
    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-sms-counter"
        defaultRecipientPhone="9876543210"
        defaultChannel="SMS"
        defaultMessage={longMessage}
      />
    );

    expect(screen.getByText(/165 characters \(2 SMS units\)/i)).toBeInTheDocument();
  });

  it('validates invalid email format and handles scenario selection with fallback tokens and matching vault collateral', async () => {
    const matchingDocs = [
      {
        id: 'vault-marketing-1',
        documentName: 'Enterprise Marketing Deck',
        fileName: 'marketing.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        fileUrl: '/docs/marketing.pdf',
        isActive: true,
      },
    ];
    mockFetchDocuments.mockResolvedValueOnce(matchingDocs);

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-fallback-tokens"
        defaultChannel="EMAIL"
        defaultRecipientName=""
        defaultRecipientEmail="not-an-email"
        defaultMessage="Valid message content"
      />
    );

    // Try submit with invalid email format (missing @)
    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Select scenario when recipientName is empty and matching vault collateral exists
    const select = container.querySelector('#compose-scenario') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'buyer_conversion_followup' } });

    await waitFor(() => {
      const subjectInput = container.querySelector('#compose-subject') as HTMLInputElement;
      expect(subjectInput.value).toContain('Follow-up: Procurement Optimization & Commercial Plan for byr-fallback-tokens');
    });

    // Verify auto-attached document appears
    await waitFor(() => {
      expect(screen.getByText('Enterprise Marketing Deck')).toBeInTheDocument();
    });
  });

  it('submits form with scenario, attachments, and scheduleFollowup without notes', async () => {
    mockDispatch.mockResolvedValueOnce({ success: true });

    const { container } = render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-full-submit"
        defaultChannel="EMAIL"
        defaultRecipientName="Acme Corp"
        defaultRecipientEmail="acme@example.com"
        defaultMessage="Ready to submit"
        defaultScenarioId="buyer_conversion_followup"
        defaultAttachments={[
          {
            id: 'att-1',
            documentName: 'Att Doc',
            fileName: 'doc.pdf',
            category: 'rate_cards',
          },
        ]}
      />
    );

    // Enable followup without notes
    const followupCheckbox = screen.getByRole('checkbox');
    fireEvent.click(followupCheckbox);

    const dateInput = container.querySelector('#compose-followup-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-12-01' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId: 'buyer_conversion_followup',
          attachments: expect.arrayContaining([expect.objectContaining({ id: 'att-1' })]),
          scheduleFollowup: expect.objectContaining({
            dueDate: '2026-12-01',
            notes: undefined,
          }),
        })
      );
    });
  });

  it('calls onClose on backdrop click and Escape without closing on inner clicks', async () => {
    render(
      <ActionCenterComposeModal
        isOpen={true}
        onClose={mockOnClose}
        entityType="buyer_dossier"
        entityId="byr-dismiss"
      />
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByText(strings.modalTitle));
    expect(mockOnClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });
});
