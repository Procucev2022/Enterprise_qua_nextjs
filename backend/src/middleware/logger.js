/**
 * HTTP Request Logging Middleware
 */
function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${req.method} ${req.originalUrl} ${color}${status}\x1b[0m (${duration}ms)`);
  });

  next();
}

module.exports = requestLogger;
