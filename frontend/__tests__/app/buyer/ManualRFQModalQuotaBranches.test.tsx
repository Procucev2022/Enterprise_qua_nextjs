import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import { setCategoryTaxonomy } from '@/lib/categoryTaxonomy';
import * as rfqClient from '@/lib/rfqClient';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type { RFQItem, SourcingMode, VendorEntry } from '@/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/lib/rfqClient', () => ({
  createRFQ: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  extractLineItemsFromDocument: jest.fn(),
  classifyLineItems: jest.fn(),
  fetchAllVendors: jest.fn(),
  requestVendorCategoryUpdateEmail: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/documentExtraction', () => ({
  buildExtractionRequest: jest.fn(),
}));

// The upgrade dialog fetches pricing on open. These tests only need to know it opened and which mode it targeted.
jest.mock('@/app/buyer/RfqUpgradePlanModal', () => {
  const { createElement } = require('react');
  return {
    __esModule: true,
    default: ({ isOpen, targetMode }: { isOpen: boolean; targetMode: string }) =>
      isOpen
        ? createElement('div', { 'data-testid': 'rfq-upgrade-plan-modal', 'data-target-mode': targetMode })
        : null,
  };
});

const createRFQ = rfqClient.createRFQ as jest.Mock;
const mockedUseApp = useApp as jest.Mock;

const MODAL = UI_STRINGS.manualRfqModal;
const HOME_CATEGORY = categoriesData[0];
const onClose = jest.fn();
const onCreated = jest.fn();
const showToast = jest.fn();

function buildVendor(overrides: Partial<VendorEntry>): VendorEntry {
  return {
    id: '',
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    majorCategory: '',
    minorCategories: [],
    location: '',
    rating: 0,
    source: 'buyer_uploaded',
    ...overrides,
  };
}

/** Buyer-uploaded and matching the category fillRow() selects, so a Mode 1 RFQ has a private supplier to send to. */
const matchingVendor = buildVendor({
  id: 'v-match',
  name: 'Matching Co',
  email: 'match@test.com',
  majorCategory: HOME_CATEGORY.majorCategory,
  minorCategories: [HOME_CATEGORY.minorCategories[0]],
});

/** Buyer-uploaded but in another category, so the category check leaves it out of the shortlist. */
const mismatchedVendor = buildVendor({
  id: 'v-mis',
  name: 'Mismatch Co',
  email: 'mis@test.com',
  majorCategory: categoriesData[1].majorCategory,
});

function storeWith(overrides: Record<string, unknown> = {}) {
  return {
    buyerVendors: [matchingVendor],
    activeBuyerAccount: { subscriptionPlan: 'version_3' },
    showToast,
    adoptCreatedRFQ: jest.fn(),
    ...overrides,
  };
}

function savedRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: HOME_CATEGORY.majorCategory,
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  } as RFQItem;
}

const renderModal = () => render(<ManualRFQModal isOpen={true} onClose={onClose} onCreated={onCreated} />);

const firstRow = () => screen.getAllByRole('row')[1];

/** Complete every field a line item needs before dispatch. */
function fillRow() {
  const row = firstRow();
  fireEvent.change(within(row).getByLabelText(MODAL.colItem), {
    target: { value: 'Centrifugal Water Pump' },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMajor), { target: { value: HOME_CATEGORY.majorCategory } });
  fireEvent.change(within(row).getByLabelText(MODAL.colMinor), { target: { value: HOME_CATEGORY.minorCategories[0] } });
  fireEvent.change(within(row).getByLabelText(MODAL.colSpecs), { target: { value: 'SS316 impeller, 2 HP' } });
  fireEvent.change(within(row).getByLabelText(MODAL.colQty), { target: { value: '12' } });
  fireEvent.change(within(row).getByLabelText(MODAL.colUnit), { target: { value: 'Nos' } });
}

/** Fill the mandatory header fields: the title, the target delivery date and the destination. */
function fillHeaderFields() {
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i')), {
    target: { value: 'Centrifugal pump replacement' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.targetDateLabel, 'i')), {
    target: { value: '2099-12-01' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryLocationLabel, 'i')), {
    target: { value: 'Navi Mumbai Plant, Gate 3' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryPincodeLabel, 'i')), {
    target: { value: '400701' },
  });
}

const clickSave = () => fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

const chooseMode = (mode: SourcingMode) => fireEvent.click(screen.getByTestId(`manual-mode-${mode}`));

beforeEach(() => {
  jest.resetAllMocks();
  setCategoryTaxonomy(categoriesData);
  createRFQ.mockResolvedValue({ success: true, rfq: savedRFQ() });
});

describe('ManualRFQModal: quota and plan come only from the store', () => {
  it('shows no quota banner or upgrade prompt when the free balance has not been reported', () => {
    mockedUseApp.mockReturnValue(storeWith({ activeBuyerAccount: { subscriptionPlan: 'free_trial' }, remainingFreeRFQs: null }));
    renderModal();
    chooseMode('mode_1');

    expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();
  });

  it('does not treat a balance that is not a number as used up', () => {
    mockedUseApp.mockReturnValue(
      storeWith({ activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: '0' }, remainingFreeRFQs: '0' })
    );
    renderModal();
    chooseMode('mode_1');

    expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
  });

  it('sends the RFQ to the server when the balance is unknown, and shows the server error when it refuses', async () => {
    createRFQ.mockResolvedValueOnce({ success: false, error: 'Free RFQ allowance is used up on the server.' });
    mockedUseApp.mockReturnValue(storeWith({ activeBuyerAccount: { subscriptionPlan: 'free_trial' }, remainingFreeRFQs: null }));
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_1');
    clickSave();

    await waitFor(() => expect(createRFQ).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Free RFQ allowance is used up on the server.')).toBeInTheDocument();
    expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();
  });

  it('shows every sourcing mode as available when the plan has not been reported', () => {
    mockedUseApp.mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: null,
      activeSubscription: null,
      remainingFreeRFQs: null,
      showToast,
    });
    renderModal();

    expect(screen.getByLabelText(/(Mode 2|Version 2)/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/(Mode 3|Version 3)/i)).not.toBeDisabled();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  it('treats a plan that is not text as not reported, so no mode is locked', () => {
    mockedUseApp.mockReturnValue(
      storeWith({
        activeBuyerAccount: { subscriptionPlan: { tier: 'enterprise' }, remainingFreeRFQs: null },
        activeSubscription: { tier: 'enterprise' },
      })
    );
    renderModal();

    expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  it('opens the modal with no restriction when the store cannot be read', () => {
    mockedUseApp.mockImplementation(() => {
      throw new Error('No application provider');
    });
    renderModal();

    expect(screen.getByLabelText(/(Mode 3|Version 3)/i)).not.toBeDisabled();
    expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('shows the exhausted banner in place of save when the store reports the free balance used up', () => {
    mockedUseApp.mockReturnValue(
      storeWith({ activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 }, remainingFreeRFQs: 0 })
    );
    renderModal();
    chooseMode('mode_1');

    expect(screen.getByTestId('manual-rfq-quota-exhausted-banner')).toBeInTheDocument();
    expect(screen.getByText(MODAL.quotaExhaustedTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: MODAL.saveAction })).not.toBeInTheDocument();
  });

  it('keeps Mode 0 available while the free balance is used up', () => {
    mockedUseApp.mockReturnValue(
      storeWith({ activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 }, remainingFreeRFQs: 0 })
    );
    renderModal();
    chooseMode('mode_0');

    expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
  });
});

describe('ManualRFQModal: outcome messages', () => {
  it('names the suppliers left out of the shortlist without claiming an email was sent', async () => {
    mockedUseApp.mockReturnValue(storeWith({ buyerVendors: [matchingVendor, mismatchedVendor] }));
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_1');
    clickSave();

    await waitFor(() => expect(createRFQ).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith(
      MODAL.shortlistAdjustedTitle,
      formatString(MODAL.shortlistMismatchNotice, { count: 1 }),
      'info'
    );
    expect(createRFQ.mock.calls[0][0].assignedVendors).toEqual([
      expect.objectContaining({ id: 'v-match', name: 'Matching Co' }),
    ]);
  });

  it('shows the saved item count from the server record', async () => {
    mockedUseApp.mockReturnValue(storeWith());
    createRFQ.mockResolvedValueOnce({ success: true, rfq: savedRFQ({ extractedEntities: [] }) });
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_1');
    clickSave();

    expect(await screen.findByText(formatString(MODAL.itemsCount, { count: 0 }))).toBeInTheDocument();
  });

  it('shows not recorded instead of an item count when the server record holds no line items list', async () => {
    mockedUseApp.mockReturnValue(storeWith());
    const withoutItems = savedRFQ();
    delete (withoutItems as Partial<RFQItem>).extractedEntities;
    createRFQ.mockResolvedValueOnce({ success: true, rfq: withoutItems });
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_1');
    clickSave();

    const notRecorded = await screen.findAllByText(UI_STRINGS.recordPlaceholders.notRecorded);
    expect(notRecorded.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(formatString(MODAL.itemsCount, { count: 0 }))).not.toBeInTheDocument();
  });
});
