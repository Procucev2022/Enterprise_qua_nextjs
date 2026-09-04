// ==============================================================================
// MIGRATION RUNNER
// ==============================================================================
// `npm run db:migrate` is a quality-gate step, so two behaviours are load-bearing:
// an unconfigured database must SKIP rather than fail (CI has no credentials), and
// an interrupted run must be repeatable (MySQL has no CREATE INDEX IF NOT EXISTS,
// so re-running hits "already exists" errors that are not real failures).
// ==============================================================================

const migrationRunner = require('../src/db/migrationRunner');
const { MIGRATIONS, BOOKKEEPING_DDL } = require('../src/db/migrations');
const identityPoolModule = require('../src/db/identityPool');
const { RFQ_PERSISTENCE } = require('../src/config/constants');

const { MIGRATION_STATUS } = migrationRunner;
const { RFQ_TABLE, MIGRATIONS_TABLE } = RFQ_PERSISTENCE;

function mysqlError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/** A query double that records statements and reports nothing applied yet. */
function recordingQuery(appliedIds = []) {
  const statements = [];
  const query = jest.fn(async (sql) => {
    statements.push(sql);
    if (sql.startsWith('SELECT id FROM')) return appliedIds.map((id) => ({ id }));
    return { affectedRows: 1 };
  });
  query.statements = statements;
  return query;
}

describe('migrations definitions', () => {
  test('the bookkeeping table is created before anything else', () => {
    expect(BOOKKEEPING_DDL).toContain('CREATE TABLE IF NOT EXISTS');
    expect(BOOKKEEPING_DDL).toContain(MIGRATIONS_TABLE);
  });

  test('every migration has a unique id, a description and statements', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);

    MIGRATIONS.forEach((migration) => {
      expect(typeof migration.id).toBe('string');
      expect(migration.description.length).toBeGreaterThan(0);
      expect(migration.statements.length).toBeGreaterThan(0);
    });
  });

  test('the first migration creates the RFQ table with its ownership columns', () => {
    const first = MIGRATIONS[0];
    const ddl = first.statements.join('\n');

    expect(ddl).toContain(RFQ_TABLE);
    // Ownership is what every dashboard read filters on.
    expect(ddl).toContain('buyer_org_id');
    expect(ddl).toContain('buyer_user_id');
    expect(ddl).toContain('buyer_email');
    // The RFQ number must be unique; both this app and the Java app allocate
    // from the same space.
    expect(ddl).toContain('UNIQUE KEY uq_qua_rfq_rfq_id (rfq_id)');
  });

  // Per the database optimisation standard: the columns reads filter on are
  // indexed, and the org index carries created_at so the newest-first listing
  // does not filesort.
  test('indexes the columns every read filters on', () => {
    const ddl = MIGRATIONS[0].statements.join('\n');
    expect(ddl).toContain('idx_qua_rfq_org_created\n        ON `qua_enterprice_rfq` (buyer_org_id, created_at)');
    expect(ddl).toContain('idx_qua_rfq_buyer_email');
    expect(ddl).toContain('idx_qua_rfq_buyer_user');
  });

  // This workspace only creates tables it owns. The Java p2pservices app owns the
  // rest of the schema and migrates them itself.
  test('touches no table belonging to the Java application', () => {
    const ddl = MIGRATIONS.flatMap((m) => m.statements).join('\n');
    expect(ddl).not.toMatch(/ALTER TABLE\s+`?(user|organization|role|rfq_records|rfq_header)`?/i);
  });
});

describe('migrationRunner.isAlreadyExists', () => {
  test.each(['ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_FIELDNAME'])(
    'treats %s as already applied',
    (code) => {
      expect(migrationRunner.isAlreadyExists(mysqlError(code))).toBe(true);
    }
  );

  test.each([['ER_ACCESS_DENIED_ERROR'], [null], [undefined], [new Error('no code')]])(
    'treats %p as a real failure',
    (err) => {
      expect(migrationRunner.isAlreadyExists(err)).toBe(false);
    }
  );
});

describe('migrationRunner.runStatement', () => {
  test('reports that a statement did something', async () => {
    const query = jest.fn(async () => ({ affectedRows: 1 }));
    expect(await migrationRunner.runStatement(query, 'CREATE TABLE x')).toBe(true);
  });

  test('reports a no-op when the object already exists', async () => {
    const query = jest.fn(async () => {
      throw mysqlError('ER_DUP_KEYNAME');
    });
    expect(await migrationRunner.runStatement(query, 'CREATE INDEX x')).toBe(false);
  });

  test('propagates a real failure', async () => {
    const query = jest.fn(async () => {
      throw mysqlError('ER_ACCESS_DENIED_ERROR');
    });
    await expect(migrationRunner.runStatement(query, 'CREATE TABLE x')).rejects.toThrow(
      'ER_ACCESS_DENIED_ERROR'
    );
  });
});

describe('migrationRunner.loadAppliedIds', () => {
  test('reads the recorded ids', async () => {
    const query = jest.fn(async () => [{ id: 'a' }, { id: 'b' }]);
    const ids = await migrationRunner.loadAppliedIds(query);
    expect(ids.has('a')).toBe(true);
    expect(ids.size).toBe(2);
  });

  test('tolerates no rows', async () => {
    const query = jest.fn(async () => null);
    expect((await migrationRunner.loadAppliedIds(query)).size).toBe(0);
  });
});

describe('migrationRunner.runMigrations', () => {
  const fakeMigrations = [
    { id: '001_first', description: 'first', statements: ['CREATE TABLE a'] },
    { id: '002_second', description: 'second', statements: ['CREATE TABLE b', 'CREATE INDEX i ON b (c)'] },
  ];

  test('applies every pending migration in order and records each one', async () => {
    const query = recordingQuery();
    const report = await migrationRunner.runMigrations({ query, migrations: fakeMigrations });

    expect(report.status).toBe(MIGRATION_STATUS.APPLIED);
    expect(report.applied).toEqual(['001_first', '002_second']);
    expect(report.alreadyApplied).toEqual([]);
    expect(report.total).toBe(2);

    // Bookkeeping first, then the migration statements, each followed by an insert.
    expect(query.statements[0]).toContain(MIGRATIONS_TABLE);
    expect(query.statements).toContain('CREATE TABLE a');
    expect(query.statements).toContain('CREATE INDEX i ON b (c)');
    expect(query.statements.filter((s) => s.startsWith('INSERT INTO'))).toHaveLength(2);
  });

  test('skips a migration that has already been recorded', async () => {
    const query = recordingQuery(['001_first']);
    const report = await migrationRunner.runMigrations({ query, migrations: fakeMigrations });

    expect(report.applied).toEqual(['002_second']);
    expect(report.alreadyApplied).toEqual(['001_first']);
    expect(query.statements).not.toContain('CREATE TABLE a');
  });

  test('is a no-op when everything is already applied', async () => {
    const query = recordingQuery(['001_first', '002_second']);
    const report = await migrationRunner.runMigrations({ query, migrations: fakeMigrations });

    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied).toHaveLength(2);
  });

  // An interrupted run must be repeatable.
  test('continues past statements whose object already exists', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.startsWith('SELECT id FROM')) return [];
      if (sql.startsWith('CREATE INDEX')) throw mysqlError('ER_DUP_KEYNAME');
      return { affectedRows: 1 };
    });

    const report = await migrationRunner.runMigrations({ query, migrations: fakeMigrations });
    expect(report.applied).toEqual(['001_first', '002_second']);
  });

  test('propagates a real migration failure', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.startsWith('SELECT id FROM')) return [];
      if (sql === 'CREATE TABLE b') throw mysqlError('ER_ACCESS_DENIED_ERROR');
      return { affectedRows: 1 };
    });

    await expect(
      migrationRunner.runMigrations({ query, migrations: fakeMigrations })
    ).rejects.toThrow('ER_ACCESS_DENIED_ERROR');
  });

  // CI and fresh checkouts have no MySQL credentials. Failing there would block
  // every commit for a reason unrelated to the change under test.
  test('skips rather than fails when the database is not configured', async () => {
    const originalPool = identityPoolModule.pool;
    identityPoolModule.pool = null;
    try {
      const report = await migrationRunner.runMigrations({ migrations: fakeMigrations });
      expect(report.status).toBe(MIGRATION_STATUS.SKIPPED_NOT_CONFIGURED);
      expect(report.applied).toEqual([]);
      expect(report.total).toBe(2);
    } finally {
      identityPoolModule.pool = originalPool;
    }
  });

  test('defaults to the real migration list', async () => {
    const query = recordingQuery(MIGRATIONS.map((m) => m.id));
    const report = await migrationRunner.runMigrations({ query });
    expect(report.total).toBe(MIGRATIONS.length);
  });

  // With no injected query and a configured pool, the runner reaches for the real
  // identityQuery. This is the path `npm run db:migrate` actually takes.
  test('uses the pool query when none is injected and the database is configured', async () => {
    const originalPool = identityPoolModule.pool;
    const originalQuery = identityPoolModule.identityQuery;
    const spy = jest.fn(async (sql) => (sql.startsWith('SELECT id FROM') ? [] : { affectedRows: 1 }));

    identityPoolModule.pool = { fake: true };
    identityPoolModule.identityQuery = spy;
    try {
      const report = await migrationRunner.runMigrations({ migrations: fakeMigrations });
      expect(report.status).toBe(MIGRATION_STATUS.APPLIED);
      expect(spy).toHaveBeenCalled();
    } finally {
      identityPoolModule.pool = originalPool;
      identityPoolModule.identityQuery = originalQuery;
    }
  });
});
