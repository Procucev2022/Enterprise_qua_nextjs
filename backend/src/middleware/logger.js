const { logger } = require('../services/loggerService');
const crypto = require('crypto');
const { REQUEST_ID_CONFIG } = require('../config/constants');
const {
  createRequestContext,
  runWithRequestContext,
  summarizeD1Counters,
} = require('../services/requestContext');

/**
 * HTTP Request Structured Logging Middleware
 *
 * Each request runs inside a request context, so every log line written while it is handled
 * carries the request id. The access line also reports the D1 work the request caused.
 */
function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const start = Date.now();
  const headers = req.headers || {};
  const clientRequestId = headers['x-request-id'];
  const requestId = typeof clientRequestId === 'string' && REQUEST_ID_CONFIG.HEADER_PATTERN.test(clientRequestId)
    ? clientRequestId
    : `req-${crypto.randomUUID()}`;
  const requestPath = req.originalUrl.split('?')[0];
  req.requestId = requestId;
  if (typeof res.setHeader === 'function') res.setHeader('X-Request-Id', requestId);
  const requestContext = createRequestContext({ requestId, method: req.method, path: requestPath });

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
      `${req.method} ${requestPath} -> connection closed with no response after ${Date.now() - start}ms`,
      {
        method: req.method,
        url: requestPath,
        durationMs: Date.now() - start,
        requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        ...summarizeD1Counters(requestContext),
      },
      'HTTP_REQUEST'
    );
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode || 200;

    // The shared logger handles both structured persistence and stdout output.
    // Avoid a second unstructured line for every request.
    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    logger.log(
      level,
      `${req.method} ${requestPath} -> ${status} (${duration}ms)`,
      {
        method: req.method,
        url: requestPath,
        statusCode: status,
        durationMs: duration,
        requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: headers['user-agent'],
        ...summarizeD1Counters(requestContext),
      },
      'HTTP_REQUEST'
    );
  });

  return runWithRequestContext(requestContext, () => next());
}

module.exports = requestLogger;
