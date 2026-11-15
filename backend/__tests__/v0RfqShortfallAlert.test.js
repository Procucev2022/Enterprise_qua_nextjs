'use strict';

// A V0 RFQ raised from the wizard reaches the same minor shortfall alert as the other creation flows.
// Before this, the wizard's create called the V0 assignment without the flag, so the Procucev team was
// never told that a minor category of the RFQ had too few network vendors.

const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const { authHeader } = require('./testHelpers');

const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('V0 RFQ creation from the wizard asks for the minor shortfall alert', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('POST /api/rfqs in mode_0 hands the V0 assignment notifyShortfall', async () => {
    const augmentSpy = jest.spyOn(storeService, 'augmentV0AssignmentsFromDB').mockImplementation(async (rfq) => rfq);

    const res = await request(app)
      .post('/api/rfqs')
      .set(authHeader('buyer'))
      .send({
        title: 'Electrical spares for the packing line',
        category: 'Engineering Spares - Electrical',
        sourcingMode: 'mode_0',
        budget: 120000,
        targetDeliveryDate: A_FUTURE_DATE,
        deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        deliveryPincode: '400701',
        extractedEntities: [{
          itemName: 'LED panel light',
          technicalSpecs: '18 W, recessed, 600 x 600 mm',
          quantity: 100,
          unit: 'Nos',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategory: 'Lights',
        }],
      });

    expect(res.status).toBeLessThan(300);
    expect(augmentSpy).toHaveBeenCalledWith(expect.objectContaining({ sourcingMode: 'mode_0' }), { notifyShortfall: true });
  });
});
