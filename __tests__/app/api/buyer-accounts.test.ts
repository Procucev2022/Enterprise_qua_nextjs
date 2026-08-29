/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/buyer-accounts/route';
import { NextRequest } from 'next/server';

describe('/api/buyer-accounts', () => {
  describe('GET', () => {
    it('should return list of buyer accounts', async () => {
      const response = await GET();
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  describe('POST', () => {
    it('should return 400 when required fields are missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/buyer-accounts', {
        method: 'POST',
        body: JSON.stringify({ id: 'acc-1' }),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('required');
    });

    it('should return 200 for valid buyer account payload', async () => {
      const payload = {
        id: 'acc-test-1',
        organizationName: 'Acme Test Corp',
        corporateEmail: 'procure@acme.com',
        contactPerson: 'Alice Smith',
        mobileNumber: '+91 9988776655',
        gstin: '27AABCU9603R1ZN',
        industrySector: 'Manufacturing',
        sourcingMode: 'mode_1' as const,
        subscriptionPlan: 'free_trial' as const,
        remainingFreeRFQs: 5,
        accountSource: 'public_system' as const,
        status: 'ACTIVE_VERIFIED' as const,
        primaryPlantLocation: 'Mumbai',
        supportedMajorCategories: ['Mechanical'],
        totalRFQsCreated: 0,
        totalSpend: '$0',
        syncTimestamp: new Date().toISOString(),
        createdDate: '2026-08-29',
      };
      const req = new NextRequest('http://localhost:3000/api/buyer-accounts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('acc-test-1');
    });

    it('should return 500 when json parsing errors out', async () => {
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
