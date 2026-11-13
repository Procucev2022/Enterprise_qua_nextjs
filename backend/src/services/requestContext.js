// ==============================================================================
// REQUEST CONTEXT — per-request correlation for structured logs
// ==============================================================================
// Services, queries and the logger never receive the Express request, so a log line
// written deep inside a query could not name the request that caused it. AsyncLocalStorage
// carries the request id and per-request D1 counters through the async call chain that
// starts in the request logger middleware.
//
// Work started outside a request (cron ticks, the event-outbox dispatcher) has no context:
// its log lines carry no request fields and no D1 counters are recorded for it.
// ==============================================================================

const { AsyncLocalStorage } = require('node:async_hooks');

const requestStorage = new AsyncLocalStorage();

/** Fresh context for one HTTP request. Every D1 counter starts at zero. */
function createRequestContext({ requestId, method, path }) {
  return {
    requestId,
    requestMethod: method,
    requestPath: path,
    d1: {
      queries: 0,
      errors: 0,
      overloadErrors: 0,
      rowsRead: 0,
      rowsWritten: 0,
      durationMs: 0,
    },
  };
}

/** Runs `callback` with `context` as the active request context for every async step it starts. */
function runWithRequestContext(context, callback) {
  return requestStorage.run(context, callback);
}

/** The active request context, or undefined outside a request. */
function getRequestContext() {
  return requestStorage.getStore();
}

/** Adds one D1 statement to the active request's counters. Does nothing outside a request. */
function recordD1Statement({
  durationMs = 0,
  rowsRead,
  rowsWritten,
  failed = false,
  overloaded = false,
} = {}) {
  const context = requestStorage.getStore();
  if (!context || !context.d1) return;
  const counters = context.d1;
  counters.queries += 1;
  if (Number.isFinite(durationMs)) counters.durationMs += durationMs;
  if (Number.isFinite(rowsRead)) counters.rowsRead += rowsRead;
  if (Number.isFinite(rowsWritten)) counters.rowsWritten += rowsWritten;
  if (failed) counters.errors += 1;
  if (overloaded) counters.overloadErrors += 1;
}

/** The per-request D1 totals, named the way the HTTP access log records them. */
function summarizeD1Counters(context) {
  if (!context || !context.d1) return {};
  const counters = context.d1;
  return {
    d1Queries: counters.queries,
    d1Errors: counters.errors,
    d1OverloadErrors: counters.overloadErrors,
    d1RowsRead: counters.rowsRead,
    d1RowsWritten: counters.rowsWritten,
    d1DurationMs: counters.durationMs,
  };
}

module.exports = {
  createRequestContext,
  runWithRequestContext,
  getRequestContext,
  recordD1Statement,
  summarizeD1Counters,
};
