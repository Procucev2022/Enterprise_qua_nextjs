// ==============================================================================
// SCHEMA MIGRATIONS (shared Procucev MySQL)
// ==============================================================================
// Ordered, append-only migration definitions applied by migrationRunner.js.
//
// Rules for this file:
//   - NEVER edit or reorder an existing migration. Once an id has been applied
//     anywhere, its statements are frozen; corrections go in a new migration.
//   - Every statement must be idempotent on its own (CREATE TABLE IF NOT EXISTS,
//     CREATE INDEX guarded by the runner's duplicate tolerance). The bookkeeping
//     table means a migration normally runs once, but an interrupted run must be
//     safe to repeat.
//   - Statements are plain DDL strings with no interpolated user input. Table
//     names come from constants so the same identifiers are used everywhere.
//
// This workspace only creates tables it owns, namespaced with the
// `qua_enterprice_` prefix. It never alters a table belonging to the Java
// p2pservices application.
// ==============================================================================

const { RFQ_PERSISTENCE } = require('../config/constants');

const { RFQ_TABLE, MIGRATIONS_TABLE } = RFQ_PERSISTENCE;

/**
 * DDL for the bookkeeping table itself. Applied before anything else and not
 * recorded as a migration, because it is what recording depends on.
 */
const BOOKKEEPING_DDL = `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL,
  duration_ms INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/**
 * The ordered migration list. Append only.
 */
const MIGRATIONS = [
  {
    id: '001_create_qua_enterprice_rfq',
    description: 'RFQ header, ownership and line-item payload for this workspace.',
    statements: [
      // Ownership is recorded three ways on purpose:
      //   buyer_org_id  - the owning buyer organisation, and the column every
      //                   dashboard read filters on. Procurement is a team
      //                   function, so an RFQ belongs to the company rather
      //                   than to whoever happened to key it.
      //   buyer_user_id - the individual who created it, kept for audit and so
      //                   a departing user does not orphan the record.
      //   buyer_email   - the login email, matching rfq_records.buyer_email in
      //                   the Java app so the two datasets can be reconciled.
      //
      // Line items, attachments and the generated summary are JSON documents
      // rather than child tables: they are always read and written whole with
      // their parent RFQ, and are never queried field-wise.
      `CREATE TABLE IF NOT EXISTS \`${RFQ_TABLE}\` (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        rfq_id VARCHAR(64) NOT NULL,
        buyer_org_id VARCHAR(255) NOT NULL,
        buyer_user_id VARCHAR(255) NOT NULL,
        buyer_email VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        major_category VARCHAR(255) NULL,
        sourcing_mode VARCHAR(32) NULL,
        status VARCHAR(64) NULL,
        source VARCHAR(64) NULL,
        source_file_name VARCHAR(260) NULL,
        budget DECIMAL(18,2) NOT NULL DEFAULT 0,
        target_delivery_date VARCHAR(32) NULL,
        delivery_location VARCHAR(200) NULL,
        delivery_pincode VARCHAR(16) NULL,
        items_json LONGTEXT NULL,
        attachments_json LONGTEXT NULL,
        ai_summary_json LONGTEXT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NULL,
        UNIQUE KEY uq_qua_rfq_rfq_id (rfq_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      // Composite rather than a bare buyer_org_id index: every dashboard read is
      // "this organisation's RFQs, newest first", so ordering inside the index
      // avoids a filesort on the hot path.
      `CREATE INDEX idx_qua_rfq_org_created
        ON \`${RFQ_TABLE}\` (buyer_org_id, created_at)`,

      // Supports reconciliation against the Java app's rfq_records.buyer_email
      // and the legacy email-keyed lookups.
      `CREATE INDEX idx_qua_rfq_buyer_email
        ON \`${RFQ_TABLE}\` (buyer_email)`,

      // "RFQs I raised" views, and audit queries by creator.
      `CREATE INDEX idx_qua_rfq_buyer_user
        ON \`${RFQ_TABLE}\` (buyer_user_id, created_at)`,
    ],
  },
];

module.exports = {
  BOOKKEEPING_DDL,
  MIGRATIONS,
};
