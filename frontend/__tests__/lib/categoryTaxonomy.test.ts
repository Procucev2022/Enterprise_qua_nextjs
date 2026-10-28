import {
  setCategoryTaxonomy,
  getCategoryTaxonomy,
  isCategoryTaxonomyLoaded,
  getMajorCategories,
  getMinorCategories,
  getDefaultMinorForMajor,
  hasMajorCategory,
  hasMinorCategory,
  findMajorForMinor,
  countMinorCategories,
  clearCategoryTaxonomy,
  autoCategorizeItem,
  dominantMajorCategory,
  getDefaultCategoryTaxonomy,
  KNOWN_KEYWORD_RULES,
} from '@/lib/categoryTaxonomy';
import { MASTER_CATEGORY_TAXONOMY, MASTER_CATEGORY_GROUPS } from '@/lib/categoryTaxonomySeed';

describe('categoryTaxonomy module', () => {
  beforeEach(() => {
    setCategoryTaxonomy(MASTER_CATEGORY_GROUPS);
  });

  afterEach(() => {
    setCategoryTaxonomy(MASTER_CATEGORY_GROUPS);
  });

  it('(a) verifies every major and minor in KNOWN_KEYWORD_RULES exists in master taxonomy', () => {
    for (const rule of KNOWN_KEYWORD_RULES) {
      expect(MASTER_CATEGORY_TAXONOMY[rule.major]).toBeDefined();
      const minors = MASTER_CATEGORY_TAXONOMY[rule.major] || [];
      expect(minors).toContain(rule.minor);
    }
  });

  it('(b) setCategoryTaxonomy merges duplicate taxonomy keys and trims whitespace', () => {
    setCategoryTaxonomy([
      { majorCategory: 'Engineering Spares - Mechanical', minorCategories: ['Pumps & Accessories', 'Filters'] },
      { majorCategory: 'Engineering spares - Mechanical', minorCategories: ['Bearings & Accessories', 'Filters'] },
      { majorCategory: ' IT', minorCategories: ['Laptop', 'CCTV '] },
    ]);

    const majors = getMajorCategories();
    expect(majors).toEqual(['Engineering Spares - Mechanical', 'IT']);

    const mechMinors = getMinorCategories('Engineering Spares - Mechanical');
    expect(mechMinors).toEqual(['Pumps & Accessories', 'Filters', 'Bearings & Accessories']);

    const itMinors = getMinorCategories('IT');
    expect(itMinors).toEqual(['Laptop', 'CCTV']);
    expect(hasMinorCategory('IT', 'CCTV')).toBe(true);
  });

  it('(c) with an empty registry, getMajorCategories() returns [] without fallbacks', () => {
    clearCategoryTaxonomy();
    expect(isCategoryTaxonomyLoaded()).toBe(false);
    expect(getMajorCategories()).toEqual([]);
    expect(getMinorCategories('Civil Works')).toEqual([]);
    expect(hasMajorCategory('Civil Works')).toBe(false);
    expect(hasMinorCategory('Civil Works', 'Bricks')).toBe(false);
    expect(findMajorForMinor('Bricks')).toBe('');
  });

  it('(d) autoCategorizeItem("Tablet") does not return Furniture', () => {
    // Exact token matching stops 'table' from matching 'Tablet'
    const result = autoCategorizeItem('Tablet', '');
    expect(result.majorCategory).not.toBe('Others – New Product');
    expect(result.minorCategory).not.toBe('Furniture');
    expect(result).toEqual({ majorCategory: '', minorCategory: '' });
  });

  it('(e) autoCategorizeItem("Network Switch") returns IT / Networking Equipment', () => {
    const result = autoCategorizeItem('Network Switch', '');
    expect(result).toEqual({
      majorCategory: 'IT',
      minorCategory: 'Networking Equipment',
    });
  });

  it('handles plural tokens and exact keywords without false prefix matches', () => {
    // 'sand' does not match 'sandpaper' (Abrasives rule matches 'sandpaper')
    const sandRes = autoCategorizeItem('Sand', '');
    expect(sandRes.minorCategory).not.toBe('Abrasives');

    // Plurals like 'switches' and 'cables' match
    const switchRes = autoCategorizeItem('Electrical switches', '');
    expect(switchRes.majorCategory).toBe('Engineering Spares - Electrical');
    expect(switchRes.minorCategory).toBe('Switches');

    const cableRes = autoCategorizeItem('Copper cables', '');
    expect(cableRes.majorCategory).toBe('Engineering Spares - Electrical');
    expect(cableRes.minorCategory).toBe('Cables');
  });

  it('validates rule output against loaded taxonomy and returns empty when not found', () => {
    clearCategoryTaxonomy();
    // Rule keyword matches but taxonomy is empty, so it must return empty
    const res = autoCategorizeItem('Network Switch', '');
    expect(res).toEqual({ majorCategory: '', minorCategory: '' });
  });

  it('derives dominant major category across line items', () => {
    expect(
      dominantMajorCategory([
        { majorCategory: 'Civil Works' },
        { majorCategory: 'Engineering Spares - Mechanical' },
        { majorCategory: 'Engineering Spares - Mechanical' },
      ])
    ).toBe('Engineering Spares - Mechanical');

    expect(dominantMajorCategory([])).toBe('');
    expect(dominantMajorCategory([{ majorCategory: 'All Categories' }, { majorCategory: 'IT' }], ['All Categories'])).toBe('IT');
    expect(dominantMajorCategory([{ majorCategory: '' }, { majorCategory: null }])).toBe('');
  });

  it('transforms legacy new category aliases into Others – New Product and Others – New Service', () => {
    setCategoryTaxonomy([
      { majorCategory: 'New Category-Product', minorCategories: ['Custom Widget'] },
      { majorCategory: 'New Category-Service', minorCategories: ['Custom Consulting'] },
      { majorCategory: 'New Category', minorCategories: ['Only Product Expected'] },
      { majorCategory: '', minorCategories: ['Empty'] },
      { majorCategory: null as any, minorCategories: ['Null'] },
    ]);
    expect(hasMajorCategory('Others – New Product')).toBe(true);
    expect(hasMajorCategory('Others – New Service')).toBe(true);
    expect(getMinorCategories('Others – New Product')).toContain('Custom Widget');
    expect(getMinorCategories('Others – New Product')).toContain('Only Product Expected');
    expect(getMinorCategories('Others – New Service')).toContain('Custom Consulting');
    expect(getCategoryTaxonomy().length).toBeGreaterThan(0);
    expect(getDefaultCategoryTaxonomy().length).toBeGreaterThan(0);
  });

  it('handles duplicate minors across majors properly with first loaded major winning in findMajorForMinor', () => {
    // In master:
    // Panels appears under 'Engineering Spares - Electrical' and 'CAPEX - Equipment & Machinery'
    expect(findMajorForMinor('Panels')).toBe('Engineering Spares - Electrical');

    // Refractories appears under 'Engineering Spares - Mechanical' and 'Raw Material'
    expect(findMajorForMinor('Refractories')).toBe('Engineering Spares - Mechanical');
    expect(findMajorForMinor('')).toBe('');
    expect(findMajorForMinor('Nonexistent')).toBe('');
  });

  it('counts total minor categories across loaded groups', () => {
    expect(countMinorCategories()).toBe(309);
  });

  it('covers specs matching and dynamic taxonomy matching', () => {
    // Specs matching when cleanName has no rule
    const resSpecs = autoCategorizeItem('Custom Special Equipment', 'Need barcode scanner hand terminal');
    expect(resSpecs.majorCategory).toBe('IT');
    expect(resSpecs.minorCategory).toBe('BARCODE SCANNERS');

    // Material-only keywords in specs are excluded
    const resMat = autoCategorizeItem('Custom Enclosure', 'Made of steel and plastic');
    expect(resMat).toEqual({ majorCategory: '', minorCategory: '' });

    // Dynamic taxonomy matching minor (non-rule minor)
    setCategoryTaxonomy([
      { majorCategory: 'Custom Division', minorCategories: ['Custom Specialty Widget'] },
    ]);
    const resDynMinor = autoCategorizeItem('Custom Specialty Widget', '');
    expect(resDynMinor.majorCategory).toBe('Custom Division');
    expect(resDynMinor.minorCategory).toBe('Custom Specialty Widget');

    // Dynamic taxonomy matching major without minors
    setCategoryTaxonomy([
      { majorCategory: 'Bare Division', minorCategories: [] },
    ]);
    const resBareMajor = autoCategorizeItem('Bare Division', '');
    expect(resBareMajor.majorCategory).toBe('Bare Division');
    expect(resBareMajor.minorCategory).toBe('');

    // Empty input returns empty
    expect(autoCategorizeItem('', '')).toEqual({ majorCategory: '', minorCategory: '' });
  });

  it('tests default minor for major, empty checks, and non-array setCategoryTaxonomy', () => {
    expect(getDefaultMinorForMajor('Civil Works')).toBe('Back filing');
    expect(getDefaultMinorForMajor('')).toBe('');
    expect(getDefaultMinorForMajor('Nonexistent')).toBe('');

    expect(getMinorCategories('')).toEqual([]);
    expect(hasMajorCategory('')).toBe(false);
    expect(hasMinorCategory('', '')).toBe(false);
    expect(hasMinorCategory('Civil Works', '')).toBe(false);

    setCategoryTaxonomy(null as any);
    expect(getMajorCategories()).toEqual([]);
  });

  it('exercises matchesRuleKeyword edge cases and multi-word phrases', () => {
    // Multi-word phrase matching
    const resMulti = autoCategorizeItem('Public Announcement System (PAS)', '');
    expect(resMulti.majorCategory).toBe('Occuptional Health and Safety');
    expect(resMulti.minorCategory).toBe('Public Announcement System (PAS)');

    // Only specs provided, empty itemName
    const specsOnly = autoCategorizeItem('', 'centrifugal pump SS316');
    expect(specsOnly.majorCategory).toBe('Engineering Spares - Mechanical');
    expect(specsOnly.minorCategory).toBe('Pumps & Accessories');

    // Rule matches in itemName but hasMinorCategory is false
    setCategoryTaxonomy([
      { majorCategory: 'Civil Works', minorCategories: [] },
    ]);
    const resNoMinor = autoCategorizeItem('rebar', '');
    expect(resNoMinor).toEqual({ majorCategory: '', minorCategory: '' });

    // Rule matches in specs but hasMinorCategory is false
    const resNoMinorSpecs = autoCategorizeItem('', 'rebar');
    expect(resNoMinorSpecs).toEqual({ majorCategory: '', minorCategory: '' });

    setCategoryTaxonomy(MASTER_CATEGORY_GROUPS);

    // Multi-word keyword rule match on multi-token item
    const resShrink = autoCategorizeItem('High grade shrink flim roll', '');
    expect(resShrink.majorCategory).toBe('Packing Material');
    expect(resShrink.minorCategory).toBe('Shrink Flims');

    // Exercises all keyword rules to achieve 100% rule coverage
    for (const rule of KNOWN_KEYWORD_RULES) {
      if (rule.keywords.length > 0) {
        const testKw = rule.keywords[0];
        const res = autoCategorizeItem(testKw, '');
        expect(res.majorCategory).toBe(rule.major);
        expect(res.minorCategory).toBe(rule.minor);
      }
    }
  });
});
