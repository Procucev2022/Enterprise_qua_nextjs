const store = require('../src/services/storeService');
const pool = require('../src/db/pool');
const enterpriseInquiryQueries = require('../src/db/enterpriseInquiryQueries');

test('enterprise inquiries have no process-local or filesystem persistence path', async () => {
  expect(store.enterpriseInquiries).toBeUndefined();
  expect(store.addEnterpriseInquiry).toBeUndefined();
  expect(store.getEnterpriseInquiries).toBeUndefined();
  expect(store.updateEnterpriseInquiry).toBeUndefined();

  jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
  await expect(enterpriseInquiryQueries.getEnterpriseInquiries()).rejects.toMatchObject({
    code: 'PERSISTENCE_UNAVAILABLE',
  });
});
