import { FEATURE_FLAGS } from '@/lib/featureFlags';

describe('lib/featureFlags', () => {
  it('should export valid FEATURE_FLAGS configuration with default values', () => {
    expect(FEATURE_FLAGS).toBeDefined();
    expect(FEATURE_FLAGS.ENABLE_MODE_3).toBe(false);
    expect(FEATURE_FLAGS.ENABLE_VENDOR_RATING).toBe(true);
    expect(FEATURE_FLAGS.ENABLE_VENDOR_EVALUATION_REQUEST).toBe(false);
  });
});
