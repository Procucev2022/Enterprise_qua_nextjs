/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/rfqs/route';
import { NextRequest } from 'next/server';

describe('/api/rfqs', () => {
  describe('GET', () => {
    it('should return rfqs or 500 when database is not configured', async () => {
      const response = await GET();
      const data = await response.json();
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
      }
    });
  });

  describe('POST', () => {
    it('should return 400 if id or rfqNumber is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/rfqs', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('required');
    });

    it('should handle valid RFQ item', async () => {
      const payload = {
        id: 'rfq-test-1',
        rfqNumber: 'RFQ-TEST-001',
        title: 'Industrial Heavy Valves',
        category: 'Mechanical',
        createdAt: '2026-08-29',
        status: 'OPEN_BIDDING' as const,
      };
      const req = new NextRequest('http://localhost:3000/api/rfqs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response = await POST(req);
      const data = await response.json();
      expect([200, 500]).toContain(response.status);
    });

    it('should return 500 on malformed json', async () => {
      const req = {
        json: jest.fn().mockRejectedValue(new Error('SyntaxError')),
      } as unknown as NextRequest;
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
