// Cloudflare Workers entry point for the existing Express app.
//
// Reuses src/app.js as-is (the Express app, without .listen()) via
// httpServerHandler, which bridges Workers' fetch(request) model to a real
// Node http.Server under nodejs_compat. See src/server.js for the
// Node/Render entry point this parallels — that one stays the source of
// truth for local dev and the current Render deploy; this file is additive.
import { httpServerHandler } from 'cloudflare:node';
import { env, waitUntil } from 'cloudflare:workers';

const WORKER_ENV_LOG_CATEGORY = 'WORKER_ENV';
const WORKER_ENV_LOG_MESSAGE = 'Failed to synchronize Cloudflare Worker bindings into process.env';
const WORKER_ENV_OPERATIONS = Object.freeze({
  MODULE_INITIALIZATION: 'worker_module_initialization',
  FETCH: 'worker_fetch',
  SCHEDULED: 'worker_scheduled',
});

async function logWorkerEnvironmentSyncFailure(operation, error) {
  try {
    const loggerModule = await import('./services/loggerService.js');
    const logger = loggerModule.logger || loggerModule.default?.logger;
    if (typeof logger?.error === 'function') {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Worker binding synchronization failed with a non-Error value');
      logger.error(WORKER_ENV_LOG_MESSAGE, {
        operation,
        error: normalizedError,
        ...(error instanceof Error ? {} : { errorType: typeof error }),
      }, WORKER_ENV_LOG_CATEGORY);
      return;
    }
  } catch (loggingError) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      category: WORKER_ENV_LOG_CATEGORY,
      message: WORKER_ENV_LOG_MESSAGE,
      operation,
      errorName: error instanceof Error ? error.name : typeof error,
      loggerErrorName: loggingError instanceof Error ? loggingError.name : typeof loggingError,
    }));
    return;
  }

  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    category: WORKER_ENV_LOG_CATEGORY,
    message: WORKER_ENV_LOG_MESSAGE,
    operation,
    errorName: error instanceof Error ? error.name : typeof error,
  }));
}

// d1Bridge.js (required by the CommonJS backend, deep under app.js) cannot
// reach `env` itself: `require('cloudflare:workers')` at call time throws
// "Dynamic require of 'cloudflare:workers' is not supported" — the bundler
// only resolves cloudflare: specifiers through a static ESM import, and this
// is the only file in the backend that's real ESM. Every D1-ported query
// silently fell back to the pg pool because of this (queryD1 never ran; only
// the try/catch in getD1Binding swallowing the throw). Stashing the binding
// on globalThis here, once, lets d1Bridge.js read it synchronously without
// its own require/import of the virtual module.
globalThis.__CF_ENV__ = env;
if (env && typeof env === 'object') {
  try {
    for (const [k, v] of Object.entries(env)) {
      if ((typeof v === 'string' || typeof v === 'number') && (!process.env[k] || process.env[k] === '')) {
        process.env[k] = String(v);
      }
    }
  } catch (error) {
    await logWorkerEnvironmentSyncFailure(WORKER_ENV_OPERATIONS.MODULE_INITIALIZATION, error);
  }
}

// storeService.js's persistence writes are all fire-and-forget: `promise
// .catch(err => logger.error(...))`, never awaited by the caller, so the
// HTTP response doesn't wait on the DB write. That is fine on Node/Render,
// where the process just keeps running — but on Workers, once the response
// has been sent, an unawaited promise not passed to ctx.waitUntil() can be
// cancelled before it finishes, dropping the write entirely (confirmed live:
// a created RFQ never made it into D1). `waitUntil` imported here from
// cloudflare:workers works the same as ctx.waitUntil() but from anywhere,
// without threading `ctx` through Express — stashed on globalThis for the
// same require/import reason __CF_ENV__ is.
globalThis.__CF_WAIT_UNTIL__ = waitUntil;

// Load the CommonJS application only after the Worker bindings have been copied
// into process.env. Static ESM imports are evaluated before this module body, so
// the old imports froze GEMINI_CONFIG before GEMINI_API_KEY and timeout/model
// variables existed in the Worker runtime. That produced stale model chains and
// immediate aborts when an old deployment supplied 0/negative timeout values.
const appModule = await import('./app.js');
const emailGatewayModule = await import('./services/emailGatewayService.js');
const zohoReconciliationModule = await import('./services/zohoReconciliationService.js');
const rfqChaserSchedulerModule = await import('./services/rfqChaserScheduler.js');
const eventOutboxModule = await import('./services/eventOutboxService.js');
const dailyRfqReportModule = await import('./services/dailyRfqReportService.js');
const app = appModule.default || appModule;
const emailGatewayService = emailGatewayModule.default || emailGatewayModule;
const zohoReconciliationService = zohoReconciliationModule.default || zohoReconciliationModule;
const rfqChaserScheduler = rfqChaserSchedulerModule.default || rfqChaserSchedulerModule;
const eventOutboxService = eventOutboxModule.default || eventOutboxModule;
const dailyRfqReportService = dailyRfqReportModule.default || dailyRfqReportModule;

const PORT = 4000;
app.listen(PORT);

const httpHandler = httpServerHandler({ port: PORT });

/**
 * Runs cron jobs one after another. Starting them together put all of their D1 queries into the same
 * ten-second window, and D1 rejected the burst as overloaded, which failed the jobs that most needed the
 * database. Each job still runs when an earlier one fails. The first failure is rethrown at the end, so the
 * invocation is still reported.
 */
async function runCronJobsInTurn(jobs) {
  let failure = null;
  for (const job of jobs) {
    try {
      await job();
    } catch (error) {
      if (failure === null) failure = { error };
    }
  }
  if (failure !== null) throw failure.error;
}

// server.js's bootstrapServer() (Node/Render only) starts both of these via
// setInterval — emailGatewayService.startPolling() (IMAP -> auto-RFQ
// ingestion) and zohoReconciliationService.startPolling() (payment-link
// reconciliation). worker.mjs never calls bootstrapServer(), and a
// setInterval wouldn't survive a Worker's request-scoped lifetime even if it
// did — Workers has no persistent background process to hold it. Cloudflare
// Cron Triggers (the `crons` array in wrangler.jsonc, wired to this
// `scheduled` export) are the platform's actual mechanism for periodic
// background work: each trigger fire is its own short-lived invocation that
// calls the same single-shot polling functions (pollBothInboxesOnce /
// reconcileOnce) and dispatches due D1-backed notification jobs.
async function scheduled(controller, workerEnv, ctx) {
  if (workerEnv && typeof workerEnv === 'object') {
    globalThis.__CF_ENV__ = workerEnv;
    try {
      for (const [k, v] of Object.entries(workerEnv)) {
        if (typeof v === 'string') {
          process.env[k] = v;
        }
      }
    } catch (error) {
      await logWorkerEnvironmentSyncFailure(WORKER_ENV_OPERATIONS.SCHEDULED, error);
    }
  }
  const cron = controller.cron;
  const isEmailGateway = cron === EMAIL_GATEWAY_CRON || cron === '* * * * *' || cron === '*/5 * * * *';
  const { default: storeService } = await import('./services/storeService.js');
  const loggerModule = await import('./services/loggerService.js');
  const logger = loggerModule.logger || loggerModule.default?.logger;
  // Hydration reads the working set from the database, so it runs only for the jobs that work from the
  // in-memory store. The reconciliation trigger works from the database directly and does not hydrate.
  const hydrate = async () => {
    if (storeService.isHydratedFromDB) return;
    await storeService.hydrateFromDB().catch((err) => {
      if (logger?.error) {
        logger.error('Scheduled Worker state hydration failed', err, 'WORKER_CRON');
      } else {
        console.error('[CRON] hydration failed', err);
      }
    });
  };
  if (isEmailGateway) {
    await hydrate();
    await runCronJobsInTurn([
      () => eventOutboxService.dispatchScheduledEventOutboxJobs(),
      () => rfqChaserScheduler.dispatchDueChaserJobs(),
      () => rfqChaserScheduler.dispatchDueRFQComparisonJobs(),
      () => storeService.closeExpiredRFQsDurably(),
      () => emailGatewayService.pollBothInboxesOnce(),
    ]);
    return;
  }
  if (cron === DAILY_RFQ_REPORT_CRON) {
    await hydrate();
    const scheduledTime = controller?.scheduledTime == null
      ? new Date()
      : new Date(controller.scheduledTime);
    await dailyRfqReportService.runScheduledDailyRfqReport(scheduledTime);
    return;
  }
  if (cron === ZOHO_RECONCILIATION_CRON) {
    await runCronJobsInTurn([
      () => zohoReconciliationService.reconcileOnce(),
      () => eventOutboxService.purgeExpiredEventOutboxRows(),
    ]);
    return;
  }
  // Unrecognised cron pattern: run all rather than silently doing nothing,
  // so a wrangler.jsonc edit that adds/renames a trigger doesn't go quiet.
  await hydrate();
  await runCronJobsInTurn([
    () => emailGatewayService.pollBothInboxesOnce(),
    () => zohoReconciliationService.reconcileOnce(),
    () => rfqChaserScheduler.dispatchDueChaserJobs(),
    () => rfqChaserScheduler.dispatchDueRFQComparisonJobs(),
    () => eventOutboxService.dispatchScheduledEventOutboxJobs(),
    () => eventOutboxService.purgeExpiredEventOutboxRows(),
    () => storeService.closeExpiredRFQsDurably(),
  ]);
}

// Must match the `crons` entries in wrangler.jsonc exactly — Cloudflare
// passes the matched cron expression string back on `controller.cron`.
const EMAIL_GATEWAY_CRON = '*/5 * * * *';
const ZOHO_RECONCILIATION_CRON = '*/10 * * * *';
const DAILY_RFQ_REPORT_CRON = '30 0 * * *';

const originalFetch = httpHandler.fetch;
httpHandler.fetch = async function (request, workerEnv, ctx) {
  if (workerEnv && typeof workerEnv === 'object') {
    globalThis.__CF_ENV__ = workerEnv;
    try {
      for (const [k, v] of Object.entries(workerEnv)) {
        if (typeof v === 'string') {
          process.env[k] = v;
        }
      }
    } catch (error) {
      await logWorkerEnvironmentSyncFailure(WORKER_ENV_OPERATIONS.FETCH, error);
    }
  }
  return originalFetch.call(this, request, workerEnv, ctx);
};

httpHandler.scheduled = scheduled;

export default httpHandler;
