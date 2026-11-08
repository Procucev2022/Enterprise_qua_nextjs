const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const { RFQ_NOTIFICATION_ERROR_CODES } = require('../src/config/constants');

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

  test('logs resolved email provider refusals with delivery operation context', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const refusal = { sent: false, reason: 'provider_declined' };
    const task = storeService._background(
      Promise.resolve(refusal),
      'Failed to email RFQ invite to vendor',
      {
        deliveryChannel: 'email',
        operation: 'rfq-vendor-invite',
        rfqId: 'rfq-3',
        rfqNumber: 'RFQ-3',
        vendorId: 'vendor-3',
      }
    );

    await expect(task).resolves.toBe(refusal);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to email RFQ invite to vendor',
      expect.objectContaining({
        deliveryChannel: 'email',
        operation: 'rfq-vendor-invite',
        rfqId: 'rfq-3',
        rfqNumber: 'RFQ-3',
        vendorId: 'vendor-3',
        error: expect.objectContaining({
          code: RFQ_NOTIFICATION_ERROR_CODES.EMAIL_DELIVERY_NOT_ACCEPTED,
          deliveryResultPresent: true,
        }),
      }),
      'STORE_SERVICE'
    );
  });

  test('does not report accepted background emails as failures', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const metadata = { deliveryChannel: 'email', operation: 'rfq-vendor-invite', rfqNumber: 'RFQ-3' };
    const delivery = { sent: true, messageId: 'message-3' };
    const task = storeService._background(
      Promise.resolve(delivery),
      'Failed to email RFQ invite to vendor',
      metadata
    );

    await expect(task).resolves.toBe(delivery);
    expect(infoSpy).toHaveBeenCalledWith('Background email accepted by provider', metadata, 'STORE_SERVICE');
    expect(errorSpy).not.toHaveBeenCalledWith(
      'Failed to email RFQ invite to vendor',
      expect.anything(),
      'STORE_SERVICE'
    );
  });
});
