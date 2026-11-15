const { validateRFQLineItemsForCreate, VALIDATION_SCHEMAS } = require('../src/config/validationSchemas');

// A row with every field the RFQ form requires. Each test changes only the field it covers.
const COMPLETE = {
  itemName: 'Centrifugal pump bearing',
  technicalSpecs: 'Deep groove ball bearing, 6205 2RS',
  quantity: 2,
  unit: 'Nos',
  majorCategory: 'Engineering Spares - Mechanical',
  minorCategory: 'Bearings & Accessories',
};

describe('validateRFQLineItemsForCreate', () => {
  test('requires at least one row, and treats anything that is not a list as no rows', () => {
    expect(validateRFQLineItemsForCreate([])).toEqual({
      isValid: false,
      errors: { lineItems: 'Add at least one line item so vendors have something to quote against.' },
    });
    expect(validateRFQLineItemsForCreate(undefined).errors.lineItems).toMatch(/at least one line item/i);
    expect(validateRFQLineItemsForCreate('not a list').isValid).toBe(false);
  });

  test('accepts a complete row', () => {
    expect(validateRFQLineItemsForCreate([COMPLETE])).toEqual({ isValid: true, errors: {} });
  });

  test.each(['itemName', 'technicalSpecs', 'unit', 'majorCategory'])('reports a blank %s, including whitespace only', (field) => {
    const result = validateRFQLineItemsForCreate([{ ...COMPLETE, [field]: '   ' }]);

    expect(result.isValid).toBe(false);
    expect(Object.keys(result.errors)).toEqual([`lineItems[0].${field}`]);
  });

  test('reports every blank field of a row that is missing altogether', () => {
    const result = validateRFQLineItemsForCreate([null]);

    expect(Object.keys(result.errors)).toEqual(
      expect.arrayContaining([
        'lineItems[0].itemName',
        'lineItems[0].technicalSpecs',
        'lineItems[0].quantity',
        'lineItems[0].unit',
        'lineItems[0].majorCategory',
      ])
    );
  });

  test.each([[0], [-1], ['abc']])('rejects a quantity of %p', (quantity) => {
    const result = validateRFQLineItemsForCreate([{ ...COMPLETE, quantity }]);

    expect(result.errors['lineItems[0].quantity']).toEqual(expect.any(String));
  });

  test('explains a zero quantity in the form\'s own words', () => {
    expect(validateRFQLineItemsForCreate([{ ...COMPLETE, quantity: 0 }]).errors['lineItems[0].quantity']).toBe(
      'Each line item needs a quantity above zero.'
    );
  });

  test('requires a minor category under a real major category', () => {
    expect(validateRFQLineItemsForCreate([{ ...COMPLETE, minorCategory: '' }]).errors['lineItems[0].minorCategory']).toMatch(
      /minor category/i
    );
  });

  test('reads a row whose minor category is given as category, the controller\'s alias', () => {
    const row = {
      itemName: COMPLETE.itemName,
      technicalSpecs: COMPLETE.technicalSpecs,
      quantity: COMPLETE.quantity,
      unit: COMPLETE.unit,
      majorCategory: COMPLETE.majorCategory,
      category: 'Bearings & Accessories',
    };

    expect(validateRFQLineItemsForCreate([row]).isValid).toBe(true);
  });

  test('needs no minor category under All Categories, and rejects one that is given', () => {
    expect(validateRFQLineItemsForCreate([{ ...COMPLETE, majorCategory: 'All Categories', minorCategory: '' }])).toEqual({
      isValid: true,
      errors: {},
    });

    const withMinor = validateRFQLineItemsForCreate([{ ...COMPLETE, majorCategory: 'All Categories' }]);
    expect(withMinor.errors['lineItems[0].minorCategory']).toBe(
      'A minor category does not apply to All Categories. Clear the minor category to continue.'
    );
  });

  test('reports each bad row under its own index and leaves the good rows alone', () => {
    const result = validateRFQLineItemsForCreate([COMPLETE, { ...COMPLETE, unit: '' }]);

    expect(Object.keys(result.errors)).toEqual(['lineItems[1].unit']);
  });

  test('is backed by the createRFQLineItem schema', () => {
    expect(Object.keys(VALIDATION_SCHEMAS.createRFQLineItem)).toEqual(
      expect.arrayContaining(['itemName', 'technicalSpecs', 'quantity', 'unit', 'majorCategory', 'minorCategory'])
    );
  });
});
