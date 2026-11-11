const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  compareRequiredAccessPaths,
  compareSchemas,
  hasIndexPrefix,
  parseIndexFiles,
  parseSchemaFiles,
  stripSqlComments,
} = require('./check-db-schema-parity.cjs');

test('comment removal preserves comment markers inside SQL string literals', () => {
  const sql = "SELECT '-- retained', '/* retained */'; -- removed\nSELECT 1 /* removed */;";
  const result = stripSqlComments(sql);
  assert.match(result, /'-- retained'/);
  assert.match(result, /'\/\* retained \*\/'/);
  assert.doesNotMatch(result, /removed/);
});

test('schema parser finds quoted tables, top-level columns, and later additions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'db-parity-'));
  const schemaFile = path.join(directory, 'schema.sql');
  try {
    fs.writeFileSync(schemaFile, `
      -- CREATE TABLE comment_only (bad TEXT)
      CREATE TABLE IF NOT EXISTS "sample_table" (
        id TEXT PRIMARY KEY,
        label TEXT DEFAULT 'a,b',
        payload TEXT DEFAULT json_object('key', 'value'),
        CONSTRAINT sample_check CHECK (length(label) > 0)
      );
      ALTER TABLE sample_table ADD COLUMN IF NOT EXISTS created_at TEXT;
      ALTER TABLE sample_table
        ADD COLUMN root_hash TEXT NOT NULL DEFAULT '',
        ADD COLUMN entry_count BIGINT NOT NULL DEFAULT 0;
    `);
    const schema = parseSchemaFiles([schemaFile]);
    assert.deepEqual([...schema.get('sample_table')].sort(), [
      'created_at', 'entry_count', 'id', 'label', 'payload', 'root_hash',
    ]);
    assert.equal(schema.has('comment_only'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('index inventory honors expression columns and later index drops', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'db-index-parity-'));
  const baselineFile = path.join(directory, 'schema.d1.sql');
  const migrationFile = path.join(directory, '0014_indexes.d1.sql');
  try {
    fs.writeFileSync(baselineFile, `
      CREATE INDEX IF NOT EXISTS idx_user_name ON "user" (username);
      CREATE INDEX IF NOT EXISTS idx_user_lookup ON "user" (lower(username), phone);
      CREATE INDEX IF NOT EXISTS idx_org_old ON organization (org_type_uuid);
    `);
    fs.writeFileSync(migrationFile, `
      DROP INDEX IF EXISTS idx_user_name;
      DROP INDEX IF EXISTS idx_org_old;
    `);
    const indexes = parseIndexFiles([baselineFile, migrationFile]);
    assert.equal(indexes.has('idx_user_name'), false);
    assert.equal(indexes.has('idx_org_old'), false);
    assert.equal(hasIndexPrefix(indexes, {
      table: 'user',
      columns: ['lower(username)'],
    }), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('index inventory applies drops and recreations in SQL order', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'db-index-recreate-'));
  const migrationFile = path.join(directory, '0030_rebuild_credit_history.d1.sql');
  try {
    fs.writeFileSync(migrationFile, `
      CREATE INDEX IF NOT EXISTS idx_credit_owner ON credit_history (owner_id, created_at);
      DROP INDEX IF EXISTS idx_credit_owner;
      CREATE INDEX IF NOT EXISTS idx_credit_owner ON credit_history (owner_id, created_at DESC, id DESC);
    `);
    const indexes = parseIndexFiles([migrationFile]);
    assert.deepEqual(indexes.get('idx_credit_owner'), {
      name: 'idx_credit_owner',
      table: 'credit_history',
      columns: ['owner_id', 'created_atdesc', 'iddesc'],
      unique: false,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('critical access path comparison accepts a composite leftmost prefix and reports missing paths', () => {
  const postgresIndexes = new Map([
    ['org_name_type', { table: 'organization', columns: ['organization_name', 'org_type_uuid'] }],
    ['user_lower_phone', { table: 'user', columns: ['lower(username)', 'phone'] }],
    ['org_category_user', { table: 'org_division_category', columns: ['user_id', 'is_active', 'division', 'category'] }],
    ['org_category_org', { table: 'org_division_category', columns: ['organization_id', 'is_active', 'division', 'category'] }],
    ['vendor_buyer_id', { table: 'vendors', columns: ["lower(raw->>'buyerid')"] }],
    ['vendor_buyer_account', { table: 'vendors', columns: ["lower(raw->>'buyeraccountid')"] }],
    ['vendor_buyer_email', { table: 'vendors', columns: ["lower(raw->>'buyeremail')"] }],
    ['catalogue_created', { table: 'vendor_catalogue', columns: ['created_at', 'id'] }],
    ['catalogue_vendor_created', { table: 'vendor_catalogue', columns: ['vendor_id', 'created_at', 'id'] }],
    ['catalogue_vendor_sku', { table: 'vendor_catalogue', columns: ['vendor_id', 'lower(trim(sku))'] }],
    ['vendor_credit_history', { table: 'vendor_credit_transactions', columns: ['vendor_id', 'created_atdesc', 'iddesc'] }],
    ['buyer_credit_history', { table: 'buyer_credit_transactions', columns: ['buyer_id', 'created_atdesc', 'iddesc'] }],
  ]);
  const d1Indexes = new Map([
    ['org_name_type', { table: 'organization', columns: ['organization_name', 'org_type_uuid'] }],
    ['user_lower_phone', { table: 'user', columns: ['lower(username)', 'phone'] }],
    ['org_category_user', { table: 'org_division_category', columns: ['user_id', 'is_active', 'division', 'category'] }],
    ['org_category_org', { table: 'org_division_category', columns: ['organization_id', 'is_active', 'division', 'category'] }],
    ['vendor_buyer_id', { table: 'vendors', columns: ["lower(json_extract(raw,'$.buyerid'))"] }],
    ['vendor_buyer_account', { table: 'vendors', columns: ["lower(json_extract(raw,'$.buyeraccountid'))"] }],
    ['vendor_buyer_email', { table: 'vendors', columns: ["lower(json_extract(raw,'$.buyeremail'))"] }],
    ['catalogue_created', { table: 'vendor_catalogue', columns: ['created_at', 'id'] }],
    ['catalogue_vendor_created', { table: 'vendor_catalogue', columns: ['vendor_id', 'created_at', 'id'] }],
    ['catalogue_vendor_sku', { table: 'vendor_catalogue', columns: ['vendor_id', 'lower(trim(sku))'] }],
    ['vendor_credit_history', { table: 'vendor_credit_transactions', columns: ['vendor_id', 'created_atdesc', 'iddesc'] }],
    ['buyer_credit_history', { table: 'buyer_credit_transactions', columns: ['buyer_id', 'created_atdesc', 'iddesc'] }],
  ]);

  assert.deepEqual(compareRequiredAccessPaths(postgresIndexes, d1Indexes), { postgres: [], d1: [] });
  d1Indexes.delete('org_category_user');
  d1Indexes.delete('catalogue_vendor_created');
  d1Indexes.delete('buyer_credit_history');
  const result = compareRequiredAccessPaths(postgresIndexes, d1Indexes);
  assert.deepEqual(result.postgres, []);
  assert.equal(result.d1.length, 3);
  assert.deepEqual(result.d1.map((item) => item.query), [
    'buyer category reads and ordering by user',
    'bounded vendor catalogue listing by creation time',
    'bounded buyer credit history by newest transaction',
  ]);
});

test('schema comparison reports missing tables and unapproved columns while listing approved legacy drift', () => {
  const postgres = new Map([
    ['auth_otp_codes', new Set(['otp_key', 'code'])],
    ['vendors', new Set(['id', 'email'])],
    ['postgres_only', new Set(['id'])],
  ]);
  const d1 = new Map([
    ['auth_otp_codes', new Set(['otp_key', 'code', 'id'])],
    ['vendors', new Set(['id', 'email', 'unexpected_column'])],
    ['d1_only', new Set(['id'])],
    ['schema_migration_locks', new Set(['name'])],
  ]);

  const result = compareSchemas(postgres, d1);
  assert.deepEqual(result.missingFromD1, ['postgres_only']);
  assert.deepEqual(result.missingFromPostgres, ['d1_only']);
  assert.deepEqual(result.columnDifferences, [{
    table: 'vendors',
    postgresOnly: [],
    d1Only: ['unexpected_column'],
  }]);
  assert.deepEqual(result.allowedColumnDifferences[0], {
    table: 'auth_otp_codes',
    columns: [{
      column: 'id',
      reason: 'Legacy D1 row identifier; OTP operations key by otp_key.',
    }],
  });
});

test('schema comparison accepts matching tables and an explicitly dialect-specific lock table', () => {
  const tables = new Map([['vendors', new Set(['id', 'email'])]]);
  const d1 = new Map([
    ['vendors', new Set(['id', 'email'])],
    ['schema_migration_locks', new Set(['name'])],
  ]);
  const result = compareSchemas(tables, d1);
  assert.equal(result.tableCount, 1);
  assert.deepEqual(result.missingFromD1, []);
  assert.deepEqual(result.missingFromPostgres, []);
  assert.deepEqual(result.columnDifferences, []);
});
