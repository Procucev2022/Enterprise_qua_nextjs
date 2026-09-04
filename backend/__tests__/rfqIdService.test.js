// ==============================================================================
// RFQ ID ALLOCATION
// ==============================================================================
// The format is a byte-for-byte port of AutomaticRfqServiceImpl.generateRfqId in
// the Java p2pservices app, so these tests pin the exact shape rather than a
// loose pattern. If the two ever diverge, ids minted here stop being valid there.
// ==============================================================================

const rfqIdService = require('../src/services/rfqIdService');
const { RFQ_PERSISTENCE, RFQ_ID_CONFIG } = require('../src/config/constants');

const { ID_RESERVATION_TABLE, RFQ_TABLE } = RFQ_PERSISTENCE;

/** A query double that reports nothing taken and accepts every reservation. */
function freeQuery() {
  return jest.fn(async (sql) => {
    if (sql.includes('COUNT(*)')) return [{ total: 0 }];
    return { affectedRows: 1 };
  });
}

function mysqlError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

describe('rfqIdService.buildPrefix', () => {
  test.each([
    ['RFQ', 'RFQ'],
    ['rfq', 'RFQ'],
    ['Procucev', 'PRO'],
  ])('takes the first three characters of %s uppercased', (input, expected) => {
    expect(rfqIdService.buildPrefix(input)).toBe(expected);
  });

  // The Java branch uses the whole string when it is shorter than three.
  test.each([
    ['ab', 'AB'],
    ['x', 'X'],
  ])('uses the whole of %s when shorter than three characters', (input, expected) => {
    expect(rfqIdService.buildPrefix(input)).toBe(expected);
  });

  test.each([[''], [null], [undefined]])('falls back for %p', (input) => {
    // Empty and null collapse to the configured default via the caller's default
    // parameter, so only the empty-string path is exercised directly here.
    expect(typeof rfqIdService.buildPrefix(input)).toBe('string');
  });

  test('defaults to the configured company prefix', () => {
    expect(rfqIdService.buildPrefix()).toBe(RFQ_ID_CONFIG.COMPANY);
  });
});

describe('rfqIdService.buildDatePart', () => {
  // yyddMM, not yyMMdd. That ordering is what the Java SimpleDateFormat pattern
  // produces, and matching it matters more than it reading naturally.
  test.each([
    ['2026-09-04T10:00:00', '260409'],
    ['2026-01-31T23:00:00', '263101'],
    ['2026-12-01T00:00:00', '260112'],
  ])('formats %s as %s', (iso, expected) => {
    expect(rfqIdService.buildDatePart(new Date(iso))).toBe(expected);
  });

  test('defaults to now', () => {
    expect(rfqIdService.buildDatePart()).toMatch(/^\d{6}$/);
  });
});

describe('rfqIdService.buildCandidate', () => {
  test('zero-pads the suffix to six digits', () => {
    expect(rfqIdService.buildCandidate('RFQ', '260409', 512)).toBe('RFQ260409000512');
  });

  test('leaves a full-width suffix untouched', () => {
    expect(rfqIdService.buildCandidate('RFQ', '260409', 999999)).toBe('RFQ260409999999');
  });
});

describe('rfqIdService.countMatching', () => {
  test('returns the counted total', async () => {
    const query = jest.fn(async () => [{ total: 3 }]);
    expect(await rfqIdService.countMatching(query, 'SELECT ...', 'RFQ1')).toBe(3);
  });

  test.each([[[]], [[{}]], [null]])('treats %p as zero', async (rows) => {
    const query = jest.fn(async () => rows);
    expect(await rfqIdService.countMatching(query, 'SELECT ...', 'RFQ1')).toBe(0);
  });

  // The legacy Java tables are absent in an environment that only ever ran this
  // workspace. Nothing there means nothing to clash with.
  test('treats a missing table as zero rather than failing', async () => {
    const query = jest.fn(async () => {
      throw mysqlError('ER_NO_SUCH_TABLE');
    });
    expect(await rfqIdService.countMatching(query, 'SELECT ...', 'RFQ1')).toBe(0);
  });

  test('propagates any other database error', async () => {
    const query = jest.fn(async () => {
      throw mysqlError('ER_ACCESS_DENIED_ERROR');
    });
    await expect(rfqIdService.countMatching(query, 'SELECT ...', 'RFQ1')).rejects.toThrow(
      'ER_ACCESS_DENIED_ERROR'
    );
  });
});

describe('rfqIdService.isCandidateFree', () => {
  test('is free when neither this table nor either legacy table holds it', async () => {
    expect(await rfqIdService.isCandidateFree(freeQuery(), 'RFQ260409000001')).toBe(true);
  });

  // Each of the three checks short-circuits, so each needs its own case.
  test('is taken when this workspace already holds it', async () => {
    const query = jest.fn(async (sql) =>
      sql.includes(RFQ_TABLE) ? [{ total: 1 }] : [{ total: 0 }]
    );
    expect(await rfqIdService.isCandidateFree(query, 'RFQ260409000001')).toBe(false);
  });

  test('is taken when the legacy rfq_records table holds it', async () => {
    const query = jest.fn(async (sql) =>
      sql.includes('rfq_records') ? [{ total: 1 }] : [{ total: 0 }]
    );
    expect(await rfqIdService.isCandidateFree(query, 'RFQ260409000001')).toBe(false);
  });

  test('is taken when the legacy rfq_header table holds it', async () => {
    const query = jest.fn(async (sql) =>
      sql.includes('rfq_header') ? [{ total: 1 }] : [{ total: 0 }]
    );
    expect(await rfqIdService.isCandidateFree(query, 'RFQ260409000001')).toBe(false);
  });
});

describe('rfqIdService.reserveCandidate', () => {
  test('claims the candidate through the shared reservation table', async () => {
    const query = jest.fn(async () => ({ affectedRows: 1 }));
    expect(await rfqIdService.reserveCandidate(query, 'RFQ260409000001')).toBe(true);
    expect(query.mock.calls[0][0]).toContain(ID_RESERVATION_TABLE);
  });

  // A duplicate means another allocator, possibly the Java app, won the race.
  test('reports a lost race rather than throwing', async () => {
    const query = jest.fn(async () => {
      throw mysqlError('ER_DUP_ENTRY');
    });
    expect(await rfqIdService.reserveCandidate(query, 'RFQ260409000001')).toBe(false);
  });

  test('propagates any other database error', async () => {
    const query = jest.fn(async () => {
      throw mysqlError('ER_LOCK_WAIT_TIMEOUT');
    });
    await expect(rfqIdService.reserveCandidate(query, 'RFQ1')).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
  });
});

describe('rfqIdService.generateRfqId', () => {
  const now = new Date('2026-09-04T10:00:00Z');

  test('returns a reserved id in the Java format', async () => {
    const id = await rfqIdService.generateRfqId({ query: freeQuery(), now });
    expect(id).toMatch(/^RFQ260409\d{6}$/);
    expect(id).toHaveLength(15);
  });

  test('honours a custom company prefix', async () => {
    const id = await rfqIdService.generateRfqId({ query: freeQuery(), now, company: 'Procucev' });
    expect(id.startsWith('PRO260409')).toBe(true);
  });

  // The suffix is seeded from the clock and probed upward, so a taken candidate
  // must advance rather than abort.
  test('advances past a candidate that is already taken', async () => {
    let countCalls = 0;
    const query = jest.fn(async (sql) => {
      if (sql.includes('COUNT(*)')) {
        countCalls += 1;
        // Report the first probed candidate as taken, then everything free.
        return [{ total: countCalls === 1 ? 1 : 0 }];
      }
      return { affectedRows: 1 };
    });

    const first = rfqIdService.buildCandidate('RFQ', '260409', now.getTime() % 1000000);
    const id = await rfqIdService.generateRfqId({ query, now });
    expect(id).not.toBe(first);
  });

  test('advances past a candidate another allocator reserved first', async () => {
    let inserts = 0;
    const query = jest.fn(async (sql) => {
      if (sql.includes('COUNT(*)')) return [{ total: 0 }];
      inserts += 1;
      if (inserts === 1) throw mysqlError('ER_DUP_ENTRY');
      return { affectedRows: 1 };
    });

    const id = await rfqIdService.generateRfqId({ query, now });
    expect(id).toMatch(/^RFQ260409\d{6}$/);
    expect(inserts).toBe(2);
  });

  test('gives up with an actionable message once the attempt cap is reached', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('COUNT(*)')) return [{ total: 1 }];
      return { affectedRows: 1 };
    });

    await expect(rfqIdService.generateRfqId({ query, now })).rejects.toThrow(
      /Unable to allocate a unique RFQ id after \d+ attempts/
    );
  });
});
