'use strict';

const {
  ensureLocalChaserRetryMigration,
  readCount,
} = require('../scripts/migrate-d1-local-chaser-retries');

const responseWithCount = (count) => [{ results: [{ count }], success: true }];

describe('Local D1 chaser retry migration', () => {
  test('adds the column and records the migration when neither exists', () => {
    const run = jest.fn()
      .mockReturnValueOnce(responseWithCount(0))
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(responseWithCount(0))
      .mockReturnValueOnce(undefined);

    expect(ensureLocalChaserRetryMigration({ run })).toEqual({ columnAdded: true, ledgerInserted: true });
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[1][0]).toContain('--file');
    expect(run.mock.calls[3][0].join(' ')).toContain('INSERT INTO schema_migrations');
  });

  test('does not reapply an existing column or duplicate its migration ledger row', () => {
    const run = jest.fn()
      .mockReturnValueOnce(responseWithCount(1))
      .mockReturnValueOnce(responseWithCount(1));

    expect(ensureLocalChaserRetryMigration({ run })).toEqual({ columnAdded: false, ledgerInserted: false });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('repairs a missing migration ledger entry after the column was applied', () => {
    const run = jest.fn()
      .mockReturnValueOnce(responseWithCount(1))
      .mockReturnValueOnce(responseWithCount(0))
      .mockReturnValueOnce(undefined);

    expect(ensureLocalChaserRetryMigration({ run })).toEqual({ columnAdded: false, ledgerInserted: true });
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2][0].join(' ')).toContain('INSERT INTO schema_migrations');
  });

  test('reads absent or malformed Wrangler result shapes as zero rows', () => {
    expect(readCount(responseWithCount(3))).toBe(3);
    expect(readCount([])).toBe(0);
    expect(readCount([{ results: [{ count: 'invalid' }] }])).toBe(0);
  });

  test('propagates migration command failures so local setup cannot continue silently', () => {
    const run = jest.fn().mockImplementation(() => {
      throw new Error('Wrangler command failed');
    });
    expect(() => ensureLocalChaserRetryMigration({ run })).toThrow('Wrangler command failed');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
