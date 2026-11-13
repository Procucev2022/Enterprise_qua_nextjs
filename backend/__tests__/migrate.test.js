const fs = require('fs');
const os = require('os');
const path = require('path');

function createHarness({ appliedRows = [], failQuery } = {}) {
  const ledger = new Map(appliedRows.map(({ version, checksum }) => [version, checksum]));
  const clientQuery = jest.fn(async (sql, params = []) => {
    if (failQuery && failQuery(sql, params)) throw new Error('injected database error');
    if (/^\s*SELECT version, checksum FROM schema_migrations/i.test(sql)) {
      return { rows: [...ledger].map(([version, checksum]) => ({ version, checksum })) };
    }
    if (/^\s*INSERT INTO schema_migrations/i.test(sql)) {
      ledger.set(params[0], params[2]);
    }
    return { rows: [{ total: '0' }] };
  });
  const poolQuery = jest.fn().mockResolvedValue({ rows: [{ total: '0' }] });
  const client = { query: clientQuery, release: jest.fn() };
  const pgPool = { connect: jest.fn().mockResolvedValue(client) };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return { ledger, client, clientQuery, pgPool, poolQuery, logger };
}

function loadMigrationModule(harness) {
  let migrationModule;
  jest.isolateModules(() => {
    jest.doMock('../src/db/pool', () => ({ pool: harness.pgPool, query: harness.poolQuery }));
    jest.doMock('../src/services/loggerService', () => ({ logger: harness.logger }));
    migrationModule = require('../src/db/migrate');
  });
  return migrationModule;
}

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pg-migrations-'));
}

describe('PostgreSQL migration runner', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('keeps PostgreSQL and D1 table inventories aligned', () => {
    const dbDir = path.resolve(__dirname, '../src/db');
    const readTables = (fileName) => {
      const sql = fs.readFileSync(path.join(dbDir, fileName), 'utf8');
      return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+"?([\w]+)/gi)]
        .map((match) => match[1])
        .sort();
    };

    const postgresTables = readTables('schema.sql');
    const d1Tables = readTables('schema.d1.sql');
    expect(d1Tables).toEqual(postgresTables);
    expect(postgresTables).toContain('payment_dues_communications');
  });

  test('adds a PostgreSQL migration to scrub historical vendor temporary passwords', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0007_remove_vendor_temporary_passwords.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("SET raw = raw - 'tempPassword'");
    expect(sql).toContain("WHERE raw ? 'tempPassword'");
  });

  test('creates the durable RFQ comparison notification queue in PostgreSQL', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0008_rfq_comparison_queue.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rfq_comparison_queue');
    expect(sql).toContain('rfq_id VARCHAR(64) NOT NULL UNIQUE');
    expect(sql).toContain('email_completed_at TIMESTAMPTZ');
    expect(sql).toContain('sms_completed_at TIMESTAMPTZ');
    expect(sql).toContain('idx_rfq_comparison_queue_status_fire_at');
  });

  test('creates a lease-based event outbox with retry and retention indexes in PostgreSQL', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0010_event_outbox.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS event_outbox');
    expect(sql).toContain('lease_token VARCHAR(64)');
    expect(sql).toContain('available_at TIMESTAMPTZ');
    expect(sql).toContain('idx_event_outbox_status_available');
    expect(sql).toContain("WHERE status = 'completed'");
  });

  test('atomically enqueues both enterprise inquiry email intents on insert', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0014_enterprise_inquiry_email_outbox.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION queue_enterprise_inquiry_email_outbox()');
    expect(sql).toContain('AFTER INSERT ON enterprise_inquiries');
    expect(sql).toContain("'enterprise_inquiry_email'");
    expect(sql).toContain("'notificationType', 'team'");
    expect(sql).toContain("'notificationType', 'buyer_confirmation'");
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });

  test('adds root and record-count anchors for full PostgreSQL audit verification', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0015_audit_chain_integrity_anchors.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('ADD COLUMN root_hash VARCHAR(64)');
    expect(sql).toContain('ADD COLUMN entry_count BIGINT');
    expect(sql).toContain('ORDER BY sequence ASC LIMIT 1');
    expect(sql).toContain('SELECT COUNT(*) FROM audit_logs');
  });

  test('atomically enqueues vendor rating revision emails on revision changes', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0016_vendor_rating_revision_email_outbox.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION queue_vendor_rating_revision_email_outbox()');
    expect(sql).toContain('AFTER UPDATE OF raw, email ON vendors');
    expect(sql).toContain('IS DISTINCT FROM (OLD.raw');
    expect(sql).toContain("'vendor_rating_revision_email'");
    expect(sql).toContain("'recipientEmail', NEW.email");
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });

  test('atomically queues pending email and SMS communication rows in PostgreSQL', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0017_communication_delivery_outbox.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION queue_communication_delivery_outbox()');
    expect(sql).toContain('AFTER INSERT ON payment_dues_communications');
    expect(sql).toContain("lower(NEW.channel) NOT IN ('email', 'sms')");
    expect(sql).toContain("lower(NEW.delivery_status) <> 'pending'");
    expect(sql).toContain("'communication_delivery'");
    expect(sql).toContain("'communication-delivery:' || NEW.id");
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });

  test('extends the durable communication trigger to Action Center BOTH rows', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0026_action_center_delivery_outbox.pg.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("lower(NEW.channel) NOT IN ('email', 'sms', 'both')");
    expect(sql).toContain("jsonb_build_object('communicationId', NEW.id)");
    expect(sql).toContain("lower(channel) IN ('email', 'sms', 'both')");
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });

  test('keeps PostgreSQL columns present in D1 and records intentional D1-only extensions', () => {
    const dbDir = path.resolve(__dirname, '../src/db');
    const readColumns = (fileName) => {
      const sql = fs.readFileSync(path.join(dbDir, fileName), 'utf8');
      const tables = new Map();
      const tableMatches = sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+("[^"]+"|[\w]+)\s*\(([\s\S]*?)\n\);/gi);
      for (const match of tableMatches) {
        const table = match[1].replaceAll('"', '');
        const columns = match[2].split(/\r?\n/)
          .map((line) => line.match(/^\s{2,}("[^"]+"|[\w]+)\s+/)?.[1]?.replaceAll('"', ''))
          .filter((column) => column && !['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'].includes(column.toUpperCase()));
        tables.set(table, columns);
      }
      return tables;
    };

    const postgres = readColumns('schema.sql');
    const d1 = readColumns('schema.d1.sql');
    for (const [table, columns] of postgres) {
      expect(d1.has(table)).toBe(true);
      columns.forEach((column) => expect(d1.get(table)).toContain(column));
    }

    const d1Only = {};
    for (const [table, columns] of d1) {
      const extras = columns.filter((column) => !postgres.get(table)?.includes(column)).sort();
      if (extras.length > 0) d1Only[table] = extras;
    }
    expect(d1Only).toEqual({
      auth_otp_codes: ['email', 'id'],
      auth_revoked_tokens: ['jti'],
      category_division: ['division_name', 'last_modified_ts'],
      org_division_category: ['division_uuid', 'last_modified_ts', 'org_uuid'],
      organization: ['contact_email', 'contact_name', 'contact_phone', 'is_active', 'logo_url'],
      user: ['is_password_changed', 'organization_name'],
    });
  });

  test('category uniqueness migrations preserve legacy rows and enforce normalized active keys in both databases', () => {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const postgresSql = fs.readFileSync(
      path.join(migrationsDir, '0001_active_org_category_uniqueness.pg.sql'),
      'utf8'
    ).replace(/\r\n?/g, '\n');
    const d1Sql = fs.readFileSync(
      path.join(migrationsDir, '0003_active_org_category_uniqueness.d1.sql'),
      'utf8'
    ).replace(/\r\n?/g, '\n');

    [postgresSql, d1Sql].forEach((sql) => {
      expect(sql).toContain('PARTITION BY organization_id, lower(trim(division)), lower(trim(category))');
      expect(sql).toContain('PARTITION BY user_id, lower(trim(division)), lower(trim(category))');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_org_division_category_active_org_unique');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_org_division_category_active_user_unique');
      expect(sql).toContain('SET is_active');
      expect(sql).toContain('row_number() OVER');
    });

    expect(postgresSql).toContain('SET is_active = false');
    expect(d1Sql).toContain('SET is_active = 0');
    expect(postgresSql).toContain('WHERE is_active\n');
    expect(d1Sql).toContain('WHERE is_active = 1');
  });

  test('approval persistence migrations keep decision rows and immutable events aligned across databases', () => {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const postgresSql = fs.readFileSync(path.join(migrationsDir, '0002_management_approvals.pg.sql'), 'utf8');
    const d1Sql = fs.readFileSync(path.join(migrationsDir, '0004_management_approvals.d1.sql'), 'utf8');
    const requiredFields = [
      'request_number', 'module', 'project', 'applicant_name', 'applicant_email', 'value_impact',
      'maker_name', 'maker_role', 'status', 'approver_id', 'approver_name', 'approver_email',
      'approver_remarks', 'last_action_id', 'created_at', 'updated_at',
    ];

    [postgresSql, d1Sql].forEach((sql) => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS management_approvals');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS management_approval_events');
      expect(sql).toContain("CHECK (status IN ('Pending', 'Approved', 'Rejected'))");
      expect(sql).toContain('idx_management_approvals_status_created');
      expect(sql).toContain('idx_management_approval_events_approval_created');
      requiredFields.forEach((field) => expect(sql).toContain(field));
      expect(sql).toContain('REFERENCES management_approvals(id)');
    });
  });

  test('registration decision migrations keep buyer-only decision history aligned across databases', () => {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const postgresSql = fs.readFileSync(path.join(migrationsDir, '0003_client_registration_events.pg.sql'), 'utf8');
    const d1Sql = fs.readFileSync(path.join(migrationsDir, '0005_client_registration_events.d1.sql'), 'utf8');
    const requiredFields = [
      'user_id', 'user_email', 'action', 'previous_status', 'new_status',
      'actor_id', 'actor_name', 'actor_email', 'remarks', 'created_at',
    ];

    [postgresSql, d1Sql].forEach((sql) => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS client_registration_events');
      expect(sql).toContain('REFERENCES "user"(uuid)');
      expect(sql).toContain("CHECK (action IN ('Accepted', 'Rejected'))");
      expect(sql).toContain('idx_client_registration_events_user_created');
      requiredFields.forEach((field) => expect(sql).toContain(field));
    });
  });

  test('registration list indexes support buyer-role filtering and stable pagination in both databases', () => {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const postgresSql = fs.readFileSync(path.join(migrationsDir, '0004_client_registration_list_index.pg.sql'), 'utf8');
    const d1Sql = fs.readFileSync(path.join(migrationsDir, '0006_client_registration_list_index.d1.sql'), 'utf8');

    [postgresSql, d1Sql].forEach((sql) => {
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_user_role_created');
      expect(sql).toContain('ON "user" (role_uuid, created_ts DESC, uuid DESC)');
    });
  });

  test('enterprise inquiry migrations define durable bounded records and query indexes in both databases', () => {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const postgresSql = fs.readFileSync(path.join(migrationsDir, '0005_enterprise_inquiries.pg.sql'), 'utf8');
    const d1Sql = fs.readFileSync(path.join(migrationsDir, '0007_enterprise_inquiries.d1.sql'), 'utf8');

    [postgresSql, d1Sql].forEach((sql) => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS enterprise_inquiries');
      expect(sql).toContain('company_name');
      expect(sql).toContain('buyer_account_id');
      expect(sql).toContain('contacted_at');
      expect(sql).toContain("CHECK (status IN ('NEW', 'CONTACTED', 'IN_DISCUSSION', 'CONTRACT_SIGNED', 'CLOSED'))");
      expect(sql).toContain('idx_enterprise_inquiries_created');
      expect(sql).toContain('idx_enterprise_inquiries_status_created');
    });
    expect(fs.readFileSync(path.resolve(__dirname, '../src/db/mock-seed.d1.sql'), 'utf8'))
      .toContain('mock-enterprise-inquiry-local-001');
  });

  test('Zoho webhook receipt migrations enforce cross-runtime idempotency and bounded cleanup indexes', () => {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const postgresSql = fs.readFileSync(path.join(migrationsDir, '0006_zoho_webhook_events.pg.sql'), 'utf8');
    const d1Sql = fs.readFileSync(path.join(migrationsDir, '0008_zoho_webhook_events.d1.sql'), 'utf8');

    [postgresSql, d1Sql].forEach((sql) => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS zoho_webhook_events');
      expect(sql).toContain('PRIMARY KEY (account_id, event_id)');
      expect(sql).toContain('payload_hash');
      expect(sql).toContain("CHECK (status IN ('PROCESSING', 'FAILED', 'PROCESSED'))");
      expect(sql).toContain('idx_zoho_webhook_events_lease');
      expect(sql).toContain('idx_zoho_webhook_events_processed');
      expect(sql).toContain('idx_zoho_webhook_events_failed_updated');
    });
  });

  test('loads only ordered PostgreSQL migration files and hashes their exact contents', () => {
    const directory = createTempDirectory();
    try {
      fs.writeFileSync(path.join(directory, '0002_add_indexes.pg.sql'), 'CREATE INDEX second_idx;');
      fs.writeFileSync(path.join(directory, '0001_add_table.pg.sql'), 'CREATE TABLE example (id int);');
      fs.writeFileSync(path.join(directory, '0003_d1_only.d1.sql'), 'CREATE TABLE d1_only (id int);');
      const migrationModule = loadMigrationModule(createHarness());
      const migrations = migrationModule.loadMigrations(directory);

      expect(migrations.map(({ version }) => version)).toEqual(['0001_add_table', '0002_add_indexes']);
      expect(migrations[0].checksum).toBe(migrationModule.checksum('CREATE TABLE example (id int);'));
      expect(migrationModule.loadMigrations(path.join(directory, 'missing'))).toEqual([]);
      expect(migrationModule.loadMigrations().map(({ version }) => version)).toEqual([
        '0001_active_org_category_uniqueness',
        '0002_management_approvals',
        '0003_client_registration_events',
        '0004_client_registration_list_index',
        '0005_enterprise_inquiries',
        '0006_zoho_webhook_events',
        '0007_remove_vendor_temporary_passwords',
        '0008_rfq_comparison_queue',
        '0009_audit_chain_state',
        '0010_event_outbox',
        '0011_vendor_presence',
        '0012_query_access_path_indexes',
        '0013_chaser_retry_attempts',
        '0014_enterprise_inquiry_email_outbox',
        '0015_audit_chain_integrity_anchors',
        '0016_vendor_rating_revision_email_outbox',
        '0017_communication_delivery_outbox',
        '0018_rfq_created_email_outbox',
        '0019_rfq_vendor_invitation_email_outbox',
        '0020_rfq_gateway_notification_email_outbox',
        '0023_dossier_schema_alignment',
        '0024_buyer_quote_onboarding_outbox',
        '0025_vendor_owner_lookup_indexes',
        '0026_action_center_delivery_outbox',
        '0027_email_gateway_retry_claims',
        '0028_drop_system_error_logs',
        '0029_drop_all_remaining_log_tables',
        '0030_drop_vendors_search_fts',
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects empty and reserved baseline migration files', () => {
    const directory = createTempDirectory();
    const migrationModule = loadMigrationModule(createHarness());
    try {
      fs.writeFileSync(path.join(directory, '0001_empty.pg.sql'), '  \n');
      expect(() => migrationModule.loadMigrations(directory)).toThrow('migration is empty');
      fs.rmSync(path.join(directory, '0001_empty.pg.sql'));
      fs.writeFileSync(path.join(directory, '0000_schema_baseline.pg.sql'), 'SELECT 1;');
      expect(() => migrationModule.loadMigrations(directory)).toThrow('Duplicate or reserved');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails loudly when DATABASE_URL is unset', async () => {
    const harness = createHarness();
    harness.pgPool = null;
    const migrationModule = loadMigrationModule(harness);
    const originalExitCode = process.exitCode;

    await migrationModule.migrate();

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('DATABASE_URL is not configured'), {}, 'DATABASE_MIGRATION'
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  test('applies the baseline once under an advisory lock and does not seed or scan by default', async () => {
    const harness = createHarness();
    const migrationModule = loadMigrationModule(harness);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await migrationModule.migrate();

    const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    expect(harness.clientQuery).toHaveBeenCalledWith('SELECT pg_advisory_lock($1, $2)', [1702069401, 1]);
    expect(harness.clientQuery).toHaveBeenCalledWith(schemaSql);
    expect(harness.ledger.get('0000_schema_baseline')).toBe(migrationModule.checksum(schemaSql));
    expect(harness.clientQuery).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1, $2)', [1702069401, 1]);
    expect(harness.client.release).toHaveBeenCalledTimes(1);
    expect(harness.poolQuery).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No seed data is written'));
    expect(harness.logger.info).toHaveBeenCalledWith(
      'PostgreSQL migrations completed',
      expect.objectContaining({ rowCountsReported: false }),
      'DATABASE_MIGRATION'
    );
  });

  test('skips full schema replay after the recorded checksum matches', async () => {
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.sql'), 'utf8');
    const harness = createHarness({
      appliedRows: [{ version: '0000_schema_baseline', checksum: require('crypto').createHash('sha256').update(schemaSql).digest('hex') }],
    });
    const migrationModule = loadMigrationModule(harness);

    await migrationModule.migrate();

    expect(harness.clientQuery).not.toHaveBeenCalledWith(schemaSql);
    expect(harness.logger.info).toHaveBeenCalledWith(
      'PostgreSQL schema baseline checksum matches; skipping full schema replay',
      expect.any(Object),
      'DATABASE_MIGRATION'
    );
  });

  test('rejects an edited bootstrap schema and an unknown database migration before changing schema', async () => {
    const harness = createHarness({
      appliedRows: [{ version: '0000_schema_baseline', checksum: 'different-checksum' }],
    });
    const migrationModule = loadMigrationModule(harness);
    await expect(migrationModule.migrate()).rejects.toThrow('schema.sql changed after its PostgreSQL baseline');
    expect(harness.clientQuery.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS vendors'))).toBe(false);

    const unknownHarness = createHarness({
      appliedRows: [{ version: '0099_removed_migration', checksum: 'old-checksum' }],
    });
    const unknownModule = loadMigrationModule(unknownHarness);
    await expect(unknownModule.migrate()).rejects.toThrow('versions missing from this checkout');
    expect(unknownHarness.clientQuery.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS vendors'))).toBe(false);
  });

  test('applies numbered PostgreSQL migrations transactionally and verifies their checksums', async () => {
    const directory = createTempDirectory();
    try {
      fs.writeFileSync(path.join(directory, '0001_example_change.pg.sql'), 'ALTER TABLE example ADD COLUMN status text;');
      const harness = createHarness();
      const migrationModule = loadMigrationModule(harness);

      await migrationModule.migrate({ migrationsPath: directory });

      expect(harness.ledger.has('0001_example_change')).toBe(true);
      expect(harness.clientQuery).toHaveBeenCalledWith('BEGIN');
      expect(harness.clientQuery).toHaveBeenCalledWith('ALTER TABLE example ADD COLUMN status text;');
      expect(harness.clientQuery).toHaveBeenCalledWith('COMMIT');
      expect(harness.logger.info).toHaveBeenCalledWith(
        'Applying PostgreSQL migration',
        expect.objectContaining({ migrationVersion: '0001_example_change' }),
        'DATABASE_MIGRATION'
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects changed applied migration content', async () => {
    const directory = createTempDirectory();
    try {
      const sql = 'ALTER TABLE example ADD COLUMN status text;';
      fs.writeFileSync(path.join(directory, '0001_example_change.pg.sql'), sql);
      const harness = createHarness({
        appliedRows: [{ version: '0001_example_change', checksum: 'incorrect-checksum' }],
      });
      const migrationModule = loadMigrationModule(harness);
      await expect(migrationModule.migrate({ migrationsPath: directory })).rejects.toThrow('checksum mismatch');
      expect(harness.clientQuery).not.toHaveBeenCalledWith(sql);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('skips a correctly checksummed migration that is already applied', async () => {
    const directory = createTempDirectory();
    try {
      const sql = 'ALTER TABLE example ADD COLUMN status text;';
      fs.writeFileSync(path.join(directory, '0001_example_change.pg.sql'), sql);
      const harness = createHarness();
      const migrationModule = loadMigrationModule(harness);
      const schemaSql = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.sql'), 'utf8');
      harness.ledger.set('0000_schema_baseline', migrationModule.checksum(schemaSql));
      harness.ledger.set('0001_example_change', migrationModule.checksum(sql));

      await migrationModule.migrate({ migrationsPath: directory });

      expect(harness.clientQuery).not.toHaveBeenCalledWith(sql);
      expect(harness.clientQuery).not.toHaveBeenCalledWith('BEGIN');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rolls back a failed baseline and releases the migration lock', async () => {
    const harness = createHarness({
      failQuery: (sql) => String(sql).includes('CREATE TABLE IF NOT EXISTS vendors'),
    });
    const migrationModule = loadMigrationModule(harness);

    await expect(migrationModule.migrate()).rejects.toThrow('injected database error');

    expect(harness.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(harness.clientQuery).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1, $2)', [1702069401, 1]);
    expect(harness.client.release).toHaveBeenCalledTimes(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      'PostgreSQL migration failed', expect.objectContaining({ error: expect.any(Error) }), 'DATABASE_MIGRATION'
    );
  });

  test('rolls back a failed numbered migration without recording it', async () => {
    const directory = createTempDirectory();
    try {
      fs.writeFileSync(path.join(directory, '0001_example_change.pg.sql'), 'INVALID MIGRATION');
      const harness = createHarness({ failQuery: (sql) => sql === 'INVALID MIGRATION' });
      const migrationModule = loadMigrationModule(harness);

      await expect(migrationModule.migrate({ migrationsPath: directory })).rejects.toThrow('injected database error');

      expect(harness.clientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(harness.ledger.has('0001_example_change')).toBe(false);
      expect(harness.logger.error).toHaveBeenCalledWith(
        'PostgreSQL migration failed and was rolled back',
        expect.objectContaining({ migrationVersion: '0001_example_change' }),
        'DATABASE_MIGRATION'
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('reports row counts only when requested and continues after an unavailable table', async () => {
    const harness = createHarness();
    harness.poolQuery.mockRejectedValueOnce(new Error('relation does not exist'));
    const migrationModule = loadMigrationModule(harness);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await migrationModule.migrate({ reportCounts: true });

    expect(harness.poolQuery).toHaveBeenCalledTimes(migrationModule.REPORTED_TABLES.length);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('unavailable (relation does not exist)'));
    expect(harness.logger.error).toHaveBeenCalledWith(
      'PostgreSQL migration row-count report failed', expect.objectContaining({ table: 'schema_migrations' }), 'DATABASE_MIGRATION'
    );
  });

  test('direct row-count report covers every declared table and logs unavailable tables', async () => {
    const harness = createHarness();
    const migrationModule = loadMigrationModule(harness);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await migrationModule.reportRowCounts();
    expect(harness.poolQuery).toHaveBeenCalledTimes(migrationModule.REPORTED_TABLES.length);
    migrationModule.REPORTED_TABLES.forEach((table) => {
      expect(harness.poolQuery).toHaveBeenCalledWith(`select count(*) as total from "${table}"`);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(table));
    });

    harness.poolQuery.mockRejectedValue(new Error('not reachable'));
    await expect(migrationModule.reportRowCounts()).resolves.toBeUndefined();
    expect(harness.logger.error).toHaveBeenCalledWith(
      'PostgreSQL migration row-count report failed', expect.objectContaining({ table: 'schema_migrations' }), 'DATABASE_MIGRATION'
    );
  });

  test('releases a client when advisory lock acquisition fails', async () => {
    const harness = createHarness({ failQuery: (sql) => sql.includes('pg_advisory_lock(') });
    const migrationModule = loadMigrationModule(harness);
    await expect(migrationModule.migrate()).rejects.toThrow('injected database error');
    expect(harness.client.release).toHaveBeenCalledTimes(1);
    expect(harness.clientQuery).not.toHaveBeenCalledWith('SELECT pg_advisory_unlock($1, $2)', [1702069401, 1]);
  });

  test('fails if the advisory lock cannot be released after successful migration', async () => {
    const harness = createHarness({ failQuery: (sql) => sql.includes('pg_advisory_unlock(') });
    const migrationModule = loadMigrationModule(harness);
    await expect(migrationModule.migrate()).rejects.toThrow('injected database error');
    expect(harness.client.release).toHaveBeenCalledTimes(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      'PostgreSQL migration lock release failed', expect.objectContaining({ error: expect.any(Error) }), 'DATABASE_MIGRATION'
    );
  });

  test('preserves the migration error when lock release also fails', async () => {
    const harness = createHarness({
      failQuery: (sql) => sql.includes('CREATE TABLE IF NOT EXISTS vendors') || sql.includes('pg_advisory_unlock('),
    });
    const migrationModule = loadMigrationModule(harness);
    await expect(migrationModule.migrate()).rejects.toThrow('injected database error');
    expect(harness.logger.error).toHaveBeenCalledWith(
      'PostgreSQL migration lock release failed', expect.objectContaining({ error: expect.any(Error) }), 'DATABASE_MIGRATION'
    );
  });

  describe('runCli', () => {
    test('exits 0 on success and forwards the opt-in row-count flag', async () => {
      const harness = createHarness();
      const migrationModule = loadMigrationModule(harness);
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      await migrationModule.runCli(['--report-row-counts']);

      expect(harness.poolQuery).toHaveBeenCalledTimes(migrationModule.REPORTED_TABLES.length);
      expect(exitSpy).toHaveBeenCalledWith(0);
      process.exitCode = originalExitCode;
    });

    test('logs and exits 1 when migration fails', async () => {
      const harness = createHarness({ failQuery: (sql) => sql.includes('pg_advisory_lock(') });
      const migrationModule = loadMigrationModule(harness);
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await migrationModule.runCli([]);

      expect(harness.logger.error).toHaveBeenCalledWith(
        'PostgreSQL migration command failed', expect.objectContaining({ error: expect.any(Error) }), 'DATABASE_MIGRATION'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('uses the default command arguments when none are passed', async () => {
      const harness = createHarness();
      const migrationModule = loadMigrationModule(harness);
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      await migrationModule.runCli();

      expect(harness.poolQuery).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      process.exitCode = originalExitCode;
    });
  });
});
