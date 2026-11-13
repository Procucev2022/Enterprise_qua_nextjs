const { logger } = require('../services/loggerService');
const { D1_OVERLOAD_CONFIG } = require('../config/constants');
const { isD1OverloadError, isRetryableD1Error } = require('../db/d1Bridge');

/**
 * Global API Error Handling Middleware with Structured Logging
 *
 * 4xx responses are expected outcomes (validation, permissions, business rules), so they log
 * at WARN without a stack trace. 5xx responses log at ERROR with the stack trace. The raw error
 * name, message and code are always logged, even though the response text may be generic.
 */
function errorHandler(err, req, res, next) {
  const requestedStatus = err.statusCode || err.status;
  const hasExplicitStatus = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599;
  // A D1 overload without its own status is a retryable outage, not an internal error.
  // The response text stays generic so database internals are not exposed.
  const databaseOverloaded = !hasExplicitStatus && isD1OverloadError(err);
  let statusCode = 500;
  if (databaseOverloaded) statusCode = 503;
  else if (hasExplicitStatus) statusCode = requestedStatus;
  const isPublicError = statusCode < 500 || err.expose || statusCode === 502 || statusCode === 503 || statusCode === 504;
  let message = isPublicError
    ? (err.message || (statusCode >= 500 ? 'Service temporarily unavailable. Please retry.' : 'Request failed.'))
    : (err.message && process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error');
  if (databaseOverloaded) message = D1_OVERLOAD_CONFIG.MESSAGE;
  const requestPath = req.path || String(req.originalUrl || '').split('?')[0];

  // Structured Error Logging with fallback
  try {
    const isServerError = statusCode >= 500;
    const logMeta = {
      statusCode,
      method: req.method,
      url: requestPath,
      requestId: req.requestId,
      errorName: err.name,
      errorCode: err.code,
      errorMessage: err.message,
      clientMessage: message,
      databaseOverloaded,
      retryable: databaseOverloaded || isRetryableD1Error(err),
      ipAddress: req.ip || req.connection?.remoteAddress,
      ...(isServerError ? { stack: err.stack } : {}),
    };
    const summary = `API Error ${statusCode}: ${message}`;
    if (isServerError) {
      logger.error(summary, logMeta, 'GLOBAL_ERROR_HANDLER');
    } else {
      logger.warn(summary, logMeta, 'GLOBAL_ERROR_HANDLER');
    }
  } catch (loggingError) {
    // Keep a minimal safe signal if the shared logger itself is unavailable.
    console.error('[GLOBAL_ERROR_HANDLER] Structured logging failed', {
      statusCode,
      method: req.method,
      url: requestPath,
      requestId: req.requestId,
      loggingErrorName: loggingError?.name || 'Error',
    });
  }

  if (databaseOverloaded) res.setHeader('Retry-After', String(D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS));
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(databaseOverloaded ? { retryable: true } : {}),
    ...(err.code ? { code: err.code } : {}),
    ...(err.details ? { details: err.details } : {}),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

module.exports = errorHandler;
