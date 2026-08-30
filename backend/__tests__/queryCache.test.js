const { QueryCache, queryCache } = require('../src/db/queryCache');

describe('Database QueryCache Unit Tests', () => {
  let cache;

  beforeEach(() => {
    cache = new QueryCache({ maxEntries: 3, defaultTTLMs: 100 });
  });

  test('generates normalized keys and caches query results', () => {
    const query = '  SELECT   * FROM   vendors WHERE id = $1 ';
    const params = ['v-101'];
    const data = [{ id: 'v-101', name: 'Tata Steel' }];

    expect(cache.get(query, params)).toBeNull();

    cache.set(query, params, data, { tag: 'vendors', executionDurationMs: 25 });
    const result = cache.get(query, params);
    expect(result).toEqual(data);

    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(1);
    expect(metrics.totalQueriesProcessed).toBe(2);
    expect(metrics.cacheHitRatioNumber).toBe(50);
    expect(metrics.estimatedComputeMsSaved).toBe(25);
  });

  test('expires entries after TTL elapses', async () => {
    const query = 'SELECT 1';
    cache.set(query, [], { val: 1 }, { ttlMs: 20 });
    expect(cache.get(query, [])).toEqual({ val: 1 });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get(query, [])).toBeNull();
  });

  test('enforces LRU capacity limit by evicting oldest entry', () => {
    cache.set('Q1', [], 'data1');
    cache.set('Q2', [], 'data2');
    cache.set('Q3', [], 'data3');

    // Access Q1 to make it recently used
    cache.get('Q1', []);

    // Add Q4, should evict Q2
    cache.set('Q4', [], 'data4');

    expect(cache.get('Q1', [])).toBe('data1');
    expect(cache.get('Q2', [])).toBeNull();
    expect(cache.get('Q3', [])).toBe('data3');
    expect(cache.get('Q4', [])).toBe('data4');
  });

  test('invalidates cache entries by tag', () => {
    cache.set('SELECT * FROM rfqs', [], ['rfq1'], { tag: 'rfqs' });
    cache.set('SELECT * FROM rfqs WHERE id = 1', [], ['rfq1_single'], { tag: 'rfqs' });
    cache.set('SELECT * FROM vendors', [], ['v1'], { tag: 'vendors' });

    const count = cache.invalidate('rfqs');
    expect(count).toBe(2);
    expect(cache.get('SELECT * FROM rfqs', [])).toBeNull();
    expect(cache.get('SELECT * FROM vendors', [])).toEqual(['v1']);

    // Invalidate non-existent tag
    expect(cache.invalidate('non_existent')).toBe(0);
    expect(cache.invalidate('')).toBe(0);
  });

  test('clear empties all entries and metrics reflect state', () => {
    cache.set('Q1', [], 'd1');
    cache.set('Q2', [], 'd2');
    expect(cache.clear()).toBe(2);
    expect(cache.getMetrics().activeEntries).toBe(0);
  });

  test('handles edge cases: set with default parameters, delete key without tag, empty metrics', () => {
    const emptyMetrics = new QueryCache().getMetrics();
    expect(emptyMetrics.cacheHitRatioNumber).toBe(0);

    const testC = new QueryCache();
    testC.set('NO_PARAMS', undefined, 'val');
    expect(testC.get('NO_PARAMS')).toBe('val');

    testC.set('NO_TAG', [], 'no_tag_val', { tag: '' });
    expect(testC.get('NO_TAG')).toBe('no_tag_val');

    // delete
    expect(testC.delete('NO_TAG')).toBe(true);
    expect(testC.delete('NON_EXISTENT')).toBe(false);
  });

  test('singleton instance methods work', () => {
    queryCache.clear();
    queryCache.set('SELECT 1', [], 'test');
    expect(queryCache.get('SELECT 1', [])).toBe('test');
    queryCache.clear();
  });
});
