// ==============================================================================
// CATEGORY TAXONOMY TEST FIXTURE
// ==============================================================================
// Stands in for the `category_division` master that `GET /api/buyer-profile/categories`
// serves.
//
// This replaces the `@/lib/categories.json` these suites used to import. That file
// was a copy of the master bundled into the client bundle, and deleting it is the
// point: the taxonomy is fetched from the database at runtime now, so tests have
// to supply it the same way the app receives it.
//
// Kept outside `__tests__/` deliberately — jest.config's testMatch treats every
// file under that directory as a suite, so a fixture placed there would be
// collected and fail as a file containing no tests.
//
// Division order mirrors the real master (Civil Works first, by `created_ts`, not
// alphabetically), because several assertions index into position 0 and 1 and the
// screens render in master order.
// ==============================================================================

import type { MajorMinorCategory } from '@/lib/types';

export const CATEGORY_TAXONOMY_FIXTURE: MajorMinorCategory[] = [
  {
    majorCategory: 'Civil Works',
    minorCategories: ['Bricks', 'Excavation', 'Flooring Material', 'Painting', 'Roofing', 'Waterproofing'],
  },
  {
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: [
      'Pumps & Accessories',
      'Bearings & Accessories',
      'Compressors & Accessories',
      'Hoses, Valves & Fittings',
      'Machinery Parts',
      'Motors',
    ],
  },
  {
    majorCategory: 'Engineering Spares - Electrical',
    minorCategories: ['Panels', 'Circuit Breakers', 'Transformers'],
  },
  {
    majorCategory: 'Packing Material',
    minorCategories: ['Cartons', 'Stretch Film'],
  },
];

/** The leading major/minor pair, for assertions that just need a valid value. */
export const FIRST_MAJOR = CATEGORY_TAXONOMY_FIXTURE[0].majorCategory;
export const FIRST_MINOR = CATEGORY_TAXONOMY_FIXTURE[0].minorCategories[0];

export default CATEGORY_TAXONOMY_FIXTURE;
