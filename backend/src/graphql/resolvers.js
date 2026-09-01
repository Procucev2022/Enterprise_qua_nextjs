const storeService = require('../services/storeService');
const { queryCache } = require('../db/queryCache');
const poolModule = require('../db/pool');
const { logger } = require('../services/loggerService');
const { logErrorResolver } = require('../services/logErrorResolver');
const { performanceOptimizer } = require('../services/performanceOptimizer');
const cryptoService = require('../services/cryptoService');
const authService = require('../services/authService');
const { extractToken } = require('../middleware/auth');
const { AUTH_MESSAGES } = require('../config/constants');

/**
 * Mutations go through the same rootValue-as-plain-functions path as queries,
 * bypassing the REST route middleware entirely — so auth has to be enforced
 * here instead. graphql-js calls these as fn(args, context, info); context
 * carries { req, res } from graphqlController.
 */
function requireAuth(context) {
  const token = extractToken(context && context.req);
  if (!token) {
    throw new Error(AUTH_MESSAGES.NO_SESSION_TOKEN);
  }
  const verification = authService.verifySessionToken(token);
  if (!verification.valid) {
    throw new Error(verification.error || AUTH_MESSAGES.INVALID_SESSION_FALLBACK);
  }
  return verification.user;
}

function requireAdmin(context) {
  const user = requireAuth(context);
  if (user.role !== 'admin') {
    throw new Error('You do not have permission to perform this action.');
  }
  return user;
}

/**
 * GraphQL Root Resolvers
 */
const rootResolvers = {

  rfqs: (args = {}) => {
    const { category, sourcingMode, status, limit = 50, offset = 0 } = args;
    let result = storeService.getRFQs();
    if (category) {
      result = result.filter((r) => r.category && r.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (sourcingMode) {
      result = result.filter((r) => r.sourcingMode === sourcingMode);
    }
    if (status) {
      result = result.filter((r) => r.status && r.status.toLowerCase() === status.toLowerCase());
    }
    return result.slice(offset, offset + limit);
  },

  rfq: (args = {}) => {
    const key = args.id || args.rfqNumber;
    return key ? storeService.getRFQById(key) || null : null;
  },

  vendors: (args = {}) => {
    const { majorCategory, source, search, limit = 50, offset = 0 } = args;
    let result = storeService.getVendors();
    if (majorCategory) {
      result = result.filter((v) => v.majorCategory && v.majorCategory.toLowerCase().includes(majorCategory.toLowerCase()));
    }
    if (source) {
      result = result.filter((v) => v.source === source);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((v) => (v.name && v.name.toLowerCase().includes(q)) || (v.email && v.email.toLowerCase().includes(q)));
    }
    return result.slice(offset, offset + limit);
  },

  vendor: (args = {}) => {
    if (args.id) {
      return storeService.getVendorById(args.id) || null;
    }
    if (args.email) {
      return storeService.getVendors().find((v) => v.email && v.email.toLowerCase() === args.email.toLowerCase()) || null;
    }
    return null;
  },

  buyerAccounts: (args = {}) => {
    const limit = args.limit || 20;
    return storeService.getBuyerAccounts().slice(0, limit);
  },

  activeBuyerAccount: () => {
    return storeService.getActiveBuyerAccount();
  },

  evaluations: (args = {}) => {
    let evals = storeService.getEvaluations();
    if (args.vendorName) {
      evals = evals.filter((e) => e.vendorName && e.vendorName.toLowerCase().includes(args.vendorName.toLowerCase()));
    }
    return evals;
  },

  auditLogs: (args = {}) => {
    const { limit = 50, search } = args;
    let logs = storeService.getAuditLogs();
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter((l) => (l.action && l.action.toLowerCase().includes(q)) || (l.userEmail && l.userEmail.toLowerCase().includes(q)));
    }
    return logs.slice(0, limit);
  },

  catalogue: (args = {}) => {
    const { category, search } = args;
    let items = storeService.getVendorCatalogue();
    if (category) {
      items = items.filter((i) => i.category && i.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) => (i.name && i.name.toLowerCase().includes(q)) || (i.sku && i.sku.toLowerCase().includes(q)));
    }
    return items;
  },

  aiFeed: (args = {}) => {
    const limit = args.limit || 20;
    return storeService.getAIFeed().slice(0, limit);
  },

  systemConfig: () => {
    return storeService.getSystemConfig();
  },

  dbHealth: async () => {
    return await poolModule.checkDBHealth();
  },

  optimizationMetrics: () => {
    return poolModule.getOptimizationMetrics();
  },

  diagnoseLogErrors: () => {
    return logErrorResolver.diagnoseErrors();
  },

  auditPerformance: () => {
    return performanceOptimizer.auditPerformance();
  },

  cryptoStatus: () => {
    return cryptoService.verifyCryptoHealth();
  },

  decryptData: ({ input }) => {
    if (input.token) {
      const plaintext = cryptoService.decrypt(input.token, {
        secretKey: input.secretKey,
        additionalData: input.additionalData,
      });
      return { plaintext };
    }
    const plaintext = cryptoService.decrypt(input, {
      secretKey: input.secretKey,
      additionalData: input.additionalData,
      encoding: input.encoding,
    });
    return { plaintext };
  },

  createRFQ: ({ input }, context) => {
    requireAuth(context);
    logger.info('GraphQL Mutation: createRFQ', { title: input.title }, 'GRAPHQL_MUTATION');
    return storeService.createRFQ(input);
  },

  updateRFQ: ({ id, input }, context) => {
    requireAuth(context);
    logger.info(`GraphQL Mutation: updateRFQ ${id}`, { id, input }, 'GRAPHQL_MUTATION');
    return storeService.updateRFQ(id, input);
  },

  createVendor: ({ input }, context) => {
    requireAuth(context);
    logger.info('GraphQL Mutation: createVendor', { name: input.name }, 'GRAPHQL_MUTATION');
    return storeService.addVendor(input);
  },

  updateVendor: ({ id, input }, context) => {
    requireAuth(context);
    logger.info(`GraphQL Mutation: updateVendor ${id}`, { id, input }, 'GRAPHQL_MUTATION');
    return storeService.updateVendor(id, input);
  },

  deleteVendor: ({ id }, context) => {
    requireAuth(context);
    logger.info(`GraphQL Mutation: deleteVendor ${id}`, { id }, 'GRAPHQL_MUTATION');
    return storeService.deleteVendor(id);
  },

  createBuyerAccount: ({ input }, context) => {
    requireAuth(context);
    logger.info('GraphQL Mutation: createBuyerAccount', { org: input.organizationName }, 'GRAPHQL_MUTATION');
    return storeService.addBuyerAccount(input);
  },

  clearQueryCache: (args, context) => {
    requireAuth(context);
    queryCache.clear();
    return true;
  },

  purgeLogs: (args = {}, context) => {
    requireAdmin(context);
    const maxAgeDays = args.maxAgeDays || 30;
    return logger.purgeExpiredLogs({ maxAgeDays });
  },

  autoResolveLogErrors: async (args = {}, context) => {
    requireAdmin(context);
    if (args.action) {
      const res = await logErrorResolver.executeRemediation(args.action);
      return {
        diagnosedCount: 1,
        issues: [],
        remediationsApplied: [res],
      };
    }
    return await logErrorResolver.autoResolveAll();
  },

  optimizePerformance: (args = {}, context) => {
    requireAdmin(context);
    const level = args.level || 'standard';
    return performanceOptimizer.optimizePerformance(level);
  },

  encryptData: ({ input }, context) => {
    requireAuth(context);
    const res = cryptoService.encrypt(input.plaintext, {
      secretKey: input.secretKey,
      additionalData: input.additionalData,
      encoding: input.encoding,
    });
    return {
      ciphertext: res.ciphertext,
      iv: res.iv,
      authTag: res.authTag,
      salt: res.salt,
      algorithm: res.algorithm,
      version: res.version,
      encoded: res.encoded,
    };
  },
};

module.exports = rootResolvers;

