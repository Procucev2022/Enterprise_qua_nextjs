import type { UserRole, SourcingMode, BuyerAccount } from '@/lib/types';

describe('lib/types', () => {
  it('should support type assignments correctly', () => {
    const role: UserRole = 'buyer';
    expect(role).toBe('buyer');

    const mode: SourcingMode = 'mode_1';
    expect(mode).toBe('mode_1');

    const buyer: BuyerAccount = {
      id: 'test-1',
      organizationName: 'Acme Corp',
      corporateEmail: 'test@acme.com',
      contactPerson: 'John Doe',
      mobileNumber: '+919999999999',
      gstin: '27AABCU9603R1ZN',
      industrySector: 'Manufacturing',
      sourcingMode: 'mode_1',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 5,
      accountSource: 'public_system',
      status: 'ACTIVE_VERIFIED',
      primaryPlantLocation: 'Mumbai',
      supportedMajorCategories: ['Mechanical'],
      totalRFQsCreated: 0,
      totalSpend: '$0',
      syncTimestamp: new Date().toISOString(),
      createdDate: '2026-08-29',
    };
    expect(buyer.id).toBe('test-1');
  });
});
