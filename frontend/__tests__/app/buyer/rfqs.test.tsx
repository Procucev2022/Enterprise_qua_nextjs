import React from 'react';
import { render, waitFor } from '@testing-library/react';
import BuyerRfqsPage from '@/app/buyer/rfqs/page';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

describe('BuyerRfqsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('redirects to /buyer/rfq-summary when no rfq parameter is provided', async () => {
    render(<BuyerRfqsPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/buyer/rfq-summary');
    });
  });

  it('redirects to /buyer/rfq-details with rfq param when rfq is present', async () => {
    mockSearchParams = new URLSearchParams('rfq=RFQ262410013365');
    render(<BuyerRfqsPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/buyer/rfq-details?rfq=RFQ262410013365');
    });
  });
});
