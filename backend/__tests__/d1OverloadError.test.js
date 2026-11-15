const { isD1OverloadError, isRetryableD1Error } = require('../src/db/d1Bridge');

describe('isD1OverloadError', () => {
  test('recognizes the platform overload message', () => {
    expect(isD1OverloadError(new Error('D1_ERROR: D1 DB is overloaded. Too many requests queued.'))).toBe(true);
  });

  test('recognizes the per-window resource budget message', () => {
    expect(isD1OverloadError(new Error('Too many resources consumed within a 10 second window.'))).toBe(true);
  });

  test('does not match generic rate-limit wording that other providers use', () => {
    const err = new Error('rate limit exceeded');
    expect(isD1OverloadError(err)).toBe(false);
    expect(isRetryableD1Error(err)).toBe(true);
  });

  test('accepts plain strings and rejects empty values', () => {
    expect(isD1OverloadError('D1 DB is overloaded')).toBe(true);
    expect(isD1OverloadError(null)).toBe(false);
    expect(isD1OverloadError(undefined)).toBe(false);
  });
});
