const fs = require('fs');
const os = require('os');
const path = require('path');
jest.mock('../src/services/loggerService', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));
const {
  acquireMigrationLock,
  applyD1Migrations,
  getSchemaBaseline,
  migrate,
  schemaChecksum,
  splitStatements,
} = require('../scripts/migrate-d1');
const { ensureLocalAuditChainVerificationMigration } = require('../scripts/migrate-d1-local-audit-chain-verification');

describe('D1 migration SQL handling', () => {
  test('splits SQL while preserving quoted semicolons and complete trigger bodies', () => {
    const statements = splitStatements(`
      -- semicolon in this comment ; must not split
      CREATE TABLE sample (value TEXT DEFAULT 'left;right');
      CREATE TRIGGER sample_update AFTER UPDATE ON sample BEGIN
        UPDATE sample SET value = CASE WHEN new.value = 'a;b' THEN 'x;y' ELSE new.value END;
        INSERT INTO audit_log(message) VALUES ("quoted;value");
      END;
      /* another ; comment */ CREATE INDEX sample_value ON sample(value);
    `);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("DEFAULT 'left;right'");
    expect(statements[1]).toContain("CASE WHEN new.value = 'a;b' THEN 'x;y' ELSE new.value END;");
    expect(statements[1]).toMatch(/END\s*$/);
    expect(statements[2]).toContain('CREATE INDEX sample_value');
  });

  test('uses an atomic lease, guards statements, and releases only its own lock', async () => {
    const query = jest.fn(async (sql, params = []) => {
      if (sql.includes('INSERT INTO schema_migration_locks')) {
        return { result: [{ results: [{ owner_token: params[1] }] }] };
      }
      if (sql.includes('UPDATE schema_migration_locks')) {
        return { result: [{ results: [{ owner_token: params[2] }] }] };
      }
      return { result: [{ results: [] }] };
    });

    const lock = await acquireMigrationLock(query);
    await expect(lock.query('SELECT 1')).resolves.toEqual({ result: [{ results: [] }] });
    await lock.release();

    expect(query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS schema_migration_locks');
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT(lock_key) DO UPDATE');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE FROM schema_migration_locks'))).toBe(true);
  });

  test('rejects acquisition when another non-expired lease owns the lock', async () => {
    const query = jest.fn(async (sql) => (
      sql.includes('INSERT INTO schema_migration_locks')
        ? { result: [{ results: [] }] }
        : { result: [{ results: [] }] }
    ));

    await expect(acquireMigrationLock(query)).rejects.toThrow('Another D1 migration holds the lock');
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('stops guarded work when lease renewal no longer owns the lock', async () => {
    jest.useFakeTimers();
    const query = jest.fn(async (sql, params = []) => {
      if (sql.includes('INSERT INTO schema_migration_locks')) {
        return { result: [{ results: [{ owner_token: params[1] }] }] };
      }
      if (sql.includes('UPDATE schema_migration_locks')) return { result: [{ results: [] }] };
      return { result: [{ results: [] }] };
    });
    const originalExitCode = process.exitCode;

    try {
      const lock = await acquireMigrationLock(query);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(() => lock.assertOwned()).toThrow('D1 migration lock was lost');
      await expect(lock.query('SELECT 1')).rejects.toThrow('D1 migration lock was lost');
      await lock.release();
    } finally {
      process.exitCode = originalExitCode;
      jest.useRealTimers();
    }
  });

  test('keeps every D1 vendor-search trigger as one migration statement', () => {
    const schemaPath = path.resolve(__dirname, '../src/db/schema.d1.sql');
    const statements = splitStatements(fs.readFileSync(schemaPath, 'utf8'));
    const triggers = statements.filter((statement) => /^CREATE TRIGGER/i.test(statement));

    expect(triggers).toHaveLength(3);
    expect(triggers.every((statement) => statement.includes('END'))).toBe(true);
    expect(statements.some((statement) => /^INSERT INTO vendors_search_fts\(rowid/i.test(statement))).toBe(false);
  });

  test('keeps category dedupe updates and uniqueness indexes as complete D1 statements', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0003_active_org_category_uniqueness.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(/^UPDATE org_division_category/i);
    expect(statements[1]).toMatch(/^WITH ranked AS/i);
    expect(statements[2]).toMatch(/^WITH ranked AS/i);
    expect(statements[3]).toMatch(/^CREATE UNIQUE INDEX/i);
    expect(statements[4]).toMatch(/^CREATE UNIQUE INDEX/i);
    expect(statements.every((statement) => !statement.includes('--'))).toBe(true);
  });

  test('adds a D1 migration to scrub historical vendor temporary passwords', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0009_remove_vendor_temporary_passwords.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/UPDATE vendors\s+SET raw = json_remove\(raw, '\$\.tempPassword'\)/i);
    expect(statements[0]).toContain('json_valid(raw)');
    expect(statements[0]).toContain("'$.tempPassword'");
  });

  test('creates the durable RFQ comparison notification queue in D1', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0010_rfq_comparison_queue.d1.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rfq_comparison_queue');
    expect(sql).toContain('rfq_id TEXT NOT NULL UNIQUE');
    expect(sql).toContain('email_completed_at TEXT');
    expect(sql).toContain('sms_completed_at TEXT');
    expect(sql).toContain('idx_rfq_comparison_queue_status_fire_at');
  });

  test('creates a lease-based event outbox with retry and retention indexes in D1', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0012_event_outbox.d1.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS event_outbox');
    expect(sql).toContain('lease_token TEXT');
    expect(sql).toContain('available_at TEXT');
    expect(sql).toContain('idx_event_outbox_status_available');
    expect(sql).toContain("WHERE status = 'completed'");
  });

  test('atomically enqueues both enterprise inquiry email intents on insert', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0016_enterprise_inquiry_email_outbox.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/CREATE TRIGGER IF NOT EXISTS enterprise_inquiries_queue_email_outbox/i);
    expect(statements[0]).toContain("'enterprise_inquiry_email'");
    expect(statements[0]).toContain("'notificationType', 'team'");
    expect(statements[0]).toContain("'notificationType', 'buyer_confirmation'");
    expect(statements[0]).toContain('INSERT OR IGNORE INTO event_outbox');
  });

  test('adds D1 root and record-count anchors before verification', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0017_audit_chain_integrity_anchors.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/ADD COLUMN root_hash TEXT/i);
    expect(statements[1]).toMatch(/ADD COLUMN entry_count INTEGER/i);
    expect(statements[2]).toContain('ORDER BY rowid ASC LIMIT 1');
    expect(statements[2]).toContain('SELECT COUNT(*) FROM audit_logs');
  });

  test('atomically enqueues vendor rating revision emails when the revision id changes', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0018_vendor_rating_revision_email_outbox.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/CREATE TRIGGER IF NOT EXISTS vendors_queue_rating_revision_email_outbox/i);
    expect(statements[0]).toContain("'$.latestRatingRevision.id'");
    expect(statements[0]).toContain("'vendor_rating_revision_email'");
    expect(statements[0]).toContain("'recipientEmail', NEW.email");
    expect(statements[0]).toContain('INSERT OR IGNORE INTO event_outbox');
  });

  test('atomically queues pending email and SMS communication rows in D1', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0019_communication_delivery_outbox.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/CREATE TRIGGER IF NOT EXISTS payment_dues_communications_queue_delivery_outbox/i);
    expect(statements[0]).toContain("lower(NEW.channel) IN ('email', 'sms')");
    expect(statements[0]).toContain("lower(NEW.delivery_status) = 'pending'");
    expect(statements[0]).toContain("'communication_delivery'");
    expect(statements[0]).toContain("'communication-delivery:' || NEW.id");
    expect(statements[0]).toContain("json_object('communicationId', NEW.id)");
  });

  test('atomically queues explicitly requested buyer RFQ acknowledgements in D1', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0020_rfq_created_email_outbox.d1.sql'
    );
    const statements = splitStatements(fs.readFileSync(migrationPath, 'utf8'));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/CREATE TRIGGER IF NOT EXISTS rfqs_enqueue_created_email_event/i);
    expect(statements[0]).toContain("'$.creationAcknowledgementRequested'");
    expect(statements[0]).toContain("lower(COALESCE(json_extract(NEW.raw, '$.source'), '')) <> 'email_gateway'");
    expect(statements[0]).toContain("'rfq_created_email'");
    expect(statements[0]).toContain("'rfq-created-email:' || NEW.id");
    expect(statements[0]).toContain("json_object('rfqId', NEW.id)");
  });

  test('repairs missing D1 anchor columns and records the local migration', () => {
    const calls = [];
    const run = jest.fn((args) => {
      calls.push(args);
      const command = args[args.indexOf('--command') + 1];
      if (command.includes('pragma_table_info')) {
        return [{ results: [{ name: 'id' }, { name: 'head_hash' }, { name: 'revision' }] }];
      }
      if (command.includes('FROM schema_migrations')) return [{ results: [] }];
      return [{ results: [] }];
    });

    expect(ensureLocalAuditChainVerificationMigration({ run })).toEqual({ addedColumns: 2, ledgerInserted: true });
    expect(calls.some((args) => args.some((argument) => String(argument).includes('ALTER TABLE audit_chain_state ADD COLUMN root_hash TEXT NOT NULL DEFAULT')))).toBe(true);
    expect(calls.some((args) => args.some((argument) => String(argument).includes('ALTER TABLE audit_chain_state ADD COLUMN entry_count INTEGER NOT NULL DEFAULT')))).toBe(true);
    expect(calls.some((args) => args.includes("INSERT INTO schema_migrations(version, description) VALUES ('0017_audit_chain_integrity_anchors', 'audit chain integrity anchors')"))).toBe(true);
  });

  test('does not duplicate existing anchor columns or the local migration record', () => {
    const run = jest.fn((args) => {
      const command = args[args.indexOf('--command') + 1];
      if (command.includes('pragma_table_info')) {
        return [{ results: [{ name: 'id' }, { name: 'head_hash' }, { name: 'revision' }, { name: 'root_hash' }, { name: 'entry_count' }] }];
      }
      if (command.includes('FROM schema_migrations')) return [{ results: [{ version: '0017_audit_chain_integrity_anchors' }] }];
      return [{ results: [] }];
    });

    expect(ensureLocalAuditChainVerificationMigration({ run })).toEqual({ addedColumns: 0, ledgerInserted: false });
    expect(run.mock.calls.some(([args]) => args.some((argument) => String(argument).startsWith('ALTER TABLE')))).toBe(false);
    expect(run.mock.calls.some(([args]) => args.some((argument) => String(argument).startsWith('INSERT INTO schema_migrations')))).toBe(false);
  });

  test('keeps every numbered D1 migration in the local mock setup command', () => {
    const migrationsPath = path.resolve(__dirname, '../src/db/migrations');
    const scripts = require('../package.json').scripts;
    const setupScriptNames = scripts['db:setup:mock:local'].match(/npm run ([\w:.-]+)/g) || [];
    const configuredLocalSetup = setupScriptNames
      .map((entry) => entry.replace(/^npm run /, ''))
      .map((scriptName) => scripts[scriptName] || '')
      .join('\n');
    const localSetupWithHelpers = configuredLocalSetup.includes('migrate-d1-local-chaser-retries.js')
      ? `${configuredLocalSetup}\n${fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-d1-local-chaser-retries.js'), 'utf8')}`
      : configuredLocalSetup;
    const localSetupWithAllHelpers = localSetupWithHelpers.includes('migrate-d1-local-audit-chain-verification.js')
      ? `${localSetupWithHelpers}\n${fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-d1-local-audit-chain-verification.js'), 'utf8')}`
      : localSetupWithHelpers;
    const migrationFiles = fs.readdirSync(migrationsPath).filter((file) => /^\d+_[\w-]+\.d1\.sql$/i.test(file));

    expect(migrationFiles.length).toBeGreaterThan(0);
    migrationFiles.forEach((file) => expect(localSetupWithAllHelpers).toContain(file));
  });

  test('applies numbered D1 migrations once and records a content checksum', async () => {
    const migrationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-migrations-'));
    const filePath = path.join(migrationsPath, '0001_search_index.d1.sql');
    fs.writeFileSync(filePath, "INSERT INTO search_fts(search_fts) VALUES ('rebuild');\n", 'utf8');
    const ledger = new Map();
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO schema_migration_locks')) {
        return { result: [{ results: [{ owner_token: params[1] }] }] };
      }
      if (sql.startsWith('SELECT checksum')) {
        const checksum = ledger.get(params[0]);
        return { result: [{ results: checksum ? [{ checksum }] : [] }] };
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        ledger.set(params[0], params[2]);
      }
      return { result: [{ results: [] }] };
    });

    try {
      await expect(applyD1Migrations({ query, migrationsPath })).resolves.toEqual({ applied: 1, skipped: 0 });
      const firstRunCallCount = calls.length;
      await expect(applyD1Migrations({ query, migrationsPath })).resolves.toEqual({ applied: 0, skipped: 1 });
      expect(calls.slice(firstRunCallCount).some(({ sql }) => sql.includes('search_fts(search_fts)'))).toBe(false);
      expect(ledger.get('0001_search_index')).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fs.rmSync(migrationsPath, { recursive: true, force: true });
    }
  });

  test('rejects edits to an already applied migration', async () => {
    const migrationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-migrations-'));
    fs.writeFileSync(path.join(migrationsPath, '0002_search_index.d1.sql'), 'SELECT 1;\n', 'utf8');
    const query = jest.fn().mockResolvedValue({
      result: [{ results: [{ checksum: 'incorrect-checksum' }] }],
    });

    try {
      await expect(applyD1Migrations({ query, migrationsPath }))
        .rejects.toThrow(/checksum mismatch for 0002_search_index/);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(migrationsPath, { recursive: true, force: true });
    }
  });

  test('does not mark a migration applied when one of its statements fails', async () => {
    const migrationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-migrations-'));
    fs.writeFileSync(path.join(migrationsPath, '0003_search_index.d1.sql'), 'CREATE TABLE failure_case(id);\n', 'utf8');
    const query = jest.fn()
      .mockResolvedValueOnce({ result: [{ results: [] }] })
      .mockRejectedValueOnce(new Error('migration statement failed'));

    try {
      await expect(applyD1Migrations({ query, migrationsPath })).rejects.toThrow('migration statement failed');
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO schema_migrations'))).toBe(false);
    } finally {
      fs.rmSync(migrationsPath, { recursive: true, force: true });
    }
  });

  test('returns an empty result when the migrations directory is not present', async () => {
    await expect(applyD1Migrations({ query: jest.fn(), migrationsPath: path.join(os.tmpdir(), 'missing-d1-migrations') }))
      .resolves.toEqual({ applied: 0, skipped: 0 });
  });

  test('treats a missing migration ledger as an uninitialized database', async () => {
    const query = jest.fn().mockRejectedValue(new Error('D1 query failed: no such table: schema_migrations'));
    await expect(getSchemaBaseline(query)).resolves.toBeNull();
  });

  test('propagates ledger errors other than a missing table', async () => {
    const query = jest.fn().mockRejectedValue(new Error('D1 authorization failed'));
    await expect(getSchemaBaseline(query)).rejects.toThrow('D1 authorization failed');
  });

  test('applies and records the schema once, then skips full schema replay', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-schema-'));
    const schemaPath = path.join(root, 'schema.d1.sql');
    const migrationsPath = path.join(root, 'migrations');
    fs.mkdirSync(migrationsPath);
    const schemaSql = 'CREATE TABLE IF NOT EXISTS sample (id TEXT PRIMARY KEY);';
    fs.writeFileSync(schemaPath, schemaSql, 'utf8');
    let baseline = null;
    const query = jest.fn(async (sql, params = []) => {
      if (sql.includes('INSERT INTO schema_migration_locks')) {
        return { result: [{ results: [{ owner_token: params[1] }] }] };
      }
      if (sql.startsWith('SELECT checksum')) {
        return { result: [{ results: baseline && params[0] === '0000_schema_baseline' ? [baseline] : [] }] };
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        if (params[0] === '0000_schema_baseline') baseline = { checksum: params[2] };
      }
      if (sql.startsWith('SELECT COUNT(*)')) return { result: [{ results: [{ total: 0 }] }] };
      return { result: [{ results: [] }] };
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await expect(migrate({ query, schemaPath, migrationsPath, requireCredentials: false }))
        .resolves.toEqual({ applied: 1, skipped: 0, failures: [], migrations: { applied: 0, skipped: 0 } });
      expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT COUNT(*)'))).toBe(false);
      const callsAfterFirstRun = query.mock.calls.length;
      await expect(migrate({ query, schemaPath, migrationsPath, requireCredentials: false }))
        .resolves.toEqual({ applied: 0, skipped: 0, failures: [], migrations: { applied: 0, skipped: 0 } });
      expect(query.mock.calls.slice(callsAfterFirstRun).some(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS sample'))).toBe(false);
      expect(baseline.checksum).toBe(schemaChecksum(schemaSql));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('skipping the full schema replay'));
    } finally {
      process.exitCode = originalExitCode;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed when the baseline checksum no longer matches the schema', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-schema-'));
    const schemaPath = path.join(root, 'schema.d1.sql');
    const migrationsPath = path.join(root, 'migrations');
    fs.mkdirSync(migrationsPath);
    fs.writeFileSync(schemaPath, 'CREATE TABLE changed (id TEXT);', 'utf8');
    const query = jest.fn(async (sql, params = []) => {
      if (sql.includes('INSERT INTO schema_migration_locks')) {
        return { result: [{ results: [{ owner_token: params[1] }] }] };
      }
      return sql.startsWith('SELECT checksum')
        ? { result: [{ results: [{ checksum: 'stale' }] }] }
        : { result: [{ results: [] }] };
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const result = await migrate({ query, schemaPath, migrationsPath, requireCredentials: false });
      expect(result.failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('changed after the recorded baseline') }),
      ]));
      expect(query.mock.calls.some(([sql]) => sql.startsWith('CREATE TABLE'))).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalled();
    } finally {
      process.exitCode = originalExitCode;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
