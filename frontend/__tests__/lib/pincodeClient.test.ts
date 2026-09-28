import { lookupPincode } from '@/lib/pincodeClient';

describe('lookupPincode', () => {
  it('rejects empty or whitespace-only pincode immediately', async () => {
    const res = await lookupPincode('');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('EMPTY_PINCODE');

    const resSpaces = await lookupPincode('   ');
    expect(resSpaces.valid).toBe(false);
    expect(resSpaces.reason).toBe('EMPTY_PINCODE');
  });

  it('rejects invalid format pincodes', async () => {
    const res = await lookupPincode('!!');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('INVALID_FORMAT');

    const resShort = await lookupPincode('12');
    expect(resShort.valid).toBe(false);
    expect(resShort.reason).toBe('INVALID_FORMAT');
  });

  it('rejects known dummy or sequential pincodes', async () => {
    const res123456 = await lookupPincode('123456');
    expect(res123456.valid).toBe(false);
    expect(res123456.reason).toBe('DUMMY_PINCODE');

    const res111111 = await lookupPincode('111111');
    expect(res111111.valid).toBe(false);
    expect(res111111.reason).toBe('DUMMY_PINCODE');

    const res999999 = await lookupPincode('999999');
    expect(res999999.valid).toBe(false);
    expect(res999999.reason).toBe('DUMMY_PINCODE');
  });

  it('accepts valid 6-digit Indian PIN codes and international postal codes', async () => {
    const res400701 = await lookupPincode('400701');
    expect(res400701.valid).toBe(true);
    expect(res400701.pincode).toBe('400701');

    const resUK = await lookupPincode('SW1A 1AA');
    expect(resUK.valid).toBe(true);
    expect(resUK.pincode).toBe('SW1A 1AA');
  });
});
