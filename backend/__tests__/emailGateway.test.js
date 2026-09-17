const request = require('supertest');
const app = require('../src/app');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const emailIngestionService = require('../src/services/emailIngestionService');
const geminiService = require('../src/services/geminiService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const dbPool = require('../src/db/pool');
const {
  EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  resolveBuyerSourcingMode,
  BUYER_SUBSCRIPTION_TO_SOURCING_MODE,
} = require('../src/config/constants');
const { authHeader } = require('./testHelpers');
const fixtures = require('./fixtures/sampleRequisitionEmail');
const taxonomyFixture = require('./fixtures/categoryTaxonomy');

// ==============================================================================
// AUTONOMOUS EMAIL INGESTION GATEWAY
// ==============================================================================
// The gateway reuses the parser and extractor wholesale, so this suite is about
// the three things only it decides: who is allowed to raise a requisition by
// email, that a message is never ingested twice, and that an ingested RFQ is
// parked for review rather than circulated to vendors.
// ==============================================================================

const { INGESTION_OUTCOME } = emailGatewayQueries;

const FULL_ENV = {
  EMAIL_GATEWAY_ENABLED: 'true',
  EMAIL_GATEWAY_HOST: 'imap.gmail.com',
  EMAIL_GATEWAY_USER: 'intake@procucev.com',
  EMAIL_GATEWAY_PASSWORD: 'app-password',
};

const SENDER = 'project.procurement@lt-heavy.com';

function buyerAccount(overrides = {}) {
  return {
    id: 'buyer-acc-101',
    organizationName: 'L&T Heavy Engineering',
    corporateEmail: SENDER,
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    ...overrides,
  };
}

/** A minimal ImapFlow double: one unseen message carrying `source`. */
function fakeImap({ uids = [1], source = fixtures.PLAIN_REQUISITION_EML, messageId = '<m1@lt-heavy.com>', failConnect = false } = {}) {
  const flagged = [];
  const client = {
    connect: jest.fn(failConnect ? () => Promise.reject(new Error('authentication failed')) : async () => {}),
    getMailboxLock: jest.fn(async () => ({ release: jest.fn() })),
    search: jest.fn(async () => uids),
    fetchOne: jest.fn(async () => (source === null ? null : { source: Buffer.from(source, 'utf8'), envelope: { messageId } })),
    messageFlagsAdd: jest.fn(async (uid, flags) => {
      flagged.push([uid, flags]);
      return true;
    }),
    logout: jest.fn(async () => {}),
    flagged,
  };
  return client;
}

describe('emailGatewayService.resolveConfig', () => {
  test('defaults to disabled with a two-minute interval', () => {
    const config = emailGatewayService.resolveConfig({});
    expect(config.enabled).toBe(false);
    expect(config.mailbox).toBe('INBOX');
    expect(config.pollIntervalMs).toBe(EMAIL_GATEWAY_CONFIG.DEFAULT_POLL_MS);
    expect(config.maxPerPoll).toBe(EMAIL_GATEWAY_CONFIG.DEFAULT_MAX_PER_POLL);
    expect(config.secure).toBe(true);
  });

  // Each poll opens a connection and may call Gemini per message, so a
  // misconfigured interval must not be honoured.
  test('clamps the interval to the floor', () => {
    const config = emailGatewayService.resolveConfig({ EMAIL_GATEWAY_POLL_MS: '1000' });
    expect(config.pollIntervalMs).toBe(EMAIL_GATEWAY_CONFIG.MIN_POLL_MS);
  });

  test('honours an interval above the floor', () => {
    expect(emailGatewayService.resolveConfig({ EMAIL_GATEWAY_POLL_MS: '600000' }).pollIntervalMs).toBe(600000);
  });

  test('never drops below one message per poll', () => {
    expect(emailGatewayService.resolveConfig({ EMAIL_GATEWAY_MAX_PER_POLL: '0' }).maxPerPoll).toBe(1);
  });

  test('parses the allow-lists into lowercase entries', () => {
    const config = emailGatewayService.resolveConfig({
      EMAIL_GATEWAY_ALLOWED_SENDERS: ' A@B.com , c@d.com ,, ',
      EMAIL_GATEWAY_ALLOWED_DOMAINS: 'LT-Heavy.com',
    });
    expect(config.allowedSenders).toEqual(['a@b.com', 'c@d.com']);
    expect(config.allowedDomains).toEqual(['lt-heavy.com']);
  });

  test('allows TLS to be switched off explicitly', () => {
    expect(emailGatewayService.resolveConfig({ EMAIL_GATEWAY_SECURE: 'false' }).secure).toBe(false);
  });

  test.each([
    ['nothing set', {}, false],
    ['host only', { EMAIL_GATEWAY_HOST: 'h' }, false],
    ['no password', { EMAIL_GATEWAY_HOST: 'h', EMAIL_GATEWAY_USER: 'u' }, false],
    ['all three', FULL_ENV, true],
  ])('isConfigured with %s is %p', (_label, env, expected) => {
    expect(emailGatewayService.isConfigured(emailGatewayService.resolveConfig(env))).toBe(expected);
  });
});

// ── The security control ──────────────────────────────────────────────────────
// Without this, anyone who learns the intake address could inject RFQs and reach
// the vendor panel. It is also a functional bar: an RFQ with no buyerAccountId
// would appear on nobody's dashboard.
describe('emailGatewayService.resolveSenderAuthorisation', () => {
  afterEach(() => jest.restoreAllMocks());

  const config = (env = {}) => emailGatewayService.resolveConfig({ ...FULL_ENV, ...env });

  test('refuses a message with no sender address', () => {
    const result = emailGatewayService.resolveSenderAuthorisation('', config());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(EMAIL_GATEWAY_MESSAGES.SENDER_MISSING);
  });

  test('allows a sender registered as a buyer account', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    const result = emailGatewayService.resolveSenderAuthorisation(SENDER, config());
    expect(result.allowed).toBe(true);
    expect(result.buyerAccount.id).toBe('buyer-acc-101');
  });

  test('refuses a sender with no buyer account', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(null);
    const result = emailGatewayService.resolveSenderAuthorisation('stranger@example.com', config());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No buyer account is registered');
  });

  test('matches the address case-insensitively', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    expect(emailGatewayService.resolveSenderAuthorisation(SENDER.toUpperCase(), config()).allowed).toBe(true);
  });

  test('an explicit sender list excludes everyone else', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    const cfg = config({ EMAIL_GATEWAY_ALLOWED_SENDERS: 'someone.else@corp.com' });
    const result = emailGatewayService.resolveSenderAuthorisation(SENDER, cfg);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not on EMAIL_GATEWAY_ALLOWED_SENDERS');
  });

  test('an explicit sender list still requires an owning account', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(null);
    const cfg = config({ EMAIL_GATEWAY_ALLOWED_SENDERS: SENDER });
    const result = emailGatewayService.resolveSenderAuthorisation(SENDER, cfg);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No buyer account is registered');
  });

  test('a listed sender with an account is allowed', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    const cfg = config({ EMAIL_GATEWAY_ALLOWED_SENDERS: SENDER });
    expect(emailGatewayService.resolveSenderAuthorisation(SENDER, cfg).allowed).toBe(true);
  });

  test('a domain list narrows the baseline rule', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    const cfg = config({ EMAIL_GATEWAY_ALLOWED_DOMAINS: 'other.com' });
    const result = emailGatewayService.resolveSenderAuthorisation(SENDER, cfg);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not on EMAIL_GATEWAY_ALLOWED_DOMAINS');
  });

  test('a sender on a listed domain with an account is allowed', () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    const cfg = config({ EMAIL_GATEWAY_ALLOWED_DOMAINS: 'lt-heavy.com' });
    expect(emailGatewayService.resolveSenderAuthorisation(SENDER, cfg).allowed).toBe(true);
  });
});

describe('emailGatewayService.processMessage', () => {
  beforeEach(() => {
    rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rfqIngestionService.resetTaxonomyIndex();
  });

  const raw = () => Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8');
  const config = () => emailGatewayService.resolveConfig(FULL_ENV);

  const mockExtraction = (overrides = {}) =>
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      model: 'gemini-test',
      documentTitle: 'Centrifugal Pumps',
      lineItems: [{ itemName: 'Centrifugal Pump 150 m3/hr', quantity: 4, unit: 'Nos' }],
      ...overrides,
    });

  // The whole point of holding these: nothing has reviewed an inbound message, so
  // it must not reach vendors automatically.
  test('raises the RFQ in the review status, not as awaiting quotes', async () => {
    mockExtraction();
    const created = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-1', rfqNumber: 'RFQ-2026-0001' });

    const result = await emailGatewayService.processMessage(raw(), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    const [payload, account] = created.mock.calls[0];
    expect(payload.status).toBe(EMAIL_GATEWAY_CONFIG.INGESTED_STATUS);
    expect(payload.status).not.toBe('Quotes Pending');
    // Buyer's own roster only; widening the pool is a commercial decision.
    expect(payload.sourcingMode).toBe(EMAIL_GATEWAY_CONFIG.INGESTED_SOURCING_MODE);
    expect(payload.source).toBe('email_gateway');
    expect(payload.sourceEmail).toBe(SENDER);
    expect(account.id).toBe('buyer-acc-101');
    expect(result.rfq.rfqNumber).toBe('RFQ-2026-0001');
  });

  test('refuses a message the parser cannot read', async () => {
    const result = await emailGatewayService.processMessage(Buffer.from(''), config());
    expect(result.status).toBe(INGESTION_OUTCOME.UNREADABLE);
    expect(result.detail).toContain('could not be read');
  });

  test('refuses an unauthorised sender before calling the extractor', async () => {
    storeService.getBuyerAccountByEmail.mockReturnValue(null);
    const extract = mockExtraction();

    const result = await emailGatewayService.processMessage(raw(), config());

    expect(result.status).toBe(INGESTION_OUTCOME.SENDER_NOT_ALLOWED);
    // Quota is not spent on a message that was never going to be accepted.
    expect(extract).not.toHaveBeenCalled();
  });

  test('records a failed extraction', async () => {
    mockExtraction({ status: geminiService.EXTRACTION_STATUS.NOT_CONFIGURED, lineItems: [] });
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
  });

  test('records a message whose rows were all discarded', async () => {
    // Rows with no description are dropped by the shared normaliser.
    mockExtraction({ lineItems: [{ quantity: 4, unit: 'Nos' }] });
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    expect(result.detail).toBe(EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED);
  });

  test('accepts a base64 string as well as a buffer', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-2', rfqNumber: 'RFQ-2026-0002' });

    const result = await emailGatewayService.processMessage(
      Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8').toString('base64'),
      config()
    );

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
  });

  test('dispatches RFQ acknowledgement email to buyer upon successful RFQ creation', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-ack', rfqNumber: 'RFQ-ACK-001', title: 'Ack Test RFQ' });
    const sendAckSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: true });

    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(sendAckSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: SENDER,
        rfqNumber: 'RFQ-ACK-001',
      })
    );
  });

  test('catches errors gracefully if RFQ acknowledgement email fails to send', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-err', rfqNumber: 'RFQ-ERR-001', title: 'Err RFQ' });
    jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockRejectedValueOnce(new Error('SMTP connection timed out'));

    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
  });

  test('catches errors gracefully if unauthorized buyer notification email fails to send', async () => {
    storeService.getBuyerAccountByEmail.mockReturnValue(null);
    jest.spyOn(mailerService, 'sendUnauthorizedBuyerNotificationEmail').mockRejectedValueOnce(new Error('SMTP down'));
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.SENDER_NOT_ALLOWED);
  });

  test('handles buyerName variations and empty accepted line items', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-var', rfqNumber: 'RFQ-VAR' });
    const sendAckSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: true });

    // 1. With contactPerson
    storeService.getBuyerAccountByEmail.mockReturnValueOnce(buyerAccount({ contactPerson: 'Jane Doe' }));
    await emailGatewayService.processMessage(raw(), config());
    expect(sendAckSpy).toHaveBeenCalledWith(expect.objectContaining({ buyerName: 'Jane Doe' }));

    // 2. Without contactPerson, but with organizationName
    storeService.getBuyerAccountByEmail.mockReturnValueOnce({
      id: 'b2',
      organizationName: 'Acme Industries',
      corporateEmail: SENDER,
    });
    await emailGatewayService.processMessage(raw(), config());
    expect(sendAckSpy).toHaveBeenCalledWith(expect.objectContaining({ buyerName: 'Acme Industries' }));

    // 3. When classification accepted is 0 for groups
    jest.spyOn(rfqIngestionService, 'buildRFQDraft').mockResolvedValueOnce({
      draft: {},
      classification: { accepted: 0, needsReview: 0 },
    });
    const res = await emailGatewayService.processMessage(raw(), config());
    expect(res.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);

    // 4. When processLineItemsAndGroups returns empty groups
    jest.spyOn(emailGatewayService, 'processLineItemsAndGroups').mockReturnValueOnce([]);
    const resEmpty = await emailGatewayService.processMessage(raw(), config());
    expect(resEmpty.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    expect(resEmpty.detail).toBe(EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED);
  });
});

describe('emailGatewayService.pollOnce', () => {
  let originalImap;

  beforeEach(() => {
    rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    originalImap = emailGatewayService.ImapFlow;
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-1', rfqNumber: 'RFQ-2026-0001' });
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      model: 'gemini-test',
      lineItems: [{ itemName: 'Centrifugal Pump 150 m3/hr', quantity: 4, unit: 'Nos' }],
    });
  });

  afterEach(() => {
    emailGatewayService.ImapFlow = originalImap;
    emailGatewayService.runtime.isPolling = false;
    jest.restoreAllMocks();
    rfqIngestionService.resetTaxonomyIndex();
  });

  const withEnv = async (env, fn) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      return await fn();
    } finally {
      process.env = saved;
    }
  };

  test('does nothing when no mailbox is configured', async () => {
    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig({}));
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe(EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED);
  });

  // A slow extraction must not let two passes fetch the same unseen message.
  test('refuses to overlap with a run already in progress', async () => {
    emailGatewayService.runtime.isPolling = true;
    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe(EMAIL_GATEWAY_MESSAGES.POLL_ALREADY_RUNNING);
  });

  test('ingests an unseen message and marks it seen afterwards', async () => {
    const client = fakeImap();
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.ingested).toBe(1);
    expect(result.considered).toBe(1);
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ status: INGESTION_OUTCOME.INGESTED, rfqNumber: 'RFQ-2026-0001' })
    );
    // Flagged only after the ledger write, so a failed write leaves it to retry.
    expect(client.messageFlagsAdd).toHaveBeenCalledWith('1', ['\\Seen']);
    expect(client.logout).toHaveBeenCalled();
  });

  test('skips a message already in the ledger without re-ingesting it', async () => {
    emailGatewayQueries.hasProcessed.mockResolvedValue(true);
    const client = fakeImap();
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.ingested).toBe(0);
    expect(storeService.createRFQ).not.toHaveBeenCalled();
    // Still flagged, so it is not reconsidered on every future poll.
    expect(client.messageFlagsAdd).toHaveBeenCalledWith('1', ['\\Seen']);
  });

  test('caps the batch and reports the remainder as pending', async () => {
    const client = fakeImap({ uids: [1, 2, 3, 4, 5] });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(
      emailGatewayService.resolveConfig({ ...FULL_ENV, EMAIL_GATEWAY_MAX_PER_POLL: '2' })
    );

    expect(result.considered).toBe(2);
    expect(result.pending).toBe(3);
  });

  test('reports a connection failure through the result rather than throwing', async () => {
    emailGatewayService.ImapFlow = jest.fn(() => fakeImap({ failConnect: true }));

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.error).toContain('authentication failed');
    expect(emailGatewayService.runtime.lastError).toContain('authentication failed');
  });

  test('records a message whose body could not be fetched', async () => {
    const client = fakeImap({ source: null });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.UNREADABLE);
    expect(result.ingested).toBe(0);
  });

  test('one unusable message does not abort the batch', async () => {
    const client = fakeImap({ uids: [1, 2] });
    let call = 0;
    client.fetchOne = jest.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('fetch exploded');
      return { source: Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), envelope: { messageId: '<m2@x.com>' } };
    });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.considered).toBe(2);
    expect(result.ingested).toBe(1);
    expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.FAILED);
  });

  test('synthesises a ledger key when the message carries no Message-ID', async () => {
    const client = fakeImap({ messageId: null });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    const recorded = emailGatewayQueries.recordProcessed.mock.calls[0][0];
    expect(recorded.messageId).toBeTruthy();
  });

  test('tolerates a mailbox with nothing unseen', async () => {
    const client = fakeImap({ uids: [] });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.considered).toBe(0);
    expect(result.ingested).toBe(0);
  });

  test('records multiple comma-separated rfqNumbers when processMessage returns multiple RFQs', async () => {
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValueOnce({
      status: INGESTION_OUTCOME.INGESTED,
      rfqs: [{ id: 'rfq-1', rfqNumber: 'RFQ-1' }, { id: 'rfq-2', rfqNumber: 'RFQ-2' }],
      rfq: { id: 'rfq-1', rfqNumber: 'RFQ-1' },
      message: { messageId: '<multi-rfq@corp.com>', fromAddress: 'buyer@corp.com' },
    });
    const client = fakeImap({ uids: [10], messageId: '<multi-rfq@corp.com>' });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));
    expect(result.ingested).toBe(1);
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ rfqNumber: 'RFQ-1, RFQ-2' })
    );
  });
});

describe('emailGatewayService start and stop', () => {
  afterEach(() => {
    emailGatewayService.stopPolling();
    jest.restoreAllMocks();
  });

  test('does not start when switched off', () => {
    const result = emailGatewayService.startPolling(
      emailGatewayService.resolveConfig({ ...FULL_ENV, EMAIL_GATEWAY_ENABLED: 'false' })
    );
    expect(result).toEqual({ started: false, reason: EMAIL_GATEWAY_MESSAGES.DISABLED });
  });

  test('does not start when unconfigured', () => {
    const result = emailGatewayService.startPolling(
      emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true' })
    );
    expect(result).toEqual({ started: false, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED });
  });

  test('starts once and refuses to start twice', () => {
    const config = emailGatewayService.resolveConfig(FULL_ENV);
    expect(emailGatewayService.startPolling(config).started).toBe(true);
    expect(emailGatewayService.startPolling(config)).toEqual({
      started: false,
      reason: EMAIL_GATEWAY_MESSAGES.ALREADY_STARTED,
    });
    expect(emailGatewayService.stopPolling()).toBe(true);
    // Safe to call again when nothing is running.
    expect(emailGatewayService.stopPolling()).toBe(false);
  });
});

describe('emailGatewayService.getStatus', () => {
  let origEnv;
  beforeEach(() => {
    origEnv = { ...process.env };
    delete process.env.EMAIL_GATEWAY_HOST;
    delete process.env.EMAIL_GATEWAY_USER;
    delete process.env.EMAIL_GATEWAY_PASSWORD;
    delete process.env.EMAIL_GATEWAY_ENABLED;
  });
  afterEach(() => {
    process.env = origEnv;
    jest.restoreAllMocks();
  });

  test('reports an unconfigured gateway without touching the ledger', async () => {
    const counts = jest.spyOn(emailGatewayQueries, 'countsByStatus');
    const status = await emailGatewayService.getStatus();

    expect(status.configured).toBe(false);
    expect(status.recent).toEqual([]);
    expect(counts).not.toHaveBeenCalled();
    expect(status.ingestedStatus).toBe(EMAIL_GATEWAY_CONFIG.INGESTED_STATUS);
  });

  // Credentials must never leave the server.
  test('never includes the mailbox password', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, FULL_ENV);
    jest.spyOn(emailGatewayQueries, 'countsByStatus').mockResolvedValue({ INGESTED: 2 });
    jest.spyOn(emailGatewayQueries, 'listRecent').mockResolvedValue([]);
    try {
      const status = await emailGatewayService.getStatus();
      expect(status.mailboxUser).toBe('intake@procucev.com');
      expect(JSON.stringify(status)).not.toContain('app-password');
      expect(status.counts).toEqual({ INGESTED: 2 });
    } finally {
      process.env = saved;
    }
  });
});

describe('emailGatewayQueries', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('treats a message with no id as unprocessed', async () => {
    await expect(emailGatewayQueries.hasProcessed('')).resolves.toBe(false);
  });

  test('reports a known message as processed', async () => {
    jest.spyOn(dbPool, 'rows').mockResolvedValue([{ '1': 1 }]);
    await expect(emailGatewayQueries.hasProcessed('<a@b.com>')).resolves.toBe(true);
  });

  test('reports an unknown message as unprocessed', async () => {
    jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
    await expect(emailGatewayQueries.hasProcessed('<a@b.com>')).resolves.toBe(false);
  });

  // Fails closed: skipping a requisition is recoverable, a duplicate RFQ reaching
  // vendors is not.
  test('treats an unreadable ledger as already processed', async () => {
    jest.spyOn(dbPool, 'rows').mockRejectedValue(new Error('db down'));
    await expect(emailGatewayQueries.hasProcessed('<a@b.com>')).resolves.toBe(true);
  });

  test('records an outcome and truncates oversized fields', async () => {
    const query = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
    await expect(
      emailGatewayQueries.recordProcessed({
        messageId: '<a@b.com>',
        status: INGESTION_OUTCOME.INGESTED,
        detail: 'd'.repeat(3000),
        subject: 's'.repeat(3000),
        fromAddress: 'f'.repeat(400),
      })
    ).resolves.toBe(true);

    const params = query.mock.calls[0][1];
    expect(params[3].length).toBe(320);
    expect(params[4].length).toBe(2000);
    expect(params[6].length).toBe(2000);
  });

  test('skips a record with no message id', async () => {
    await expect(emailGatewayQueries.recordProcessed({ messageId: '' })).resolves.toBe(false);
  });

  test('reports a failed ledger write rather than throwing', async () => {
    jest.spyOn(dbPool, 'query').mockRejectedValue(new Error('db down'));
    await expect(
      emailGatewayQueries.recordProcessed({ messageId: '<a@b.com>', status: 'FAILED' })
    ).resolves.toBe(false);
  });

  test('lists recent entries with a bounded limit', async () => {
    const rows = jest.spyOn(dbPool, 'rows').mockResolvedValue([{ message_id: '<a@b.com>' }]);
    await emailGatewayQueries.listRecent(1000);
    expect(rows.mock.calls[0][1]).toEqual([100]);
    await emailGatewayQueries.listRecent(0);
    expect(rows.mock.calls[1][1]).toEqual([15]);
  });

  test('returns an empty list when the ledger cannot be read', async () => {
    jest.spyOn(dbPool, 'rows').mockRejectedValue(new Error('db down'));
    await expect(emailGatewayQueries.listRecent()).resolves.toEqual([]);
  });

  test('tallies outcomes by status', async () => {
    jest.spyOn(dbPool, 'rows').mockResolvedValue([
      { status: 'INGESTED', total: 3 },
      { status: 'FAILED', total: 1 },
    ]);
    await expect(emailGatewayQueries.countsByStatus()).resolves.toEqual({ INGESTED: 3, FAILED: 1 });
  });

  test('returns no counts when the ledger cannot be read', async () => {
    jest.spyOn(dbPool, 'rows').mockRejectedValue(new Error('db down'));
    await expect(emailGatewayQueries.countsByStatus()).resolves.toEqual({});
  });
});

describe('gateway endpoints', () => {
  let origEnv;
  beforeEach(() => {
    origEnv = { ...process.env };
    delete process.env.EMAIL_GATEWAY_HOST;
    delete process.env.EMAIL_GATEWAY_USER;
    delete process.env.EMAIL_GATEWAY_PASSWORD;
    delete process.env.EMAIL_GATEWAY_ENABLED;
  });
  afterEach(() => {
    process.env = origEnv;
    jest.restoreAllMocks();
  });

  test('status requires a session', async () => {
    const res = await request(app).get('/api/rfqs/email-gateway/status');
    expect(res.status).toBe(401);
  });

  test('status reports the gateway state', async () => {
    const res = await request(app).get('/api/rfqs/email-gateway/status').set(authHeader('buyer'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('configured');
    expect(res.body.data).toHaveProperty('ingestedStatus');
  });

  test('status surfaces an unexpected fault', async () => {
    jest.spyOn(emailGatewayService, 'getStatus').mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/rfqs/email-gateway/status').set(authHeader('buyer'));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  test('poll requires a session', async () => {
    const res = await request(app).post('/api/rfqs/email-gateway/poll');
    expect(res.status).toBe(401);
  });

  // Switched off is an expected state, not a failure.
  test('poll reports a skipped run as a conflict', async () => {
    const res = await request(app).post('/api/rfqs/email-gateway/poll').set(authHeader('buyer'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED);
  });

  test('poll reports a mailbox failure as a bad gateway', async () => {
    jest.spyOn(emailGatewayService, 'pollOnce').mockResolvedValue({ error: 'authentication failed' });
    const res = await request(app).post('/api/rfqs/email-gateway/poll').set(authHeader('buyer'));
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('authentication failed');
  });

  test('poll returns the run summary', async () => {
    jest
      .spyOn(emailGatewayService, 'pollOnce')
      .mockResolvedValue({ skipped: false, considered: 3, ingested: 2, pending: 1, outcomes: [] });
    const res = await request(app).post('/api/rfqs/email-gateway/poll').set(authHeader('buyer'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ considered: 3, ingested: 2, pending: 1 });
  });

  test('poll surfaces an unexpected fault', async () => {
    jest.spyOn(emailGatewayService, 'pollOnce').mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/rfqs/email-gateway/poll').set(authHeader('buyer'));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

// ==============================================================================
// REMAINING BRANCHES
// ==============================================================================
// The interval callback, and the paths taken when a message or its ledger write is
// incomplete. These are the cases that only occur in production — a timer firing,
// a message with no parseable sender, a fetch that fails before an id is known.
// ==============================================================================

describe('emailGatewayService interval callback', () => {
  afterEach(() => {
    emailGatewayService.stopPolling();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('the timer invokes a poll on each tick', () => {
    jest.useFakeTimers();
    const poll = jest.spyOn(emailGatewayService, 'pollOnce').mockResolvedValue({ skipped: true });

    emailGatewayService.startPolling(emailGatewayService.resolveConfig(FULL_ENV));
    // The default interval, not the floor: FULL_ENV sets no override.
    jest.advanceTimersByTime(EMAIL_GATEWAY_CONFIG.DEFAULT_POLL_MS + 1);

    expect(poll).toHaveBeenCalled();
  });

  // A rejected poll inside the timer has no caller to surface it, so it must be
  // logged rather than becoming an unhandled rejection that kills the process.
  test('a poll that rejects inside the timer is swallowed and logged', async () => {
    jest.useFakeTimers();
    jest.spyOn(emailGatewayService, 'pollOnce').mockRejectedValue(new Error('poll exploded'));

    emailGatewayService.startPolling(emailGatewayService.resolveConfig(FULL_ENV));
    jest.advanceTimersByTime(EMAIL_GATEWAY_CONFIG.DEFAULT_POLL_MS + 1);

    // Flush the rejection handler without advancing wall-clock time.
    await Promise.resolve();
    await Promise.resolve();
    expect(emailGatewayService.runtime.pollTimer).not.toBeNull();
  });
});

describe('emailGatewayService.pollOnce edge paths', () => {
  let originalImap;

  beforeEach(() => {
    rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    originalImap = emailGatewayService.ImapFlow;
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
  });

  afterEach(() => {
    emailGatewayService.ImapFlow = originalImap;
    emailGatewayService.runtime.isPolling = false;
    jest.restoreAllMocks();
    rfqIngestionService.resetTaxonomyIndex();
  });

  // The id is only known after the fetch, so a fetch that throws has nothing to
  // key the ledger on and must not attempt a write with an empty key.
  test('does not write to the ledger when the fetch failed before an id was known', async () => {
    const client = fakeImap();
    client.fetchOne = jest.fn(async () => {
      throw new Error('fetch exploded');
    });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.FAILED);
    expect(emailGatewayQueries.recordProcessed).not.toHaveBeenCalled();
  });

  test('records a failure against the id when one was already read', async () => {
    const client = fakeImap();
    let call = 0;
    client.fetchOne = jest.fn(async () => {
      call += 1;
      if (call === 1) return { source: Buffer.from('x'), envelope: { messageId: '<known@x.com>' } };
      throw new Error('unused');
    });
    jest
      .spyOn(emailIngestionService, 'prepareEmailForExtraction')
      .mockRejectedValue(new Error('prepare exploded'));
    emailGatewayService.ImapFlow = jest.fn(() => client);

    await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: '<known@x.com>', status: INGESTION_OUTCOME.FAILED })
    );
  });

  // A refusal before the headers are parsed carries no sender or subject.
  test('records an outcome with no sender when the message never parsed', async () => {
    const client = fakeImap({ source: 'not a message at all' });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    const recorded = emailGatewayQueries.recordProcessed.mock.calls[0][0];
    expect(recorded.status).toBe(INGESTION_OUTCOME.UNREADABLE);
    expect(recorded.fromAddress).toBeNull();
    expect(recorded.rfqId).toBeNull();
  });

  test('tolerates a search that returns nothing at all', async () => {
    const client = fakeImap();
    client.search = jest.fn(async () => undefined);
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.considered).toBe(0);
    expect(result.pending).toBe(0);
  });

  test('a logout failure does not mask the run result', async () => {
    const client = fakeImap({ uids: [] });
    client.logout = jest.fn(async () => {
      throw new Error('already disconnected');
    });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    const result = await emailGatewayService.pollOnce(emailGatewayService.resolveConfig(FULL_ENV));

    expect(result.considered).toBe(0);
    expect(emailGatewayService.runtime.isPolling).toBe(false);
  });
});

describe('emailGatewayService configuration helpers and connection diagnostics', () => {
  test('describeConfigurationFault identifies SMTP hosts and ports', () => {
    expect(
      emailGatewayService.describeConfigurationFault({ host: 'smtp.gmail.com', port: 993 })
    ).toContain('smtp.gmail.com');

    expect(
      emailGatewayService.describeConfigurationFault({ host: 'imap.gmail.com', port: 587 })
    ).toContain('587');

    expect(
      emailGatewayService.describeConfigurationFault({ host: 'imap.gmail.com', port: 993 })
    ).toBeNull();
  });

  test('describeConnectionError categorizes known network and auth errors', () => {
    expect(
      emailGatewayService.describeConnectionError(new Error('wrong version number in SSL routines'))
    ).toBe(EMAIL_GATEWAY_MESSAGES.TLS_VERSION_MISMATCH);

    expect(
      emailGatewayService.describeConnectionError(new Error('Invalid credentials'))
    ).toBe(EMAIL_GATEWAY_MESSAGES.AUTH_REJECTED);

    expect(
      emailGatewayService.describeConnectionError(new Error('getaddrinfo ENOTFOUND'))
    ).toBe(EMAIL_GATEWAY_MESSAGES.HOST_UNRESOLVED);

    expect(
      emailGatewayService.describeConnectionError(new Error('connect ECONNREFUSED'))
    ).toBe(EMAIL_GATEWAY_MESSAGES.HOST_UNREACHABLE);

    expect(
      emailGatewayService.describeConnectionError(new Error('unable to verify the first certificate'))
    ).toBe(EMAIL_GATEWAY_MESSAGES.CERTIFICATE_REJECTED);

    expect(
      emailGatewayService.describeConnectionError(new Error('Unknown generic error'))
    ).toBe(EMAIL_GATEWAY_MESSAGES.CONNECTION_FAILED_FALLBACK);
  });

  test('resolveConnectionState determines correct UI connection states', () => {
    const unconfigured = emailGatewayService.resolveConfig({});
    expect(emailGatewayService.resolveConnectionState(unconfigured)).toBe('NOT_CONFIGURED');

    const smtpConfig = { ...emailGatewayService.resolveConfig(FULL_ENV), host: 'smtp.gmail.com' };
    expect(emailGatewayService.resolveConnectionState(smtpConfig)).toBe('CONNECTION_ERROR');

    const disabledConfig = { ...emailGatewayService.resolveConfig(FULL_ENV), enabled: false };
    expect(emailGatewayService.resolveConnectionState(disabledConfig)).toBe('SWITCHED_OFF');

    const errorConfig = emailGatewayService.resolveConfig(FULL_ENV);
    expect(
      emailGatewayService.resolveConnectionState(errorConfig, { lastError: 'Some error' })
    ).toBe('CONNECTION_ERROR');

    expect(
      emailGatewayService.resolveConnectionState(errorConfig, { watching: true })
    ).toBe('ACTIVE_LISTENING');

    expect(
      emailGatewayService.resolveConnectionState(errorConfig, { watching: false })
    ).toBe('SWITCHED_OFF');
  });

  test('startPolling stops on configuration faults', () => {
    const smtpConfig = { ...emailGatewayService.resolveConfig(FULL_ENV), host: 'smtp.gmail.com' };
    const res = emailGatewayService.startPolling(smtpConfig);
    expect(res.started).toBe(false);
    expect(res.reason).toContain('smtp.gmail.com');
  });

  test('pollOnce refuses execution when configuration fault is present', async () => {
    const smtpConfig = { ...emailGatewayService.resolveConfig(FULL_ENV), host: 'smtp.gmail.com' };
    const res = await emailGatewayService.pollOnce(smtpConfig);
    expect(res.skipped).toBe(true);
    expect(res.reason).toContain('smtp.gmail.com');
  });

  test('handles default arguments and edge cases in helpers', () => {
    expect(typeof emailGatewayService.isConfigured()).toBe('boolean');
    expect(emailGatewayService.describeConfigurationFault()).toBeNull();
    expect(emailGatewayService.describeConnectionError(null)).toBe(EMAIL_GATEWAY_MESSAGES.CONNECTION_FAILED_FALLBACK);
    expect(emailGatewayService.describeConnectionError({})).toBe(EMAIL_GATEWAY_MESSAGES.CONNECTION_FAILED_FALLBACK);
    expect(typeof emailGatewayService.resolveSenderAuthorisation('test@corp.com').allowed).toBe('boolean');
    expect(
      emailGatewayService.resolveSenderAuthorisation('noatsign', { allowedDomains: ['corp.com'], allowedSenders: [] })
        .allowed
    ).toBe(false);
  });
});

describe('emailGatewayService.resolveBuyerRegisteredLocation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('resolves location directly from buyer account fields when present', async () => {
    const loc = await emailGatewayService.resolveBuyerRegisteredLocation({
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560001',
    });
    expect(loc).toEqual({ city: 'Bangalore', state: 'Karnataka', pincode: '560001' });
  });

  test('resolves location using deliveryCity/deliveryState/deliveryPincode aliases', async () => {
    const loc = await emailGatewayService.resolveBuyerRegisteredLocation({
      deliveryCity: 'Chennai',
      deliveryState: 'Tamil Nadu',
      deliveryPincode: '600001',
    });
    expect(loc).toEqual({ city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' });
  });

  test('queries Neon PostgreSQL buyer profile when account fields are empty', async () => {
    const origPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(dbPool, 'rows').mockResolvedValue([
      {
        user_uuid: 'u-1',
        username: 'buyer@corp.com',
        user_email: 'buyer@corp.com',
        city: 'Mysore',
        state: 'Karnataka',
        zip_code: '570001',
      },
    ]);

    try {
      const loc = await emailGatewayService.resolveBuyerRegisteredLocation({
        corporateEmail: 'buyer@corp.com',
      });
      expect(loc).toEqual({ city: 'Mysore', state: 'Karnataka', pincode: '570001' });
    } finally {
      dbPool.pool = origPool;
    }
  });

  test('handles database errors gracefully and returns empty fields', async () => {
    const origPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(dbPool, 'rows').mockRejectedValue(new Error('DB connection failed'));

    try {
      const loc = await emailGatewayService.resolveBuyerRegisteredLocation({
        corporateEmail: 'buyer@corp.com',
      });
      expect(loc).toEqual({ city: '', state: '', pincode: '' });
    } finally {
      dbPool.pool = origPool;
    }
  });

  test('returns empty strings when buyer account is null', async () => {
    const loc = await emailGatewayService.resolveBuyerRegisteredLocation(null);
    expect(loc).toEqual({ city: '', state: '', pincode: '' });
  });
});

describe('emailGatewayService.processLineItemsAndGroups', () => {
  const buyerLoc = { city: 'Bangalore', state: 'Karnataka', pincode: '560001' };

  test('preserves partial location and does NOT replace Pune with Bangalore', () => {
    const rawItems = [{ itemName: 'Laptop', deliveryCity: 'Pune' }];
    const groups = emailGatewayService.processLineItemsAndGroups(rawItems, {}, buyerLoc);

    expect(groups).toHaveLength(1);
    expect(groups[0].deliveryCity).toBe('Pune');
    expect(groups[0].deliveryState).toBe('');
    expect(groups[0].deliveryPincode).toBe('');
    expect(groups[0].deliveryCity).not.toBe('Bangalore');
  });

  test('applies registered buyer location when item has no location at all', () => {
    const rawItems = [{ itemName: 'Monitor' }];
    const groups = emailGatewayService.processLineItemsAndGroups(rawItems, {}, buyerLoc);

    expect(groups).toHaveLength(1);
    expect(groups[0].deliveryCity).toBe('Bangalore');
    expect(groups[0].deliveryState).toBe('Karnataka');
    expect(groups[0].deliveryPincode).toBe('560001');
  });

  test('groups items with same date and location into a single group', () => {
    const rawItems = [
      { itemName: 'Item 1', targetDate: '2026-10-01', deliveryCity: 'Bangalore' },
      { itemName: 'Item 2', targetDate: '2026-10-01', deliveryCity: 'Bangalore' },
    ];
    const groups = emailGatewayService.processLineItemsAndGroups(rawItems, {}, buyerLoc);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  test('splits items with different delivery dates into separate groups', () => {
    const rawItems = [
      { itemName: 'Item 1', targetDate: '2026-10-01', deliveryCity: 'Bangalore' },
      { itemName: 'Item 2', targetDate: '2026-10-05', deliveryCity: 'Bangalore' },
    ];
    const groups = emailGatewayService.processLineItemsAndGroups(rawItems, {}, buyerLoc);

    expect(groups).toHaveLength(2);
    expect(groups[0].targetDate).toBe('2026-10-01');
    expect(groups[1].targetDate).toBe('2026-10-05');
  });

  test('splits items with different delivery locations into separate groups', () => {
    const rawItems = [
      { itemName: 'Item 1', targetDate: '2026-10-01', deliveryCity: 'Bangalore' },
      { itemName: 'Item 2', targetDate: '2026-10-01', deliveryCity: 'Hyderabad' },
    ];
    const groups = emailGatewayService.processLineItemsAndGroups(rawItems, {}, buyerLoc);

    expect(groups).toHaveLength(2);
    expect(groups[0].deliveryCity).toBe('Bangalore');
    expect(groups[1].deliveryCity).toBe('Hyderabad');
  });

  test('uses deliveryLocation as deliveryCity when deliveryCity is not provided', () => {
    const rawItems = [{ itemName: 'Laptop', deliveryLocation: 'Pune' }];
    const groups = emailGatewayService.processLineItemsAndGroups(rawItems, {}, buyerLoc);
    expect(groups[0].deliveryCity).toBe('Pune');
  });
});

describe('Email-to-RFQ Flow: Required Edge Cases (Tests 1 - 12)', () => {
  beforeEach(() => {
    rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation((email) => {
      if (email === SENDER) return buyerAccount();
      return null;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rfqIngestionService.resetTaxonomyIndex();
  });

  const config = () => emailGatewayService.resolveConfig(FULL_ENV);

  test('TEST 1: Single item + date provided + location provided -> uses email date and location', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t1', rfqNumber: 'RFQ-T1' });
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [
        {
          itemName: 'Industrial Pump',
          quantity: 2,
          unit: 'Nos',
          targetDate: '2026-10-15',
          deliveryCity: 'Mumbai',
          deliveryState: 'Maharashtra',
          deliveryPincode: '400001',
        },
      ],
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.targetDeliveryDate).toBe('2026-10-15');
    expect(payload.deliveryCity).toBe('Mumbai');
    expect(payload.deliveryState).toBe('Maharashtra');
    expect(payload.deliveryPincode).toBe('400001');
  });

  test('TEST 2: Single item + date missing + location provided -> date = current date + 5 days', async () => {
    const expectedDate = rfqIngestionService.defaultTargetDate(5);
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t2', rfqNumber: 'RFQ-T2' });
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [
        {
          itemName: 'Industrial Pump',
          quantity: 2,
          unit: 'Nos',
          targetDate: null,
          deliveryCity: 'Pune',
          deliveryState: 'Maharashtra',
          deliveryPincode: '411001',
        },
      ],
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.targetDeliveryDate).toBe(expectedDate);
    expect(payload.deliveryCity).toBe('Pune');
    expect(payload.deliveryState).toBe('Maharashtra');
    expect(payload.deliveryPincode).toBe('411001');
  });

  test('TEST 3: Single item + date provided + location missing -> location = buyer registration default location', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t3', rfqNumber: 'RFQ-T3' });
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [
        {
          itemName: 'Industrial Pump',
          quantity: 2,
          unit: 'Nos',
          targetDate: '2026-10-20',
          deliveryCity: '',
          deliveryState: '',
          deliveryPincode: '',
        },
      ],
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.targetDeliveryDate).toBe('2026-10-20');
    expect(payload.deliveryCity).toBe('Bangalore');
    expect(payload.deliveryState).toBe('Karnataka');
    expect(payload.deliveryPincode).toBe('560001');
  });

  test('TEST 4: Single item + date missing + location missing -> date = current + 5 days & location = buyer registration', async () => {
    const expectedDate = rfqIngestionService.defaultTargetDate(5);
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t4', rfqNumber: 'RFQ-T4' });
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [
        {
          itemName: 'Dell Laptop',
          quantity: 10,
          unit: 'Nos',
        },
      ],
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.targetDeliveryDate).toBe(expectedDate);
    expect(payload.deliveryCity).toBe('Bangalore');
    expect(payload.deliveryState).toBe('Karnataka');
    expect(payload.deliveryPincode).toBe('560001');
  });

  test('TEST 5: 5 items + same date + same location -> 1 RFQ with 5 line items', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t5', rfqNumber: 'RFQ-T5' });
    const items = Array.from({ length: 5 }, (_, i) => ({
      itemName: `Component Item ${i + 1}`,
      quantity: (i + 1) * 5,
      unit: 'Nos',
      targetDate: '2026-10-15',
      deliveryCity: 'Bangalore',
      deliveryState: 'Karnataka',
      deliveryPincode: '560001',
    }));

    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: items,
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.extractedEntities).toHaveLength(5);
  });

  test('TEST 6: 49 items + same date + same location -> 1 RFQ with exactly 49 line items', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t6', rfqNumber: 'RFQ-T6' });
    const items = Array.from({ length: 49 }, (_, i) => ({
      itemName: `Equipment Line Item ${i + 1}`,
      quantity: i + 1,
      unit: 'Nos',
      brand: i % 2 === 0 ? 'Dell' : 'HP',
      specifications: `Specification details for equipment line item ${i + 1}`,
      targetDate: '2026-10-15',
      deliveryCity: 'Bangalore',
      deliveryState: 'Karnataka',
      deliveryPincode: '560001',
    }));

    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: items,
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.extractedEntities).toHaveLength(49);
    expect(payload.extractedEntities[0].quantity).toBe(1);
    expect(payload.extractedEntities[48].quantity).toBe(49);
    expect(payload.extractedEntities[0].brand).toBe('Dell');
  });

  test('TEST 7: Multiple items + different dates -> grouped into separate RFQs', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockImplementation((data) => ({
      id: `rfq-${data.targetDeliveryDate}`,
      rfqNumber: `RFQ-${data.targetDeliveryDate}`,
    }));

    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [
        { itemName: 'Laptop Batch A', quantity: 10, unit: 'Nos', targetDate: '2026-09-21', deliveryCity: 'Bangalore' },
        { itemName: 'Printer Batch B', quantity: 5, unit: 'Nos', targetDate: '2026-09-25', deliveryCity: 'Bangalore' },
      ],
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.rfqs).toHaveLength(2);
    expect(result.rfqs[0].targetDeliveryDate || createSpy.mock.calls[0][0].targetDeliveryDate).toBe('2026-09-21');
    expect(result.rfqs[1].targetDeliveryDate || createSpy.mock.calls[1][0].targetDeliveryDate).toBe('2026-09-25');
  });

  test('TEST 8: Multiple items + different locations -> grouped into separate RFQs', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockImplementation((data) => ({
      id: `rfq-${data.deliveryCity}`,
      rfqNumber: `RFQ-${data.deliveryCity}`,
    }));

    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [
        { itemName: 'Server Unit', quantity: 2, unit: 'Nos', targetDate: '2026-09-21', deliveryCity: 'Bangalore' },
        { itemName: 'Router Unit', quantity: 4, unit: 'Nos', targetDate: '2026-09-21', deliveryCity: 'Hyderabad' },
      ],
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.rfqs).toHaveLength(2);
    expect(createSpy.mock.calls[0][0].deliveryCity).toBe('Bangalore');
    expect(createSpy.mock.calls[1][0].deliveryCity).toBe('Hyderabad');
  });

  test('TEST 9: 49 items + missing date + missing location -> all use default date and buyer location', async () => {
    const expectedDate = rfqIngestionService.defaultTargetDate(5);
    const createSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-t9', rfqNumber: 'RFQ-T9' });
    const items = Array.from({ length: 49 }, (_, i) => ({
      itemName: `Stationery Pack ${i + 1}`,
      quantity: 10 + i,
      unit: 'Nos',
    }));

    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: items,
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [payload] = createSpy.mock.calls[0];
    expect(payload.extractedEntities).toHaveLength(49);
    expect(payload.targetDeliveryDate).toBe(expectedDate);
    expect(payload.deliveryCity).toBe('Bangalore');
    expect(payload.deliveryState).toBe('Karnataka');
    expect(payload.deliveryPincode).toBe('560001');
  });

  test('TEST 10: 50 items -> rejected by 49-item limit validation with no silent data loss', async () => {
    const createSpy = jest.spyOn(storeService, 'createRFQ');
    const items = Array.from({ length: 50 }, (_, i) => ({
      itemName: `Bulk Line Item ${i + 1}`,
      quantity: 1,
      unit: 'Nos',
      targetDate: '2026-10-15',
      deliveryCity: 'Bangalore',
    }));

    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: items,
    });

    const result = await emailGatewayService.processMessage(Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT);
    expect(result.detail).toContain('Maximum 49 line items per RFQ exceeded (received 50).');
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('TEST 11: Unregistered buyer -> registration notification sent, no Gemini call, no RFQ created', async () => {
    const createRfqSpy = jest.spyOn(storeService, 'createRFQ');
    const mailerSpy = jest.spyOn(mailerService, 'sendUnauthorizedBuyerNotificationEmail');
    const geminiSpy = jest.spyOn(geminiService, 'extractLineItems');

    const unregEml = fixtures.PLAIN_REQUISITION_EML.split(SENDER).join('stranger.buyer@outside.org');
    const result = await emailGatewayService.processMessage(Buffer.from(unregEml, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.SENDER_NOT_ALLOWED);
    expect(mailerSpy).toHaveBeenCalledWith('stranger.buyer@outside.org', expect.anything());
    expect(geminiSpy).not.toHaveBeenCalled();
    expect(createRfqSpy).not.toHaveBeenCalled();
  });

  test('TEST 12: Same email processed twice -> duplicate rejected, no second RFQ created', async () => {
    const client = fakeImap({ uids: [88], source: fixtures.PLAIN_REQUISITION_EML, messageId: '<msg-dup-12@lt-heavy.com>' });
    emailGatewayService.ImapFlow = jest.fn(() => client);

    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
    let hasProcessedFlag = false;
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockImplementation(async (mid) => {
      return hasProcessedFlag && mid === '<msg-dup-12@lt-heavy.com>';
    });

    const createRfqSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-dup', rfqNumber: 'RFQ-DUP-12' });
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      lineItems: [{ itemName: 'Centrifugal Pump', quantity: 2, unit: 'Nos' }],
    });

    // Poll 1: First time processed -> Ingested and RFQ created
    const poll1 = await emailGatewayService.pollOnce(config());
    expect(poll1.ingested).toBe(1);
    expect(createRfqSpy).toHaveBeenCalledTimes(1);

    // Ledger records completion
    hasProcessedFlag = true;

    // Poll 2: Scheduler polls mailbox again
    const client2 = fakeImap({ uids: [88], source: fixtures.PLAIN_REQUISITION_EML, messageId: '<msg-dup-12@lt-heavy.com>' });
    emailGatewayService.ImapFlow = jest.fn(() => client2);

    const poll2 = await emailGatewayService.pollOnce(config());
    expect(poll2.ingested).toBe(0);
    expect(poll2.outcomes[0].status).toBe(EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED);
    // Verified: Exactly 1 RFQ created across both poll runs
    expect(createRfqSpy).toHaveBeenCalledTimes(1);
  });

  describe('Subscription-Based Sourcing Mode Resolution (resolveBuyerSourcingMode)', () => {
    beforeEach(() => {
      rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      rfqIngestionService.resetTaxonomyIndex();
    });

    const raw = () => Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8');
    const config = () => emailGatewayService.resolveConfig(FULL_ENV);

    const mockExtraction = (overrides = {}) =>
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-test',
        documentTitle: 'Centrifugal Pumps',
        lineItems: [{ itemName: 'Centrifugal Pump 150 m3/hr', quantity: 4, unit: 'Nos' }],
        ...overrides,
      });

    test('resolves version_1 plan to mode_1', () => {
      expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_1' })).toBe('mode_1');
      expect(resolveBuyerSourcingMode('version_1')).toBe('mode_1');
      expect(resolveBuyerSourcingMode('v1')).toBe('mode_1');
      expect(resolveBuyerSourcingMode('mode_1')).toBe('mode_1');
    });

    test('resolves version_2 plan to mode_2', () => {
      expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_2' })).toBe('mode_2');
      expect(resolveBuyerSourcingMode('version_2')).toBe('mode_2');
      expect(resolveBuyerSourcingMode('v2')).toBe('mode_2');
      expect(resolveBuyerSourcingMode('mode_2')).toBe('mode_2');
    });

    test('resolves version_3 plan to mode_3', () => {
      expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_3' })).toBe('mode_3');
      expect(resolveBuyerSourcingMode('version_3')).toBe('mode_3');
      expect(resolveBuyerSourcingMode('v3')).toBe('mode_3');
      expect(resolveBuyerSourcingMode('mode_3')).toBe('mode_3');
    });

    test('defaults to mode_2 for free_trial, unknown plan, or empty account', () => {
      expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial' })).toBe('mode_2');
      expect(resolveBuyerSourcingMode({ subscriptionPlan: 'unknown_plan' })).toBe('mode_2');
      expect(resolveBuyerSourcingMode({})).toBe('mode_2');
      expect(resolveBuyerSourcingMode(null)).toBe('mode_2');
      expect(resolveBuyerSourcingMode(undefined)).toBe('mode_2');
      expect(resolveBuyerSourcingMode(42)).toBe('mode_2');
    });

    test('processMessage assigns mode_1 for buyer on version_1 plan', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount({ subscriptionPlan: 'version_1' }));
      const created = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-v1', rfqNumber: 'RFQ-V1-0001' });

      const result = await emailGatewayService.processMessage(raw(), config());

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      const [payload] = created.mock.calls[0];
      expect(payload.sourcingMode).toBe('mode_1');
    });

    test('processMessage assigns mode_3 for buyer on version_3 plan', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount({ subscriptionPlan: 'version_3' }));
      const created = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-v3', rfqNumber: 'RFQ-V3-0001' });

      const result = await emailGatewayService.processMessage(raw(), config());

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      const [payload] = created.mock.calls[0];
      expect(payload.sourcingMode).toBe('mode_3');
    });

    test('processMessage defaults to mode_2 for buyer on free_trial plan', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount({ subscriptionPlan: 'free_trial' }));
      const created = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-trial', rfqNumber: 'RFQ-TRIAL-0001' });

      const result = await emailGatewayService.processMessage(raw(), config());

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      const [payload] = created.mock.calls[0];
      expect(payload.sourcingMode).toBe('mode_2');
    });
  });
});


