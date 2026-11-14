const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(BACKEND_ROOT, 'src/db/migrations');
const D1_MIGRATION = '0034_organization_vendor_master_uploaded.d1.sql';
const PG_MIGRATION = '0034_organization_vendor_master_uploaded.pg.sql';
const LOCAL_SCRIPT = 'db:migrate:d1:local:organization-vendor-master-uploaded';

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

function readMigration(file) {
  return normalizeSql(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

// The buyer initial setup popup reads organization.vendor_master_uploaded_at at sign-in. These checks keep
// both dialects adding the column the same way, and keep the backfill that stops the popup from returning
// for organizations that already uploaded a vendor master.
describe('organization vendor master uploaded migration', () => {
  test('the D1 migration adds a nullable TEXT column to organization', () => {
    expect(readMigration(D1_MIGRATION)).toContain(
      'ALTER TABLE organization ADD COLUMN vendor_master_uploaded_at TEXT;'
    );
  });

  test('the PostgreSQL migration adds a nullable TIMESTAMPTZ column to organization', () => {
    expect(readMigration(PG_MIGRATION)).toContain(
      'ALTER TABLE organization ADD COLUMN IF NOT EXISTS vendor_master_uploaded_at TIMESTAMPTZ;'
    );
  });

  test.each([D1_MIGRATION, PG_MIGRATION])(
    '%s backfills only unset organizations whose sessions already stored vendor master rows',
    (file) => {
      const sql = readMigration(file);
      expect(sql).toContain('UPDATE organization');
      expect(sql).toContain('WHERE vendor_master_uploaded_at IS NULL');
      expect(sql).toContain('s.organization_id = organization.uuid');
      expect(sql).toContain('s.vendor_master_row_count > 0');
    }
  );

  test('both dialects ship the migration and the local mock setup applies the D1 migration', () => {
    expect(fs.existsSync(path.join(MIGRATIONS, D1_MIGRATION))).toBe(true);
    expect(fs.existsSync(path.join(MIGRATIONS, PG_MIGRATION))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts[LOCAL_SCRIPT]).toContain(D1_MIGRATION);
    expect(pkg.scripts['db:setup:mock:local']).toContain(LOCAL_SCRIPT);
  });
});
