/**
 * Client Error Rate Limiter & Request Validation Middleware
 *
 * Protects unauthenticated public beacon (/api/logs/client-error) against
 * denial-of-service, storage exhaustion, and log injection attacks.
 */

const ipStore = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_REQUESTS = 30; // 30 requests per minute per IP

function getClientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown-client';
}

function clientErrorRateLimiter(req, res, next) {
  const maxRequests = parseInt(process.env.CLIENT_ERROR_RATE_LIMIT, 10) || DEFAULT_MAX_REQUESTS;
  const ip = getClientIp(req);
  const now = Date.now();

  let record = ipStore.get(ip);
  if (!record || now - record.windowStart > WINDOW_MS) {
    record = { windowStart: now, count: 1 };
    ipStore.set(ip, record);
  } else {
    record.count += 1;
  }

  // Periodic pruning of stale records if store grows large
  if (ipStore.size > 1000) {
    for (const [k, v] of ipStore.entries()) {
      if (now - v.windowStart > WINDOW_MS * 2) {
        ipStore.delete(k);
      }
    }
  }

  if (record.count > maxRequests) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      success: false,
      error: 'Too many client error reports. Please slow down.',
    });
  }

  next();
}

clientErrorRateLimiter.reset = () => {
  ipStore.clear();
};

const ALLOWED_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CATEGORY_LENGTH = 64;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_JSON_LENGTH = 10000;

function validateClientError(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      error: 'Request body must be a valid JSON object.',
    });
  }

  // 1. Validate message
  if (typeof body.message !== 'string' || body.message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'message is required and must be a non-empty string.',
    });
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `message must not exceed ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  // 2. Validate level (optional, default: ERROR)
  let level = 'ERROR';
  if (body.level !== undefined) {
    if (typeof body.level !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'level must be a string.',
      });
    }
    const upper = body.level.toUpperCase();
    if (!ALLOWED_LEVELS.has(upper)) {
      return res.status(400).json({
        success: false,
        error: `level must be one of: ${Array.from(ALLOWED_LEVELS).join(', ')}.`,
      });
    }
    level = upper;
  }

  // 3. Validate category (optional, default: CLIENT_ERROR)
  let category = 'CLIENT_ERROR';
  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || body.category.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'category must be a non-empty string.',
      });
    }
    if (body.category.length > MAX_CATEGORY_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `category must not exceed ${MAX_CATEGORY_LENGTH} characters.`,
      });
    }
    category = body.category.trim();
  }

  // 4. Validate metadata (optional plain object)
  let metadata = {};
  if (body.metadata !== undefined) {
    if (body.metadata === null || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      return res.status(400).json({
        success: false,
        error: 'metadata must be a plain JSON object.',
      });
    }
    const keys = Object.keys(body.metadata);
    if (keys.length > MAX_METADATA_KEYS) {
      return res.status(400).json({
        success: false,
        error: `metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
      });
    }
    let serialized = '';
    try {
      serialized = JSON.stringify(body.metadata);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'metadata must be valid JSON.',
      });
    }
    if (serialized.length > MAX_METADATA_JSON_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `metadata serialized size cannot exceed ${MAX_METADATA_JSON_LENGTH} bytes.`,
      });
    }
    metadata = body.metadata;
  }

  // Sanitize req.body to prevent prototype pollution or unconstrained properties
  req.body = {
    message: body.message.trim(),
    level,
    category,
    metadata,
  };

  next();
}

module.exports = {
  clientErrorRateLimiter,
  validateClientError,
  rateLimiter: clientErrorRateLimiter,
};
