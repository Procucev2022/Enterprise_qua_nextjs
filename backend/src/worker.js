// ==============================================================================
// PROCUCEV ENTERPRISE (QUA AI 2.0) - CLOUDFLARE WORKERS NATIVE EDGE ENTRY POINT
// ==============================================================================
// Serverless Edge Gateway powered by Hono on the Cloudflare Workers Platform
// Supports V8 isolates (workerd) with nodejs_compat, Hyperdrive connection pooling,
// native Cloudflare R2 bucket bindings, Scheduled Cron triggers, and Email Workers.
// ==============================================================================

const { Hono } = require('hono');
const { cors } = require('hono/cors');
const http = require('http');
const { Socket } = require('net');
const { graphql } = require('graphql');

const expressApp = require('./app');
const pool = require('./db/pool');
const r2Client = require('./services/r2Client');
const { logger } = require('./services/loggerService');
const schema = require('./graphql/schema');
const rootResolvers = require('./graphql/resolvers');
const { handleScheduled } = require('./workers/scheduledWorker');
const { handleEmail } = require('./workers/emailWorker');

/**
 * Bridges a Web Standard Request to an Express application and captures the
 * ServerResponse as a Web Standard Response. Enables full reuse of existing Express
 * routers and controllers in Cloudflare Workers nodejs_compat isolate environments.
 *
 * @param {Function} app - Express application instance
 * @param {Request} request - Web standard Request object
 * @returns {Promise<Response>} Web standard Response
 */
function dispatchToExpress(app, request) {
  return new Promise(async (resolve, reject) => {
    try {
      const socket = new Socket();
      const req = new http.IncomingMessage(socket);
      const url = new URL(request.url);

      req.url = url.pathname + url.search;
      req.method = request.method;
      for (const [k, v] of request.headers.entries()) {
        req.headers[k.toLowerCase()] = v;
      }

      let bodyBuffer = null;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        try {
          const arrayBuf = await request.arrayBuffer();
          if (arrayBuf && arrayBuf.byteLength > 0) {
            bodyBuffer = Buffer.from(arrayBuf);
            req.headers['content-length'] = String(bodyBuffer.length);
          }
        } catch {
          // If request body was already read or empty, proceed without buffer
        }
      }

      const chunks = [];
      const responseHeaders = new Headers();
      const res = new http.ServerResponse(req);
      res.assignSocket(socket);

      res.write = (chunk, encoding, cb) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        if (typeof cb === 'function') cb();
        return true;
      };

      res.end = (chunk, encoding, cb) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        if (typeof cb === 'function') cb();

        const rawHeaders = res.getHeaders();
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (v !== undefined && v !== null) {
            responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
          }
        }

        const body = chunks.length > 0 ? Buffer.concat(chunks) : null;
        const response = new Response(body, {
          status: res.statusCode || 200,
          headers: responseHeaders,
        });
        resolve(response);
      };

      app.handle(req, res);

      if (bodyBuffer) {
        req.push(bodyBuffer);
      }
      req.push(null);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Creates and configures the Hono edge gateway application.
 *
 * @param {Object} [options]
 * @param {Function} [options.appOverride] - Optional Express app override for testing
 * @returns {Hono}
 */
function createWorkerApp(options = {}) {
  const targetExpressApp = options.appOverride || expressApp;
  const app = new Hono();

  // 1. Edge Middleware: Binding Initialization (Hyperdrive & R2)
  app.use('*', async (c, next) => {
    const env = c.env || {};
    if (env.HYPERDRIVE || env.DATABASE_URL) {
      pool.initFromEnv(env);
    }
    if (env.R2_BUCKET) {
      r2Client.setNativeBucket(env.R2_BUCKET);
    }
    await next();
  });

  // 2. Global Edge CORS
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-buyer-id'],
      exposeHeaders: ['Content-Length', 'x-request-id'],
      maxAge: 86400,
    })
  );

  // 3. Native Edge Health Endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'UP',
      version: '2.1.0',
      platform: 'Procucev Enterprise (QUA AI 2.0) Cloudflare Workers Edge Platform',
      edge: true,
      timestamp: new Date().toISOString(),
    });
  });

  // 4. Native Edge Root Discovery Endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'Procucev Enterprise Procurement Edge API',
      version: '2.1.0',
      platform: 'Cloudflare Workers',
      status: 'ONLINE',
      endpoints: {
        health: '/health',
        apiBase: '/api',
        graphql: '/graphql',
        rfqs: '/api/rfqs',
        vendors: '/api/vendors',
        evaluations: '/api/evaluations',
        buyerAccounts: '/api/buyer-accounts',
        auditLogs: '/api/audit',
        systemConfig: '/api/system-config',
        catalogue: '/api/catalogue',
        supportChat: '/api/support-chat',
        logs: '/api/logs',
      },
    });
  });

  // 5. Native Edge GraphQL Execution
  app.all('/graphql', async (c) => {
    try {
      let query;
      let variables;
      let operationName;

      if (c.req.method === 'POST') {
        const body = await c.req.json().catch(() => ({}));
        query = body.query;
        variables = body.variables;
        operationName = body.operationName;
      } else {
        query = c.req.query('query');
        variables = c.req.query('variables');
        operationName = c.req.query('operationName');
      }

      if (!query) {
        return c.json({ errors: [{ message: 'Must provide query string in request.' }] }, 400);
      }

      if (typeof variables === 'string') {
        try {
          variables = JSON.parse(variables);
        } catch {
          variables = {};
        }
      }

      const result = await graphql({
        schema,
        source: query,
        rootValue: rootResolvers,
        contextValue: { req: c.req, env: c.env },
        variableValues: variables || {},
        operationName,
      });

      return c.json(result);
    } catch (err) {
      logger.error('Worker GraphQL Exception', err, 'GRAPHQL_EDGE');
      return c.json({ errors: [{ message: err.message || 'Internal GraphQL error' }] }, 500);
    }
  });

  // 6. Enterprise API Gateway Fallback - Dispatches to Express Routes & Controllers
  app.all('*', async (c) => {
    try {
      const response = await dispatchToExpress(targetExpressApp, c.req.raw);
      return response;
    } catch (err) {
      logger.error('Worker Gateway Dispatch Error', err, 'WORKER_GATEWAY');
      return c.json({ success: false, error: err.message || 'Gateway dispatch failed' }, 500);
    }
  });

  return app;
}

const workerApp = createWorkerApp();

module.exports = {
  fetch: (request, env, ctx) => workerApp.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => handleScheduled(event, env, ctx),
  email: (message, env, ctx) => handleEmail(message, env, ctx),
  workerApp,
  createWorkerApp,
  dispatchToExpress,
};
