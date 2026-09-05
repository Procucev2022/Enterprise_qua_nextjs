const { logger } = require('../services/loggerService');

/**
 * HTTP Request Structured Logging Middleware
 */
function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const start = Date.now();
  const headers = req.headers || {};
  const requestId = headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  /**
   * A request that never produces a response used to leave no trace at all,
   * because only 'finish' was observed. The client saw "socket hang up" and the
   * log could not even confirm the request had arrived. 'close' fires either way,
   * so an aborted or hung request is now recorded with the route and how long it
   * survived — which is the difference between a hang and a request that never
   * reached the server.
   */
  res.on('close', () => {
    if (res.writableEnded) return;

    logger.log(
      'WARN',
      `${req.method} ${req.originalUrl} -> connection closed with no response after ${Date.now() - start}ms`,
      {
        method: req.method,
        url: req.originalUrl,
        durationMs: Date.now() - start,
        requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
      },
      'HTTP_REQUEST'
    );
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode || 200;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';

    // Console output for local dev terminal
    console.log(`${req.method} ${req.originalUrl} ${color}${status}\x1b[0m (${duration}ms)`);

    // Structured persistent logging
    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    logger.log(
      level,
      `${req.method} ${req.originalUrl} -> ${status} (${duration}ms)`,
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: status,
        durationMs: duration,
        requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: headers['user-agent'],
      },
      'HTTP_REQUEST'
    );
  });

  next();
}

module.exports = requestLogger;
