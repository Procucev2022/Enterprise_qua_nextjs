const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');

describe('store background task logging', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete globalThis.__CF_WAIT_UNTIL__;
  });

  test('logs rejected background work with its operation metadata', async () => {
    const failure = new Error('mail provider unavailable');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const task = storeService._background(
      Promise.reject(failure),
      'Failed to email RFQ invite to matched vendor',
      { operation: 'rfq-matched-vendor-invite', rfqId: 'rfq-1', rfqNumber: 'RFQ-1', vendorId: 'vendor-1' }
    );

    await expect(task).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to email RFQ invite to matched vendor',
      expect.objectContaining({
        operation: 'rfq-matched-vendor-invite',
        rfqId: 'rfq-1',
        rfqNumber: 'RFQ-1',
        vendorId: 'vendor-1',
        error: failure,
      }),
      'STORE_SERVICE'
    );
  });

  test('captures Worker waitUntil registration errors and still observes the task', async () => {
    const registrationError = new Error('Worker context expired');
    globalThis.__CF_WAIT_UNTIL__ = jest.fn(() => { throw registrationError; });
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const task = storeService._background(
      Promise.resolve('done'),
      'Background task failed',
      { operation: 'test-background', rfqNumber: 'RFQ-2' }
    );

    await expect(task).resolves.toBe('done');
    expect(errorSpy).toHaveBeenCalledWith(
      'Could not register background work with the Worker lifecycle',
      expect.objectContaining({
        operation: 'test-background',
        rfqNumber: 'RFQ-2',
        error: registrationError,
      }),
      'STORE_SERVICE'
    );
  });
});
