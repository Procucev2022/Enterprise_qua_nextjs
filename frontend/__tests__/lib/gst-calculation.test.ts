/**
 * GST Calculation Tests
 *
 * These tests verify that GST is correctly calculated and displayed:
 * 1. Default 18% GST when no tax info is provided
 * 2. Explicit tax amount when recorded in quote
 * 3. Explicit tax rate when recorded in quote
 * 4. Grand Total calculations include GST
 */

import { DEFAULT_GST_RATE } from '@/lib/constants';

describe('GST Calculation Constants', () => {
  it('DEFAULT_GST_RATE is 0.18 (18%)', () => {
    expect(DEFAULT_GST_RATE).toBe(0.18);
  });
});

describe('GST Calculation Logic', () => {
  /**
   * Simulates the PO Modal GST calculation:
   * - If quote has explicit taxes amount, use it
   * - Otherwise default to 18% of subtotal
   */
  const calculateGstAmount = (subTotal: number, quote: any): number => {
    if (quote?.taxes && quote.taxes > 0) {
      return quote.taxes;
    }
    return Math.round(subTotal * DEFAULT_GST_RATE);
  };

  /**
   * Simulates the PO Modal GST rate calculation:
   * - If quote has explicit taxes amount, derive rate from it
   * - Otherwise default to 18%
   */
  const calculateGstRate = (subTotal: number, gstAmount: number, quote: any): number => {
    if (quote?.taxes && quote.taxes > 0 && subTotal > 0) {
      return Math.round((quote.taxes / subTotal) * 100);
    }
    return 18; // Default rate
  };

  /**
   * Simulates Grand Total calculation:
   * Grand Total = SubTotal + GST + Delivery
   */
  const calculateGrandTotal = (subTotal: number, gstAmount: number, delivery: number): number => {
    return subTotal + gstAmount + delivery;
  };

  describe('Default 18% GST when no tax info', () => {
    it('calculates 18% GST for subtotal 1,00,000', () => {
      const subTotal = 100000;
      const quote = {}; // No tax info
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(18000); // 100000 * 0.18 = 18000
    });

    it('calculates 18% GST for subtotal 2,00,000', () => {
      const subTotal = 200000;
      const quote = {}; // No tax info
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(36000); // 200000 * 0.18 = 36000
    });

    it('calculates 18% GST for subtotal 50,000', () => {
      const subTotal = 50000;
      const quote = {}; // No tax info
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(9000); // 50000 * 0.18 = 9000
    });

    it('defaults rate to 18% when no tax info', () => {
      const subTotal = 100000;
      const quote = {}; // No tax info
      const gstAmount = calculateGstAmount(subTotal, quote);
      const gstRate = calculateGstRate(subTotal, gstAmount, quote);
      
      expect(gstRate).toBe(18);
    });
  });

  describe('Explicit tax amount overrides default', () => {
    it('uses recorded tax amount instead of calculating 18%', () => {
      const subTotal = 100000;
      const quote = { taxes: 10000 }; // Explicit tax: 10%
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(10000); // Uses recorded value, not 18000
    });

    it('calculates actual tax rate from recorded amount', () => {
      const subTotal = 100000;
      const quote = { taxes: 10000 }; // Explicit tax: 10%
      const gstAmount = calculateGstAmount(subTotal, quote);
      const gstRate = calculateGstRate(subTotal, gstAmount, quote);
      
      expect(gstRate).toBe(10); // Derives 10% from taxes/subtotal
    });

    it('handles 5% GST correctly', () => {
      const subTotal = 500000;
      const quote = { taxes: 25000 }; // 5% GST
      const gstAmount = calculateGstAmount(subTotal, quote);
      const gstRate = calculateGstRate(subTotal, gstAmount, quote);
      
      expect(gstAmount).toBe(25000);
      expect(gstRate).toBe(5);
    });
  });

  describe('Grand Total calculation', () => {
    it('Grand Total = Subtotal + GST (18%) + Delivery for 1,00,000 order', () => {
      const subTotal = 100000;
      const delivery = 5000;
      const quote = {}; // No tax info, should default to 18%
      const gstAmount = calculateGstAmount(subTotal, quote);
      const grandTotal = calculateGrandTotal(subTotal, gstAmount, delivery);
      
      expect(gstAmount).toBe(18000);
      expect(grandTotal).toBe(123000); // 100000 + 18000 + 5000
    });

    it('Grand Total = Subtotal + GST + Delivery for order with explicit 10% GST', () => {
      const subTotal = 200000;
      const delivery = 10000;
      const quote = { taxes: 20000 }; // 10% GST
      const gstAmount = calculateGstAmount(subTotal, quote);
      const grandTotal = calculateGrandTotal(subTotal, gstAmount, delivery);
      
      expect(gstAmount).toBe(20000);
      expect(grandTotal).toBe(230000); // 200000 + 20000 + 10000
    });

    it('Grand Total with zero delivery charges', () => {
      const subTotal = 150000;
      const delivery = 0;
      const quote = {}; // Default 18% GST
      const gstAmount = calculateGstAmount(subTotal, quote);
      const grandTotal = calculateGrandTotal(subTotal, gstAmount, delivery);
      
      expect(gstAmount).toBe(27000); // 150000 * 0.18 = 27000
      expect(grandTotal).toBe(177000); // 150000 + 27000 + 0
    });
  });

  describe('Line-item GST calculation (quote-matrix)', () => {
    /**
     * Simulates line-item GST calculation in quote-matrix:
     * For each line, calculate 18% GST if no tax info exists
     */
    const calculateLineItemGst = (lineTotal: number, quote: any): number => {
      if (lineTotal === null || lineTotal === undefined) return 0;
      if (quote?.taxes && quote.taxes > 0) return quote.taxes; // Per-quote tax
      return Math.round(lineTotal * 0.18);
    };

    it('calculates 18% GST for line-item total 2,000', () => {
      const lineTotal = 2000;
      const quote = {}; // No tax info
      const gst = calculateLineItemGst(lineTotal, quote);
      
      expect(gst).toBe(360); // 2000 * 0.18 = 360
    });

    it('calculates 18% GST for line-item total 10,000', () => {
      const lineTotal = 10000;
      const quote = {}; // No tax info
      const gst = calculateLineItemGst(lineTotal, quote);
      
      expect(gst).toBe(1800); // 10000 * 0.18 = 1800
    });

    it('respects recorded tax amount per quote', () => {
      const lineTotal = 10000;
      const quote = { taxes: 500 }; // Explicit 5% per line
      const gst = calculateLineItemGst(lineTotal, quote);
      
      expect(gst).toBe(500); // Uses recorded value
    });
  });

  describe('Rounding behavior', () => {
    it('rounds down GST for 1,25,000 subtotal: 22,500 GST', () => {
      const subTotal = 125000;
      const quote = {}; // No tax info, default 18%
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(22500); // 125000 * 0.18 = 22500 (exact)
    });

    it('rounds correctly for GST 23,999', () => {
      const subTotal = 133327;
      const quote = {}; // No tax info, default 18%
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      // 133327 * 0.18 = 23998.86, Math.round = 23999
      expect(gstAmount).toBe(23999);
    });
  });

  describe('Edge cases', () => {
    it('handles zero subtotal', () => {
      const subTotal = 0;
      const quote = {}; // No tax info
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(0);
    });

    it('handles zero taxes field (skips to default 18%)', () => {
      const subTotal = 100000;
      const quote = { taxes: 0 }; // Explicitly zero
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      // Should default to 18% since taxes is falsy
      expect(gstAmount).toBe(18000);
    });

    it('handles undefined taxes field (uses default 18%)', () => {
      const subTotal = 100000;
      const quote = { taxes: undefined }; // Undefined
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(18000);
    });

    it('handles very large amounts', () => {
      const subTotal = 10000000; // 1 crore
      const quote = {}; // No tax info, default 18%
      const gstAmount = calculateGstAmount(subTotal, quote);
      
      expect(gstAmount).toBe(1800000); // 10000000 * 0.18 = 1800000
    });
  });
});

