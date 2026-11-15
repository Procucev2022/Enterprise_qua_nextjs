const fs = require('fs');
const path = require('path');

describe('RFQ gateway notification outbox migrations', () => {
  test('D1 queues gateway notification intent atomically on RFQ insert and intent updates', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0022_rfq_gateway_notification_email_outbox.d1.sql'
    );
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/AFTER INSERT ON rfqs/i);
    expect(migration).toMatch(/AFTER UPDATE OF raw ON rfqs/i);
    expect(migration).toContain("'$.gatewayNotificationTarget'");
    expect(migration).toContain("'$.gatewayNotificationTarget.recipientEmail'");
    expect(migration).toContain("'rfq_gateway_notification_email'");
    expect(migration).toContain('INSERT OR IGNORE INTO event_outbox');
  });

  test('PostgreSQL queues gateway notification intent atomically on RFQ insert and intent updates', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../src/db/migrations/0020_rfq_gateway_notification_email_outbox.pg.sql'
    );
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/AFTER INSERT ON rfqs/i);
    expect(migration).toMatch(/AFTER UPDATE OF raw ON rfqs/i);
    expect(migration).toContain("NEW.raw->'gatewayNotificationTarget'");
    expect(migration).toContain("'rfq_gateway_notification_email'");
    expect(migration).toContain('ON CONFLICT (id) DO NOTHING');
  });

  test('local mock setup applies the idempotent D1 gateway outbox migration', () => {
    const packagePath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    expect(packageJson.scripts['db:migrate:d1:local:rfq-gateway-notification-email-outbox'])
      .toContain('0022_rfq_gateway_notification_email_outbox.d1.sql');
    expect(packageJson.scripts['db:setup:mock:local'])
      .toContain('db:migrate:d1:local:rfq-gateway-notification-email-outbox');
  });
});
