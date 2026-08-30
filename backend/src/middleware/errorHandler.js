const { logger } = require('../services/loggerService');

/**
 * Global API Error Handling Middleware with Structured Logging
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Error ${statusCode}] ${req.method} ${req.originalUrl}:`, err);
  }

  // Structured Error Logging with fallback
  try {
    logger.error(
      `API Error ${statusCode}: ${message}`,
      {
        statusCode,
        method: req.method,
        url: req.originalUrl,
        errorName: err.name,
        errorMessage: message,
        stack: err.stack,
        ipAddress: req.ip || req.connection?.remoteAddress,
      },
      'GLOBAL_ERROR_HANDLER'
    );
  } catch {
    // Graceful error logging fallback
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

module.exports = errorHandler;
