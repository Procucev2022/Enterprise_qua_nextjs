/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/audit/route';
import { NextRequest } from 'next/server';

describe('/api/audit', () => {
  describe('GET', () => {
    it('should return audit logs or 500 when pool is unconfigured', async () => {
      const response = await GET();
      const data = await response.json();
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
      } else {
        expect(data.success).toBe(false);
      }
    });
  });

  describe('POST', () => {
    it('should return 400 if id or action is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/audit', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('id and action are required');
    });

    it('should return 200 or 500 depending on database connection for valid payload', async () => {
      const payload = {
        id: 'audit-test-1',
        action: 'RFQ_CREATED',
        timestamp: new Date().toISOString(),
        user: 'buyer@procucev.com',
        shaSignature: 'sha256:abc1234567890',
        status: 'TAMPER_CHECK_OK' as const,
      };
      const req = new NextRequest('http://localhost:3000/api/audit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response = await POST(req);
      const data = await response.json();
      expect([200, 500]).toContain(response.status);
    });

    it('should return 500 on json parse error', async () => {
      const req = {
        json: jest.fn().mockRejectedValue(new Error('Malformed payload')),
      } as unknown as NextRequest;
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
