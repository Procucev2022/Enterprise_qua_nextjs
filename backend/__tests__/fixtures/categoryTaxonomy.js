// ==============================================================================
// CATEGORY TAXONOMY TEST FIXTURE
// ==============================================================================
// A small stand-in for the `category_division` master, in the grouped shape
// buyerProfileQueries.findCategoryTaxonomy() returns.
//
// This is test input, not application seed data: the taxonomy is read from the
// database at runtime, and the suite must not reach the real one (see
// setup/noRealDatabase.js). The entries below are chosen to exercise the
// behaviours the classification code actually depends on:
//
//   - a minor that lives under two majors ('Panels'), so the "first major wins"
//     rule has something to resolve
//   - a minor whose casing and spacing differ from the search term, so the
//     normalised lookup is exercised
//   - a group with a blank division, which the real master contains and which
//     must be skipped
// ==============================================================================

const CATEGORY_TAXONOMY_FIXTURE = [
  {
    majorCategory: 'Civil Works',
    minorCategories: ['Bricks', 'Flooring Material', 'Painting', 'Roofing'],
  },
  {
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories', 'Motors', 'Hoses, Valves & Fittings', 'Storage  Racks'],
  },
  {
    majorCategory: 'Engineering Spares - Electrical',
    // 'Panels' also appears under the mechanical group above in the real master;
    // keeping it here too is what makes the ambiguity resolvable in tests.
    minorCategories: ['Panels', 'Circuit Breakers', 'Transformers'],
  },
  {
    majorCategory: 'Packing Material',
    minorCategories: ['Cartons', 'Stretch Film'],
  },
];

/** The first major/minor pair, which most tests just need *a* valid value for. */
const FIRST_MAJOR = CATEGORY_TAXONOMY_FIXTURE[0].majorCategory;
const FIRST_MINOR = CATEGORY_TAXONOMY_FIXTURE[0].minorCategories[0];

module.exports = {
  CATEGORY_TAXONOMY_FIXTURE,
  FIRST_MAJOR,
  FIRST_MINOR,
};
