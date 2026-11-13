const storeService = require('../src/services/storeService');

describe('vendor category lists stored as text', () => {
  test('matches a category named in a JSON array string', () => {
    const vendor = { id: 'v-json-1', name: 'JSON Vendor', minorCategories: '["Steel Pipes", "Valves"]' };

    expect(storeService.vendorCoversCategory(vendor, 'Valves')).toBe(true);
    expect(storeService.vendorCoversCategory(vendor, 'Gaskets')).toBe(false);
  });

  test('treats a bracketed string that is not valid JSON as a comma-separated list', () => {
    const vendor = { id: 'v-json-2', name: 'Broken JSON Vendor', minorCategories: '[Valves, Gaskets' };

    expect(storeService.vendorCoversCategory(vendor, 'Gaskets')).toBe(true);
  });
});
