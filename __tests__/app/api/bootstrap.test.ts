/**
 * @jest-environment node
 */
import { GET } from '@/app/api/bootstrap/route';

describe('/api/bootstrap', () => {
  it('should return 200 with bootstrap data or 500 when unconfigured', async () => {
    const response = await GET();
    const data = await response.json();
    expect([200, 500]).toContain(response.status);
    if (response.status === 200) {
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    } else {
      expect(data.success).toBe(false);
    }
  });
});
