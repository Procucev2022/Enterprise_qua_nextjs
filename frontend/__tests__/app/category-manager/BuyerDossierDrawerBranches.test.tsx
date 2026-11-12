import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BuyerDossierDrawer from '@/app/category-manager/components/BuyerDossierDrawer';
import type { BuyerAccount, RFQItem } from '@/lib/types';
import * as accountDocsClient from '@/lib/accountDocumentsClient';
import * as buyerProfileClient from '@/lib/buyerProfileClient';
import * as categoryTaxonomy from '@/lib/categoryTaxonomy';
import * as documentVaultClient from '@/lib/documentVaultClient';
import * as emailScenarioTemplates from '@/lib/emailScenarioTemplates';
import type { EmailScenarioTemplate } from '@/lib/emailScenarioTemplates';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

jest.mock('@/lib/accountDocumentsClient', () => ({
  createCreditApprovalIdempotencyKey: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
  requestBuyerCreditApproval: jest.fn().mockResolvedValue({ success: true, message: 'Request submitted' }),
  fetchAccountDocuments: jest.fn().mockResolvedValue([]),
  uploadAccountDocument: jest.fn().mockResolvedValue({ success: true }),
  deleteAccountDocument: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerCreditHistory: jest.fn(),
  addBuyerCredit: jest.fn(),
  updateBuyerCategories: jest.fn(),
  fetchBuyerCommunications: jest.fn(),
  fetchBuyerPaymentHistory: jest.fn(),
  recordBuyerCommunication: jest.fn(),
  fetchCategoryTaxonomy: jest.fn().mockResolvedValue({
    success: true,
    data: [
      { majorCategory: 'General Procurement', minorCategories: [] },
      { majorCategory: 'Raw Materials', minorCategories: [] },
      { majorCategory: 'Spares', minorCategories: [] },
      { majorCategory: 'Capital Equipment', minorCategories: [] },
      { majorCategory: 'IT & Telecom', minorCategories: [] },
    ],
  }),
}));

jest.mock('@/lib/internalTaskClient', () => ({
  fetchInternalAssignees: jest.fn().mockResolvedValue({
    assignees: [
      { id: 'exec-1', name: 'Test Assignee', role: 'Category Specialist' },
      { id: 'exec-2', name: 'Second Assignee', role: 'Account Manager' },
    ],
  }),
}));

jest.mock('@/lib/documentVaultClient', () => ({
  fetchDocuments: jest.fn().mockResolvedValue([
    {
      id: 'doc-vault-1',
      documentName: 'Enterprise SLA Contract',
      fileName: 'sla_contract.pdf',
      fileSize: 102400,
      mimeType: 'application/pdf',
      category: 'CONTRACT',
      isActive: true,
    },
    {
      id: 'doc-vault-2',
      documentName: 'Product Rate Card',
      fileName: 'rate_card.pdf',
      fileSize: 204800,
      mimeType: 'application/pdf',
      category: 'PROPOSAL',
      isActive: true,
    },
  ]),
}));

// The real taxonomy and scenario functions stay in place by default. Individual tests override them.
jest.mock('@/lib/categoryTaxonomy', () => {
  const actual = jest.requireActual('@/lib/categoryTaxonomy');
  return { ...actual, getMajorCategories: jest.fn(actual.getMajorCategories) };
});

jest.mock('@/lib/emailScenarioTemplates', () => {
  const actual = jest.requireActual('@/lib/emailScenarioTemplates');
  return {
    ...actual,
    getScenariosForEntityType: jest.fn(actual.getScenariosForEntityType),
    getScenarioForCallOutcome: jest.fn(actual.getScenarioForCallOutcome),
  };
});

const actualCategoryTaxonomy: typeof categoryTaxonomy = jest.requireActual('@/lib/categoryTaxonomy');
const actualEmailScenarioTemplates: typeof emailScenarioTemplates = jest.requireActual('@/lib/emailScenarioTemplates');

const sessionUser = { id: 'session-user-1', name: 'Session Initiator', email: 'initiator@test.invalid' };

const mockBuyer: BuyerAccount = {
  id: 'buyer-test-1',
  organizationName: 'Test Buyer Organization',
  contactPerson: 'Test Contact',
  corporateEmail: 'buyer.contact@test.invalid',
  mobileNumber: '+91 00000 00000',
  city: 'Hyderabad',
  primaryPlantLocation: 'Telangana, India',
  gstin: '36AAAAA0000A1Z5',
  industrySector: 'Information Technology',
  accountSource: 'web_registration',
  sourcingMode: 'mode_1',
  subscriptionPlan: 'free_trial',
  remainingFreeRFQs: 5,
  totalSpend: '₹0',
  totalRFQsCreated: 2,
  status: 'ACTIVE_VERIFIED',
  createdDate: '2026-09-19T05:30:00.000Z',
  syncTimestamp: '2026-10-30 10:00 UTC',
  supportedMajorCategories: ['General Procurement', 'Raw Materials', 'Spares'],
};

const creditSummaryFixture = {
  totalCreditsAllocated: 15,
  totalCreditsConsumed: 2,
  remainingFreeCredits: 5,
  purchasedCredits: 10,
  adjustedCredits: 0,
  currentEntitlementMode: 'mode_1',
  currentSubscriptionPlan: 'free_trial',
};

const paymentSummaryFixture = {
  totalAmountPaid: 0,
  totalSuccessfulPayments: 0,
  pendingPayments: 1,
  failedPayments: 0,
  totalRefundedAmount: 0,
};

const emailCommunication = {
  id: 'comm-1',
  accountId: 'buyer-test-1',
  channel: 'EMAIL',
  subject: 'Enterprise Onboarding Confirmation & API Key Generation',
  sender: 'Onboarding Desk',
  recipient: 'buyer.contact@test.invalid',
  message: 'Welcome to the enterprise network.',
  deliveryStatus: 'Delivered',
  sentAt: '2026-09-19T05:30:00.000Z',
};

const ledgerRowWithoutBalance = {
  id: 'ctx-no-balance',
  transactionId: 'ctx-no-balance',
  transactionDate: '2026-09-19T00:00:00.000Z',
  transactionType: 'Free Credits Allocated',
  creditSource: 'Enterprise Free Trial',
  creditsAdded: 5,
  creditsConsumed: 0,
  previousBalance: 0,
  relatedRfqId: null,
  status: 'COMPLETED',
  description: 'Sign-up grant',
};

// Captured at module load, before any test blanks a string.
const originalText = {
  creditSuccessToast: UI_STRINGS.buyerDirectory.dossier.creditApproval.successToast,
  creditErrorToast: UI_STRINGS.buyerDirectory.dossier.creditApproval.toastError,
};

type DossierSection = 'compose' | 'creditApproval';
const restoreUiStrings: Array<() => void> = [];

// Blanks the named strings so the component falls back to its own literal text. Each blank is undone in afterEach.
const blankDossierStrings = (section: DossierSection, keys: string[]) => {
  const target = UI_STRINGS.buyerDirectory.dossier[section] as unknown as Record<string, string | undefined>;
  keys.forEach((key) => {
    const original = target[key];
    target[key] = '';
    restoreUiStrings.push(() => {
      target[key] = original;
    });
  });
};

describe('BuyerDossierDrawer branch coverage', () => {
  const onCloseMock = jest.fn();
  let sessionSpy: jest.SpyInstance | undefined;

  const signInAs = (user: typeof sessionUser | null) => {
    sessionSpy = jest
      .spyOn(authClient, 'getSessionUser')
      .mockReturnValue(user as unknown as ReturnType<typeof authClient.getSessionUser>);
  };

  const fillCreditRequest = (approver: string) => {
    fireEvent.click(screen.getByText('Add Credit'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    fireEvent.change(document.getElementById('credit-approver') as HTMLInputElement, {
      target: { value: approver },
    });
  };

  const submitCreditForm = () => {
    const form = screen.getByRole('button', { name: /Submit for Approval/i }).closest('form');
    fireEvent.submit(form as HTMLFormElement);
  };

  const openComposeDialog = async (): Promise<HTMLElement> => {
    fireEvent.click(await screen.findByRole('button', { name: /Record Communication/i }));
    const subjectField = await screen.findByPlaceholderText(/Price negotiation|Brief summary/i);
    return subjectField.closest('[role="dialog"]') as HTMLElement;
  };

  const clickComposeButton = (dialog: HTMLElement, label: string) => {
    const match = within(dialog)
      .getAllByRole('button')
      .find((candidate) => candidate.textContent?.trim() === label);
    fireEvent.click(match as HTMLElement);
  };

  const subjectFieldOf = (dialog: HTMLElement) =>
    within(dialog).getByPlaceholderText(/Price negotiation|Brief summary/i) as HTMLInputElement;
  const messageFieldOf = (dialog: HTMLElement) =>
    within(dialog).getByPlaceholderText(/Enter detailed conversation notes|Key details/i) as HTMLTextAreaElement;
  const recipientFieldOf = (dialog: HTMLElement) =>
    within(dialog).getByPlaceholderText(
      UI_STRINGS.buyerDirectory.dossier.compose.recipientPlaceholder
    ) as HTMLInputElement;
  const scenarioSelectOf = (dialog: HTMLElement) =>
    within(dialog).getByText(/Select Conversion Scenario/i).closest('div')?.querySelector('select') as HTMLSelectElement;
  const saveRecordButtonOf = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: /Save & Synchronize Tasks|Save Record/i });
  const followupDateOf = (dialog: HTMLElement) =>
    dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
  const attachFileInputOf = (dialog: HTMLElement) => dialog.querySelector('input[type="file"]') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();

    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: creditSummaryFixture,
      transactions: [],
    });
    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [emailCommunication],
    });
    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: paymentSummaryFixture,
      payments: [],
    });
  });

  afterEach(() => {
    restoreUiStrings.splice(0).reverse().forEach((restore) => restore());
    sessionSpy?.mockRestore();
    sessionSpy = undefined;
    (categoryTaxonomy.getMajorCategories as jest.Mock)
      .mockReset()
      .mockImplementation(actualCategoryTaxonomy.getMajorCategories);
    (emailScenarioTemplates.getScenariosForEntityType as jest.Mock)
      .mockReset()
      .mockImplementation(actualEmailScenarioTemplates.getScenariosForEntityType);
    (emailScenarioTemplates.getScenarioForCallOutcome as jest.Mock)
      .mockReset()
      .mockImplementation(actualEmailScenarioTemplates.getScenarioForCallOutcome);
  });

  describe('category list', () => {
    it('shows the API error when the category list reports a failure', async () => {
      (categoryTaxonomy.getMajorCategories as jest.Mock).mockReturnValueOnce([]);
      (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Category master is offline.',
      });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByText('Edit'));

      expect(await screen.findByText('Category master is offline.')).toBeInTheDocument();
    });

    it('shows the empty-taxonomy message when a failed category list has no error text', async () => {
      (categoryTaxonomy.getMajorCategories as jest.Mock).mockReturnValueOnce([]);
      (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockResolvedValueOnce({ success: false });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByText('Edit'));

      expect(await screen.findByText(UI_STRINGS.buyerProfile.taxonomyEmpty)).toBeInTheDocument();
    });

    it('shows the empty-taxonomy message when the category list request throws', async () => {
      (categoryTaxonomy.getMajorCategories as jest.Mock).mockReturnValueOnce([]);
      (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockRejectedValueOnce(new Error('Socket closed'));
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByText('Edit'));

      expect(await screen.findByText(UI_STRINGS.buyerProfile.taxonomyEmpty)).toBeInTheDocument();
    });

    it('ignores a category list failure that arrives after the dossier has unmounted', async () => {
      const pending: { reject?: (reason: Error) => void } = {};
      (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          pending.reject = reject;
        })
      );
      const { unmount } = render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);
      unmount();

      await act(async () => {
        pending.reject?.(new Error('Request aborted'));
      });

      expect(buyerProfileClient.fetchCategoryTaxonomy).toHaveBeenCalledTimes(1);
    });
  });

  describe('credit ledger', () => {
    it('treats a credit history without a transaction list as an unavailable ledger', async () => {
      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: creditSummaryFixture,
      });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.credit.historyUnavailable)).toBeInTheDocument();
    });

    it('shows a dash for a ledger row without a balance and the remaining credits in the request form', async () => {
      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: creditSummaryFixture,
        transactions: [ledgerRowWithoutBalance],
      });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.credit.totalAllocated)).toBeInTheDocument();
      expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByText('Add Credit'));
      expect(screen.getByText('5 Credits')).toBeInTheDocument();
    });

    it('shows the built-in load message when the credit history reports a failure without an error', async () => {
      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({ success: false });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.credit.loadFailure)).toBeInTheDocument();
    });

    it('shows the built-in payment load message when the payment history reports a failure without an error', async () => {
      (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({ success: false });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="payments" />);

      expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.payments.loadFailure)).toBeInTheDocument();
    });
  });

  describe('add credit request', () => {
    it('shows the built-in labels in the Add Credit form when its strings are empty', async () => {
      blankDossierStrings('creditApproval', [
        'modalTitle',
        'modalSubtitle',
        'buyerNameLabel',
        'availableCreditsLabel',
        'requestedCreditsLabel',
        'initiatorLabel',
        'approverLabel',
        'reasonLabel',
        'reasonPlaceholder',
        'submitBtn',
        'submittingBtn',
      ]);
      signInAs(sessionUser);
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Test Approver');
      expect(screen.getByText('Request Buyer Sourcing Credits')).toBeInTheDocument();
      expect(screen.getByText('Buyer Organization')).toBeInTheDocument();
      expect(screen.getByText('Available Sourcing Credits')).toBeInTheDocument();
      expect(screen.getByText('Assigned Approver')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter business justification...')).toBeInTheDocument();

      submitCreditForm();
      expect(await screen.findByRole('button', { name: 'Submitting Request...' })).toBeInTheDocument();
    });

    it('shows the built-in success text when the approval response has no message', async () => {
      blankDossierStrings('creditApproval', ['toastSuccess', 'successToast']);
      signInAs(sessionUser);
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({ success: true });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Test Approver');
      submitCreditForm();

      expect(
        await screen.findByText(formatString(originalText.creditSuccessToast, { approverName: 'Test Approver' }))
      ).toBeInTheDocument();
    });

    it('shows the built-in failure text when the approval response has no error', async () => {
      blankDossierStrings('creditApproval', ['toastError', 'errorToast']);
      signInAs(sessionUser);
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({ success: false });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Test Approver');
      submitCreditForm();

      expect(await screen.findByText(originalText.creditErrorToast)).toBeInTheDocument();
    });

    it('shows the built-in failure text when the approval request throws', async () => {
      blankDossierStrings('creditApproval', ['toastError', 'errorToast']);
      signInAs(sessionUser);
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network down'));
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Test Approver');
      submitCreditForm();

      expect(await screen.findByText(originalText.creditErrorToast)).toBeInTheDocument();
    });

    it('blocks a credit request when no signed-in user is available', async () => {
      signInAs(null);
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Test Approver');
      submitCreditForm();

      expect(
        await screen.findByText(UI_STRINGS.buyerDirectory.dossier.creditApproval.approverRequired)
      ).toBeInTheDocument();
      expect(accountDocsClient.requestBuyerCreditApproval).not.toHaveBeenCalled();
    });
  });

  describe('communications and compose dialog', () => {
    it('leaves the recipient empty when a call outcome draft is opened for a buyer without an email address', async () => {
      const noEmailBuyer = { ...mockBuyer, corporateEmail: '' };
      render(<BuyerDossierDrawer buyer={noEmailBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      clickComposeButton(dialog, 'Call Log');
      fireEvent.click(within(dialog).getByRole('button', { name: /Draft for Connected/i }));

      expect(recipientFieldOf(dialog).value).toBe('');
      expect(subjectFieldOf(dialog).value).toContain('Discussion Recap & Commercial Proposal');
    });

    it('uses the buyer follow-up scenario when no call outcome scenario matches', async () => {
      (emailScenarioTemplates.getScenarioForCallOutcome as jest.Mock).mockReturnValueOnce(undefined);
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      clickComposeButton(dialog, 'Call Log');
      fireEvent.click(within(dialog).getByRole('button', { name: /Draft for Busy/i }));

      expect(subjectFieldOf(dialog).value).toContain(
        'Procurement Optimization & Commercial Plan for Test Buyer Organization'
      );
    });

    it('keeps the subject unchanged when the matched scenario id is missing from the buyer scenario list', async () => {
      (emailScenarioTemplates.getScenarioForCallOutcome as jest.Mock).mockReturnValueOnce({ id: 'retired_scenario' });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      clickComposeButton(dialog, 'Call Log');
      fireEvent.click(within(dialog).getByRole('button', { name: /Draft for Busy/i }));

      expect(subjectFieldOf(dialog).value).toBe('');
    });

    it('applies a blank-template scenario without filling fields, then attaches vault documents that match its tags', async () => {
      const scenarios: EmailScenarioTemplate[] = [
        {
          id: 'blank_scenario',
          name: 'Blank scenario',
          description: 'Scenario without templates',
          targetCategory: 'BUYER',
          scenarioGroup: 'commercial_pitch',
          subjectTemplate: '',
          bodyTemplate: '',
          suggestedVaultTags: [],
        },
        {
          id: 'vault_scenario',
          name: 'Vault scenario',
          description: 'Scenario that attaches a contract',
          targetCategory: 'BUYER',
          scenarioGroup: 'commercial_pitch',
          subjectTemplate: 'Plan for {companyName}',
          bodyTemplate: 'Hello {contactName}',
          suggestedVaultTags: ['CONTRACT'],
        },
      ];
      (emailScenarioTemplates.getScenariosForEntityType as jest.Mock).mockImplementation(() => scenarios);
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();
      await waitFor(() => expect(documentVaultClient.fetchDocuments).toHaveBeenCalled());
      await act(async () => {});

      fireEvent.change(scenarioSelectOf(dialog), { target: { value: 'blank_scenario' } });
      expect(subjectFieldOf(dialog).value).toBe('');
      expect(within(dialog).queryByText('Enterprise SLA Contract')).not.toBeInTheDocument();

      fireEvent.change(scenarioSelectOf(dialog), { target: { value: 'vault_scenario' } });
      expect(subjectFieldOf(dialog).value).toBe('Plan for Test Buyer Organization');
      expect(await within(dialog).findByText('Enterprise SLA Contract')).toBeInTheDocument();
    });

    it('ignores an empty file selection and saves a local file with no MIME type as octet-stream', async () => {
      const randomUUID = jest
        .spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValue('00000000-0000-4000-8000-0000000000bb');
      (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({ success: true });
      try {
        render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
        const dialog = await openComposeDialog();

        fireEvent.change(attachFileInputOf(dialog), { target: { files: [] } });
        fireEvent.change(attachFileInputOf(dialog), {
          target: { files: [new File(['notes'], 'plain_notes', { type: '' })] },
        });
        expect(await within(dialog).findByText(/plain notes \(Local Upload\)/i)).toBeInTheDocument();

        fireEvent.change(messageFieldOf(dialog), { target: { value: 'Shared the plain notes' } });
        fireEvent.click(saveRecordButtonOf(dialog));

        await waitFor(() => {
          expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledWith(
            mockBuyer.id,
            expect.objectContaining({
              attachments: [
                expect.objectContaining({
                  id: 'local_00000000-0000-4000-8000-0000000000bb',
                  mimeType: 'application/octet-stream',
                }),
              ],
            })
          );
        });
      } finally {
        randomUUID.mockRestore();
      }
    });

    it('sends an empty recipient when the buyer has no email or mobile on file', async () => {
      const noContactBuyer = { ...mockBuyer, corporateEmail: '', mobileNumber: '' };
      (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({ success: true });
      render(<BuyerDossierDrawer buyer={noContactBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      clickComposeButton(dialog, 'Email');
      fireEvent.change(messageFieldOf(dialog), { target: { value: 'No contact on file' } });
      fireEvent.click(saveRecordButtonOf(dialog));

      await waitFor(() => {
        expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledWith(
          noContactBuyer.id,
          expect.objectContaining({ recipient: '' })
        );
      });
    });

    it('shows the built-in success text after a communication without a follow-up date', async () => {
      blankDossierStrings('compose', ['successToast']);
      (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({ success: true });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      fireEvent.change(messageFieldOf(dialog), { target: { value: 'Called the buyer' } });
      fireEvent.click(saveRecordButtonOf(dialog));

      expect(await screen.findByText('Communication recorded and completed task created.')).toBeInTheDocument();
    });

    it('shows the built-in follow-up success text after a communication with a follow-up date', async () => {
      blankDossierStrings('compose', ['successToast']);
      (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({ success: true });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      fireEvent.change(followupDateOf(dialog), { target: { value: '2026-11-10T14:00' } });
      fireEvent.change(messageFieldOf(dialog), { target: { value: 'Follow-up agreed' } });
      fireEvent.click(saveRecordButtonOf(dialog));

      expect(
        await screen.findByText('Communication recorded, completed task created, and follow-up scheduled.')
      ).toBeInTheDocument();
    });

    it('falls back to the default record button label and closes the email dialog on a backdrop click', async () => {
      blankDossierStrings('compose', ['title']);
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);

      expect(await screen.findByRole('button', { name: /Record Communication/i })).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: /View Full Content/i }));
      const emailDialog = (await screen.findByText('Email Dispatch Details')).closest('[role="dialog"]') as HTMLElement;

      fireEvent.click(emailDialog);

      expect(screen.queryByText('Email Dispatch Details')).not.toBeInTheDocument();
    });
  });

  describe('sourcing mode and RFQ labels', () => {
    it('shows a dash for an unknown buyer sourcing mode on the profile and credit tabs', async () => {
      const unknownModeBuyer = {
        ...mockBuyer,
        sourcingMode: 'unknown_mode' as unknown as BuyerAccount['sourcingMode'],
      };
      const { unmount } = render(<BuyerDossierDrawer buyer={unknownModeBuyer} onClose={onCloseMock} />);

      expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);
      unmount();

      render(<BuyerDossierDrawer buyer={unknownModeBuyer} onClose={onCloseMock} initialTab="credits" />);

      expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.credit.totalAllocated)).toBeInTheDocument();
      expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);
    });

    it('shows dashes for an RFQ with no mode, vendor, entity or quote lists when its popup opens', async () => {
      const sparseRfq = {
        id: 'rfq-sparse',
        rfqNumber: 'RFQ-SPARSE-001',
        title: 'Sparse RFQ',
        category: 'General Procurement',
        sourcingMode: 'unknown_mode',
        status: 'Closed',
        budget: 0,
        targetDeliveryDate: '2026-11-20T00:00:00.000Z',
        deliveryLocation: 'Pune, India',
        createdAt: '2026-10-29T10:28:00.000Z',
        chasingActive: false,
      } as unknown as RFQItem;
      render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} buyerRfqs={[sparseRfq]} initialTab="rfqs" />
      );

      expect(screen.getByText('0 assigned / 0 bids')).toBeInTheDocument();
      fireEvent.click(screen.getByTitle('Click to view complete RFQ details popup'));

      expect(screen.getByText('0 vendors / 0 bids')).toBeInTheDocument();
      expect(screen.getByText('Awaiting vendor quotation submissions.')).toBeInTheDocument();
    });
  });

  describe('payments', () => {
    it('shows a dash for a payment without an amount and opens its details without a receipt link', async () => {
      (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: paymentSummaryFixture,
        payments: [
          {
            id: 'pay-unpriced',
            paymentId: 'pay-unpriced',
            invoiceNo: 'INV-UNPRICED-1',
            date: '2026-09-20T10:00:00.000Z',
            description: 'Unpriced batch',
            subscriptionPlan: 'version_3',
            currency: 'INR',
            gateway: 'Zoho Payments (India UPI / NetBanking)',
            paymentMethod: 'UPI / NetBanking',
            status: 'PENDING',
          },
        ],
      });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="payments" />);

      expect(await screen.findByText('INV-UNPRICED-1')).toBeInTheDocument();
      expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: 'Details' }));

      expect(screen.getByText('Channel / Method:')).toBeInTheDocument();
      expect(screen.queryByText('Download Invoice')).not.toBeInTheDocument();
    });
  });
});
