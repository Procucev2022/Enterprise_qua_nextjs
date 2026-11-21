/**
 * validateAiResult minor-category resolution: the fuzzy matcher used when the model's minor
 * (or a relevant product / PO line) is not an exact master minor, and the fallback that reads
 * relevantProducts and PO line summaries when the model's minors resolve to nothing.
 */
const { validateAiResult } = require('../src/services/vendorCategorizationService');

const categoryMaster = [
  {
    majorCategory: 'Electrical',
    minorCategories: ['Cables', 'Motors', 'Circuit Breakers', 'Battery', 'Steel Rods', 'Industrial Valves'],
  },
];

const minorsFor = (parsed, vendorProfile = null) => {
  const result = validateAiResult(
    { primaryCategory: 'Electrical', confidenceScore: 0.95, reason: 'test', ...parsed },
    { categoryMaster, vendorProfile }
  );
  expect(result.valid).toBe(true);
  return result.suggestion.minorCategories;
};

describe('validateAiResult fuzzy minor matching', () => {
  test.each([
    ['singular of a plural master minor', 'Cable', 'Cables'],
    ['-ies plural of a -y master minor', 'Batteries', 'Battery'],
    ['technical keyword', 'MCB unit', 'Circuit Breakers'],
    ['master minor contained in the candidate', 'steel rods heavy', 'Steel Rods'],
    ['shared word stem', 'rod supplies', 'Steel Rods'],
    ['stem of a plural master token', 'valve', 'Industrial Valves'],
  ])('%s: %s -> %s', (_label, candidate, expected) => {
    expect(minorsFor({ minorCategories: [candidate] })).toEqual([expected]);
  });

  test('a keyword whose minor is not in this major falls through to the other rules', () => {
    // "laptop" maps to "Laptop", which Electrical does not have; nothing else matches.
    expect(minorsFor({ minorCategories: ['laptop bag'] })).toEqual([]);
  });

  test('generic words alone never match, and an unrelated candidate resolves to nothing', () => {
    expect(minorsFor({ minorCategories: ['industrial spares', 'xyzqwe'] })).toEqual([]);
  });

  test('duplicates resolving to the same minor are kept once', () => {
    expect(minorsFor({ minorCategories: ['Cable', 'cables wire'] })).toEqual(['Cables']);
  });
});

describe('validateAiResult fallback to relevant products and PO lines', () => {
  test('uses relevantProducts (exact) and PO line summaries when the minors resolve to nothing', () => {
    const minors = minorsFor(
      { minorCategories: ['xyzqwe'], relevantProducts: ['Motors'] },
      { lineSummaries: ['', '   ', 'copper wire 4 sq mm', 'Motors'] }
    );
    expect(minors).toEqual(['Motors', 'Cables']);
  });

  test('works with no vendor profile', () => {
    expect(minorsFor({ minorCategories: [], relevantProducts: ['induction motor'] })).toEqual(['Motors']);
  });

  test('stops at the per-vendor minor cap', () => {
    const bigMaster = [{
      majorCategory: 'Electrical',
      minorCategories: Array.from({ length: 15 }, (_, i) => `Part${i}`),
    }];
    const result = validateAiResult(
      { primaryCategory: 'Electrical', confidenceScore: 0.95, minorCategories: [] },
      { categoryMaster: bigMaster, vendorProfile: { lineSummaries: Array.from({ length: 15 }, (_, i) => `Part${i}`) } }
    );
    expect(result.suggestion.minorCategories).toHaveLength(10);
  });
});
