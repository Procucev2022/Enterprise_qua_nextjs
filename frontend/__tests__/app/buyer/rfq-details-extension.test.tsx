import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RFQDetails from '@/app/buyer/rfq-details';
import * as storeModule from '@/lib/store';
import * as rfqClientModule from '@/lib/rfqClient';
import { calculateExtendedDeadline, formatExtensionDayCount, formatIndianDateTime } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/authClient', () => ({
  authClient: { getToken: jest.fn(() => 'test-session-token') },
}));
jest.mock('@/lib/rfqClient', () => ({
  rfqAttachmentUrl: jest.fn((id: string, attId: string) => `/api/rfq/${id}/attachments/${attId}`),
  updateRFQ: jest.fn(),
  extendRFQ: jest.fn(),
  replyToRFQInquiry: jest.fn(),
  submitRFQInquiry: jest.fn(),
}));
jest.mock('@/lib/vendorPresenceClient', () => ({
  getVendorPresence: jest.fn(async () => ({ success: true, onlineVendors: [] })),
}));
jest.mock('@/app/category-manager/InviteVendorsModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

const DETAILS = UI_STRINGS.rfqDetails;
const RANGE = { min: 1, max: 30 };
/** Far in the future, so the extension is measured from the stored deadline rather than from today. */
const CLOSING_DEADLINE = '2099-12-09T05:30:00.000Z';

const OPEN_RFQ = {
  id: 'rfq-ext-1',
  rfqNumber: 'RFQ261411297419',
  title: 'Industrial Pumps',
  category: 'Mechanical',
  budget: 850000,
  targetDeliveryDate: '2099-11-30',
  deliveryLocation: 'Mumbai Hub',
  deliveryPincode: '400701',
  status: 'Quotes Pending',
  sourcingMode: 'mode_0',
  deadline: CLOSING_DEADLINE,
  closingDeadline: CLOSING_DEADLINE,
  createdAt: '2099-11-01T05:30:00.000Z',
  extractedEntities: [],
  quotes: [],
  quotesCount: 0,
  assignedVendors: [],
  inquiries: [],
  attachments: [],
} as unknown as RFQItem;

const mockShowToast = jest.fn();
const mockRefreshFromDB = jest.fn();

function renderDetails(rfq: RFQItem = OPEN_RFQ) {
  return render(<RFQDetails rfq={rfq} onBack={jest.fn()} />);
}

/** Opens the extension dialog from the header button and returns it. */
function openExtendDialog(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /Extend RFQ/i }));
  return screen.getByRole('dialog');
}

function dayInput(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByLabelText(DETAILS.extensionDaysLabel);
}

function confirmLabel(days: number): string {
  return formatString(DETAILS.confirmExtensionAction, { duration: formatExtensionDayCount(days) });
}

describe('RFQ details extension dialog (whole days)', () => {
  beforeEach(() => {
    jest.mocked(storeModule.useApp).mockReturnValue({
      currentRole: 'buyer',
      showToast: mockShowToast,
      refreshFromDB: mockRefreshFromDB,
      buyerVendors: [],
      currentUserSession: { id: 'usr-1', email: 'buyer@test.com', name: 'Buyer', role: 'buyer', orgId: 'org-1', orgName: 'Org' },
    } as unknown as ReturnType<typeof storeModule.useApp>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts on one day and shows the matching calendar date and hint', () => {
    renderDetails();
    const dialog = openExtendDialog();

    expect(dayInput(dialog)).toHaveValue(1);
    expect(within(dialog).getByText(formatString(DETAILS.extensionHoursPreview, { hours: 24 }))).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatIndianDateTime(calculateExtendedDeadline(CLOSING_DEADLINE, 1)))
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: confirmLabel(1) })).toBeEnabled();
  });

  it('moves the calendar date and the added hours as the buyer types a different number of days', () => {
    renderDetails();
    const dialog = openExtendDialog();

    fireEvent.change(dayInput(dialog), { target: { value: '5' } });

    expect(
      within(dialog).getByText(formatIndianDateTime(calculateExtendedDeadline(CLOSING_DEADLINE, 5)))
    ).toBeInTheDocument();
    expect(within(dialog).getByText(formatString(DETAILS.extensionHoursPreview, { hours: 120 }))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: confirmLabel(5) })).toBeEnabled();
  });

  it('steps the day count with the stepper and stops at the edges of the range', () => {
    renderDetails();
    const dialog = openExtendDialog();
    const decrease = within(dialog).getByRole('button', { name: DETAILS.extensionDaysDecreaseAria });
    const increase = within(dialog).getByRole('button', { name: DETAILS.extensionDaysIncreaseAria });

    expect(decrease).toBeDisabled();
    fireEvent.click(increase);
    expect(dayInput(dialog)).toHaveValue(2);
    fireEvent.click(decrease);
    expect(dayInput(dialog)).toHaveValue(1);

    fireEvent.change(dayInput(dialog), { target: { value: String(RANGE.max) } });
    expect(increase).toBeDisabled();
    expect(decrease).toBeEnabled();
  });

  it('blocks confirmation and explains the allowed days for an out-of-range or fractional entry', () => {
    renderDetails();
    const dialog = openExtendDialog();

    for (const value of ['0', '31', '2.5']) {
      fireEvent.change(dayInput(dialog), { target: { value } });
      expect(within(dialog).getByText(formatString(DETAILS.extensionDaysInvalid, RANGE))).toBeInTheDocument();
      expect(within(dialog).getByText(formatString(DETAILS.revisedDeadlineUnavailable, RANGE))).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: DETAILS.confirmExtensionDisabledAction })).toBeDisabled();
    }
    expect(rfqClientModule.extendRFQ).not.toHaveBeenCalled();
  });

  it('sends the chosen days, reports success, and closes the dialog', async () => {
    const extended = {
      ...OPEN_RFQ,
      isExtended: true,
      extensionHours: 48,
      closingDeadline: calculateExtendedDeadline(CLOSING_DEADLINE, 2),
    } as unknown as RFQItem;
    jest.mocked(rfqClientModule.extendRFQ).mockResolvedValue({ success: true, rfq: extended });
    renderDetails();
    const dialog = openExtendDialog();

    fireEvent.change(dayInput(dialog), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: confirmLabel(2) }));

    await waitFor(() => expect(rfqClientModule.extendRFQ).toHaveBeenCalledWith('rfq-ext-1', 2));
    const expectedMessage = formatString(DETAILS.extensionSuccessMessage, {
      rfqNumber: OPEN_RFQ.rfqNumber,
      duration: formatExtensionDayCount(2),
      newDeadline: formatIndianDateTime(extended.closingDeadline),
    });
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(DETAILS.extensionSuccessTitle, expectedMessage, 'success')
    );
    expect(mockRefreshFromDB).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(formatString(DETAILS.extendedBadge, { duration: formatExtensionDayCount(2) }))).toBeInTheDocument();
  });

  it('keeps the dialog open and reports the server reason when the extension fails', async () => {
    jest
      .mocked(rfqClientModule.extendRFQ)
      .mockResolvedValue({ success: false, reason: 'NETWORK', error: 'Server unreachable' });
    renderDetails();
    const dialog = openExtendDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: confirmLabel(1) }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(DETAILS.extensionFailedTitle, 'Server unreachable', 'warning')
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancels without calling the API and reopens on the default day count', () => {
    renderDetails();
    const dialog = openExtendDialog();
    fireEvent.change(dayInput(dialog), { target: { value: '7' } });

    fireEvent.click(within(dialog).getByText(UI_STRINGS.actions.cancel, { selector: 'button' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rfqClientModule.extendRFQ).not.toHaveBeenCalled();

    const reopened = openExtendDialog();
    expect(dayInput(reopened)).toHaveValue(1);
  });

  it('shows the days a stored extension added and offers no further extension', () => {
    renderDetails({ ...OPEN_RFQ, isExtended: true, extensionHours: 72 } as unknown as RFQItem);

    expect(screen.getByText(formatString(DETAILS.extendedBadge, { duration: formatExtensionDayCount(3) }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Extend RFQ/i })).not.toBeInTheDocument();
  });

  it('reads a stored 48-hour extension from before the change as two days', () => {
    renderDetails({ ...OPEN_RFQ, isExtended: true, extensionHours: 48 } as unknown as RFQItem);

    expect(screen.getByText(formatString(DETAILS.extendedBadge, { duration: formatExtensionDayCount(2) }))).toBeInTheDocument();
  });
});
