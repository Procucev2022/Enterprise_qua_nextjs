/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/ai-feed/route';
import { NextRequest } from 'next/server';

describe('/api/ai-feed', () => {
  describe('GET', () => {
    it('should return 200 and list of feeds or empty fallback', async () => {
      const response = await GET();
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  describe('POST', () => {
    it('should return 400 if id or title is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai-feed', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('id and title are required');
    });

    it('should return 200 and saved item when payload is valid', async () => {
      const payload = {
        id: 'feed-test-1',
        title: 'Auto-chaser triggered',
        message: 'WhatsApp sent to vendor',
        type: 'whatsapp' as const,
        channel: 'whatsapp' as const,
        timestamp: new Date().toISOString(),
      };
      const req = new NextRequest('http://localhost:3000/api/ai-feed', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('feed-test-1');
    });

    it('should return 500 if json parsing fails', async () => {
      const req = {
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as NextRequest;
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid JSON');
    });
  });
});
