import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CategoryManagerBuyersDirectoryPage from '@/app/category-manager/buyers-directory/page';
import CategoryManagerSellersDirectoryPage from '@/app/category-manager/sellers-directory/page';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/app/category-manager/buyers-directory', () => ({
  __esModule: true,
  default: ({ onSelectRFQ }: { onSelectRFQ?: (rfq: RFQItem) => void }) => (
    <div>
      <button onClick={() => onSelectRFQ?.({ rfqNumber: 'RFQ-101' } as RFQItem)}>Select with number</button>
      <button onClick={() => onSelectRFQ?.({ rfqNumber: '' } as RFQItem)}>Select without number</button>
      <button onClick={() => onSelectRFQ?.(null as unknown as RFQItem)}>Select null</button>
    </div>
  ),
}));

jest.mock('@/app/category-manager/sellers-directory', () => ({
  __esModule: true,
  default: ({ onSelectRFQ }: { onSelectRFQ?: (rfq: RFQItem) => void }) => (
    <div>
      <button onClick={() => onSelectRFQ?.({ rfqNumber: 'RFQ-202' } as RFQItem)}>Select seller with number</button>
      <button onClick={() => onSelectRFQ?.({ rfqNumber: '' } as RFQItem)}>Select seller without number</button>
      <button onClick={() => onSelectRFQ?.(null as unknown as RFQItem)}>Select seller null</button>
    </div>
  ),
}));

describe('Category Manager Directory Pages onSelectRFQ Coverage', () => {
  const mockSetSelected = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      setSelectedRFQForMatrix: mockSetSelected,
    });
  });

  describe('CategoryManagerBuyersDirectoryPage', () => {
    it('routes to quote matrix with rfq query param when rfqNumber is present', () => {
      render(<CategoryManagerBuyersDirectoryPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select with number' }));

      expect(mockSetSelected).toHaveBeenCalledWith({ rfqNumber: 'RFQ-101' });
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix?rfq=RFQ-101');
    });

    it('routes to quote matrix base path when rfqNumber is empty', () => {
      render(<CategoryManagerBuyersDirectoryPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select without number' }));

      expect(mockSetSelected).toHaveBeenCalledWith({ rfqNumber: '' });
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');
    });

    it('routes to quote matrix base path when rfq is null', () => {
      render(<CategoryManagerBuyersDirectoryPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select null' }));

      expect(mockSetSelected).toHaveBeenCalledWith(null);
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');
    });
  });

  describe('CategoryManagerSellersDirectoryPage', () => {
    it('routes to quote matrix with rfq query param when rfqNumber is present', () => {
      render(<CategoryManagerSellersDirectoryPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select seller with number' }));

      expect(mockSetSelected).toHaveBeenCalledWith({ rfqNumber: 'RFQ-202' });
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix?rfq=RFQ-202');
    });

    it('routes to quote matrix base path when rfqNumber is empty', () => {
      render(<CategoryManagerSellersDirectoryPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select seller without number' }));

      expect(mockSetSelected).toHaveBeenCalledWith({ rfqNumber: '' });
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');
    });

    it('routes to quote matrix base path when rfq is null', () => {
      render(<CategoryManagerSellersDirectoryPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Select seller null' }));

      expect(mockSetSelected).toHaveBeenCalledWith(null);
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');
    });
  });
});
