import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorQuotationFormPage from '@/app/vendor/quotation-form/page';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

const mockRouterPush = jest.fn();
let mockSearchParams = new Map<string, string>();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) || null,
  }),
}));

jest.mock('@/app/vendor/quotation-form', () => {
  return function MockQuotationForm({ opportunity, onBack, onSubmitSuccess }: any) {
    return (
      <div data-testid="mock-quotation-form">
        <span data-testid="opp-title">{opportunity?.title}</span>
        <span data-testid="opp-type">{opportunity?.type}</span>
        <span data-testid="opp-status">{opportunity?.status}</span>
        <span data-testid="opp-buyer">{opportunity?.buyer}</span>
        <span data-testid="opp-est-val">{opportunity?.estimatedValue || 'no-est-val'}</span>
        <button data-testid="back-btn" onClick={onBack}>Back</button>
        <button data-testid="submit-btn" onClick={onSubmitSuccess}>Submit</button>
      </div>
    );
  };
});

describe('VendorQuotationFormPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new Map();
    authClient.setSession(
      {
        id: 'user-1',
        email: 'vendor@test.com',
        name: 'Test Vendor Co',
        role: 'vendor',
        orgId: 'org-1',
        orgName: 'Test Vendor Co',
      },
      'fake-test-token',
    );
  });

  test('renders empty message when no opportunity or rfqs exist', async () => {
    render(
      <AppProvider>
        <VendorQuotationFormPage />
      </AppProvider>
    );

    expect(
      screen.getByText(/No open opportunity is available to quote on right now/i)
    ).toBeInTheDocument();
  });

  test('resolves opportunity from searchParams "rfq" with positive budget and pending_bid status', async () => {
    mockSearchParams.set('rfq', 'RFQ-2026-001');

    function Wrapper() {
      const { adoptCreatedRFQ } = useApp();
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (!seededRef.current) {
          seededRef.current = true;
          adoptCreatedRFQ({
            id: 'rfq-1',
            rfqNumber: 'RFQ-2026-001',
            title: 'Centrifugal Pump Unit',
            buyerAccountName: 'L&T Ltd',
            category: 'Mechanical',
            sourcingMode: 'mode_1',
            status: 'Quotes Pending',
            quotesCount: 0,
            quotes: [],
            targetDeliveryDate: '2026-09-15',
            budget: 150000,
            deliveryLocation: 'Mumbai',
            extractedEntities: [
              { id: 'item-1', itemName: 'Pump', quantity: 5, minorCategory: 'Pumps' },
            ],
          } as any);
        }
      }, [adoptCreatedRFQ]);
      return <VendorQuotationFormPage />;
    }

    render(
      <AppProvider>
        <Wrapper />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('opp-title')).toHaveTextContent('Centrifugal Pump Unit');
    });

    expect(screen.getByTestId('opp-type')).toBeInTheDocument();
    expect(screen.getByTestId('opp-status')).toHaveTextContent('under_review');
    expect(screen.getByTestId('opp-buyer')).toBeInTheDocument();
    expect(screen.getByTestId('opp-est-val')).toBeInTheDocument();

    // Trigger onBack and onSubmitSuccess
    fireEvent.click(screen.getByTestId('back-btn'));
    expect(mockRouterPush).toHaveBeenCalledWith('/vendor/opportunity-feed');

    fireEvent.click(screen.getByTestId('submit-btn'));
    expect(mockRouterPush).toHaveBeenCalledWith('/vendor/quotation-form');
  });

  test('resolves opportunity from searchParams "id" matching mode_3, zero budget, closed status, and default buyer', async () => {
    mockSearchParams.set('id', 'RFQ-MODE-3');

    function Wrapper() {
      const { adoptCreatedRFQ } = useApp();
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (!seededRef.current) {
          seededRef.current = true;
          adoptCreatedRFQ({
            id: 'rfq-m3',
            rfqNumber: 'RFQ-MODE-3',
            title: 'Marketplace Screws',
            sourcingMode: 'mode_3',
            status: 'Closed',
            budget: 0,
            extractedEntities: [{ itemName: 'Screw M5', quantity: 100 }],
          } as any);
        }
      }, [adoptCreatedRFQ]);
      return <VendorQuotationFormPage />;
    }

    render(
      <AppProvider>
        <Wrapper />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('opp-title')).toHaveTextContent('Marketplace Screws');
    });

    expect(screen.getByTestId('opp-type')).toHaveTextContent('network_marketplace');
    expect(screen.getByTestId('opp-status')).toHaveTextContent('Closed');
    expect(screen.getByTestId('opp-buyer')).toHaveTextContent('Buyer enterprise');
    expect(screen.getByTestId('opp-est-val')).toHaveTextContent('no-est-val');
  });

  test('resolves opportunity with under_review status when rfq has quotes', async () => {
    mockSearchParams.set('rfq', 'RFQ-QUOTES-1');

    function Wrapper() {
      const { adoptCreatedRFQ } = useApp();
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (!seededRef.current) {
          seededRef.current = true;
          adoptCreatedRFQ({
            id: 'rfq-q1',
            rfqNumber: 'RFQ-QUOTES-1',
            title: 'Valves Package',
            status: 'Quotes Pending',
            quotes: [{ id: 'q-1', vendorId: 'v-1' }],
            budget: 50000,
          } as any);
        }
      }, [adoptCreatedRFQ]);
      return <VendorQuotationFormPage />;
    }

    render(
      <AppProvider>
        <Wrapper />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('opp-status')).toHaveTextContent('under_review');
    });
  });

  test('falls back to selectedVendorOpportunity when query param is absent', async () => {
    const oppFixture: any = {
      id: 'opp-selected-1',
      rfqNumber: 'RFQ-SEL-1',
      title: 'Direct Selected Opp',
      type: 'direct_invitation',
      status: 'pending_bid',
      buyer: 'Selected Buyer Corp',
    };

    function Wrapper() {
      const { setSelectedVendorOpportunity } = useApp();
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (!seededRef.current) {
          seededRef.current = true;
          setSelectedVendorOpportunity(oppFixture);
        }
      }, [setSelectedVendorOpportunity]);
      return <VendorQuotationFormPage />;
    }

    render(
      <AppProvider>
        <Wrapper />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('opp-title')).toHaveTextContent('Direct Selected Opp');
    });
  });

  test('derives opportunity from open rfqs when no query param and no selected opportunity', async () => {
    function Wrapper() {
      const { adoptCreatedRFQ, setSelectedVendorOpportunity } = useApp();
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (!seededRef.current) {
          seededRef.current = true;
          setSelectedVendorOpportunity(null);
          adoptCreatedRFQ({
            id: 'rfq-expired-1',
            rfqNumber: 'RFQ-EXP-1',
            title: 'Expired RFQ',
            status: 'Expired',
          } as any);
          adoptCreatedRFQ({
            id: 'rfq-active-1',
            rfqNumber: 'RFQ-ACT-1',
            title: 'Active Open RFQ',
            status: 'Quotes Pending',
            sourcingMode: 'mode_1',
            budget: 200000,
          } as any);
        }
      }, [adoptCreatedRFQ, setSelectedVendorOpportunity]);
      return <VendorQuotationFormPage />;
    }

    render(
      <AppProvider>
        <Wrapper />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('opp-title')).toHaveTextContent('Active Open RFQ');
    });
  });

  test('derives opportunity from all-closed rfqs fallback rfqs[0]', async () => {
    function Wrapper() {
      const { adoptCreatedRFQ, setSelectedVendorOpportunity } = useApp();
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (!seededRef.current) {
          seededRef.current = true;
          setSelectedVendorOpportunity(null);
          adoptCreatedRFQ({
            id: 'rfq-closed-only',
            rfqNumber: 'RFQ-CL-1',
            title: 'Only Closed RFQ',
            status: 'Closed',
          } as any);
        }
      }, [adoptCreatedRFQ, setSelectedVendorOpportunity]);
      return <VendorQuotationFormPage />;
    }

    render(
      <AppProvider>
        <Wrapper />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('opp-title')).toHaveTextContent('Only Closed RFQ');
    });
  });
});
