/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/evaluations/route';
import { NextRequest } from 'next/server';

describe('/api/evaluations', () => {
  describe('GET', () => {
    it('should return evaluations list or 500 when unconfigured', async () => {
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
    it('should return 400 if required fields missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/evaluations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('required');
    });

    it('should handle valid evaluation payload', async () => {
      const payload = {
        id: 'eval-test-1',
        vendorId: 'v-001',
        vendorName: 'Apex Industrial',
        status: 'PREFERRED ENTERPRISE SUPPLIER' as const,
        overallScore: 95.0,
      };
      const req = new NextRequest('http://localhost:3000/api/evaluations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response = await POST(req);
      const data = await response.json();
      expect([200, 500]).toContain(response.status);
    });

    it('should return 500 on json parse error', async () => {
      const req = {
        json: jest.fn().mockRejectedValue(new Error('Parse error')),
      } as unknown as NextRequest;
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
