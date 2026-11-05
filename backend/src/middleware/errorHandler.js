const { logger } = require('../services/loggerService');

/**
 * Global API Error Handling Middleware with Structured Logging
 */
function errorHandler(err, req, res, next) {
  const requestedStatus = err.statusCode || err.status;
  const statusCode = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
    ? requestedStatus
    : 500;
  const message = statusCode < 500 || err.expose
    ? (err.message || 'Request failed.')
    : 'Internal Server Error';
  const requestPath = req.path || String(req.originalUrl || '').split('?')[0];

  // Structured Error Logging with fallback
  try {
    logger.error(
      `API Error ${statusCode}: ${message}`,
      {
        statusCode,
        method: req.method,
        url: requestPath,
        requestId: req.requestId,
        errorName: err.name,
        errorMessage: message,
        stack: err.stack,
        ipAddress: req.ip || req.connection?.remoteAddress,
      },
      'GLOBAL_ERROR_HANDLER'
    );
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

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

module.exports = errorHandler;
