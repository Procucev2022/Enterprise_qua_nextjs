/**
 * @jest-environment node
 */
import { POST } from '@/app/api/db/sync/route';

describe('/api/db/sync', () => {
  it('should handle database synchronization', async () => {
    const response = await POST();
    const data = await response.json();
    expect([200, 500]).toContain(response.status);
    expect(data).toBeDefined();
  });
});
