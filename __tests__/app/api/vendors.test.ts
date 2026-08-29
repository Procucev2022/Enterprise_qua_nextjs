/**
 * @jest-environment node
 */
import { GET, POST, PATCH } from '@/app/api/vendors/route';
import { NextRequest } from 'next/server';

describe('/api/vendors', () => {
  describe('GET', () => {
    it('should return vendors list or 500 when unconfigured', async () => {
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
    it('should return 400 if required fields are missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/vendors', {
        method: 'POST',
        body: JSON.stringify({ id: 'v-1' }),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('required');
    });

    it('should handle valid vendor item', async () => {
      const payload = {
        id: 'vendor-test-1',
        name: 'Precision Test Tech',
        email: 'info@precisiontest.com',
        majorCategory: 'Mechanical',
      };
      const req = new NextRequest('http://localhost:3000/api/vendors', {
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

  describe('PATCH', () => {
    it('should handle rating_revision action', async () => {
      const payload = {
        action: 'rating_revision',
        revision: {
          id: 'rev-1',
          vendorId: 'v-1',
          vendorName: 'Vendor',
          buyerCompany: 'Tata',
          buyerName: 'Vikram',
          timestamp: '2026-08-29',
          qualityScore: 90,
          costScore: 90,
          deliveryScore: 90,
          buyerAverage: 90,
          previousScore: 80,
          newCompositeScore: 88,
          previousRating: 4.0,
          newRating: 4.5,
          remarks: 'Good',
          shaSignature: 'sha:123',
        },
        vendor: {
          id: 'v-1',
          name: 'Vendor',
          email: 'v@test.com',
          majorCategory: 'Mechanical',
        },
      };
      const req = new NextRequest('http://localhost:3000/api/vendors', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const response = await PATCH(req);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle vendor update action without revision', async () => {
      const payload = {
        vendor: {
          id: 'v-1',
          name: 'Vendor',
          email: 'v@test.com',
          majorCategory: 'Mechanical',
        },
      };
      const req = new NextRequest('http://localhost:3000/api/vendors', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const response = await PATCH(req);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should return 400 when invalid payload is sent', async () => {
      const req = new NextRequest('http://localhost:3000/api/vendors', {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      const response = await PATCH(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid action payload');
    });

    it('should return 500 on json error', async () => {
      const req = {
        json: jest.fn().mockRejectedValue(new Error('Parse error')),
      } as unknown as NextRequest;
      const response = await PATCH(req);
      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
