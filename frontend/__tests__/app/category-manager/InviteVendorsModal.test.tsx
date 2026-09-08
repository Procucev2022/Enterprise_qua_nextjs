import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteVendorsModal from '@/app/category-manager/InviteVendorsModal';
import { useApp } from '@/lib/store';
import * as rfqClient from '@/lib/rfqClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/rfqClient', () => ({
  fetchVendorCandidates: jest.fn(),
  inviteVendorsToRFQ: jest.fn(),
}));

const S = UI_STRINGS.inviteVendors;
const mockShowToast = jest.fn();
const mockOnClose = jest.fn();
const mockOnInvited = jest.fn();

const RFQ: RFQItem = {
  id: 'rfq-1',
  rfqNumber: 'RFQ-2026-001',
  title: 'Copper Cable',
  category: 'Cables',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 0,
  targetDeliveryDate: '2026-12-01',
  budget: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  extractedEntities: [],
  quotes: [],
  chasingActive: false,
};

function candidate(overrides: Partial<RFQVendorCandidate> & { id: string }): RFQVendorCandidate {
  return {
    name: `Vendor ${overrides.id}`,
    majorCategory: 'Cables',
    alreadyInvited: false,
    ...overrides,
  } as RFQVendorCandidate;
}

const mockFetchCandidates = rfqClient.fetchVendorCandidates as jest.Mock;
const mockInvite = rfqClient.inviteVendorsToRFQ as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
  mockFetchCandidates.mockResolvedValue({ success: true, candidates: [] });
});

describe('InviteVendorsModal', () => {
  it('renders nothing when closed or when there is no RFQ', () => {
    const { container, rerender } = render(
      <InviteVendorsModal isOpen={false} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<InviteVendorsModal isOpen={true} rfq={null} onClose={mockOnClose} onInvited={mockOnInvited} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading state, then the fetched candidates', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1' }), candidate({ id: 'v-2', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    expect(screen.getByText(S.loading)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());
    expect(screen.getByText('Vendor v-2')).toBeInTheDocument();
    expect(screen.getByText(S.alreadyInvitedBadge)).toBeInTheDocument();
    expect(mockFetchCandidates).toHaveBeenCalledWith('rfq-1');
  });

  it('shows an error state when the candidate fetch fails', async () => {
    mockFetchCandidates.mockResolvedValue({ success: false, reason: 'SERVER', error: 'Boom.' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText('Boom.')).toBeInTheDocument());
  });

  it('falls back to the default load-failed message when the server gives no error text', async () => {
    mockFetchCandidates.mockResolvedValue({ success: false, reason: 'SERVER', error: '' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText(S.loadFailed)).toBeInTheDocument());
  });

  it('shows an empty state when there are no candidates', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
  });

  it('selects and deselects an individual candidate, gating the submit button on selection', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    const submitButton = screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) });
    expect(submitButton).toBeDisabled();

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) })).not.toBeDisabled();

    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) })).toBeDisabled();
  });

  it('does not toggle an already-invited candidate (disabled checkbox)', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('select-all / deselect-all toggles every invitable candidate, skipping already-invited ones', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1' }), candidate({ id: 'v-2' }), candidate({ id: 'v-3', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: S.selectAll }));
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 2 }) })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: S.deselectAll }));
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) })).toBeDisabled();
  });

  it('does not show the select-all control when there is nobody left to invite', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: S.selectAll })).not.toBeInTheDocument();
  });

  it('submits the selected vendor ids, toasts success, calls onInvited, and closes', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });
    const updatedRfq = { ...RFQ, quotesCount: 1 };
    mockInvite.mockResolvedValue({ success: true, rfq: updatedRfq, invitedCount: 1 });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith('rfq-1', ['v-1']));
    expect(mockShowToast).toHaveBeenCalledWith(
      S.successTitle,
      formatString(S.successMessage, { count: 1, rfqNumber: RFQ.rfqNumber }),
      'success'
    );
    expect(mockOnInvited).toHaveBeenCalledWith(updatedRfq, 1);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('toasts a warning and stays open when the invite call fails', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });
    mockInvite.mockResolvedValue({ success: false, reason: 'SERVER', error: 'Invite failed.' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(S.failTitle, 'Invite failed.', 'warning');
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('does not submit when nothing is selected', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) }));
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('closes via the header close button and the footer cancel button', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(S.closeAria));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: S.cancelAction }));
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it('works without an onInvited callback', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });
    mockInvite.mockResolvedValue({ success: true, rfq: RFQ, invitedCount: 1 });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
  });
});
