const storeService = require('../services/storeService');
const domainQueries = require('../db/domainQueries');
const { queryCache } = require('../db/queryCache');
const pool = require('../db/pool');
const { getOptimizationMetrics } = require('../db/optimizationMetrics');
const { logger } = require('../services/loggerService');
const { logErrorResolver } = require('../services/logErrorResolver');
const { performanceOptimizer } = require('../services/performanceOptimizer');
const cryptoService = require('../services/cryptoService');
const authService = require('../services/authService');
const { extractToken } = require('../middleware/auth');
const rfqSummaryService = require('../services/rfqSummaryService');
const { AUTH_MESSAGES } = require('../config/constants');
const { sanitizePublicVendor } = require('../controllers/vendorController');
const graphqlUserCache = new WeakMap();

/**
 * Mutations go through the same rootValue-as-plain-functions path as queries,
 * bypassing the REST route middleware entirely — so auth has to be enforced
 * here instead. graphql-js calls these as fn(args, context, info); context
 * carries { req, res } from graphqlController.
 */
// Async because revocation is read from PostgreSQL now. Every caller awaits it,
// so a logged-out token is rejected here too — while that check lived in a
// per-process Set, GraphQL was a second route a revoked token could still pass
// after a restart or on a different worker.
async function resolveOptionalUser(context) {
  const req = context && context.req;
  if (!req || typeof req !== 'object') return null;
  if (req.user) return req.user;

  let verificationPromise = graphqlUserCache.get(req);
  if (!verificationPromise) {
    verificationPromise = (async () => {
      const token = extractToken(req);
      if (!token) return null;
      const verification = await authService.assertSessionActive(token);
      return verification.valid ? verification.user : null;
    })();
    graphqlUserCache.set(req, verificationPromise);
  }

  const user = await verificationPromise;
  if (user) req.user = user;
  return user;
}

async function requireAuth(context) {
  const req = context && context.req;
  const token = extractToken(req);
  const user = await resolveOptionalUser(context);
  if (!user) {
    throw new Error(token ? AUTH_MESSAGES.INVALID_SESSION_FALLBACK : AUTH_MESSAGES.NO_SESSION_TOKEN);
  }
  return user;
}

async function requireRole(context, ...allowedRoles) {
  const user = await requireAuth(context);
  if (!allowedRoles.includes(user.role)) {
    throw new Error('You do not have permission to perform this action.');
  }
  return user;
}

async function requireAdmin(context) {
  return requireRole(context, 'admin');
}

/**
 * Which RFQs a caller may see, mirroring rfqController's resolveRfqReadScope.
 *
 * The `rfqs`/`rfq` resolvers used to read `storeService.getRFQs()` — the
 * whole global array, with no session required at all. That made GraphQL a
 * second, wider route to the same leak the REST endpoints had (7c8990c),
 * and it would have quietly bypassed the scoping added there. Buyers are
 * scoped to their own buyerAccountId; category managers, admins and
 * vendors see the full list (see rfqController.js for why).
 */
async function requireRfqReadScope(context) {
  const user = await requireAuth(context);
  if (user.role === 'buyer') {
    const account = await storeService.getBuyerAccountByEmail(user.email);
    return { user, role: user.role, restricted: true, buyerAccountId: account ? account.id : null };
  }
  if (user.role === 'vendor') {
    // 'all': resolving the caller's own vendor identity by session email, not
    // a buyer-scoped list — the same fix as rfqController.resolveRfqReadScope
    // (REST); this GraphQL equivalent had the identical gap.
    const vendor = storeService.getVendorById(user.email, 'all');
    return { user, role: user.role, restricted: true, vendor: vendor || null };
  }
  return { user, role: user.role, restricted: false, buyerAccountId: null };
}

/** Whether one RFQ is in a resolved read scope. */
function rfqInScope(scope, rfq) {
  if (!scope.restricted) return true;
  if (scope.role === 'vendor') {
    if (storeService.vendorCoversRFQ(scope.vendor, rfq)) return true;
    if (storeService.isVendorMappedToRfqBuyer(scope.vendor, rfq)) return true;
    const mode = String(rfq.sourcingMode || '').trim().toLowerCase();
    const isV1 = mode === 'mode_1' || mode === 'v1' || mode === 'version_1';
    if (!isV1 && storeService._vendorCoversRFQCategories(scope.vendor, rfq)) return true;
    return false;
  }
  return rfq.buyerAccountId === scope.buyerAccountId;
}

function isManagementUser(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'category_manager'));
}

function canReadPrivateVendor(vendor, user, buyerId) {
  if (isManagementUser(user)) return true;
  if (!vendor.buyerId && !vendor.buyerAccountId) return false;
  if (!user || user.role !== 'buyer') return false;
  const ownerValues = [vendor.buyerId, vendor.buyerAccountId, vendor.buyerEmail]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return [buyerId, user.email].filter(Boolean).some((value) => ownerValues.includes(String(value).toLowerCase()));
}

function vendorForGraphQL(vendor, user, buyerId) {
  if (!vendor || typeof vendor !== 'object') return null;
  if (canReadPrivateVendor(vendor, user, buyerId)) return vendor;
  const safeVendor = sanitizePublicVendor(vendor);
  return { ...safeVendor, email: safeVendor.email || null };
}

async function requireVendorMutationScope(context, vendorId) {
  const user = await requireAuth(context);
  const vendor = await storeService.getVendorByIdWithDBFallback(vendorId, 'all');
  if (!vendor) return { user, vendor: null };
  if (isManagementUser(user)) return { user, vendor };

  if (user.role === 'buyer') {
    const account = await storeService.getBuyerAccountByEmail(user.email);
    const allowedIds = [account && account.id, user.sub, user.email].filter(Boolean).map((value) => String(value).toLowerCase());
    const ownerIds = [vendor.buyerId, vendor.buyerAccountId, vendor.buyerEmail]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    if (ownerIds.some((ownerId) => allowedIds.includes(ownerId))) return { user, vendor };
  }

  if (user.role === 'vendor' && String(vendor.email || '').toLowerCase() === String(user.email || '').toLowerCase()) {
    return { user, vendor };
  }

  throw new Error('You do not have permission to modify this vendor.');
}

/**
 * Shapes one remediation outcome for the RemediationResult type. Every value is taken from
 * the log error resolver's result. A refused action keeps remediationId null because the
 * resolver records nothing for it.
 */
function toRemediationResult(result) {
  const succeeded = result.success === true;
  return {
    remediationId: result.remediationId || null,
    actionType: String(result.actionType || ''),
    success: succeeded,
    status: result.status || (succeeded ? 'applied' : 'failed'),
    message: String(result.message || ''),
    timestamp: String(result.timestamp || ''),
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
  };
}

/**
 * GraphQL Root Resolvers
 */
const rootResolvers = {

  rfqs: async (args = {}, context) => {
    const scope = await requireRfqReadScope(context);
    if (scope.restricted && scope.role === 'buyer' && !scope.buyerAccountId) {
      return [];
    }
    const scopedBuyerId = scope.restricted && scope.role === 'buyer' ? scope.buyerAccountId : null;
    const { category, sourcingMode, status, offset = 0 } = args;
    const limit = Math.min(args.limit || 50, 500);
    let result = storeService.getRFQs(scopedBuyerId).filter((rfq) => rfqInScope(scope, rfq));
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

  rfq: async (args = {}, context) => {
    const scope = await requireRfqReadScope(context);
    const key = args.id || args.rfqNumber;
    if (!key) return null;
    const rfq = storeService.getRFQById(key);
    if (!rfq) return null;
    if (!rfqInScope(scope, rfq)) return null;
    return rfq;
  },

  vendors: async (args = {}, context = {}) => {
    const { majorCategory, source, search, offset = 0 } = args;
    const limit = Math.min(args.limit || 50, 500);
    const user = await resolveOptionalUser(context);
    let buyerId = null;
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (isManagementUser(user)) {
      buyerId = 'all';
    }
    let result;
    if (pool.hasStorage()) {
      // storeService.getVendors() re-syncs from the DB with a full unbounded
      // table read on every call (its own doc comment flags this) — wrong
      // here since this resolver already takes limit/offset/search/
      // majorCategory and only needs one page. getVendorsPageFromDB does the
      // same filtering in SQL, so a request only ever touches the rows it
      // returns.
      const page = await domainQueries.getVendorsPageFromDB({
        limit,
        offset,
        search: search || '',
        category: majorCategory || '',
        publicOnly: !buyerId,
        scopedBuyerId: buyerId || '',
      });
      result = (page && Array.isArray(page.rows)) ? page.rows : [];
    } else {
      // No DB configured: nothing to bound against, fall back to the
      // in-memory collection and filter/paginate in JS as before.
      const hasJsFilters = Boolean(majorCategory || search);
      const fetched = await storeService.getVendors(buyerId, hasJsFilters ? null : offset + limit);
      result = Array.isArray(fetched) ? fetched : [];
      if (majorCategory) {
        result = result.filter((v) => v && v.majorCategory && v.majorCategory.toLowerCase().includes(majorCategory.toLowerCase()));
      }
      if (search) {
        const q = search.toLowerCase();
        result = result.filter((v) => v && ((v.name && v.name.toLowerCase().includes(q)) || (v.email && v.email.toLowerCase().includes(q))));
      }
      result = result.slice(offset, offset + limit);
    }
    if (source) result = result.filter((vendorItem) => vendorItem && vendorItem.source === source);
    return result.map((vendorItem) => vendorForGraphQL(vendorItem, user, buyerId)).filter(Boolean);
  },

  vendor: async (args = {}, context = {}) => {
    const user = await resolveOptionalUser(context);
    let buyerId = null;
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (isManagementUser(user)) {
      buyerId = 'all';
    }
    if (args.id) {
      const found = await storeService.getVendorByIdWithDBFallback(args.id, buyerId);
      return vendorForGraphQL(found, user, buyerId);
    }
    if (args.email) {
      if (!pool.hasStorage()) {
        const vendors = await storeService.getVendors(buyerId);
        const found = vendors.find((v) => v.email && v.email.toLowerCase() === args.email.toLowerCase()) || null;
        return vendorForGraphQL(found, user, buyerId);
      }
      // Bounded single-row lookup instead of a full-table getVendors() fetch
      // just to find one row by email.
      const vendor = await domainQueries.getVendorByEmailFromDB(args.email);
      if (!vendor) return null;
      if (buyerId === 'all') return vendor;
      if (!vendor.buyerId && !vendor.buyerAccountId) return vendorForGraphQL(vendor, user, buyerId);
      if (!buyerId) return null;
      const sId = String(buyerId).toLowerCase();
      const matches =
        (vendor.buyerId && String(vendor.buyerId).toLowerCase() === sId) ||
        (vendor.buyerAccountId && String(vendor.buyerAccountId).toLowerCase() === sId) ||
        (vendor.buyerEmail && String(vendor.buyerEmail).toLowerCase() === sId);
      return matches ? vendorForGraphQL(vendor, user, buyerId) : null;
    }
    return null;
  },

  buyerAccounts: async (args = {}, context) => {
    const user = await requireRole(context, 'admin', 'category_manager', 'buyer');
    if (user.role === 'buyer') {
      const account = await storeService.getBuyerAccountByEmail(user.email);
      return account ? [account] : [];
    }
    const limit = Math.min(args.limit || 20, 500);
    return storeService.getBuyerAccounts(limit);
  },

  activeBuyerAccount: async (args, context) => {
    const user = await requireRole(context, 'admin', 'category_manager', 'buyer');
    if (user.role === 'buyer') return storeService.getBuyerAccountByEmail(user.email);
    return storeService.getActiveBuyerAccount();
  },

  evaluations: async (args = {}, context) => {
    await requireRole(context, 'admin', 'category_manager', 'buyer');
    const limit = Math.min(args.limit || 50, 500);
    let evals = storeService.getEvaluations(args.vendorName ? null : limit);
    if (args.vendorName) {
      evals = evals.filter((e) => e.vendorName && e.vendorName.toLowerCase().includes(args.vendorName.toLowerCase()));
    }
    return evals.slice(0, limit);
  },

  auditLogs: async (args = {}, context) => {
    await requireAdmin(context);
    const { search } = args;
    const limit = Math.min(args.limit || 50, 500);
    let logs = storeService.getAuditLogs(search ? null : limit);
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter((l) => (l.action && l.action.toLowerCase().includes(q)) || (l.userEmail && l.userEmail.toLowerCase().includes(q)));
    }
    return logs.slice(0, limit);
  },

  catalogue: (args = {}) => {
    const { category, search } = args;
    const limit = Math.min(args.limit || 50, 500);
    let items = storeService.getVendorCatalogue(null, (category || search) ? null : limit);
    if (category) {
      items = items.filter((i) => i.category && i.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) => (i.name && i.name.toLowerCase().includes(q)) || (i.sku && i.sku.toLowerCase().includes(q)));
    }
    return items.slice(0, limit);
  },

  aiFeed: async (args = {}, context) => {
    const user = await requireRole(context, 'admin', 'category_manager', 'buyer');
    const limit = Math.min(args.limit || 20, 500);
    const isBuyer = user.role === 'buyer';
    let buyerAccountId = null;
    if (isBuyer) {
      const account = await storeService.getBuyerAccountByEmail(context.req.user.email);
      buyerAccountId = account ? account.id : null;
      if (!buyerAccountId) return [];
    }

    const all = await storeService.getAIFeedDurably(100);
    if (isBuyer) {
      const buyerRfqs = storeService.getRFQs(buyerAccountId).filter((r) => r.buyerAccountId === buyerAccountId);
      const buyerRfqNumbers = new Set(buyerRfqs.map((r) => r.rfqNumber).filter(Boolean));
      return all
        .filter((item) => item.buyerAccountId === buyerAccountId || (item.rfqNumber && buyerRfqNumbers.has(item.rfqNumber)))
        .slice(0, limit);
    }
    return all.slice(0, limit);
  },

  systemConfig: async (args, context) => {
    await requireRole(context, 'admin', 'category_manager');
    return storeService.getSystemConfig();
  },

  dbHealth: async (args, context) => {
    await requireAdmin(context);
    return await pool.checkDatabaseHealth();
  },

  optimizationMetrics: async (args, context) => {
    await requireAdmin(context);
    return getOptimizationMetrics();
  },

  diagnoseLogErrors: async (args, context) => {
    await requireAdmin(context);
    return logErrorResolver.diagnoseErrors();
  },

  auditPerformance: async (args, context) => {
    await requireAdmin(context);
    return performanceOptimizer.auditPerformance();
  },

  cryptoStatus: async (args, context) => {
    await requireAdmin(context);
    return cryptoService.verifyCryptoHealth();
  },

  decryptData: async ({ input }, context) => {
    await requireAdmin(context);
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

  createRFQ: async ({ input }, context) => {
    const user = await requireRole(context, 'buyer', 'admin', 'category_manager');
    logger.info('GraphQL Mutation: createRFQ', { title: input.title }, 'GRAPHQL_MUTATION');
    const lineItems = Array.isArray(input.extractedEntities) ? input.extractedEntities : input.lineItems || [];
    // A model or network failure here must not block RFQ creation —
    // buildRFQSummary already falls back to a deterministic summary rather
    // than throwing (mirrors rfqController.createRFQ).
    const aiSummary = await rfqSummaryService.buildRFQSummary(
      { ...input, extractedEntities: lineItems },
      { orgName: user.orgName || '' }
    );
    const requestingBuyerAccount = await storeService.getBuyerAccountByEmail(user.email);
    return storeService.createRFQDurably({ ...input, extractedEntities: lineItems, aiSummary }, requestingBuyerAccount);
  },

  updateRFQ: async ({ id, input }, context) => {
    const scope = await requireRfqReadScope(context);
    if (scope.role === 'vendor') {
      return null;
    }
    const existing = storeService.getRFQById(id);
    if (!existing || !rfqInScope(scope, existing)) {
      return null;
    }
    logger.info(`GraphQL Mutation: updateRFQ ${id}`, { id, input }, 'GRAPHQL_MUTATION');
    return storeService.updateRFQDurably(id, input);
  },

  createVendor: async ({ input }, context) => {
    const user = await requireRole(context, 'buyer', 'admin', 'category_manager');
    logger.info('GraphQL Mutation: createVendor', { name: input.name }, 'GRAPHQL_MUTATION');
    const buyerAccount = user.role === 'buyer' ? await storeService.getBuyerAccountByEmail(user.email) : null;
    const buyerId = user.role === 'buyer' ? (buyerAccount ? buyerAccount.id : user.sub || user.email) : null;
    return storeService.addVendorDurably(input, user.email, buyerId);
  },

  updateVendor: async ({ id, input }, context) => {
    await requireVendorMutationScope(context, id);
    logger.info(`GraphQL Mutation: updateVendor ${id}`, { id, updatedFields: Object.keys(input || {}) }, 'GRAPHQL_MUTATION');
    return storeService.updateVendorDurably(id, input);
  },

  deleteVendor: async ({ id }, context) => {
    await requireVendorMutationScope(context, id);
    logger.info(`GraphQL Mutation: deleteVendor ${id}`, { id }, 'GRAPHQL_MUTATION');
    return storeService.deleteVendorDurably(id);
  },

  createBuyerAccount: async ({ input }, context) => {
    await requireRole(context, 'buyer', 'admin');
    logger.info('GraphQL Mutation: createBuyerAccount', { org: input.organizationName }, 'GRAPHQL_MUTATION');
    return storeService.addBuyerAccountDurably(input);
  },

  clearQueryCache: async (args, context) => {
    await requireAdmin(context);
    queryCache.clear();
    return true;
  },

  purgeLogs: async (args = {}, context) => {
    await requireAdmin(context);
    const maxAgeDays = args.maxAgeDays || 30;
    return logger.purgeExpiredLogs({ maxAgeDays });
  },

  autoResolveLogErrors: async (args = {}, context) => {
    await requireAdmin(context);
    if (args.action) {
      const issues = logErrorResolver.diagnoseErrors();
      const res = await logErrorResolver.executeRemediation(args.action);
      return {
        diagnosedCount: issues.length,
        issues,
        remediationsApplied: [toRemediationResult(res)],
      };
    }
    const report = await logErrorResolver.autoResolveAll();
    return {
      ...report,
      remediationsApplied: report.remediationsApplied.map(toRemediationResult),
    };
  },

  optimizePerformance: async (args = {}, context) => {
    await requireAdmin(context);
    const level = args.level || 'standard';
    return performanceOptimizer.optimizePerformance(level);
  },

  encryptData: async ({ input }, context) => {
    await requireAuth(context);
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
