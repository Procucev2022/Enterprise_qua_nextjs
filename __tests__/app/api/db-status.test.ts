/**
 * @jest-environment node
 */
import { GET } from '@/app/api/db/status/route';

describe('/api/db/status', () => {
  it('should return database health status', async () => {
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.timestamp).toBeDefined();
  });
});
