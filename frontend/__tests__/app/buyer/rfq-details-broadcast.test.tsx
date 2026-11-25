import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RFQDetails from '@/app/buyer/rfq-details';
import * as storeModule from '@/lib/store';
import * as rfqClientModule from '@/lib/rfqClient';
import type { RFQItem, RFQBroadcast } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/authClient', () => ({
  authClient: { getToken: jest.fn(() => 'test-token') },
}));
jest.mock('@/lib/rfqClient', () => ({
  rfqAttachmentUrl: jest.fn((id: string) => `/api/rfqs/attachments/${id}`),
  updateRFQ: jest.fn(),
  extendRFQ: jest.fn(),
  replyToRFQInquiry: jest.fn(),
  submitRFQInquiry: jest.fn(),
  publishRFQBroadcast: jest.fn(),
  uploadRFQAttachment: jest.fn(),
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

const mockShowToast = jest.fn();
const mockRefreshFromDB = jest.fn();

const BASE_RFQ: RFQItem = {
  id: 'rfq-bcast-1',
  rfqNumber: 'RFQ261911470099',
  title: 'Stainless Steel Pipes Procurement',
  category: 'Piping',
  budget: 500000,
  targetDeliveryDate: '2029-12-01',
  deliveryLocation: 'Ahmedabad Plant',
  deliveryPincode: '380001',
  status: 'Quotes Pending',
  sourcingMode: 'mode_1',
  deadline: '2029-12-15T18:00:00.000Z',
  closingDeadline: '2029-12-15T18:00:00.000Z',
  createdAt: '2026-11-20T08:00:00.000Z',
  extractedEntities: [],
  quotes: [],
  quotesCount: 0,
  assignedVendors: [],
  inquiries: [],
  broadcasts: [
    {
      id: 'bcast-existing-1',
      rfqId: 'rfq-bcast-1',
      rfqNumber: 'RFQ261911470099',
      title: 'Addendum #1: Grade 316 Specification',
      message: 'Please note all flanges must strictly adhere to ASTM A182 Grade F316.',
      attachments: [
        {
          id: 'att-bcast-1',
          fileName: 'flange_spec_rev1.pdf',
          size: 204800,
          uploadedAt: '2026-11-21T10:00:00.000Z',
        },
      ],
      authorName: 'Senior Procurement Lead',
      authorRole: 'buyer',
      createdAt: '2026-11-21T10:00:00.000Z',
    },
  ],
  attachments: [],
} as unknown as RFQItem;

describe('RFQ Information Broadcast Section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: { id: 'usr-buyer-1', role: 'buyer', name: 'Alok Buyer', email: 'alok@procucev.com' },
      currentRole: 'buyer',
      showToast: mockShowToast,
      refreshFromDB: mockRefreshFromDB,
      buyerVendors: [],
    });
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  describe('Buyer View', () => {
    test('renders Information Broadcast section with existing announcements and attachments', () => {
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      expect(screen.getByText('Information Broadcast & Bulletins')).toBeInTheDocument();
      expect(screen.getByText('Addendum #1: Grade 316 Specification')).toBeInTheDocument();
      expect(
        screen.getByText('Please note all flanges must strictly adhere to ASTM A182 Grade F316.')
      ).toBeInTheDocument();
      expect(screen.getByText('flange_spec_rev1.pdf')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Publish Broadcast/i })).toBeInTheDocument();
    });

    test('allows buyer to expand composer, type message, and publish broadcast', async () => {
      const mockUpdatedRfq = {
        ...BASE_RFQ,
        broadcasts: [
          ...(BASE_RFQ.broadcasts || []),
          {
            id: 'bcast-new-2',
            rfqId: BASE_RFQ.id,
            rfqNumber: BASE_RFQ.rfqNumber,
            title: 'Addendum #2: Delivery Date Extended',
            message: 'Target delivery extended by 7 days to Jan 8, 2030.',
            attachments: [],
            authorName: 'Alok Buyer',
            authorRole: 'buyer',
            createdAt: new Date().toISOString(),
          },
        ],
      };

      (rfqClientModule.publishRFQBroadcast as jest.Mock).mockResolvedValue({
        success: true,
        rfq: mockUpdatedRfq,
      });

      const onUpdateMock = jest.fn();
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} onUpdate={onUpdateMock} isVendorView={false} />);

      // Open publisher composer
      fireEvent.click(screen.getByRole('button', { name: /Publish Broadcast/i }));

      // Fill in Title and Message
      const titleInput = screen.getByPlaceholderText(/Addendum #1: Revised Technical Specification/i);
      const messageInput = screen.getByPlaceholderText(/Type the announcement details, clarifications, or revisions/i);

      fireEvent.change(titleInput, { target: { value: 'Addendum #2: Delivery Date Extended' } });
      fireEvent.change(messageInput, { target: { value: 'Target delivery extended by 7 days to Jan 8, 2030.' } });

      // Click Publish Broadcast submit button
      const submitBtn = screen.getByRole('button', { name: /Publish Broadcast/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(rfqClientModule.publishRFQBroadcast).toHaveBeenCalledWith(BASE_RFQ.id, {
          title: 'Addendum #2: Delivery Date Extended',
          message: 'Target delivery extended by 7 days to Jan 8, 2030.',
          attachments: [],
        });
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        'Broadcast Published',
        expect.stringMatching(/successfully shared with all/i),
        'success'
      );
      expect(onUpdateMock).toHaveBeenCalledWith(mockUpdatedRfq);
    });

    test('allows buyer to attach files to broadcast announcement and remove them', async () => {
      (rfqClientModule.uploadRFQAttachment as jest.Mock).mockResolvedValue({
        success: true,
        data: { id: 'att-new-99', fileName: 'test_drawing.pdf', size: 10240 },
      });

      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      // Expand composer
      fireEvent.click(screen.getByRole('button', { name: /Publish Broadcast/i }));

      // Attach file
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      const testFile = new File(['dummy-content'], 'test_drawing.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      await waitFor(() => {
        expect(rfqClientModule.uploadRFQAttachment).toHaveBeenCalledWith(testFile);
      });

      expect(await screen.findByText('test_drawing.pdf')).toBeInTheDocument();

      // Remove attachment
      const removeBtn = screen.getByTitle('Remove attachment');
      fireEvent.click(removeBtn);
      expect(screen.queryByText('test_drawing.pdf')).not.toBeInTheDocument();
    });

    test('handles download of attached document', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: jest.fn().mockResolvedValue(new Blob(['test-binary'], { type: 'application/pdf' })),
      } as any);

      window.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      window.URL.revokeObjectURL = jest.fn();

      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      const downloadBtn = screen.getByRole('button', { name: /Download/i });
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/attachments/att-bcast-1', expect.any(Object));
      });
    });

    test('handles download failure and download exception', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false } as any);
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      const downloadBtn = screen.getByRole('button', { name: /Download/i });
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Download Failed', expect.any(String), 'warning');
      });

      // Network exception
      global.fetch = jest.fn().mockRejectedValue(new Error('Network drop'));
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Download Error', expect.any(String), 'warning');
      });
    });

    test('cancel button clears composer and closes it', () => {
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      fireEvent.click(screen.getByRole('button', { name: /Publish Broadcast/i }));
      const titleInput = screen.getByPlaceholderText(/Addendum #1: Revised Technical Specification/i);
      fireEvent.change(titleInput, { target: { value: 'Draft Title' } });

      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);

      expect(screen.queryByPlaceholderText(/Addendum #1: Revised Technical Specification/i)).not.toBeInTheDocument();
    });

    test('handles upload attachment failure', async () => {
      (rfqClientModule.uploadRFQAttachment as jest.Mock).mockResolvedValue({
        success: false,
        error: 'File size exceeds 25MB limit',
      });

      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      fireEvent.click(screen.getByRole('button', { name: /Publish Broadcast/i }));
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      const testFile = new File(['huge-data'], 'large.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Upload Failed', 'File size exceeds 25MB limit', 'warning');
      });
    });

    test('handles publish failure and exception', async () => {
      (rfqClientModule.publishRFQBroadcast as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Server validation error',
      });

      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      fireEvent.click(screen.getByRole('button', { name: /Publish Broadcast/i }));
      const messageInput = screen.getByPlaceholderText(/Type the announcement details/i);
      fireEvent.change(messageInput, { target: { value: 'Important broadcast message' } });

      const submitBtn = screen.getByRole('button', { name: /Publish Broadcast/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Broadcast Failed', 'Server validation error', 'warning');
      });

      // Exception branch
      (rfqClientModule.publishRFQBroadcast as jest.Mock).mockRejectedValue(new Error('Fatal publish crash'));
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Broadcast Failed', 'Fatal publish crash', 'warning');
      });
    });

    test('handles publish when response returns res.data without res.rfq', async () => {
      (rfqClientModule.publishRFQBroadcast as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          id: 'bcast-fallback-data',
          title: 'Fallback Notice',
          message: 'Fallback message',
          createdAt: new Date().toISOString(),
        },
      });

      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={false} />);

      fireEvent.click(screen.getByRole('button', { name: /Publish Broadcast/i }));
      const messageInput = screen.getByPlaceholderText(/Type the announcement details/i);
      fireEvent.change(messageInput, { target: { value: 'Fallback message' } });

      const submitBtn = screen.getByRole('button', { name: /Publish Broadcast/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Broadcast Published', expect.any(String), 'success');
      });
    });

    test('renders empty state when RFQ has zero broadcasts', () => {
      const emptyRfq = { ...BASE_RFQ, broadcasts: [] };
      render(<RFQDetails rfq={emptyRfq} onBack={jest.fn()} isVendorView={false} />);

      expect(screen.getByText('No Information Broadcasts Published')).toBeInTheDocument();
      expect(screen.getByText(/Share addenda, technical drawings, or delivery updates/i)).toBeInTheDocument();
    });

    test('renders category manager author badge and broadcast without title', () => {
      const cmBroadcastRfq: RFQItem = {
        ...BASE_RFQ,
        broadcasts: [
          {
            id: 'bcast-cm-1',
            rfqId: BASE_RFQ.id,
            rfqNumber: BASE_RFQ.rfqNumber,
            message: 'Specification updated by Category Manager without any title',
            authorName: 'Sarah Jenkins',
            authorRole: 'category_manager',
            createdAt: '2026-11-22T14:30:00.000Z',
          },
        ],
      };

      render(<RFQDetails rfq={cmBroadcastRfq} onBack={jest.fn()} isVendorView={false} />);

      expect(screen.getByText('Category Manager: Sarah Jenkins')).toBeInTheDocument();
      expect(
        screen.getByText('Specification updated by Category Manager without any title')
      ).toBeInTheDocument();
    });
  });

  describe('Vendor View', () => {
    beforeEach(() => {
      (storeModule.useApp as jest.Mock).mockReturnValue({
        currentUserSession: { id: 'v-99', role: 'vendor', name: 'Apex Engineering', email: 'sales@apex.in' },
        currentRole: 'vendor',
        showToast: mockShowToast,
        refreshFromDB: mockRefreshFromDB,
        buyerVendors: [],
      });
    });

    test('renders broadcast announcement stream for vendor and omits publisher controls', () => {
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={true} />);

      // Vendor sees broadcasts
      expect(screen.getByText('Information Broadcast & Bulletins')).toBeInTheDocument();
      expect(screen.getByText('Addendum #1: Grade 316 Specification')).toBeInTheDocument();
      expect(screen.getByText('flange_spec_rev1.pdf')).toBeInTheDocument();

      // Vendor DOES NOT see publisher button or composer
      expect(screen.queryByRole('button', { name: /Publish Broadcast/i })).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Type the announcement details/i)).not.toBeInTheDocument();
    });

    test('vendor has zero public reply options on broadcasts', () => {
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={true} />);

      // No public comment or reply textareas inside the broadcast container
      const broadcastPanel = screen.getByText('Information Broadcast & Bulletins').closest('.panel, div');
      expect(broadcastPanel).toBeInTheDocument();

      // Ensure no public comment form is rendered
      expect(screen.queryByPlaceholderText(/leave a comment/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Reply$/i })).not.toBeInTheDocument();
    });

    test('vendor clicking Reply Privately in Clarifications directs to private inquiry desk', () => {
      render(<RFQDetails rfq={BASE_RFQ} onBack={jest.fn()} isVendorView={true} />);

      const privateReplyBtn = screen.getByRole('button', { name: /Reply Privately in Clarifications/i });
      expect(privateReplyBtn).toBeInTheDocument();

      fireEvent.click(privateReplyBtn);

      // Verify notification of private routing
      expect(mockShowToast).toHaveBeenCalledWith(
        'Private Clarification Desk',
        expect.stringMatching(/never visible to other vendors/i),
        'info'
      );

      // Verify chat text was populated with reference to the broadcast
      const chatTextarea = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      expect((chatTextarea as HTMLTextAreaElement).value).toContain('[Re Broadcast: "Addendum #1: Grade 316 Specification"]');
    });

    test('vendor clicking Reply Privately on broadcast without title uses message preview in reference', () => {
      const untitledBroadcastRfq: RFQItem = {
        ...BASE_RFQ,
        broadcasts: [
          {
            id: 'bcast-no-title',
            rfqId: BASE_RFQ.id,
            rfqNumber: BASE_RFQ.rfqNumber,
            message: 'Urgent notice regarding factory dispatch address',
            authorName: 'Buyer',
            authorRole: 'buyer',
            createdAt: '2026-11-23T09:00:00.000Z',
          },
        ],
      };

      render(<RFQDetails rfq={untitledBroadcastRfq} onBack={jest.fn()} isVendorView={true} />);

      const privateReplyBtn = screen.getByRole('button', { name: /Reply Privately in Clarifications/i });
      fireEvent.click(privateReplyBtn);

      const chatTextarea = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      expect((chatTextarea as HTMLTextAreaElement).value).toContain('[Re Broadcast: "Urgent notice regarding factor..."]');
    });

    test('renders vendor empty state when no broadcasts exist', () => {
      const emptyRfq = { ...BASE_RFQ, broadcasts: [] };
      render(<RFQDetails rfq={emptyRfq} onBack={jest.fn()} isVendorView={true} />);

      expect(screen.getByText('No Information Broadcasts Published')).toBeInTheDocument();
      expect(screen.getByText(/The buyer has not posted any official addenda or broadcasts/i)).toBeInTheDocument();
    });
  });
});
