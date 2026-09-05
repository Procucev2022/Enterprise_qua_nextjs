// ==============================================================================
// QUERY OPTIMIZATION METRICS
// ==============================================================================
// Aggregates the query cache and query auditor reports. Database-agnostic: it
// serves the MySQL identity connection and the in-memory enterprise store.
// ==============================================================================

const { queryCache } = require('./queryCache');
const { queryAuditor } = require('./queryAuditor');

/**
 * Combined cache + auditing report for the admin infrastructure screen.
 */
function getOptimizationMetrics() {
  return {
    cache: queryCache.getMetrics(),
    auditing: queryAuditor.getAuditReport(),
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getOptimizationMetrics };
