/**
 * Enterprise Database Query Cache Layer
 * Minimizes database compute hours, eliminates redundant roundtrips,
 * and maintains write-through tag-based invalidation with TTL & LRU eviction.
 */

class QueryCache {
  constructor({ maxEntries = 500, defaultTTLMs = 60000 } = {}) {
    this.maxEntries = maxEntries;
    this.defaultTTLMs = defaultTTLMs;
    this.cache = new Map();
    this.tagMap = new Map(); // tag -> Set of keys
    this.metrics = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      estimatedComputeMsSaved: 0,
    };
  }

  generateKey(queryText = '', params = []) {
    const normalized = (queryText || '').trim().replace(/\s+/g, ' ');
    const paramsStr = JSON.stringify(params || []);
    return `${normalized}::${paramsStr}`;
  }

  get(queryText, params = []) {
    const key = this.generateKey(queryText, params);
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses += 1;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.metrics.misses += 1;
      return null;
    }

    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.metrics.hits += 1;
    this.metrics.estimatedComputeMsSaved += entry.executionDurationMs;
    return entry.data;
  }

  set(queryText, params = [], data, options = {}) {
    const key = this.generateKey(queryText, params);

    // Enforce LRU eviction if capacity reached
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.delete(oldestKey);
      }
    }

    const ttlMs = options.ttlMs !== undefined ? options.ttlMs : this.defaultTTLMs;
    const tag = options.tag !== undefined ? options.tag : 'general';
    const executionDurationMs = options.executionDurationMs !== undefined ? options.executionDurationMs : 10;

    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, expiresAt, tag, executionDurationMs });

    if (tag) {
      if (!this.tagMap.has(tag)) {
        this.tagMap.set(tag, new Set());
      }
      this.tagMap.get(tag).add(key);
    }

    return data;
  }

  delete(queryText, params = []) {
    const key = queryText && queryText.includes('::') ? queryText : this.generateKey(queryText, params);
    const entry = this.cache.get(key);
    if (entry && entry.tag && this.tagMap.has(entry.tag)) {
      this.tagMap.get(entry.tag).delete(key);
    }
    return this.cache.delete(key);
  }

  invalidate(tag) {
    if (!tag) return 0;
    const keys = this.tagMap.get(tag);
    if (!keys || keys.size === 0) return 0;

    let count = 0;
    for (const key of Array.from(keys)) {
      this.cache.delete(key);
      count += 1;
    }
    this.tagMap.delete(tag);
    this.metrics.invalidations += count;
    return count;
  }

  clear() {
    const count = this.cache.size;
    this.cache.clear();
    this.tagMap.clear();
    this.metrics.invalidations += count;
    return count;
  }

  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRatio = total > 0 ? (this.metrics.hits / total) * 100 : 0;
    const computeHoursSaved = Number((this.metrics.estimatedComputeMsSaved / (1000 * 60 * 60)).toFixed(6));

    return {
      activeEntries: this.cache.size,
      maxEntries: this.maxEntries,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      totalQueriesProcessed: total,
      cacheHitRatio: `${hitRatio.toFixed(2)}%`,
      cacheHitRatioNumber: Number(hitRatio.toFixed(2)),
      invalidations: this.metrics.invalidations,
      estimatedComputeMsSaved: this.metrics.estimatedComputeMsSaved,
      estimatedComputeHoursSaved: computeHoursSaved,
    };
  }
}

const queryCache = new QueryCache();

module.exports = {
  QueryCache,
  queryCache,
};
