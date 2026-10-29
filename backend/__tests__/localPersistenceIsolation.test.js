const fs = require('fs');
const store = require('../src/services/storeService');
const { INQUIRIES_PERSISTENCE_FILE } = require('../src/config/constants');

test('persists inquiry creation and updates in a suite-specific ledger without modifying workspace data', () => {
  const realFs = jest.requireActual('fs');
  const originalBytes = realFs.readFileSync(INQUIRIES_PERSISTENCE_FILE);

  const inquiry = store.addEnterpriseInquiry({
    companyName: 'Isolated inquiry company', email: 'isolated-inquiry@example.test', mobile: '9876543210',
  });
  expect(JSON.parse(fs.readFileSync(INQUIRIES_PERSISTENCE_FILE, 'utf8'))).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: inquiry.id, companyName: 'Isolated inquiry company' }),
  ]));

  store.updateEnterpriseInquiry(inquiry.id, { status: 'CONTACTED', notes: 'Only in the test ledger' });
  store.reset();
  expect(store.getEnterpriseInquiries()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: inquiry.id, status: 'CONTACTED', notes: 'Only in the test ledger' }),
  ]));
  expect(realFs.readFileSync(INQUIRIES_PERSISTENCE_FILE)).toEqual(originalBytes);
});
