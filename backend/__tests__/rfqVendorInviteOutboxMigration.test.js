const fs = require('fs');
const path = require('path');

describe('RFQ vendor invitation outbox migrations', () => {
  test('D1 queues invitation intents atomically on RFQ insert and intent updates', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0021_rfq_vendor_invitation_email_outbox.d1.sql'
    );
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/AFTER INSERT ON rfqs/i);
    expect(migration).toMatch(/AFTER UPDATE OF raw ON rfqs/i);
    expect(migration).toContain("'rfq_vendor_invite_email'");
    expect(migration).toContain("'$.vendorInvitationTargets'");
    expect(migration).toContain("'$.recipientEmail'");
    expect(migration).toContain('INSERT OR IGNORE INTO event_outbox');
  });

  test('PostgreSQL queues invitation intents atomically on RFQ insert and intent updates', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0019_rfq_vendor_invitation_email_outbox.pg.sql'
    );
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/AFTER INSERT ON rfqs/i);
    expect(migration).toMatch(/AFTER UPDATE OF raw ON rfqs/i);
    expect(migration).toContain("'rfq_vendor_invite_email'");
    expect(migration).toContain("NEW.raw->'vendorInvitationTargets'");
    expect(migration).toContain('ON CONFLICT (id) DO NOTHING');
  });

  test('local mock setup applies the idempotent D1 invite migration', () => {
    const packagePath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    expect(packageJson.scripts['db:migrate:d1:local:rfq-vendor-invitation-email-outbox'])
      .toContain('0021_rfq_vendor_invitation_email_outbox.d1.sql');
    expect(packageJson.scripts['db:setup:mock:local'])
      .toContain('db:migrate:d1:local:rfq-vendor-invitation-email-outbox');
  });
});
