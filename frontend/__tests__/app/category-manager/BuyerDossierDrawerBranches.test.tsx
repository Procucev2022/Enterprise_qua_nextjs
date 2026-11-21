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

jest.setTimeout(35000);

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
  fetchBuyerUploadedVendors: jest.fn().mockResolvedValue({ success: true, data: [] }),
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

jest.mock('@/lib/approvalClient', () => ({
  fetchApprovalUsers: jest.fn().mockResolvedValue({
    users: [
      { id: 'usr-govardhan', name: 'Govardhan', email: 'govardhan@procucev.com' },
      { id: 'usr-krishna', name: 'Krishna', email: 'krishna@procucev.com' },
      { id: 'session-user-1', name: 'Session Initiator', email: 'initiator@example.com' },
      { id: 'usr-buyer-001', name: 'Test Buyer', email: 'test.buyer@example.com' },
    ],
  }),
  fetchApprovalApprovers: jest.fn().mockResolvedValue({
    approvers: [
      { id: 'appr-srinu', name: 'Srinu Sir', title: 'VP Sourcing' },
      { id: 'appr-rao', name: 'Rao Sir', title: 'Director' },
      { id: 'appr-sudheer', name: 'Sudheer Sir', title: 'Head of Procurement' },
      { id: 'appr-test', name: 'Test Approver', title: 'Approver' },
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
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
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
    (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  afterEach(() => {
    restoreUiStrings.splice(0).reverse().forEach((restore) => restore());
    sessionSpy?.mockRestore();
    sessionSpy = undefined;
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock)
      .mockReset()
      .mockResolvedValue({ success: true, message: 'Request submitted' });
    (categoryTaxonomy.getMajorCategories as jest.Mock)
      .mockReset()
      .mockImplementation(actualCategoryTaxonomy.getMajorCategories);
    (emailScenarioTemplates.getScenariosForEntityType as jest.Mock)
      .mockReset()
      .mockImplementation(actualEmailScenarioTemplates.getScenariosForEntityType);
    (emailScenarioTemplates.getScenarioForCallOutcome as jest.Mock)
      .mockReset()
      .mockImplementation(actualEmailScenarioTemplates.getScenarioForCallOutcome);
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock)
      .mockReset()
      .mockResolvedValue({ success: true, message: 'Request submitted' });
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

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
      expect(screen.getByText('5 Credits')).toBeInTheDocument();
    });

    it('shows available credits from buyer remainingFreeRFQs and loads credit history when opened from the profile tab', async () => {
      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: creditSummaryFixture,
        transactions: [],
      });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="profile" />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
      expect(screen.getByText('5 Credits')).toBeInTheDocument();
      expect(buyerProfileClient.fetchBuyerCreditHistory).toHaveBeenCalledWith(mockBuyer.id);
    });

    it('falls back to 0 credits if buyer has no remainingFreeRFQs and creditSummary is not yet loaded', async () => {
      const buyerWithoutCredits = { ...mockBuyer, remainingFreeRFQs: undefined as any };
      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
      render(<BuyerDossierDrawer buyer={buyerWithoutCredits} onClose={onCloseMock} initialTab="profile" />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
      expect(screen.getByText('0 Credits')).toBeInTheDocument();
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
        'types',
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
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockReturnValueOnce(new Promise(() => { }));
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Srinu Sir');
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
      expect(screen.getByText('Buyer Organization')).toBeInTheDocument();
      expect(screen.getByText('Requested Credits')).toBeInTheDocument();
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

      fillCreditRequest('Srinu Sir');
      submitCreditForm();

      expect(
        await screen.findByText(formatString(originalText.creditSuccessToast, { approverName: 'Srinu Sir' }))
      ).toBeInTheDocument();
    });

    it('shows the built-in failure text when the approval response has no error', async () => {
      blankDossierStrings('creditApproval', ['toastError', 'errorToast']);
      signInAs(sessionUser);
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({ success: false });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Srinu Sir');
      submitCreditForm();

      expect(await screen.findByText(originalText.creditErrorToast)).toBeInTheDocument();
    });

    it('shows the built-in failure text when the approval request throws', async () => {
      blankDossierStrings('creditApproval', ['toastError', 'errorToast']);
      signInAs(sessionUser);
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network down'));
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Srinu Sir');
      submitCreditForm();

      expect(await screen.findByText(originalText.creditErrorToast)).toBeInTheDocument();
    });

    it('blocks a credit request when no signed-in user is available', async () => {
      signInAs(null);
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fillCreditRequest('Srinu Sir');
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
      await act(async () => { });

      fireEvent.change(scenarioSelectOf(dialog), { target: { value: 'blank_scenario' } });
      expect(subjectFieldOf(dialog).value).toBe('');
      expect(within(dialog).queryByText('Enterprise SLA Contract')).not.toBeInTheDocument();

      fireEvent.change(scenarioSelectOf(dialog), { target: { value: 'vault_scenario' } });
      expect(subjectFieldOf(dialog).value).toBe('Plan for Test Buyer Organization');
      expect(await within(dialog).findByText('Enterprise SLA Contract')).toBeInTheDocument();
    });

    it('shows a vault load failure in the attachments section and keeps the dialog usable', async () => {
      (documentVaultClient.fetchDocuments as jest.Mock).mockRejectedValueOnce(new Error('Vault service unavailable'));
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      expect(await within(dialog).findByText(UI_STRINGS.buyerDirectory.dossier.vaultLoadFailed)).toBeInTheDocument();
      expect(within(dialog).getByText('Vault service unavailable')).toBeInTheDocument();

      // The rest of the dialog still works, and a local file can still be attached.
      fireEvent.change(subjectFieldOf(dialog), { target: { value: 'Still usable' } });
      expect(subjectFieldOf(dialog).value).toBe('Still usable');
      expect(within(dialog).getByText('Attach Local File')).toBeInTheDocument();
    });

    it('uses the built-in network message when the vault failure carries no reason', async () => {
      (documentVaultClient.fetchDocuments as jest.Mock).mockRejectedValueOnce('offline');
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      expect(await within(dialog).findByText(UI_STRINGS.buyerDirectory.dossier.vaultLoadFailed)).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          UI_STRINGS.dataLoad.networkFailed.replace('{resource}', UI_STRINGS.dataLoad.resources.documentVault)
        )
      ).toBeInTheDocument();
    });

    it('does not show a vault failure when the document list loads', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);
      const dialog = await openComposeDialog();

      await waitFor(() => expect(documentVaultClient.fetchDocuments).toHaveBeenCalled());
      await act(async () => { });
      expect(within(dialog).queryByText(UI_STRINGS.buyerDirectory.dossier.vaultLoadFailed)).not.toBeInTheDocument();
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

  describe('offline payment workflow branches', () => {
    it('exercises offline payments modal open, switching payment types, transaction ID visibility and Cash mode clearing', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

      expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();
      expect(screen.getByDisplayValue(mockBuyer.organizationName)).toBeInTheDocument();

      const typeSelect = document.getElementById('offline-payment-type-select') as HTMLSelectElement;
      expect(typeSelect).toBeInTheDocument();
      expect(typeSelect.value).toBe('NEFT / RTGS');

      // NEFT / RTGS requires transaction ID
      let txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
      expect(txInput).toBeInTheDocument();
      fireEvent.change(txInput, { target: { value: 'NEFT-12345678' } });
      expect(txInput.value).toBe('NEFT-12345678');

      // Switch to Cheque
      fireEvent.change(typeSelect, { target: { value: 'Cheque' } });
      expect(typeSelect.value).toBe('Cheque');
      txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
      expect(txInput).toBeInTheDocument();
      fireEvent.change(txInput, { target: { value: 'CHQ-555666' } });

      // Switch to UPI
      fireEvent.change(typeSelect, { target: { value: 'UPI' } });
      expect(typeSelect.value).toBe('UPI');
      txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
      expect(txInput).toBeInTheDocument();
      fireEvent.change(txInput, { target: { value: 'UPI-9876543210@okaxis' } });

      // Switch to Cash - Transaction ID is hidden and cleared
      fireEvent.change(typeSelect, { target: { value: 'Cash' } });
      expect(typeSelect.value).toBe('Cash');
      expect(document.getElementById('offline-transaction-id')).toBeNull();

      // Switch back to NEFT / RTGS - Transaction ID reappears empty
      fireEvent.change(typeSelect, { target: { value: 'NEFT / RTGS' } });
      txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
      expect(txInput).toBeInTheDocument();
      expect(txInput.value).toBe('');

      // Test sourcing mode change
      const modeSelect = document.getElementById('offline-sourcing-mode-select') as HTMLSelectElement;
      expect(modeSelect).toBeInTheDocument();
      fireEvent.change(modeSelect, { target: { value: 'Mode 3' } });
      expect(modeSelect.value).toBe('Mode 3');

      // Test cancel button closes modal
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Request Offline Payment Approval')).toBeNull();
    });

    it('handles payment proof file upload (valid image, invalid extension, oversized, and remove)', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

      const fileInput = screen.getByTestId('offline-proof-file-input') as HTMLInputElement;

      // 1. Invalid file format (e.g. PDF or EXE)
      const invalidFile = new File(['dummy content'], 'report.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });
      expect(screen.getByText('Please upload an image file in JPG, JPEG, or PNG format.')).toBeInTheDocument();

      // 2. Oversized file (> 10MB)
      const hugeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [hugeFile] } });
      expect(screen.getByText('Payment proof file must be smaller than 10MB.')).toBeInTheDocument();

      // 3. Valid JPG file
      const validFile = new File(['valid-image-bytes'], 'receipt.jpg', { type: 'image/jpeg' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      expect(await screen.findByText('receipt.jpg')).toBeInTheDocument();

      // 4. Remove file
      const removeBtn = screen.getByRole('button', { name: 'Remove' });
      fireEvent.click(removeBtn);
      expect(screen.queryByText('receipt.jpg')).toBeNull();

      // 5. Replace file button click
      const validPng = new File(['png-bytes'], 'payment_proof.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [validPng] } });
      expect(await screen.findByText('payment_proof.png')).toBeInTheDocument();
      const replaceBtn = screen.getByRole('button', { name: 'Replace File' });
      fireEvent.click(replaceBtn);
    });

    it('validates mandatory fields and handles submission errors and success for Offline Payments', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

      const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
      const typeSelect = document.getElementById('offline-payment-type-select') as HTMLSelectElement;
      const initiatorInput = document.getElementById('offline-initiator-select') as HTMLInputElement;
      const approverInput = document.getElementById('offline-approver-select') as HTMLInputElement;
      const remarksTextarea = screen.getByPlaceholderText(/Reason \/ remarks for offline payment/i);
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });
      const form = submitBtn.closest('form') as HTMLFormElement;

      // Fill valid amount
      fireEvent.change(amountInput, { target: { value: '45000' } });

      // Missing transaction ID for NEFT / RTGS
      fireEvent.submit(form);
      expect(screen.getByText(/Transaction ID is mandatory for NEFT \/ RTGS/i)).toBeInTheDocument();

      // Select Cash payment type (no transaction id required)
      fireEvent.change(typeSelect, { target: { value: 'Cash' } });
      fireEvent.change(initiatorInput, { target: { value: 'Govardhan' } });
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
      fireEvent.change(remarksTextarea, { target: { value: 'Direct cash deposit at counter' } });

      // Mock API error response
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Cash receipt verification required',
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Cash receipt verification required')).toBeInTheDocument();
      });

      // Mock network exception
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network drop'));
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit offline payment approval request.')).toBeInTheDocument();
      });

      // Successful Cash submission
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Offline payment submitted successfully for cash approval.',
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Offline payment submitted successfully for cash approval.')).toBeInTheDocument();
      });
      expect(screen.queryByText('Request Offline Payment Approval')).toBeNull();
    });
  });

  describe('buyer uploaded vendors tab branches', () => {
    const sampleUploadedVendors = [
      {
        id: 'uv-1',
        name: 'Apex Industrial Spares',
        companyName: 'Apex Spares Pvt Ltd',
        contactPerson: 'Arun Verma',
        email: 'arun@apex.com',
        phone: '+919876543210',
        createdAt: '2026-10-15T10:00:00.000Z',
        status: 'ACTIVE',
        location: 'Pune, Maharashtra',
        gstin: '27AAAAA0000A1Z5',
        pan: 'AAAAA0000A',
        category: 'Spares',
        source: 'PO Dump Upload',
      },
      {
        id: 'uv-2',
        name: 'Zenith Fasteners',
        companyName: 'Zenith Fasteners Ltd',
        contactPerson: 'Prakash Rao',
        email: 'prakash@zenith.com',
        phone: '+919876543211',
        createdAt: '2026-10-18T10:00:00.000Z',
        status: 'INACTIVE',
      },
    ];

    it('renders uploaded vendors table, filters by search & status, opens modal and closes it', async () => {
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: sampleUploadedVendors,
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="uploaded-vendors" />);

      expect(await screen.findByText('Apex Industrial Spares')).toBeInTheDocument();
      expect(screen.getByText('Zenith Fasteners')).toBeInTheDocument();

      // Search filter
      const searchInput = screen.getByPlaceholderText(/Search uploaded vendors/i);
      fireEvent.change(searchInput, { target: { value: 'Apex' } });
      expect(screen.getByText('Apex Industrial Spares')).toBeInTheDocument();
      expect(screen.queryByText('Zenith Fasteners')).toBeNull();
      fireEvent.change(searchInput, { target: { value: '' } });

      // Status filter
      const statusSelect = screen.getByRole('combobox', { name: 'Filter by vendor status' });
      fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });
      expect(screen.getByText('Apex Industrial Spares')).toBeInTheDocument();
      expect(screen.queryByText('Zenith Fasteners')).toBeNull();
      fireEvent.change(statusSelect, { target: { value: 'ALL' } });

      // Click View Details on first vendor
      const viewDetailsBtns = screen.getAllByRole('button', { name: /View Details/i });
      fireEvent.click(viewDetailsBtns[0]);

      expect(screen.getByText('Vendor Profile Details')).toBeInTheDocument();
      expect(screen.getByText('Pune, Maharashtra')).toBeInTheDocument();
      expect(screen.getByText('27AAAAA0000A1Z5')).toBeInTheDocument();

      // Close modal
      const closeBtn = screen.getAllByRole('button', { name: 'Close' })[0];
      fireEvent.click(closeBtn);
      expect(screen.queryByText('Vendor Profile Details')).toBeNull();
    });

    it('displays error message and handles retry when fetching uploaded vendors fails', async () => {
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Database connection failed while loading vendors',
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="uploaded-vendors" />);

      expect(await screen.findByText('Database connection failed while loading vendors')).toBeInTheDocument();

      // Click Retry
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: sampleUploadedVendors,
      });
      const retryBtns = screen.getAllByRole('button', { name: 'Retry' });
      fireEvent.click(retryBtns[retryBtns.length - 1]);

      expect(await screen.findByText('Apex Industrial Spares')).toBeInTheDocument();
    });
  });

  describe('offline payment validation error branches', () => {
    it('validates missing payment date, missing transaction ID, missing initiator and missing approver', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

      const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
      const typeSelect = document.getElementById('offline-payment-type-select') as HTMLSelectElement;
      const txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
      const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
      const initiatorSelect = document.getElementById('offline-initiator-select') as HTMLSelectElement;
      const approverSelect = document.getElementById('offline-approver-select') as HTMLSelectElement;
      const form = amountInput.closest('form') as HTMLFormElement;

      // 1. Missing date
      fireEvent.change(dateInput, { target: { value: '' } });
      fireEvent.submit(form);
      expect(screen.getByText('Payment date is mandatory.')).toBeInTheDocument();
      fireEvent.change(dateInput, { target: { value: '2026-11-19' } });

      // 2. Missing transaction ID for NEFT / RTGS
      fireEvent.change(amountInput, { target: { value: '15000' } });
      fireEvent.change(txInput, { target: { value: '' } });
      fireEvent.submit(form);
      expect(screen.getByText(/Transaction ID is mandatory for NEFT \/ RTGS\./i)).toBeInTheDocument();
      fireEvent.change(txInput, { target: { value: 'TXN-998877' } });

      // 3. Amount <= 0
      fireEvent.change(amountInput, { target: { value: '0' } });
      fireEvent.submit(form);
      expect(screen.getByText('Please enter a valid payment amount greater than 0.')).toBeInTheDocument();
      fireEvent.change(amountInput, { target: { value: '25000' } });

      // 4. Missing initiator
      fireEvent.change(initiatorSelect, { target: { value: '' } });
      fireEvent.submit(form);
      expect(screen.getByText('Initiated by user is mandatory.')).toBeInTheDocument();
      fireEvent.change(initiatorSelect, { target: { value: 'Krishna Chaitanya' } });

      // 5. Missing approver
      fireEvent.change(approverSelect, { target: { value: '' } });
      fireEvent.submit(form);
      expect(screen.getByText('Assigned approver is mandatory.')).toBeInTheDocument();
      fireEvent.change(approverSelect, { target: { value: 'Srinu Sir' } });

      // 6. API error without error message
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit offline payment approval request.')).toBeInTheDocument();
      });
    });

    it('covers trial period validation error branches and date range mismatch', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Periods' }));

      // Advance from step 1 to step 2 by selecting a mode button
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));

      // Find form and inputs
      const daysInput = document.getElementById('trial-days-input') as HTMLInputElement;
      const startInput = document.getElementById('trial-start-date') as HTMLInputElement;
      const endInput = document.getElementById('trial-end-date') as HTMLInputElement;
      const form = daysInput.closest('form') as HTMLFormElement;

      // 1. trialDays <= 0
      fireEvent.change(daysInput, { target: { value: '0' } });
      fireEvent.submit(form);
      expect(screen.getByText('Please enter a valid trial extension period (1-365 days).')).toBeInTheDocument();

      // 2. trialDays > 365
      fireEvent.change(daysInput, { target: { value: '400' } });
      fireEvent.submit(form);
      expect(screen.getByText('Please enter a valid trial extension period (1-365 days).')).toBeInTheDocument();

      // 3. start date after end date (calcDays <= 0)
      fireEvent.change(daysInput, { target: { value: '10' } });
      fireEvent.change(startInput, { target: { value: '2026-11-20' } });
      fireEvent.change(endInput, { target: { value: '2026-11-10' } });
      fireEvent.submit(form);
      expect(screen.getAllByText('Ending date cannot be earlier than starting date.').length).toBeGreaterThanOrEqual(1);

      // 4. days mismatch with date range
      fireEvent.change(startInput, { target: { value: '2026-11-01' } });
      fireEvent.change(endInput, { target: { value: '2026-11-11' } }); // 10 days
      fireEvent.change(daysInput, { target: { value: '15' } }); // mismatch with 10 days
      fireEvent.submit(form);
      expect(screen.getAllByText(/The entered number of days \(15\) does not match the selected date range/i).length).toBeGreaterThanOrEqual(1);

      // Test date handlers with start date only (empty end date)
      fireEvent.change(endInput, { target: { value: '' } });
      fireEvent.change(startInput, { target: { value: '2026-11-05' } });

      // Test matching days
      fireEvent.change(endInput, { target: { value: '2026-11-15' } }); // 10 days
      fireEvent.change(daysInput, { target: { value: '10' } });

      // Test back button to step 1
      fireEvent.click(screen.getByRole('button', { name: /Back/i }));
      expect(screen.getByText('Select Sourcing Mode')).toBeInTheDocument();
      // Select Mode 2
      fireEvent.click(screen.getByRole('button', { name: /Mode 2/i }));

      // 5. Successful submission with valid values and approver
      const daysInput2 = document.getElementById('trial-days-input') as HTMLInputElement;
      fireEvent.change(daysInput2, { target: { value: '10' } });
      const approverInput = document.getElementById('trial-approver') as HTMLInputElement;
      if (approverInput) {
        fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
      }
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Trial period approval request submitted successfully',
      });
      fireEvent.submit(daysInput2.closest('form') as HTMLFormElement);
      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
      });
    });

    it('covers buyer credit deletion amount validation and balance check', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Deletion' }));

      const amountInput = screen.getByRole('spinbutton');
      const form = amountInput.closest('form') as HTMLFormElement;

      // 1. Amount <= 0
      fireEvent.change(amountInput, { target: { value: '0' } });
      fireEvent.submit(form);
      expect(screen.getByText(/valid credit amount greater than 0/i)).toBeInTheDocument();

      // 2. Amount > available balance
      fireEvent.change(amountInput, { target: { value: '999999' } });
      fireEvent.submit(form);
      expect(screen.getByText(/Cannot deduct 999999 credits\. Available balance is/i)).toBeInTheDocument();
    });

    it('covers complete discount approval 3-step workflow through submission and back navigation', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      // Open Discounts workflow
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));

      // Step 1: Select Mode 1
      expect(screen.getByText('Step 1 of 3: Select sourcing mode for discount request.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));

      // Step 2: Select 12 Months
      expect(screen.getByText(/Step 2 of 3: Select billing duration for Mode 1/)).toBeInTheDocument();
      // Test back button from step 2 to step 1
      fireEvent.click(screen.getByRole('button', { name: /Back/i }));
      expect(screen.getByText('Step 1 of 3: Select sourcing mode for discount request.')).toBeInTheDocument();

      // Now select Mode 2
      fireEvent.click(screen.getByRole('button', { name: /Mode 2/i }));
      // Select 6 Months
      fireEvent.click(screen.getAllByText('6 Months')[0]);

      // Step 3: Breakdown table, discount %, approver
      expect(screen.getByText('Price Breakdown')).toBeInTheDocument();
      // Back button from step 3 to step 2
      fireEvent.click(screen.getByRole('button', { name: /Back/i }));
      expect(screen.getByText(/Step 2 of 3: Select billing duration for Mode 2/)).toBeInTheDocument();

      // Select 12 Months
      fireEvent.click(screen.getAllByText('12 Months')[0]);

      // Enter discount percentage
      const discountInput = screen.getByRole('spinbutton');
      fireEvent.change(discountInput, { target: { value: '15' } });

      // Enter approver
      const approverInput = document.getElementById('discount-approver') as HTMLInputElement;
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

      // Enter remarks
      const remarksInput = screen.getByPlaceholderText(/Reason for discount request/i);
      fireEvent.change(remarksInput, { target: { value: 'Annual enterprise volume discount' } });

      const form = discountInput.closest('form') as HTMLFormElement;
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Discount approval request submitted successfully',
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
      });
    });

    it('covers discount submission failure and error response', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 3/i }));
      fireEvent.click(screen.getAllByText('12 Months')[0]);

      const discountInput = screen.getByRole('spinbutton');
      fireEvent.change(discountInput, { target: { value: '20' } });
      const approverInput = document.getElementById('discount-approver') as HTMLInputElement;
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

      const form = discountInput.closest('form') as HTMLFormElement;
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Discount limit exceeded for tier',
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Discount limit exceeded for tier')).toBeInTheDocument();
      });

      // Also test thrown exception
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network error on discount'));
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit discount approval request.')).toBeInTheDocument();
      });
    });

    it('covers discount workflow modal cancellation at steps 1, 2, and 3', () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      // Open Discounts workflow
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));

      // Cancel at step 1
      const cancelBtnStep1 = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtnStep1);
      expect(screen.queryByText('Select Sourcing Mode')).not.toBeInTheDocument();

      // Open again and close with X at step 1
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      const closeBtnStep1 = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtnStep1);
      expect(screen.queryByText('Select Sourcing Mode')).not.toBeInTheDocument();

      // Open again, advance to step 2, close with X
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));
      const closeBtnStep2 = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtnStep2);
      expect(screen.queryByText(/Select Billing Duration/)).not.toBeInTheDocument();

      // Open again, advance to step 3, cancel
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));
      fireEvent.click(screen.getAllByText('12 Months')[0]);
      const cancelBtnStep3 = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtnStep3);
      expect(screen.queryByText('Price Breakdown')).not.toBeInTheDocument();
    });

    it('covers trial period submission failure, exception, and empty success message fallback', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Periods' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));

      const daysInput = document.getElementById('trial-days-input') as HTMLInputElement;
      fireEvent.change(daysInput, { target: { value: '14' } });
      const approverInput = document.getElementById('trial-approver') as HTMLInputElement;
      if (approverInput) {
        fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
      }

      const form = daysInput.closest('form') as HTMLFormElement;

      // 1. Failure without custom error
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit trial period approval request.')).toBeInTheDocument();
      });

      // 2. Exception thrown
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network trial error'));
      fireEvent.submit(form);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit trial period approval request.')).toBeInTheDocument();
      });

      // 3. Success without message (uses template)
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
      });
    });

    it('covers discount submission success without custom message (template fallback)', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));
      fireEvent.click(screen.getAllByText('12 Months')[0]);

      const discountInput = screen.getByRole('spinbutton');
      fireEvent.change(discountInput, { target: { value: '10' } });
      const approverInput = document.getElementById('discount-approver') as HTMLInputElement;
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

      const form = discountInput.closest('form') as HTMLFormElement;
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
      });
    });

    it('covers offline payment proof file validation, preview, and removal with mocked FileReader', async () => {
      // Mock FileReader
      const origFileReader = global.FileReader;
      class MockFileReader {
        onload: (() => void) | null = null;
        result: string = 'data:image/png;base64,mockpreviewdata';
        readAsDataURL() {
          if (this.onload) {
            this.onload();
          }
        }
      }
      global.FileReader = MockFileReader as any;

      try {
        render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

        fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

        const fileInput = screen.getByTestId('offline-proof-file-input') as HTMLInputElement;

        // 1. Invalid file format
        const invalidFile = new File(['hello'], 'doc.pdf', { type: 'application/pdf' });
        fireEvent.change(fileInput, { target: { files: [invalidFile] } });
        expect(screen.getByText(/Please upload an image file in JPG, JPEG, or PNG format/i)).toBeInTheDocument();

        // 2. Oversized file (> 10MB)
        const bigFile = new File(['x'.repeat(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
        Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 });
        fireEvent.change(fileInput, { target: { files: [bigFile] } });
        expect(screen.getByText(/Payment proof file must be smaller than 10MB/i)).toBeInTheDocument();

        // 3. Valid file with preview
        const validFile = new File(['valid-image-content'], 'receipt.png', { type: 'image/png' });
        fireEvent.change(fileInput, { target: { files: [validFile] } });

        await waitFor(() => {
          expect(screen.getByAltText('Payment Proof Preview')).toBeInTheDocument();
        });
        expect(screen.getByText('receipt.png')).toBeInTheDocument();
        expect(screen.getByText('Replace File')).toBeInTheDocument();
        expect(screen.getByText('Remove')).toBeInTheDocument();

        // 4. Click Remove file
        fireEvent.click(screen.getByText('Remove'));
        expect(screen.queryByAltText('Payment Proof Preview')).not.toBeInTheDocument();

        // 5. Submit cash payment
        const typeSelect = document.getElementById('offline-payment-type-select') as HTMLSelectElement;
        fireEvent.change(typeSelect, { target: { value: 'Cash' } });

        const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
        fireEvent.change(dateInput, { target: { value: '2026-11-20' } });

        const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
        fireEvent.change(amountInput, { target: { value: '50000' } });

        const initiatorSelect = document.getElementById('offline-initiator-select') as HTMLSelectElement;
        fireEvent.change(initiatorSelect, { target: { value: 'Krishna Chaitanya' } });

        const approverSelect = document.getElementById('offline-approver-select') as HTMLSelectElement;
        fireEvent.change(approverSelect, { target: { value: 'Srinu Sir' } });

        const form = amountInput.closest('form') as HTMLFormElement;
        (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
          success: true,
          message: 'Cash offline payment request submitted successfully',
        });
        fireEvent.submit(form);
        await waitFor(() => {
          expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
        });
      } finally {
        global.FileReader = origFileReader;
      }
    });

    it('covers standard credit addition workflow through submission and backdrop dismissal', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      // Open Buyer Credit Addition
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));

      const amountInput = screen.getByRole('spinbutton');
      fireEvent.change(amountInput, { target: { value: '50' } });

      const approverInput = document.getElementById('credit-approver') as HTMLInputElement;
      if (approverInput) {
        fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
      }

      const form = amountInput.closest('form') as HTMLFormElement;
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Credit addition request submitted successfully',
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
      });
    });

    it('renders uploaded vendors table with fallback empty values, search filter, status filter, and vendor detail modal', async () => {
      const vendorList = [
        {
          id: 'v-empty-1',
          name: 'Zero Tech',
          companyName: 'Zero Systems',
          contactPerson: 'Alex Doe',
          email: 'alex@zero.com',
          phone: '9112233445',
          createdAt: '',
          status: 'PENDING',
          location: 'Bangalore',
          gstin: '29ABCDE1234F1Z5',
          pan: 'ABCDE1234F',
          majorCategory: 'Industrial Machinery',
        },
        {
          id: 'v-active-2',
          name: 'Active Supplier',
          companyName: 'Active Corp',
          contactPerson: 'Manager Bob',
          email: 'bob@corp.com',
          phone: '9876543210',
          createdAt: '2026-11-01T10:00:00Z',
          status: 'ACTIVE',
          city: 'Mumbai',
          gst: '27XYZAB9999K1Z1',
          pan: 'XYZAB9999K',
          majorCategory: 'Raw Materials',
        },
      ];

      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
        success: true,
        data: vendorList,
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="uploaded-vendors" />);

      await waitFor(() => {
        expect(screen.getByText('Active Supplier')).toBeInTheDocument();
      });

      expect(screen.getByText('Active Corp')).toBeInTheDocument();
      expect(screen.getAllByText('ACTIVE').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(1);

      // Search by phone
      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: '9876543210' } });
      expect(screen.getByText('Active Supplier')).toBeInTheDocument();
      expect(screen.queryByText('Zero Tech')).not.toBeInTheDocument();

      // Search by email
      fireEvent.change(searchInput, { target: { value: 'alex@zero.com' } });
      expect(screen.getByText('Zero Tech')).toBeInTheDocument();
      expect(screen.queryByText('Active Supplier')).not.toBeInTheDocument();

      // Search by contactPerson
      fireEvent.change(searchInput, { target: { value: 'Manager Bob' } });
      expect(screen.getByText('Active Supplier')).toBeInTheDocument();
      expect(screen.queryByText('Zero Tech')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Test status filter select
      const statusSelect = screen.getByDisplayValue(/All Statuses|ALL/i) as HTMLSelectElement;
      if (statusSelect) {
        fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });
        expect(screen.getByText('Active Supplier')).toBeInTheDocument();
        expect(screen.queryByText('Zero Tech')).not.toBeInTheDocument();

        fireEvent.change(statusSelect, { target: { value: 'PENDING' } });
        expect(screen.getByText('Zero Tech')).toBeInTheDocument();
        expect(screen.queryByText('Active Supplier')).not.toBeInTheDocument();

        fireEvent.change(statusSelect, { target: { value: 'ALL' } });
      }

      // Click "View Details" button for the first vendor
      const viewButtons = screen.getAllByRole('button', { name: /View Details/i });
      fireEvent.click(viewButtons[0]);
      await waitFor(() => {
        expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument();
      });
      expect(screen.getByText('ABCDE1234F')).toBeInTheDocument();
      expect(screen.getByText('Bangalore')).toBeInTheDocument();
      expect(screen.getByText('Industrial Machinery')).toBeInTheDocument();

      // Close modal by clicking backdrop
      const modalBackdrop = screen.getByText('29ABCDE1234F1Z5').closest('.fixed') as HTMLElement;
      if (modalBackdrop) {
        fireEvent.click(modalBackdrop);
      }
    });

    it('covers payment transactions table, search, filter, sort, export, and payment details modal in subscriptions tab', async () => {
      const mockPayments = [
        {
          id: 'pay-1',
          paymentId: 'PAY-001',
          invoiceNo: 'INV-2026-001',
          amount: 150000,
          description: 'Annual Enterprise Subscription Mode 1',
          subscriptionPlan: 'Mode 1 Annual',
          gateway: 'Razorpay',
          paymentMethod: 'NEFT',
          status: 'PAID',
          transactionDate: '2026-11-01T10:00:00Z',
          receiptUrl: 'https://example.com/receipt-001.pdf',
        },
        {
          id: 'pay-2',
          paymentId: 'PAY-002',
          invoiceNo: 'INV-2026-002',
          amount: 'non-numeric' as any,
          description: 'Trial Period Topup',
          subscriptionPlan: 'Ad-hoc',
          gateway: 'Cash',
          paymentMethod: '',
          status: 'PENDING',
          date: '2026-10-15T09:00:00Z',
          receiptUrl: null,
        },
        {
          id: 'pay-3',
          paymentId: 'PAY-003',
          invoiceNo: 'INV-2026-003',
          amount: 50000,
          description: 'Monthly Sourcing Plan',
          subscriptionPlan: 'Mode 2 Monthly',
          gateway: 'Stripe',
          paymentMethod: 'Credit Card',
          status: 'FAILED',
          date: '2026-09-01T08:00:00Z',
          receiptUrl: null,
        },
      ];

      (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: { totalSpent: 200000, lastPaymentDate: '2026-11-01', activePlan: 'Mode 1 Annual' },
        payments: mockPayments,
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="payments" />);

      await waitFor(() => {
        expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
      });

      expect(screen.getByText('INV-2026-002')).toBeInTheDocument();
      expect(screen.getByText('INV-2026-003')).toBeInTheDocument();

      // Search in payments
      const searchInputs = screen.getAllByPlaceholderText(/search/i);
      const paymentSearch = searchInputs[searchInputs.length - 1];
      if (paymentSearch) {
        fireEvent.change(paymentSearch, { target: { value: 'INV-2026-001' } });
        expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
        expect(screen.queryByText('INV-2026-002')).not.toBeInTheDocument();
        fireEvent.change(paymentSearch, { target: { value: '' } });
      }

      // Filter by status
      const paymentStatusSelect = screen.getByDisplayValue(/All Statuses|All/i) as HTMLSelectElement;
      if (paymentStatusSelect) {
        fireEvent.change(paymentStatusSelect, { target: { value: 'PAID' } });
        expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
        expect(screen.queryByText('INV-2026-003')).not.toBeInTheDocument();

        fireEvent.change(paymentStatusSelect, { target: { value: 'FAILED' } });
        expect(screen.getByText('INV-2026-003')).toBeInTheDocument();
        expect(screen.queryByText('INV-2026-001')).not.toBeInTheDocument();

        fireEvent.change(paymentStatusSelect, { target: { value: 'all' } });
      }

      // Toggle sort
      const sortBtn = screen.getByRole('button', { name: /Oldest First|Newest First/i });
      if (sortBtn) {
        fireEvent.click(sortBtn);
      }

      // Export CSV
      const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
      if (exportBtn) {
        fireEvent.click(exportBtn);
      }

      // Open details modal for first payment (has receiptUrl)
      const pay1Row = screen.getByText('INV-2026-001').closest('tr');
      const pay1DetailBtn = within(pay1Row!).getByRole('button', { name: /Details/i });
      fireEvent.click(pay1DetailBtn);

      await waitFor(() => {
        expect(screen.getByText('Payment Record Details')).toBeInTheDocument();
      });
      expect(screen.getAllByText('Annual Enterprise Subscription Mode 1').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Download Invoice')).toBeInTheDocument();

      // Close modal with Close button
      const closeButtons = screen.getAllByRole('button', { name: /Close/i });
      const closeBtn = closeButtons.find((b) => b.textContent?.trim() === 'Close');
      if (closeBtn) fireEvent.click(closeBtn);
      expect(screen.queryByText('Payment Record Details')).not.toBeInTheDocument();

      // Open details modal for second payment (no receiptUrl)
      const pay2Row = screen.getByText('INV-2026-002').closest('tr');
      const pay2DetailBtn = within(pay2Row!).getByRole('button', { name: /Details/i });
      fireEvent.click(pay2DetailBtn);
      await waitFor(() => {
        expect(screen.getByText('Payment Record Details')).toBeInTheDocument();
      });
      expect(screen.getAllByText('Trial Period Topup').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Download Invoice')).not.toBeInTheDocument();

      // Close via backdrop click
      const modalBackdrop = screen.getByText('Payment Record Details').closest('.fixed') as HTMLElement;
      if (modalBackdrop) fireEvent.click(modalBackdrop);
    });

    it('covers trial period date error handling when end date is earlier than start date and user changes days', () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Periods' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));

      const daysInput = document.getElementById('trial-days-input') as HTMLInputElement;
      const startInput = document.getElementById('trial-start-date') as HTMLInputElement;
      const endInput = document.getElementById('trial-end-date') as HTMLInputElement;

      // Set start date > end date
      fireEvent.change(startInput, { target: { value: '2026-11-20' } });
      fireEvent.change(endInput, { target: { value: '2026-11-10' } });

      // Change trialDays while calcDays <= 0 (triggers branch 529)
      fireEvent.change(daysInput, { target: { value: '15' } });
      expect(screen.getAllByText('Ending date cannot be earlier than starting date.').length).toBeGreaterThanOrEqual(1);

      // Set valid date range and matching days (triggers branch 531)
      fireEvent.change(startInput, { target: { value: '2026-11-01' } });
      fireEvent.change(endInput, { target: { value: '2026-11-11' } });
      fireEvent.change(daysInput, { target: { value: '10' } });
      expect(screen.queryByText('Ending date cannot be earlier than starting date.')).not.toBeInTheDocument();
    });

    it('covers offline payment submit error handling, template fallback, and exception catch', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

      const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2026-11-20' } });
      const typeSelect = document.getElementById('offline-payment-type-select') as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: 'Cash' } });
      const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
      fireEvent.change(amountInput, { target: { value: '10000' } });
      const initiatorSelect = document.getElementById('offline-initiator-select') as HTMLSelectElement;
      fireEvent.change(initiatorSelect, { target: { value: 'Krishna Chaitanya' } });
      const approverSelect = document.getElementById('offline-approver-select') as HTMLSelectElement;
      fireEvent.change(approverSelect, { target: { value: 'Srinu Sir' } });

      const form = amountInput.closest('form') as HTMLFormElement;

      // 1. Success without message (template fallback at line 930)
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
      });
      fireEvent.submit(form);
      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
      });

      // 2. Exception thrown (catch branch at line 947)
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));
      const amountInput2 = document.getElementById('offline-payment-amount') as HTMLInputElement;
      fireEvent.change(amountInput2, { target: { value: '10000' } });
      const typeSelect2 = document.getElementById('offline-payment-type-select') as HTMLSelectElement;
      fireEvent.change(typeSelect2, { target: { value: 'Cash' } });
      const form2 = amountInput2.closest('form') as HTMLFormElement;

      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network offline error'));
      fireEvent.submit(form2);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit offline payment approval request.')).toBeInTheDocument();
      });
    });

    it('covers credit transaction history search, type filter, and sort toggle', async () => {
      const mockCreditTransactions = [
        {
          id: 'ctx-1',
          transactionId: 'TXN-901',
          transactionDate: '2026-11-01T00:00:00.000Z',
          transactionType: 'Free Credits Allocated',
          creditSource: 'Enterprise Plan',
          creditsAdded: 10,
          creditsConsumed: 0,
          previousBalance: 0,
          relatedRfqId: 'RFQ-SPEC-001',
          status: 'COMPLETED',
          description: 'Special RFQ credit grant',
        },
        {
          id: 'ctx-2',
          transactionId: 'TXN-902',
          transactionDate: '2026-11-15T00:00:00.000Z',
          transactionType: 'Credit Deduction',
          creditSource: 'RFQ Consumption',
          creditsAdded: 0,
          creditsConsumed: 2,
          previousBalance: 10,
          relatedRfqId: null,
          status: 'COMPLETED',
          description: 'Debit for live bidding',
        },
      ];

      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: creditSummaryFixture,
        transactions: mockCreditTransactions,
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      await waitFor(() => {
        expect(screen.getByText('TXN-901')).toBeInTheDocument();
      });
      expect(screen.getByText('TXN-902')).toBeInTheDocument();

      // Search by relatedRfqId
      const searchInputs = screen.getAllByPlaceholderText(/search/i);
      const creditSearchInput = searchInputs[0];
      fireEvent.change(creditSearchInput, { target: { value: 'RFQ-SPEC-001' } });
      expect(screen.getByText('TXN-901')).toBeInTheDocument();
      expect(screen.queryByText('TXN-902')).not.toBeInTheDocument();

      // Search by description
      fireEvent.change(creditSearchInput, { target: { value: 'Debit' } });
      expect(screen.getByText('TXN-902')).toBeInTheDocument();
      expect(screen.queryByText('TXN-901')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(creditSearchInput, { target: { value: '' } });

      // Filter by type
      const typeSelect = screen.getByDisplayValue(/All Transaction Types|all/i) as HTMLSelectElement;
      if (typeSelect) {
        fireEvent.change(typeSelect, { target: { value: 'Free Credits Allocated' } });
        expect(screen.getByText('TXN-901')).toBeInTheDocument();
        expect(screen.queryByText('TXN-902')).not.toBeInTheDocument();

        fireEvent.change(typeSelect, { target: { value: 'all' } });
      }

      // Toggle sort
      const sortBtn = screen.getByRole('button', { name: /Sort|Newest|Oldest/i });
      if (sortBtn) {
        fireEvent.click(sortBtn);
      }

      // Export Credit CSV
      const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
      if (exportBtn) {
        fireEvent.click(exportBtn);
      }
    });

    it('handles keyboard escape dismissals for modals, dropdowns, and drawer', () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} />);

      // 1. Dropdown open -> Escape closes dropdown
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      expect(screen.getByRole('menuitem', { name: 'Discounts' })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('menuitem', { name: 'Discounts' })).not.toBeInTheDocument();

      // 2. Add credit modal open -> Escape closes modal
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
      expect(screen.getByRole('spinbutton')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

      // 3. No submodal open -> Escape triggers onClose
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCloseMock).toHaveBeenCalled();
    });

    it('covers RFQs tab list rendering, budget variations, and RFQ detail modal', async () => {
      const mockRfqs: any[] = [
        {
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-001',
          sourcingMode: 'mode_1',
          status: 'ACTIVE',
          title: 'High Precision CNC Milling Parts',
          budget: 500000,
          deliveryLocation: 'Hyderabad, India',
          targetDeliveryDate: '2026-12-01T00:00:00Z',
          assignedVendors: ['v-1', 'v-2'],
          quotes: [{ id: 'q-1', vendorName: 'Apex Precision', quoteAmount: 480000, submittedDate: '2026-11-15' }],
          extractedEntities: [{ itemName: 'SS 316', technicalSpecs: 'High Grade' }],
        },
        {
          id: 'rfq-2',
          rfqNumber: 'RFQ-2026-002',
          sourcingMode: 'mode_2',
          status: 'DRAFT',
          title: 'Standard Bearings',
          budget: 0,
          deliveryLocation: '',
          targetDeliveryDate: '',
          assignedVendors: [],
          quotes: [],
          extractedEntities: [],
        },
      ];

      render(<BuyerDossierDrawer buyer={mockBuyer} buyerRfqs={mockRfqs} onClose={onCloseMock} initialTab="rfqs" />);

      expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();
      expect(screen.getByText('RFQ-2026-002')).toBeInTheDocument();

      // Open details modal for RFQ 1
      fireEvent.click(screen.getByRole('button', { name: 'RFQ-2026-001' }));

      await waitFor(() => {
        expect(screen.getAllByText('High Precision CNC Milling Parts').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText('SS 316')).toBeInTheDocument();
      expect(screen.getByText('Apex Precision')).toBeInTheDocument();

      // Close modal with close button
      const closeButtons = screen.getAllByRole('button');
      const modalClose = closeButtons.find((b) => b.getAttribute('aria-label') === 'Close' || b.textContent === '✕');
      if (modalClose) fireEvent.click(modalClose);

      // Open details modal for RFQ 2 (budget = 0, quotes = 0)
      fireEvent.click(screen.getByRole('button', { name: 'RFQ-2026-002' }));

      await waitFor(() => {
        expect(screen.getAllByText('Standard Bearings').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText('Open Budget')).toBeInTheDocument();

      // Close modal with backdrop click
      const modalBackdrop = screen.getAllByText('Standard Bearings')[0].closest('.fixed') as HTMLElement;
      if (modalBackdrop) fireEvent.click(modalBackdrop);
    });

    it('covers communications subtabs, search, and email details modal', async () => {
      const mockComms: any[] = [
        {
          id: 'c-email-1',
          channel: 'EMAIL',
          subject: 'RFQ Quote Update',
          recipient: 'buyer@example.com',
          sender: 'Category Desk',
          message: 'Your RFQ has new quotes.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-11-10T10:00:00Z',
        },
        {
          id: 'c-sms-1',
          channel: 'SMS',
          subject: '',
          recipient: '+91 9999999999',
          message: 'Your OTP is 1234',
          deliveryStatus: 'Delivered',
          sentAt: '2026-11-11T10:00:00Z',
        },
        {
          id: 'c-wa-1',
          channel: 'WHATSAPP',
          subject: '',
          recipient: '+91 9999999999',
          message: 'Hello on WA',
          deliveryStatus: 'Sent',
          sentAt: '2026-11-12T10:00:00Z',
        },
        {
          id: 'c-call-1',
          channel: 'CALL',
          subject: 'Requirement discussion',
          recipient: 'buyer@example.com',
          message: 'Call summary details',
          deliveryStatus: 'Completed',
          sentAt: '2026-11-13T10:00:00Z',
        },
      ];

      (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
        success: true,
        data: mockComms,
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);

      await waitFor(() => {
        expect(screen.getByText('RFQ Quote Update')).toBeInTheDocument();
      });

      // Click on Email to view details
      fireEvent.click(screen.getByText('RFQ Quote Update'));
      await waitFor(() => {
        expect(screen.getByText(/Your RFQ has new quotes\./)).toBeInTheDocument();
      });
      expect(screen.getByText(/Category Desk/)).toBeInTheDocument();

      // Close modal
      const closeButtons = screen.getAllByRole('button');
      const closeBtn = closeButtons.find((b) => b.getAttribute('aria-label') === 'Close' || b.textContent === '✕' || b.textContent === 'Close');
      if (closeBtn) fireEvent.click(closeBtn);

      // Switch to SMS subtab
      const smsTab = screen.getByRole('button', { name: /SMS/i });
      fireEvent.click(smsTab);
      await waitFor(() => {
        expect(screen.getByText('Your OTP is 1234')).toBeInTheDocument();
      });

      // Switch to WhatsApp subtab
      const waTab = screen.getByRole('button', { name: /WhatsApp/i });
      fireEvent.click(waTab);
      await waitFor(() => {
        expect(screen.getByText('Hello on WA')).toBeInTheDocument();
      });

      // Switch to Call subtab
      const callTab = screen.getByRole('button', { name: /Call/i });
      fireEvent.click(callTab);
      await waitFor(() => {
        expect(screen.getByText('Requirement discussion')).toBeInTheDocument();
      });
    });

    it('handles offline payments approval workflow, form validations, file upload and error handling', async () => {
      const originalFileReader = window.FileReader;
      class MockFileReader {
        result: string | null = null;
        onload: (() => void) | null = null;
        readAsDataURL(file: Blob) {
          this.result = 'data:image/png;base64,mockpreviewdata';
          if (this.onload) this.onload();
        }
      }
      (window as any).FileReader = MockFileReader;

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      // Open Request Type dropdown
      const requestTypeBtn = screen.getByTestId('request-type-dropdown-btn');
      fireEvent.click(requestTypeBtn);

      // Select 'Offline Payments'
      const offlineOption = screen.getByRole('menuitem', { name: /Offline Payments/i });
      fireEvent.click(offlineOption);

      // Verify Offline Payments modal is open
      expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();

      // Change Sourcing Mode
      const modeSelect = screen.getByLabelText(/Buyer Sourcing Mode/i);
      fireEvent.change(modeSelect, { target: { value: 'Mode 3' } });

      // Change Date
      const dateInput = screen.getByLabelText(/Payment Date/i);
      fireEvent.change(dateInput, { target: { value: '2026-11-20' } });

      // Change Payment Type to 'Cash' (transaction ID becomes hidden)
      const typeSelect = screen.getByLabelText(/Payment Type/i);
      fireEvent.change(typeSelect, { target: { value: 'Cash' } });
      expect(screen.queryByLabelText(/Transaction ID/i)).not.toBeInTheDocument();

      // Change Payment Type back to 'NEFT / RTGS'
      fireEvent.change(typeSelect, { target: { value: 'NEFT / RTGS' } });
      const txInput = screen.getByLabelText(/Transaction ID/i);
      fireEvent.change(txInput, { target: { value: 'TXN-998877' } });

      // Change Amount
      const amtInput = screen.getByLabelText(/Payment Amount/i);
      fireEvent.change(amtInput, { target: { value: '45000' } });

      // File upload validation: invalid format
      const fileInput = screen.getByTestId('offline-proof-file-input');
      const invalidFile = new File(['bad'], 'test.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });
      expect(screen.getByText(/Please upload an image file in JPG, JPEG, or PNG format/i)).toBeInTheDocument();

      // File upload validation: oversized (> 10MB)
      const oversizedFile = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [oversizedFile] } });
      expect(screen.getByText(/Payment proof file must be smaller than 10MB/i)).toBeInTheDocument();

      // File upload: valid image
      const validFile = new File(['valid content'], 'receipt.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      expect(screen.getByText('receipt.png')).toBeInTheDocument();
      expect(screen.getByAltText('Payment Proof Preview')).toBeInTheDocument();

      // Remove file
      const removeBtn = screen.getByRole('button', { name: /Remove/i });
      fireEvent.click(removeBtn);
      expect(screen.queryByText('receipt.png')).not.toBeInTheDocument();

      // Re-upload valid file
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      expect(screen.getByText('receipt.png')).toBeInTheDocument();

      // Initiator and Approver inputs
      const initiatorInput = screen.getByLabelText(/Initiated By/i);
      fireEvent.change(initiatorInput, { target: { value: 'Govardhan' } });

      const approverInput = screen.getByLabelText(/Assigned Approver/i);
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

      // Remarks
      const remarksInput = screen.getByPlaceholderText(/Reason \/ remarks for offline payment/i);
      fireEvent.change(remarksInput, { target: { value: 'Verified offline transfer' } });

      const offlineForm = screen.getByLabelText(/Payment Date/i).closest('form')!;

      // 1. Submit with empty date
      fireEvent.change(screen.getByLabelText(/Payment Date/i), { target: { value: '' } });
      fireEvent.submit(offlineForm);
      expect(screen.getByText('Payment date is mandatory.')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/Payment Date/i), { target: { value: '2026-11-20' } });

      // 2. Submit with empty payment type
      const paymentTypeSelect = screen.getByLabelText(/Payment Type/i);
      fireEvent.change(paymentTypeSelect, { target: { value: '' } });
      fireEvent.submit(offlineForm);
      expect(screen.getByText('Payment type is mandatory.')).toBeInTheDocument();
      fireEvent.change(paymentTypeSelect, { target: { value: 'NEFT / RTGS' } });

      // 3. Submit with empty transaction ID
      const transactionIdInput = screen.getByLabelText(/Transaction ID/i);
      fireEvent.change(transactionIdInput, { target: { value: '   ' } });
      fireEvent.submit(offlineForm);
      expect(screen.getByText(/Transaction ID is mandatory for NEFT \/ RTGS/i)).toBeInTheDocument();
      fireEvent.change(transactionIdInput, { target: { value: 'TXN-998877' } });

      // 4. Submit with amount <= 0
      const paymentAmountInput = screen.getByLabelText(/Payment Amount/i);
      fireEvent.change(paymentAmountInput, { target: { value: '0' } });
      fireEvent.submit(offlineForm);
      expect(screen.getByText('Please enter a valid payment amount greater than 0.')).toBeInTheDocument();
      fireEvent.change(paymentAmountInput, { target: { value: '45000' } });

      // 5. Submit with empty initiator
      fireEvent.change(initiatorInput, { target: { value: '   ' } });
      fireEvent.submit(offlineForm);
      expect(screen.getByText('Initiated by user is mandatory.')).toBeInTheDocument();
      fireEvent.change(initiatorInput, { target: { value: 'Govardhan' } });

      // 6. Submit with empty approver
      fireEvent.change(approverInput, { target: { value: '   ' } });
      fireEvent.submit(offlineForm);
      expect(screen.getByText('Assigned approver is mandatory.')).toBeInTheDocument();
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

      // Submit offline payment approval
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Offline payment submitted successfully',
      });

      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Offline payment submitted successfully')).toBeInTheDocument();
      }, { timeout: 5000 });

      // Test error responses from API
      // Re-open offline modal
      fireEvent.click(requestTypeBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: /Offline Payments/i }));

      fireEvent.change(screen.getByLabelText(/Payment Amount/i), { target: { value: '30000' } });
      fireEvent.change(screen.getByLabelText(/Transaction ID/i), { target: { value: 'TX-ERR' } });

      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Approval service rejected',
      });

      fireEvent.click(screen.getByRole('button', { name: /Submit for Approval/i }));
      await waitFor(() => {
        expect(screen.getByText('Approval service rejected')).toBeInTheDocument();
      }, { timeout: 5000 });

      // Test exception thrown
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      fireEvent.click(screen.getByRole('button', { name: /Submit for Approval/i }));
      await waitFor(() => {
        expect(screen.getByText('Failed to submit offline payment approval request.')).toBeInTheDocument();
      }, { timeout: 5000 });

      // Close modal
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      window.FileReader = originalFileReader;
    });

    it('handles uploaded vendors listing, filtering by status, search, vendor details modal and error states', async () => {
      const mockUploadedVendors: any[] = [
        {
          id: 'uv-1',
          name: 'Precision Metal Works',
          companyName: 'Precision Metal Corp',
          contactPerson: 'Amit Sharma',
          email: 'amit@precisionmetal.com',
          phone: '+91 9876543210',
          createdAt: '2026-11-01T10:00:00Z',
          status: 'ACTIVE',
          majorCategory: 'Mechanical',
          location: 'Pune, Maharashtra',
          gstin: '27AABCU9603R1ZM',
          pan: 'AABCU9603R',
        },
        {
          id: 'uv-2',
          name: 'Apex Tools & Dies',
          companyName: 'Apex Tools Ltd',
          contactPerson: 'Sunil Verma',
          email: 'sunil@apextools.com',
          phone: '+91 9123456789',
          createdAt: '2026-11-05T12:00:00Z',
          status: 'PENDING',
          majorCategory: 'Tooling',
          city: 'Bengaluru',
          gst: '29ABCDE1234F1Z5',
          pan: 'ABCDE1234F',
        },
        {
          id: 'uv-3',
          name: '',
          companyName: 'Global Polymers',
          contactPerson: 'Ravi Kumar',
          email: 'ravi@globalpolymers.com',
          phone: '+91 9800000000',
          createdAt: '',
          status: 'VERIFIED',
          majorCategory: 'Polymers',
        },
      ];

      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
        success: true,
        data: mockUploadedVendors,
      });

      const { unmount } = render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="uploaded-vendors" />);

      await waitFor(() => {
        expect(screen.getByText('Precision Metal Works')).toBeInTheDocument();
        expect(screen.getByText('Apex Tools & Dies')).toBeInTheDocument();
        expect(screen.getByText('Global Polymers')).toBeInTheDocument();
      });

      // Filter by status: PENDING
      const statusSelect = screen.getByRole('combobox');
      fireEvent.change(statusSelect, { target: { value: 'PENDING' } });
      expect(screen.queryByText('Precision Metal Works')).not.toBeInTheDocument();
      expect(screen.getByText('Apex Tools & Dies')).toBeInTheDocument();

      // Reset to ALL
      fireEvent.change(statusSelect, { target: { value: 'ALL' } });
      expect(screen.getByText('Precision Metal Works')).toBeInTheDocument();

      // Search by company name
      const searchInput = screen.getByPlaceholderText(/Search uploaded vendors/i);
      fireEvent.change(searchInput, { target: { value: 'Apex Tools' } });
      expect(screen.queryByText('Precision Metal Works')).not.toBeInTheDocument();
      expect(screen.getByText('Apex Tools & Dies')).toBeInTheDocument();

      // Search by contact person
      fireEvent.change(searchInput, { target: { value: 'Amit Sharma' } });
      expect(screen.getByText('Precision Metal Works')).toBeInTheDocument();
      expect(screen.queryByText('Apex Tools & Dies')).not.toBeInTheDocument();

      // Search by email
      fireEvent.change(searchInput, { target: { value: 'ravi@globalpolymers.com' } });
      expect(screen.getByText('Global Polymers')).toBeInTheDocument();

      // Search by phone
      fireEvent.change(searchInput, { target: { value: '+91 9876543210' } });
      expect(screen.getByText('Precision Metal Works')).toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Open Vendor Details Modal for Vendor 1
      const viewDetailsButtons = screen.getAllByRole('button', { name: /View Details/i });
      fireEvent.click(viewDetailsButtons[0]);

      // Check modal content
      await waitFor(() => {
        expect(screen.getAllByText('Precision Metal Works').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText('27AABCU9603R1ZM')).toBeInTheDocument();
      expect(screen.getByText('Pune, Maharashtra')).toBeInTheDocument();

      // Close modal with backdrop click
      const modalBackdrop = screen.getByText('27AABCU9603R1ZM').closest('.fixed') as HTMLElement;
      if (modalBackdrop) fireEvent.click(modalBackdrop);

      // Open Vendor Details Modal for Vendor 2 (uses gst instead of gstin, city instead of location)
      const viewDetailsButtons2 = screen.getAllByRole('button', { name: /View Details/i });
      fireEvent.click(viewDetailsButtons2[1]);

      await waitFor(() => {
        expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument();
      });
      expect(screen.getByText('Bengaluru')).toBeInTheDocument();

      // Close modal via close button
      const closeButtons = screen.getAllByRole('button', { name: /Close/i });
      if (closeButtons.length > 0) fireEvent.click(closeButtons[0]);

      unmount();

      // Test load error state
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Failed to load uploaded vendors',
      });
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="uploaded-vendors" />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load uploaded vendors')).toBeInTheDocument();
      });
    });

    it('handles communications compose call channel, error display, and empty states', async () => {
      // Test error display on comms load
      (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockRejectedValueOnce(new Error('Network fault'));

      const { unmount } = render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      unmount();

      // Compose CALL communication
      (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
        success: true,
        data: [],
      });
      (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValue({
        success: true,
        message: 'Communication recorded',
      });

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />);

      // Click Log / Send Communication
      const composeBtn = screen.getByRole('button', { name: /Record Communication & Activity/i });
      fireEvent.click(composeBtn);

      const dialogs = screen.getAllByRole('dialog');
      const composeModal = dialogs[dialogs.length - 1];

      // Select Channel: Call Log inside compose modal
      const callChannelBtn = within(composeModal).getByRole('button', { name: /Call Log/i });
      fireEvent.click(callChannelBtn);

      // Select Call Outcome
      const outcomeSelect = within(composeModal).getAllByRole('combobox')[0];
      fireEvent.change(outcomeSelect, { target: { value: 'Connected - Requirement Discussed' } });

      // Call Duration
      const durationInput = within(composeModal).getByPlaceholderText(/e\.g\. 10 mins/i);
      fireEvent.change(durationInput, { target: { value: '10 mins' } });

      // Message
      const messageInput = within(composeModal).getByPlaceholderText(/Key details, buyer requirements/i);
      fireEvent.change(messageInput, { target: { value: 'Discussed tooling requirements with client.' } });

      // Submit
      const submitLogBtn = within(composeModal).getByRole('button', { name: /Save & Synchronize Tasks/i });
      fireEvent.click(submitLogBtn);

      await waitFor(() => {
        expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledWith(
          mockBuyer.id,
          expect.objectContaining({
            channel: 'CALL',
            duration: '10 mins',
          })
        );
      });
    });

    it('covers trial period date and days validation branches in step 2', async () => {
      jest.spyOn(authClient, 'getSessionUser').mockReturnValue({ id: 'usr-initiator', name: 'Test Assignee' } as any);

      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      const reqBtn = screen.getByTestId('request-type-dropdown-btn');
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: /Trial Periods/i }));

      // Continue to step 2 by selecting Mode 1
      const modeButtons = screen.getAllByRole('button', { name: /Mode 1/i });
      fireEvent.click(modeButtons[modeButtons.length - 1]);

      // Set starting date and ending date with end before start
      const startDateInput = screen.getByLabelText(/Starting Date/i);
      const endDateInput = screen.getByLabelText(/Ending Date/i);
      const trialDaysInput = screen.getByLabelText(/Number of Trial Days/i);

      fireEvent.change(startDateInput, { target: { value: '2026-11-20' } });
      fireEvent.change(endDateInput, { target: { value: '2026-11-15' } });
      expect(screen.getAllByText('Ending date cannot be earlier than starting date.').length).toBeGreaterThanOrEqual(1);

      // Set ending date 5 days later
      fireEvent.change(endDateInput, { target: { value: '2026-11-25' } });

      // Change trial days to mismatched value
      fireEvent.change(trialDaysInput, { target: { value: '15' } });
      expect(screen.getAllByText(/does not match the selected date range/i).length).toBeGreaterThanOrEqual(1);

      // Trial days NaN branch
      fireEvent.change(trialDaysInput, { target: { value: '' } });

      // Set trial days with end before start
      fireEvent.change(endDateInput, { target: { value: '2026-11-10' } });
      fireEvent.change(trialDaysInput, { target: { value: '10' } });
      expect(screen.getAllByText('Ending date cannot be earlier than starting date.').length).toBeGreaterThanOrEqual(1);

      // Valid date range and matching days
      fireEvent.change(endDateInput, { target: { value: '2026-11-25' } });
      fireEvent.change(trialDaysInput, { target: { value: '5' } });

      // Select approver
      const approverSelect = screen.getByLabelText(/Assigned Approver/i);
      fireEvent.change(approverSelect, { target: { value: 'Srinu Sir' } });

      // Submit trial period with API failure
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Trial period limit exceeded',
      });

      const trialForm = screen.getByLabelText(/Starting Date/i).closest('form')!;
      fireEvent.submit(trialForm);
      await waitFor(() => {
        expect(screen.getByText('Trial period limit exceeded')).toBeInTheDocument();
      });

      // Submit trial period with exception
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Server crash'));
      fireEvent.submit(trialForm);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit trial period approval request.')).toBeInTheDocument();
      });

      // Submit trial period with success
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Trial period approval requested',
      });
      fireEvent.submit(trialForm);
      await waitFor(() => {
        expect(screen.getByText('Trial period approval requested')).toBeInTheDocument();
      });
    });

    it('covers discount workflow approval failure and exception branches in step 3', async () => {
      render(<BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />);

      const reqBtn = screen.getByTestId('request-type-dropdown-btn');
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: /Discounts/i }));

      // Step 1 -> click Mode 1
      const modeButtons = screen.getAllByRole('button', { name: /Mode 1/i });
      fireEvent.click(modeButtons[modeButtons.length - 1]);
      // Step 2 -> click 12 Months
      const dur12Btn = screen.getByRole('button', { name: /12 Months/i });
      fireEvent.click(dur12Btn);

      // Set approver in step 3
      const approverInput = document.getElementById('discount-approver') as HTMLSelectElement;
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

      // Step 3 form
      const discountForm = screen.getByRole('button', { name: /Submit for Approval/i }).closest('form')!;

      // API failure
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Discount approval failed at gateway',
      });
      fireEvent.submit(discountForm);
      await waitFor(() => {
        expect(screen.getByText('Discount approval failed at gateway')).toBeInTheDocument();
      });

      // Exception thrown
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Timeout'));
      fireEvent.submit(discountForm);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit discount approval request.')).toBeInTheDocument();
      });
    });

    it('evaluates fallback strings across drawer when UI_STRINGS properties are omitted', async () => {
      const origBuyerDirectory = (UI_STRINGS as any).buyerDirectory;
      (UI_STRINGS as any).buyerDirectory = {
        ...origBuyerDirectory,
        dossier: {
          ...origBuyerDirectory.dossier,
          creditApproval: {},
        },
      };

      try {
        const { unmount } = render(
          <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />
        );

        const reqBtn = screen.getByTestId('request-type-dropdown-btn');

        // Discounts
        fireEvent.click(reqBtn);
        fireEvent.click(screen.getByRole('menuitem', { name: /Discounts/i }));
        expect(screen.getByText('Request Discount Approval')).toBeInTheDocument();
        expect(screen.getByText('Step 1 of 3: Select sourcing mode for discount request.')).toBeInTheDocument();

        // Step 2
        const discountModeButtons = screen.getAllByRole('button', { name: /Mode 1/i });
        fireEvent.click(discountModeButtons[discountModeButtons.length - 1]);
        expect(screen.getByText('Select Billing Duration')).toBeInTheDocument();

        // Step 3
        const durButtons = screen.getAllByRole('button', { name: /12 Months/i });
        fireEvent.click(durButtons[durButtons.length - 1]);
        expect(screen.getByText('Submit discount authorization for this buyer account.')).toBeInTheDocument();
        expect(screen.getByText('Price Breakdown')).toBeInTheDocument();

        // Trial Periods
        fireEvent.click(reqBtn);
        fireEvent.click(screen.getByRole('menuitem', { name: /Trial Periods/i }));
        expect(screen.getAllByText('Select Sourcing Mode').length).toBeGreaterThanOrEqual(1);
        const modeButtons = screen.getAllByRole('button', { name: /Mode 1/i });
        fireEvent.click(modeButtons[modeButtons.length - 1]);
        expect(screen.getByText('Submit trial period extension for authorization by the approver you select below.')).toBeInTheDocument();

        // Offline Payments
        fireEvent.click(reqBtn);
        fireEvent.click(screen.getByRole('menuitem', { name: /Offline Payments/i }));
        expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();
        expect(screen.getByText('Submit offline payment verification and credit authorization.')).toBeInTheDocument();

        // Standard Buyer Credit Addition
        fireEvent.click(reqBtn);
        fireEvent.click(screen.getByRole('menuitem', { name: /Buyer Credit Addition/i }));
        expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
        expect(screen.getByText('Available Sourcing Credits')).toBeInTheDocument();
        expect(screen.getByText('Requested Credits')).toBeInTheDocument();
        expect(screen.getByText('Initiated By')).toBeInTheDocument();
        expect(screen.getByText('Assigned Approver')).toBeInTheDocument();
        expect(screen.getByText('Business Justification / Reason')).toBeInTheDocument();
        expect(screen.getByText('Submit for Approval')).toBeInTheDocument();

        unmount();
      } finally {
        (UI_STRINGS as any).buyerDirectory = origBuyerDirectory;
      }
    });

    it('covers uploaded vendor search by contact, email, phone and modal fallback fields', async () => {
      const emptyVendor = {
        id: 'v-empty',
        companyName: '',
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
        location: '',
        city: '',
        gstin: '',
        gst: '',
        pan: '',
        status: '',
      };
      const vendorWithEmail = {
        id: 'v-email',
        companyName: 'Acme Corp',
        contactPerson: 'John Doe',
        email: 'john@acme.com',
        phone: '9876543210',
        status: 'Active',
      };

      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
        success: true,
        data: [emptyVendor, vendorWithEmail],
      });

      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="uploaded-vendors" />
      );

      await waitFor(() => {
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      });

      // Search by contact person
      const searchInput = screen.getByPlaceholderText(/Search uploaded vendors/i);
      fireEvent.change(searchInput, { target: { value: 'John' } });
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();

      // Search by email
      fireEvent.change(searchInput, { target: { value: 'john@acme' } });
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();

      // Search by phone
      fireEvent.change(searchInput, { target: { value: '98765' } });
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Click "View Details" on emptyVendor (first button)
      const viewButtons = screen.getAllByRole('button', { name: /View Details/i });
      fireEvent.click(viewButtons[0]);

      // Check empty fallbacks rendered
      await waitFor(() => {
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
      });

      // Close modal
      const closeButtons = screen.getAllByRole('button', { name: /^Close$/i });
      if (closeButtons.length > 0) fireEvent.click(closeButtons[closeButtons.length - 1]);

      unmount();
    });

    it('covers offline payments validation, proof file upload/remove, and form submission', async () => {
      jest.spyOn(authClient, 'getSessionUser').mockReturnValue({ id: 'usr-initiator', name: 'Test Initiator' } as any);

      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />
      );

      const reqBtn = screen.getByTestId('request-type-dropdown-btn');

      // Switch to Offline Payments
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: /Offline Payments/i }));

      // Offline payment amount change with NaN
      const amountInput = screen.getByLabelText(/Payment Amount/i);
      fireEvent.change(amountInput, { target: { value: '' } });

      // Set valid amount
      fireEvent.change(amountInput, { target: { value: '5000' } });

      // Set transaction ID
      const txnInput = screen.getByLabelText(/Transaction ID/i);
      fireEvent.change(txnInput, { target: { value: 'TXN-12345' } });

      // Proof file handling
      const fileInput = screen.getByTestId('offline-proof-file-input') as HTMLInputElement;
      if (fileInput) {
        // PDF invalid format
        const textFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });
        fireEvent.change(fileInput, { target: { files: [textFile] } });

        // Large file > 10MB
        const largeFile = new File(['a'.repeat(100)], 'large.png', { type: 'image/png' });
        Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });
        fireEvent.change(fileInput, { target: { files: [largeFile] } });

        // Valid image
        const validFile = new File(['dummy-img'], 'receipt.png', { type: 'image/png' });
        Object.defineProperty(validFile, 'size', { value: 1024 * 50 });
        fireEvent.change(fileInput, { target: { files: [validFile] } });
      }

      // Test remove proof button if preview appears
      const removeBtn = screen.queryByRole('button', { name: /Remove/i });
      if (removeBtn) {
        fireEvent.click(removeBtn);
      }

      // Mock requestBuyerCreditApproval
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: true,
        message: 'Offline payment submitted successfully',
      });

      // Submit offline payment approval
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalledWith(
          mockBuyer.id,
          expect.objectContaining({
            requestType: 'Offline Payments',
            transactionId: 'TXN-12345',
          })
        );
      });

      unmount();
    });

    it('covers backdrop click dismissals for edit categories and compose modals', async () => {
      // 1. Edit Categories modal backdrop click
      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="rfqs" />
      );

      const editCatBtn = screen.queryByRole('button', { name: /Edit Categories/i });
      if (editCatBtn) {
        fireEvent.click(editCatBtn);
        const dialogs = screen.getAllByRole('dialog');
        const modalDialog = dialogs[dialogs.length - 1];
        fireEvent.click(modalDialog);
      }

      unmount();

      // 2. Compose modal backdrop click
      const { unmount: unmount2 } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />
      );

      const composeBtn = screen.getByRole('button', { name: /Record Communication & Activity/i });
      fireEvent.click(composeBtn);

      const dialogs = screen.getAllByRole('dialog');
      const composeDialog = dialogs[dialogs.length - 1];
      fireEvent.click(composeDialog);

      unmount2();
    });

    it('covers edit categories search suggestions, keyboard shortcuts, tag toggling, and clear actions', async () => {
      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="profile" />
      );

      const editCatBtn = screen.getByRole('button', { name: /^Edit$/i });
      fireEvent.click(editCatBtn);

      const catInput = document.getElementById('buyer-dossier-category-search-input') as HTMLInputElement;

      // 1. Type < 3 chars ('ab')
      fireEvent.change(catInput, { target: { value: 'ab' } });

      // 2. Focus input with >= 3 chars
      fireEvent.change(catInput, { target: { value: 'Steel' } });
      fireEvent.focus(catInput);

      // 4. Enter key when suggestions active
      fireEvent.keyDown(catInput, { key: 'Enter' });

      // 5. Enter key with text
      fireEvent.change(catInput, { target: { value: 'Custom CNC Parts' } });
      fireEvent.keyDown(catInput, { key: 'Enter' });

      // 6. Add category button click
      fireEvent.change(catInput, { target: { value: 'Pumps & Motors' } });
      const addCustomBtn = screen.getByRole('button', { name: /^Add Category$/i });
      fireEvent.click(addCustomBtn);

      // 7. Duplicate check: add existing category
      fireEvent.change(catInput, { target: { value: 'Pumps & Motors' } });
      fireEvent.click(addCustomBtn);

      // 8. Remove category tag
      const removeButtons = screen.getAllByRole('button').filter(b => b.querySelector('svg.lucide-x'));
      if (removeButtons.length > 0) {
        fireEvent.click(removeButtons[removeButtons.length - 1]);
      }

      // 9. Save categories successfully
      const saveBtn = screen.getByRole('button', { name: /Save Categories/i });
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(buyerProfileClient.updateBuyerCategories).toHaveBeenCalled();
      });

      // 10. Test Escape on catInput
      fireEvent.click(editCatBtn);
      const catInput2 = document.getElementById('buyer-dossier-category-search-input') as HTMLInputElement;
      fireEvent.change(catInput2, { target: { value: 'Steel' } });
      fireEvent.keyDown(catInput2, { key: 'Escape' });

      unmount();
    });

    it('covers edit categories save failure and throw branches, and cancel button', async () => {
      // 1. Save failure with res.error
      (buyerProfileClient.updateBuyerCategories as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Backend category validation error',
      });

      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="profile" />
      );

      fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
      fireEvent.click(screen.getByRole('button', { name: /Save Categories/i }));
      await waitFor(() => {
        expect(buyerProfileClient.updateBuyerCategories).toHaveBeenCalled();
      });

      // 2. Save failure with default error message (no error field)
      (buyerProfileClient.updateBuyerCategories as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /Save Categories/i }));
      await waitFor(() => {
        expect(buyerProfileClient.updateBuyerCategories).toHaveBeenCalledTimes(2);
      });

      // 3. Save failure with exception thrown
      (buyerProfileClient.updateBuyerCategories as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      fireEvent.click(screen.getByRole('button', { name: /Save Categories/i }));
      await waitFor(() => {
        expect(buyerProfileClient.updateBuyerCategories).toHaveBeenCalledTimes(3);
      });

      // 4. Cancel button click
      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      fireEvent.click(cancelBtn);

      unmount();
    });

    it('covers discounts steps 1, 2, 3 navigation, NaN percentage, back and cancel buttons', async () => {
      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="credits" />
      );

      const reqBtn = screen.getByTestId('request-type-dropdown-btn');
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: /Discounts/i }));

      // Step 1: Select Mode 1
      const modeButtons = screen.getAllByRole('button', { name: /Mode 1/i });
      fireEvent.click(modeButtons[modeButtons.length - 1]);

      // Step 2: Select Duration (6 Months)
      const durationButtons = screen.getAllByRole('button', { name: /6 Months/i });
      fireEvent.click(durationButtons[durationButtons.length - 1]);

      // Step 3: Enter discount percentage with NaN
      const discountInput = screen.getByPlaceholderText('0');
      fireEvent.change(discountInput, { target: { value: '' } });
      fireEvent.change(discountInput, { target: { value: '10' } });

      // Click Back button
      const backBtn = screen.getByRole('button', { name: /Back/i });
      fireEvent.click(backBtn);

      // Re-advance to Step 3
      const durationButtons2 = screen.getAllByRole('button', { name: /6 Months/i });
      fireEvent.click(durationButtons2[durationButtons2.length - 1]);

      // Click Cancel button
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      unmount();
    });

    it('covers email and payment modal backdrop clicks', async () => {
      // 1. Email detail modal backdrop click
      const mockComms = [
        {
          id: 'comm-email-1',
          channel: 'EMAIL',
          subject: 'RFQ Requirement Update',
          message: 'Hello, please review the RFQ details attached.',
          sentAt: '2026-11-19T10:00:00Z',
          sender: 'Category Manager',
          recipient: 'buyer@example.com',
        },
      ];
      (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: mockComms,
      });

      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="communications" />
      );

      await waitFor(() => {
        expect(screen.getByText('RFQ Requirement Update')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('RFQ Requirement Update'));

      const dialogs = screen.getAllByRole('dialog');
      const emailModal = dialogs[dialogs.length - 1];
      fireEvent.click(emailModal);

      unmount();

      // 2. Payment detail modal backdrop click
      const mockPayments = [
        {
          id: 'pay-1',
          invoiceNo: 'INV-998877',
          amount: 25000,
          status: 'PAID',
          transactionDate: '2026-11-18T10:00:00Z',
          gateway: 'Razorpay',
          description: 'Subscription Renewal',
        },
      ];
      (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        payments: mockPayments,
        summary: {
          totalAmountPaid: 25000,
          totalSuccessfulPayments: 1,
          pendingPayments: 0,
          failedPayments: 0,
        },
      });

      const { unmount: unmount2 } = render(
        <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} initialTab="payments" />
      );

      await waitFor(() => {
        expect(screen.getByText('INV-998877')).toBeInTheDocument();
      });

      const detailsBtn = screen.getByRole('button', { name: /^Details$/i });
      fireEvent.click(detailsBtn);

      const dialogs2 = screen.getAllByRole('dialog');
      const paymentModal = dialogs2[dialogs2.length - 1];
      fireEvent.click(paymentModal);

      unmount2();
    });

    it('covers remaining RFQ detail popup mode fallbacks, empty quotes, and call channel communication', async () => {
      const customRfq: any = {
        rfqNumber: 'RFQ-CUSTOM-99',
        title: 'Custom Procurement',
        sourcingMode: 'UNKNOWN_MODE',
        assignedVendors: [{ id: 'v1', name: 'Vendor 1' }],
        quotes: [],
        budget: 50000,
        createdAt: '2026-11-20T10:00:00Z',
      };

      const { unmount } = render(
        <BuyerDossierDrawer buyer={mockBuyer} buyerRfqs={[customRfq]} onClose={onCloseMock} initialTab="rfqs" />
      );

      await waitFor(() => {
        expect(screen.getByText('RFQ-CUSTOM-99')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('RFQ-CUSTOM-99'));
      await waitFor(() => {
        expect(screen.getByText('Awaiting vendor quotation submissions.')).toBeInTheDocument();
        expect(screen.getByText(/1 vendors \/ 0 bids/i)).toBeInTheDocument();
      });

      unmount();
    });
  });
});
