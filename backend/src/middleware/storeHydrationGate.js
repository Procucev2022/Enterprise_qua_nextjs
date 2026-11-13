const { D1_OVERLOAD_CONFIG, STORE_HYDRATION_CONFIG } = require('../config/constants');

/**
 * Lazy store hydration for store-backed API routes.
 *
 * A Worker isolate loads the in-memory store from D1 before it serves a store-backed
 * route. That load runs several queries, so the gate avoids repeating it when a repeat
 * cannot help:
 *   - concurrent requests share one in-flight load;
 *   - after a failed load, requests fail fast for FAILURE_BACKOFF_MS;
 *   - while D1 reports an overload, no new load starts;
 *   - frontend log ingestion never waits for the store.
 */

function normalizePath(requestPath) {
  const path = String(requestPath || '/');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function isLogIngestionRequest(req) {
  return req.method === 'POST' && STORE_HYDRATION_CONFIG.LOG_INGESTION_PATHS.includes(normalizePath(req.path));
}

function sendUnavailable(res, retryAfterSeconds, message) {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(503).json({ success: false, retryable: true, error: message });
}

function createStoreHydrationGate({
  storeService,
  hasStorage,
  isOverloaded,
  shouldSkipPath,
  logger,
  now = () => Date.now(),
}) {
  let inFlightLoad = null;
  let retryNotBefore = 0;

  function startLoad(req) {
    inFlightLoad = storeService.hydrateFromDB()
      .then((result) => {
        if (result && result.hydrated) {
          retryNotBefore = 0;
          return result;
        }
        const error = new Error(result?.error || STORE_HYDRATION_CONFIG.UNAVAILABLE_MESSAGE);
        error.code = 'STORE_HYDRATION_UNAVAILABLE';
        throw error;
      })
      .catch((error) => {
        retryNotBefore = now() + STORE_HYDRATION_CONFIG.FAILURE_BACKOFF_MS;
        logger.error('Lazy on-request hydration failed; rejecting store-backed request', {
          error,
          requestId: req.requestId || req.id || null,
          method: req.method,
          path: req.path,
        }, 'APP');
        throw error;
      })
      .finally(() => {
        inFlightLoad = null;
      });
    return inFlightLoad;
  }

  return function storeHydrationGate(req, res, next) {
    if (
      storeService.isHydratedFromDB ||
      !hasStorage() ||
      shouldSkipPath(req.path) ||
      isLogIngestionRequest(req)
    ) {
      return next();
    }

    let load = inFlightLoad;
    if (!load) {
      if (isOverloaded()) {
        return sendUnavailable(res, D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS, D1_OVERLOAD_CONFIG.MESSAGE);
      }
      if (now() < retryNotBefore) {
        return sendUnavailable(
          res,
          STORE_HYDRATION_CONFIG.FAILURE_RETRY_AFTER_SECONDS,
          STORE_HYDRATION_CONFIG.UNAVAILABLE_MESSAGE
        );
      }
      load = startLoad(req);
    }

    return load.then(
      () => next(),
      () => {
        if (res.headersSent) return next();
        return sendUnavailable(
          res,
          STORE_HYDRATION_CONFIG.FAILURE_RETRY_AFTER_SECONDS,
          STORE_HYDRATION_CONFIG.UNAVAILABLE_MESSAGE
        );
      }
    );
  };
}

module.exports = {
  createStoreHydrationGate,
  isLogIngestionRequest,
};
