import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ActionCenterComposeModal from '@/app/category-manager/components/ActionCenterComposeModal';
import * as actionCenterCommClient from '@/lib/actionCenterCommClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { DEFAULT_INTERNAL_MEMBERS } from '@/lib/constants';

jest.mock('@/lib/actionCenterCommClient', () => ({
  dispatchActionCenterCommunication: jest.fn(),
}));

describe('ActionCenterComposeModal', () => {
  const strings = UI_STRINGS.actionCenter.communicationModal;
  const mockOnClose = jest.fn();
  const mockOnSuccess = jest.fn();
  const mockDispatch = actionCenterCommClient.dispatchActionCenterCommunication as jest.Mock;

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

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'BOTH',
          recipientEmail: 'accounts@vendor.com',
          recipientPhone: '9876543210',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
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

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'SMS',
          recipientPhone: '9876543210',
          scheduleFollowup: expect.objectContaining({
            assigneeName: 'Assignee',
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
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
});
