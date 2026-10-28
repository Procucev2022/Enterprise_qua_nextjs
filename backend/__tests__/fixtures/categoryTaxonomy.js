// ==============================================================================
// CATEGORY TAXONOMY TEST FIXTURE
// ==============================================================================
// The real `category_division` master, in the grouped shape
// buyerProfileQueries.findCategoryTaxonomy() returns.
// Sourced directly from DEFAULT_CATEGORY_TAXONOMY in constants.js.
// ==============================================================================

const { DEFAULT_CATEGORY_TAXONOMY } = require('../../src/config/constants');

const CATEGORY_TAXONOMY_FIXTURE = DEFAULT_CATEGORY_TAXONOMY;

/** The leading major/minor pair, for assertions that just need a valid value. */
const FIRST_MAJOR = CATEGORY_TAXONOMY_FIXTURE[0].majorCategory;
const FIRST_MINOR = CATEGORY_TAXONOMY_FIXTURE[0].minorCategories[0];

module.exports = {
  CATEGORY_TAXONOMY_FIXTURE,
  FIRST_MAJOR,
  FIRST_MINOR,
};
