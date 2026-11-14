import { searchCategoryOptions } from '@/lib/categorySearch';
import { CATEGORY_SEARCH_RESULT_LIMIT } from '@/lib/constants';

const OPTIONS = ['Centrifugal Pumps', 'Gear Pumps', 'Pump Accessories', 'Valves', 'Gate Valves'];

describe('searchCategoryOptions', () => {
  it('lists every category in display order when the query is empty', () => {
    expect(searchCategoryOptions(OPTIONS, '')).toEqual({ shown: OPTIONS, total: OPTIONS.length });
  });

  it('treats a query of spaces alone as empty', () => {
    expect(searchCategoryOptions(OPTIONS, '   ')).toEqual({ shown: OPTIONS, total: OPTIONS.length });
  });

  it('ignores case, and every word of the query must appear in a category', () => {
    expect(searchCategoryOptions(OPTIONS, 'PUMP cent').shown).toEqual(['Centrifugal Pumps']);
    expect(searchCategoryOptions(OPTIONS, 'pump').total).toBe(3);
  });

  it('lists a category that starts with the whole query before the ones that only contain it', () => {
    // "Pump Accessories" starts with "pump"; "Centrifugal Pumps" and "Gear Pumps" only contain it.
    expect(searchCategoryOptions(OPTIONS, 'pump').shown).toEqual([
      'Pump Accessories',
      'Centrifugal Pumps',
      'Gear Pumps',
    ]);
  });

  it('keeps display order among categories that rank the same', () => {
    expect(searchCategoryOptions(OPTIONS, 'valves').shown).toEqual(['Valves', 'Gate Valves']);
  });

  it('caps the shown categories at the limit but still counts every match', () => {
    expect(searchCategoryOptions(OPTIONS, '', 2)).toEqual({
      shown: ['Centrifugal Pumps', 'Gear Pumps'],
      total: OPTIONS.length,
    });
  });

  it('uses the shared result limit when no limit is given', () => {
    const many = Array.from({ length: CATEGORY_SEARCH_RESULT_LIMIT + 5 }, (_, index) => `Category ${index + 1}`);
    const result = searchCategoryOptions(many, '');
    expect(result.shown).toHaveLength(CATEGORY_SEARCH_RESULT_LIMIT);
    expect(result.total).toBe(many.length);
  });

  it('returns no categories when nothing matches', () => {
    expect(searchCategoryOptions(OPTIONS, 'bearings')).toEqual({ shown: [], total: 0 });
  });
});
