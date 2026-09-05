import {
  setCategoryTaxonomy,
  getCategoryTaxonomy,
  isCategoryTaxonomyLoaded,
  getMajorCategories,
  getMinorCategories,
  hasMajorCategory,
  hasMinorCategory,
  findMajorForMinor,
  countMinorCategories,
  clearCategoryTaxonomy,
} from '@/lib/categoryTaxonomy';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../test-fixtures/categoryTaxonomy';

describe('categoryTaxonomy module', () => {
  beforeEach(() => {
    setCategoryTaxonomy(CATEGORY_TAXONOMY_FIXTURE);
  });

  afterEach(() => {
    setCategoryTaxonomy(CATEGORY_TAXONOMY_FIXTURE);
  });

  it('manages loading state and provides stored groups', () => {
    expect(isCategoryTaxonomyLoaded()).toBe(true);
    expect(getCategoryTaxonomy()).toEqual(CATEGORY_TAXONOMY_FIXTURE);

    clearCategoryTaxonomy();
    expect(isCategoryTaxonomyLoaded()).toBe(false);
    expect(getCategoryTaxonomy()).toEqual([]);
  });

  it('handles non-array and empty inputs safely in setCategoryTaxonomy', () => {
    setCategoryTaxonomy(null as any);
    expect(getCategoryTaxonomy()).toEqual([]);

    setCategoryTaxonomy([
      null as any,
      { majorCategory: '', minorCategories: ['Test'] } as any,
      { majorCategory: 'Mechanical', minorCategories: [null as any, 'Pumps', ''] },
    ]);
    expect(getMajorCategories()).toEqual(['Mechanical']);
    expect(getMinorCategories('Mechanical')).toEqual([null, 'Pumps', '']);
    expect(hasMinorCategory('Mechanical', 'Pumps')).toBe(true);
  });

  it('retrieves major and minor category lists with trimming and case-insensitivity', () => {
    const majors = getMajorCategories();
    expect(majors).toContain('Civil Works');
    expect(majors).toContain('Engineering Spares - Mechanical');

    expect(getMinorCategories('Civil Works')).toContain('Bricks');
    expect(getMinorCategories('  civil   works  ')).toContain('Bricks');
    expect(getMinorCategories('Non Existent Major')).toEqual([]);
  });

  it('checks existence of major and minor categories accurately', () => {
    expect(hasMajorCategory('Civil Works')).toBe(true);
    expect(hasMajorCategory('  CIVIL   WORKS  ')).toBe(true);
    expect(hasMajorCategory('Fabricated Category')).toBe(false);

    expect(hasMinorCategory('Civil Works', 'Bricks')).toBe(true);
    expect(hasMinorCategory('  civil works  ', '  bricks  ')).toBe(true);
    expect(hasMinorCategory('Civil Works', 'Unknown Minor')).toBe(false);
    expect(hasMinorCategory('Unknown Major', 'Bricks')).toBe(false);
  });

  it('finds major category for a minor category and handles duplicate/missing cases', () => {
    expect(findMajorForMinor('Bricks')).toBe('Civil Works');
    expect(findMajorForMinor('  bricks  ')).toBe('Civil Works');
    expect(findMajorForMinor('Panels')).toBe('Engineering Spares - Electrical');
    expect(findMajorForMinor('Unknown Nonexistent Item')).toBe('');
  });

  it('counts total minor categories across all groups', () => {
    const total = countMinorCategories();
    expect(total).toBeGreaterThan(0);

    setCategoryTaxonomy([
      { majorCategory: 'A', minorCategories: ['1', '2'] },
      { majorCategory: 'B', minorCategories: undefined as any },
    ]);
    expect(countMinorCategories()).toBe(2);
  });

  it('handles null minorCategories and falsy key inputs across all lookup functions', () => {
    setCategoryTaxonomy([
      { majorCategory: 'EmptyMinors', minorCategories: null as any },
      { majorCategory: 'WithMinors', minorCategories: ['Item 1'] },
    ]);

    expect(getMinorCategories('EmptyMinors')).toEqual([]);
    expect(hasMinorCategory('EmptyMinors', 'Item 1')).toBe(false);
    expect(findMajorForMinor('Item 1')).toBe('WithMinors');

    // Falsy / empty lookups
    expect(hasMajorCategory(null as any)).toBe(false);
    expect(hasMinorCategory(null as any, null as any)).toBe(false);
    expect(findMajorForMinor(null as any)).toBe('');
  });
});
