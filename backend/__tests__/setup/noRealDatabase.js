// ==============================================================================
// TEST SAFETY NET: NO REAL DATABASE
// ==============================================================================
// Severs the MySQL connection for every test file before any test runs.
//
// This exists because it went wrong. `backend/.env` is loaded by src/app.js, so
// under `npm test` the identity pool connected to the real shared schema, and any
// suite that exercised an RFQ write without doubling the query layer inserted rows
// into `qua_enterprice_rfq` for real. It left dozens of fixture RFQs — owned by
// `buyer@enterprise.com` and the synthetic test organisation — sitting in the
// live table alongside genuine buyer data.
//
// Nulling the pool makes that impossible rather than merely discouraged: any query
// that reaches the driver now throws "Identity database is not configured", which
// is a loud, obvious failure in the suite that forgot its double.
//
// Tests that need a configured pool assign their own stub (see
// buyerAccountResolver.test.js and migrationRunner.test.js) and restore it after.
// ==============================================================================

const identityPoolModule = require('../../src/db/identityPool');

beforeAll(async () => {
  if (identityPoolModule.pool) {
    // Close it rather than dropping the reference, so no socket is left open and
    // jest does not have to be forced to exit.
    try {
      await identityPoolModule.pool.end();
    } catch {
      // Already closed, or never actually connected. Either is fine.
    }
  }
  identityPoolModule.pool = null;
  identityPoolModule.isConfigured = false;
});
