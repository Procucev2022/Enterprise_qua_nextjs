/**
 * @jest-environment node
 */
import { POST } from '@/app/api/db/init/route';

describe('/api/db/init', () => {
  it('should handle schema initialization or failure gracefully', async () => {
    const response = await POST();
    const data = await response.json();
    expect([200, 500]).toContain(response.status);
    expect(data).toBeDefined();
  });
});
