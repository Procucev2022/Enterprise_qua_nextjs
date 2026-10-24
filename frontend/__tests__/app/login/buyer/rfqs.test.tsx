import React from 'react';
import { render, waitFor } from '@testing-library/react';
import LoginBuyerRfqsPage from '@/app/login/buyer/rfqs/page';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

describe('LoginBuyerRfqsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('redirects to /login?redirect=/buyer/rfq-summary when no rfq param is provided', async () => {
    render(<LoginBuyerRfqsPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login?redirect=/buyer/rfq-summary');
    });
  });

  it('redirects to /login?redirect=... when rfq param is provided', async () => {
    mockSearchParams = new URLSearchParams('rfq=RFQ262410013365');
    render(<LoginBuyerRfqsPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `/login?redirect=${encodeURIComponent('/buyer/rfq-details?rfq=RFQ262410013365')}`
      );
    });
  });
});
