/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/system-config/route';
import { NextRequest } from 'next/server';
import { INITIAL_SYSTEM_CONFIG } from '@/lib/constants';

describe('/api/system-config', () => {
  describe('GET', () => {
    it('should return system configuration', async () => {
      const response = await GET();
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe('POST', () => {
    it('should return 200 and updated config for valid body', async () => {
      const payload = {
        ...INITIAL_SYSTEM_CONFIG,
        ollamaModel: 'Llama 3.1 70B',
      };
      const req = new NextRequest('http://localhost:3000/api/system-config', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response = await POST(req);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.ollamaModel).toBe('Llama 3.1 70B');
    });

    it('should return 500 on json error', async () => {
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
