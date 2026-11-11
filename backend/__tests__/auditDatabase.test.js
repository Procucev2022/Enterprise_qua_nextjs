const { AUDIT_CHECKS, buildAuditSql, countFromResult, parseArguments, runAudit } = require('../scripts/audit-database');

describe('read-only database integrity audit', () => {
  test('requires an explicit and unambiguous backend', () => {
    expect(() => parseArguments([])).toThrow('Choose exactly one database target');
    expect(() => parseArguments(['--d1', '--postgres'])).toThrow('Choose exactly one database target');
    expect(() => parseArguments(['--postgres', '--local'])).toThrow('supported only with the D1 audit target');
    expect(parseArguments(['--d1', '--prod'])).toEqual({ provider: 'd1' });
    expect(parseArguments(['--d1', '--local'])).toEqual({ provider: 'd1', local: true });
    expect(parseArguments(['--postgres'])).toEqual({ provider: 'postgres' });
  });

  test('uses only aggregate SELECT statements and covers duplicate and orphan risks', () => {
    expect(AUDIT_CHECKS.length).toBeGreaterThanOrEqual(10);
    const sql = buildAuditSql();
    expect(sql).toMatch(/^\s*SELECT\b/i);
    expect(sql).not.toContain(';');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    expect(AUDIT_CHECKS.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'active_org_category_duplicate_groups',
      'case_insensitive_vendor_email_duplicate_groups',
      'case_insensitive_rfq_number_duplicate_groups',
      'case_insensitive_vendor_catalogue_sku_duplicate_groups',
      'orphan_catalogue_vendor_rows',
      'orphan_payment_link_buyer_rows',
      'orphan_enterprise_inquiry_buyer_rows',
    ]));
    expect(AUDIT_CHECKS.every(({ expression }) => /^\(\s*SELECT\b/i.test(expression))).toBe(true);
    expect(AUDIT_CHECKS.find(({ id }) => id === 'case_insensitive_vendor_catalogue_sku_duplicate_groups').expression)
      .toContain('GROUP BY vendor_id, lower(trim(sku))');
  });

  test('counts PostgreSQL and D1 aggregate responses', () => {
    expect(countFromResult({ rows: [{ count: '3' }] }, 'postgres')).toBe(3);
    expect(countFromResult({ result: [{ results: [{ count: 4 }] }] }, 'd1')).toBe(4);
    expect(() => countFromResult({ rows: [{ count: 'NaN' }] }, 'postgres')).toThrow('invalid aggregate count');
  });

  test('returns an aggregate report without exposing database rows', async () => {
    let invocation = 0;
    const query = jest.fn(async () => ({
      rows: [Object.fromEntries(AUDIT_CHECKS.map(({ id }) => [id, String(++invocation === 1 ? 1 : 0)]))],
    }));
    const now = () => new Date('2026-11-03T00:00:00.000Z');

    const report = await runAudit({ provider: 'postgres', query, now });

    expect(report).toEqual(expect.objectContaining({
      generatedAt: '2026-11-03T00:00:00.000Z',
      provider: 'postgres',
      readOnly: true,
      failedChecks: 0,
    }));
    expect(report.checks).toHaveLength(AUDIT_CHECKS.length);
    expect(report.checks[0]).toEqual(expect.objectContaining({
      id: AUDIT_CHECKS[0].id,
      status: 'ok',
      count: 1,
    }));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
    expect(JSON.stringify(report)).not.toContain('email@example.com');
  });

  test('reports unavailable checks without hiding errors when the aggregate query fails', async () => {
    const query = jest.fn().mockRejectedValue(
      Object.assign(new Error('no such table: org_division_category'), { code: 'SQLITE_ERROR' })
    );

    const report = await runAudit({ provider: 'd1', query });

    expect(report.provider).toBe('d1');
    expect(report.failedChecks).toBe(AUDIT_CHECKS.length);
    expect(report.checks[1]).toEqual(expect.objectContaining({
      id: AUDIT_CHECKS[1].id,
      status: 'unavailable',
      errorCode: 'SQLITE_ERROR',
      errorMessage: 'no such table: org_division_category',
    }));
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('rejects non-read-only check definitions before issuing them', async () => {
    const query = jest.fn();
    await expect(runAudit({
      provider: 'd1',
      query,
      checks: [{ id: 'bad', kind: 'rows', expression: 'DELETE FROM vendors' }],
    })).rejects.toThrow('Refusing non-read-only audit check');
    expect(query).not.toHaveBeenCalled();
  });

  test('requires an explicit cost opt-in before running D1 full-table checks', async () => {
    const originalExitCode = process.exitCode;
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const query = jest.fn();

    try {
      await expect(require('../scripts/audit-database').main(['--d1'], { query })).resolves.toBeNull();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('read cost'));
      expect(query).not.toHaveBeenCalled();
    } finally {
      process.exitCode = originalExitCode;
      stderr.mockRestore();
    }
  });

  test('runs a local D1 audit without loading remote credentials', async () => {
    const originalExitCode = process.exitCode;
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const query = jest.fn().mockResolvedValue({
      result: [{ results: [Object.fromEntries(AUDIT_CHECKS.map(({ id }) => [id, 0]))] }],
    });

    try {
      const report = await require('../scripts/audit-database').main(
        ['--d1', '--local', '--allow-full-scan'],
        { query }
      );

      expect(report).toMatchObject({ provider: 'd1', readOnly: true, failedChecks: 0 });
      expect(query).toHaveBeenCalledWith(expect.stringMatching(/^SELECT/));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"provider": "d1"'));
    } finally {
      process.exitCode = originalExitCode;
      stdout.mockRestore();
    }
  });
});
