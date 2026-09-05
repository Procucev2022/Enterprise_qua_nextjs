const {
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  DATABASE_HEALTH_SERVICE_LABEL,
  SYSTEM_ACTOR_EMAIL,
  RFQ_DEFAULTS,
} = require('../config/constants');
const pool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const { createAuditEntry, verifyAuditTrail } = require('./auditService');
const { evaluateQuotes, calculate360Evaluation, calculateRevisedRating } = require('./evaluationService');
const { simulateChaserOutreach } = require('./aiChaserService');
const geminiService = require('./geminiService');
const { logger } = require('./loggerService');

class StoreService {
  constructor() {
    // Every collection starts empty and is filled from Neon by hydrateFromDB().
    //
    // Nothing here is seeded. The vendor, evaluation and catalogue seeds this
    // constructor used to inflate — five invented supplier companies with
    // contact names, phone numbers and ratings, one fabricated 360° audit, and
    // three demo SKUs — were indistinguishable from real records once loaded:
    // they appeared in the vendor master, in category dashboards and in RFQ
    // vendor selection, and the buyer had no way to tell which suppliers
    // actually existed. Buyer accounts were worse: the seed shipped four real
    // company names with invented spend and `activeBuyerAccount` was simply
    // `buyerAccounts[0]`, so whoever signed in, the dashboard attributed their
    // work to the first seeded company.
    //
    // An empty collection now means exactly that — no rows — and is reported as
    // such rather than back-filled.
    this.buyerAccounts = [];
    this.activeBuyerAccount = null;
    this.vendors = [];
    this.buyerVendors = [];
    this.rfqs = [];
    this.evaluations = [];
    this.auditLogs = [];
    this.aiFeed = [];
    this.vendorCatalogue = [];
    this.systemConfig = JSON.parse(JSON.stringify(INITIAL_SYSTEM_CONFIG));
    this.azureHealth = JSON.parse(JSON.stringify(INITIAL_AZURE_HEALTH));
    this.isHydratedFromDB = false;
  }

  /**
   * Load every domain collection from Neon.
   *
   * Assignment is unconditional: an empty table overwrites the in-memory copy
   * with an empty array. That is the whole point of the change — the previous
   * version applied each collection only `if (rows.length > 0)`, which meant an
   * empty table silently left the seed in place and the API then served invented
   * records while reporting itself healthy.
   *
   * `isHydratedFromDB` now reports whether the read *succeeded*, not whether it
   * happened to return rows, so a legitimately empty database is still "loaded
   * from the database" rather than being mislabelled as an in-memory fallback.
   *
   * A missing DATABASE_URL or a failed read is surfaced to the caller instead of
   * being swallowed: there is no second datastore to fall back to.
   */
  async hydrateFromDB() {
    if (!pool.pool) {
      this.isHydratedFromDB = false;
      logger.error(
        'DATABASE_URL is not set — no records can be loaded and every data-backed request will fail.',
        null,
        'STORE_SERVICE'
      );
      return { hydrated: false, source: 'not_configured', error: pool.NOT_CONFIGURED_MESSAGE };
    }

    try {
      const [vendors, rfqs, evaluations, vendorCatalogue, buyerAccountsResult, aiFeed, auditLogs, buyerVendors] = await Promise.all([
        domainQueries.getVendorsFromDB(),
        domainQueries.getRFQsFromDB(),
        domainQueries.getEvaluationsFromDB(),
        domainQueries.getVendorCatalogueFromDB(),
        domainQueries.getBuyerAccountsFromDB(),
        domainQueries.getAIFeedFromDB(),
        domainQueries.getAuditLogsFromDB(),
        typeof domainQueries.getBuyerVendorsFromDB === 'function'
          ? domainQueries.getBuyerVendorsFromDB()
          : Promise.resolve([]),
      ]);

      this.vendors = vendors;
      this.buyerVendors = buyerVendors || [];
      this.rfqs = rfqs;
      this.evaluations = evaluations;
      this.vendorCatalogue = vendorCatalogue;
      this.buyerAccounts = buyerAccountsResult.accounts;
      // activeBuyerAccount must stay a reference into this.buyerAccounts (the
      // same invariant every mutator keeps), not a separately-hydrated duplicate.
      this.activeBuyerAccount =
        this.buyerAccounts.find((a) => a.id === buyerAccountsResult.activeId) || this.buyerAccounts[0] || null;
      this.aiFeed = aiFeed;
      this.auditLogs = auditLogs;

      this.isHydratedFromDB = true;
      // The admin infrastructure list should describe the connection this load
      // just used, not a placeholder, so it is refreshed off the same boot.
      await this.refreshInfrastructureHealth().catch((err) =>
        logger.warn('Infrastructure health probe failed after hydration', { error: err.message }, 'STORE_SERVICE')
      );
      logger.info(
        'Domain records loaded from PostgreSQL',
        {
          vendors: vendors.length,
          buyerVendors: this.buyerVendors.length,
          rfqs: rfqs.length,
          evaluations: evaluations.length,
          vendorCatalogue: vendorCatalogue.length,
          buyerAccounts: this.buyerAccounts.length,
          aiFeed: aiFeed.length,
          auditLogs: auditLogs.length,
        },
        'STORE_SERVICE'
      );
      return { hydrated: true, source: 'postgres' };
    } catch (err) {
      logger.error('Failed to load domain records from PostgreSQL', err, 'STORE_SERVICE');
      this.isHydratedFromDB = false;
      return { hydrated: false, source: 'unavailable', error: err.message };
    }
  }

  // Fire-and-forget write-through helpers — never awaited by callers, mirroring
  // the pattern already used for identity-DB writes elsewhere in this backend.
  _persistVendor(vendor) {
    domainQueries.upsertVendorInDB(vendor).catch((err) => logger.error('Failed to persist vendor', err, 'STORE_SERVICE'));
  }

  _removeVendor(id) {
    domainQueries.deleteVendorInDB(id).catch((err) => logger.error('Failed to delete persisted vendor', err, 'STORE_SERVICE'));
  }

  _persistBuyerVendor(buyerVendor) {
    domainQueries
      .upsertBuyerVendorInDB(buyerVendor)
      .catch((err) => logger.error('Failed to persist buyer vendor', err, 'STORE_SERVICE'));
  }

  _removeBuyerVendor(id) {
    domainQueries
      .deleteBuyerVendorInDB(id)
      .catch((err) => logger.error('Failed to delete persisted buyer vendor', err, 'STORE_SERVICE'));
  }

  _persistRFQ(rfq) {
    domainQueries.upsertRFQInDB(rfq).catch((err) => logger.error('Failed to persist RFQ', err, 'STORE_SERVICE'));
  }

  _removeRFQ(id) {
    domainQueries.deleteRFQInDB(id).catch((err) => logger.error('Failed to delete persisted RFQ', err, 'STORE_SERVICE'));
  }

  _persistEvaluation(evaluation) {
    domainQueries
      .upsertEvaluationInDB(evaluation)
      .catch((err) => logger.error('Failed to persist evaluation', err, 'STORE_SERVICE'));
  }

  _persistCatalogueProduct(product) {
    domainQueries
      .upsertCatalogueProductInDB(product)
      .catch((err) => logger.error('Failed to persist catalogue product', err, 'STORE_SERVICE'));
  }

  _removeCatalogueProduct(id) {
    domainQueries
      .deleteCatalogueProductInDB(id)
      .catch((err) => logger.error('Failed to delete persisted catalogue product', err, 'STORE_SERVICE'));
  }

  _persistBuyerAccount(account) {
    domainQueries
      .upsertBuyerAccountInDB(account)
      .catch((err) => logger.error('Failed to persist buyer account', err, 'STORE_SERVICE'));
  }

  _removeBuyerAccount(id) {
    domainQueries
      .deleteBuyerAccountInDB(id)
      .catch((err) => logger.error('Failed to delete persisted buyer account', err, 'STORE_SERVICE'));
  }

  _setActiveBuyerAccount(id) {
    domainQueries
      .setActiveBuyerAccountInDB(id)
      .catch((err) => logger.error('Failed to persist active buyer account', err, 'STORE_SERVICE'));
  }

  _persistAIFeedItem(item) {
    domainQueries
      .upsertAIFeedItemInDB(item)
      .catch((err) => logger.error('Failed to persist AI feed item', err, 'STORE_SERVICE'));
  }

  _persistAuditLog(entry) {
    domainQueries
      .upsertAuditLogInDB(entry)
      .catch((err) => logger.error('Failed to persist audit log entry', err, 'STORE_SERVICE'));
  }

  // ==========================================
  // 1. BUYER ACCOUNTS
  // ==========================================
  getBuyerAccounts() {
    return this.buyerAccounts;
  }

  getActiveBuyerAccount() {
    return this.activeBuyerAccount;
  }

  /** Resolves a buyer account by its login email, case-insensitively. */
  getBuyerAccountByEmail(email) {
    if (!email) return null;
    const target = email.toLowerCase();
    return this.buyerAccounts.find((a) => (a.corporateEmail || '').toLowerCase() === target) || null;
  }

  addBuyerAccount(accData) {
    const newAcc = {
      ...accData,
      id: accData.id || `buyer-acc-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      totalRFQsCreated: accData.totalRFQsCreated || 0,
      totalSpend: accData.totalSpend || '$0',
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      createdDate: accData.createdDate || new Date().toISOString().substring(0, 10),
      status: accData.status || 'ACTIVE_VERIFIED',
      sourcingMode: accData.sourcingMode || 'mode_1',
      subscriptionPlan: accData.subscriptionPlan || 'free_trial',
      remainingFreeRFQs: accData.remainingFreeRFQs !== undefined ? accData.remainingFreeRFQs : 5,
    };

    this.buyerAccounts.unshift(newAcc);
    this._persistBuyerAccount(newAcc);
    this.addAuditLog({
      userEmail: newAcc.corporateEmail,
      action: `Created buyer account for ${newAcc.organizationName} (${newAcc.corporateEmail})`,
    });

    return newAcc;
  }

  updateBuyerAccount(id, updates) {
    const idx = this.buyerAccounts.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    const updated = {
      ...this.buyerAccounts[idx],
      ...updates,
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    this.buyerAccounts[idx] = updated;
    this._persistBuyerAccount(updated);

    if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
      this.activeBuyerAccount = updated;
    }

    return updated;
  }

  deleteBuyerAccount(id) {
    const beforeLen = this.buyerAccounts.length;
    this.buyerAccounts = this.buyerAccounts.filter((a) => a.id !== id);
    if (this.buyerAccounts.length < beforeLen) {
      this._removeBuyerAccount(id);
      if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
        this.activeBuyerAccount = this.buyerAccounts[0] || null;
        if (this.activeBuyerAccount) this._setActiveBuyerAccount(this.activeBuyerAccount.id);
      }
      return true;
    }
    return false;
  }

  alignActiveBuyerAccount(id) {
    const target = this.buyerAccounts.find((a) => a.id === id);
    if (!target) return null;
    this.activeBuyerAccount = target;
    this._setActiveBuyerAccount(id);
    return target;
  }

  // ==========================================
  // 2. VENDORS
  // ==========================================
  getVendors() {
    return this.vendors;
  }

  getVendorById(id) {
    return this.vendors.find((v) => v.id === id || v.email === id);
  }

  addVendor(vendorData, actorEmail = null) {
    // A client-supplied id was previously trusted as-is (never checked for
    // uniqueness) and the auto-generated fallback was only the last 4 digits
    // of Date.now() — collision-prone within the same ~10s window, and a
    // deliberate duplicate `id` in the request body would shadow an existing
    // vendor for every future id-based lookup (getVendorById/updateVendor
    // resolve by the *first* array match). The id is now always generated
    // server-side; nothing in the app currently has a legitimate reason to
    // request a specific vendor id.
    const { id: _ignoredClientId, ...safeVendorData } = vendorData;
    const newVendor = {
      ...safeVendorData,
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      rating: vendorData.rating || 4.5,
      score: vendorData.score || 85.0,
      source: vendorData.source || 'buyer_manual',
      status: vendorData.status || 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: vendorData.evaluated !== undefined ? vendorData.evaluated : false,
      hasRecord: vendorData.hasRecord !== undefined ? vendorData.hasRecord : false,
      isExistingInDatabase: vendorData.isExistingInDatabase !== undefined ? vendorData.isExistingInDatabase : true,
      onboardingEmailStatus: vendorData.onboardingEmailStatus || 'sent',
      isCategoryAligned: vendorData.isCategoryAligned !== undefined ? vendorData.isCategoryAligned : true,
      // Every vendor starts on the free client-uploaded tier with a clean
      // download counter — these used to exist only as frontend useState
      // (reset on every page refresh, never actually persisted or enforced).
      subscriptionPlan: vendorData.subscriptionPlan || 'premium',
      rfqDownloadsUsed: vendorData.rfqDownloadsUsed || 0,
    };

    this.vendors.unshift(newVendor);
    this._persistVendor(newVendor);
    this.addAuditLog({
      // The signed-in caller when the controller could resolve one. Falls back to
      // the system marker rather than naming a fabricated procurement mailbox.
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Registered vendor ${newVendor.name} in category ${newVendor.majorCategory}`,
    });

    return newVendor;
  }

  updateVendor(id, updates) {
    const idx = this.vendors.findIndex((v) => v.id === id || v.email === id);
    if (idx === -1) return null;

    // A client payload must never be able to reassign the record's primary
    // key (would corrupt this.vendors' id-uniqueness and orphan the old id).
    const { id: _ignoredId, ...safeUpdates } = updates;
    const updated = { ...this.vendors[idx], ...safeUpdates };
    this.vendors[idx] = updated;
    this._persistVendor(updated);

    return updated;
  }

  deleteVendor(id, actorEmail = null) {
    const target = this.vendors.find((v) => v.id === id);
    const beforeLen = this.vendors.length;
    this.vendors = this.vendors.filter((v) => v.id !== id);
    if (this.vendors.length < beforeLen) {
      this._removeVendor(id);
      // Deletion was the only vendor mutation that wrote no audit entry, so a
      // vendor disappearing from the master left no record of who removed it or
      // when — the addVendor and updateVendor paths both log, and the removal of
      // a supplier is the change most worth being able to account for.
      this.addAuditLog({
        userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
        action: `Removed vendor ${target ? target.name : id} (${target && target.email ? target.email : 'no email on record'}) from the vendor master`,
      });
      return true;
    }
    return false;
  }

  reviseVendorRating(vendorId, ratingData) {
    const vendor = this.getVendorById(vendorId);
    if (!vendor) return null;

    // Nothing here is defaulted to an invented buyer. A revision is a record of
    // who rated whom, so an unattributed one is stored as unattributed (null)
    // rather than credited to a placeholder company and contact name.
    const { qualityScore, costScore, deliveryScore, remarks, buyerCompany, buyerName, buyerEmail } = ratingData;
    const { buyerAverage, newCompositeScore, newRating } = calculateRevisedRating({
      qualityScore: Number(qualityScore),
      costScore: Number(costScore),
      deliveryScore: Number(deliveryScore),
      previousScore: Number(vendor.score || 85),
    });

    const revisionRecord = {
      id: `rev-${Date.now()}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      buyerCompany: buyerCompany || null,
      buyerName: buyerName || null,
      buyerEmail: buyerEmail || null,
      timestamp: new Date().toISOString(),
      qualityScore,
      costScore,
      deliveryScore,
      buyerAverage,
      previousScore: vendor.score || 85,
      newCompositeScore,
      previousRating: vendor.rating || 4.5,
      newRating,
      remarks: remarks || 'Periodic Buyer Rating Assessment',
      emailDispatched: true,
      shaSignature: `sha256-${Date.now()}`,
    };

    const history = vendor.ratingRevisionHistory || [];
    history.unshift(revisionRecord);

    const updatedVendor = this.updateVendor(vendor.id, {
      score: newCompositeScore,
      rating: newRating,
      latestRatingRevision: revisionRecord,
      ratingRevisionHistory: history,
    });

    this.addAuditLog({
      userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
      action: `Revised vendor rating for ${vendor.name}: ${vendor.rating} -> ${newRating} (Score: ${newCompositeScore})`,
    });

    return { updatedVendor, revisionRecord };
  }

  // ==========================================
  // 3. RFQS
  // ==========================================
  getRFQs() {
    return this.rfqs;
  }

  getRFQById(id) {
    return this.rfqs.find((r) => r.id === id || r.rfqNumber === id);
  }

  createRFQ(rfqData, requestingBuyerAccount = null) {
    const nextNum = this.rfqs.length + 893;
    const rfqNumber = rfqData.rfqNumber || `RFQ-2026-0${nextNum}`;
    const id = rfqData.id || `rfq-${Date.now()}`;

    const newRFQ = {
      id,
      rfqNumber,
      title: rfqData.title || 'Untitled RFQ',
      // Not defaulted to a category the buyer never chose: 'Engineering Spares -
      // Mechanical' used to be substituted here, which silently mis-filed the RFQ
      // and routed it to the wrong vendor pool.
      category: rfqData.category || null,
      createdAt: rfqData.createdAt || new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      // No hardcoded fallback date. A fixed '2026-09-20' was previously stamped on
      // any RFQ that arrived without one, so an RFQ could show a deadline the
      // buyer had not set — and one that was already in the past.
      deadline: rfqData.deadline || rfqData.targetDeliveryDate || null,
      // Budget was previously dropped here, so an RFQ saved through the API came
      // back from hydration with no budget at all: the portfolio value totalled
      // zero and the quote matrix crashed reading it. It is validated as a
      // required positive number by VALIDATION_SCHEMAS.createRFQ.
      budget: Number(rfqData.budget) || 0,
      // Vendors price freight against these, so they round-trip with the RFQ.
      deliveryLocation: rfqData.deliveryLocation || '',
      deliveryPincode: rfqData.deliveryPincode || '',
      // Metadata only. The bytes live in object storage under
      // rfqAttachmentService, so the bootstrap payload stays a fixed size no
      // matter how much is attached.
      attachments: Array.isArray(rfqData.attachments) ? rfqData.attachments : [],
      // Provenance. All four of these were previously dropped here — the field
      // list below simply did not mention them — so every stored RFQ came back
      // with a null `source` and a null `sourceFileName`. That mattered twice
      // over: the RFQ details screen had no way to say where a record came from,
      // and the ingestion wizard's own documented fallback for the uploaded
      // document ("recorded as sourceFileName instead") could never have worked,
      // because the value never reached the database.
      source: rfqData.source || null,
      sourceFileName: rfqData.sourceFileName || null,
      sourceEmail: rfqData.sourceEmail || null,
      raisedByEmail: requestingBuyerAccount ? requestingBuyerAccount.corporateEmail : rfqData.raisedByEmail || null,
      status: rfqData.status || 'Quotes Pending',
      // Stamped from the authenticated caller's own buyer account (resolved
      // by the controller/resolver from the session, never trusted from the
      // client body) so an RFQ is attributed to whoever actually created it.
      // Falls back to the legacy system-wide "active" buyer account only for
      // callers that don't have a per-request buyer identity to resolve
      // (e.g. historical-data ingestion, admin-driven creation).
      buyerAccountId: requestingBuyerAccount
        ? requestingBuyerAccount.id
        : this.activeBuyerAccount ? this.activeBuyerAccount.id : null,
      buyerAccountName: requestingBuyerAccount
        ? requestingBuyerAccount.organizationName
        : this.activeBuyerAccount ? this.activeBuyerAccount.organizationName : null,
      sourcingMode: rfqData.sourcingMode || 'mode_1',
      quotesCount: rfqData.quotes ? rfqData.quotes.length : 0,
      chasingActive: rfqData.chasingActive !== undefined ? rfqData.chasingActive : true,
      allocatedTime: rfqData.allocatedTime || RFQ_DEFAULTS.ALLOCATED_TIME,
      elapsedTime: rfqData.elapsedTime || RFQ_DEFAULTS.ELAPSED_TIME,
      // A savings target is a commitment the buyer sets, not a number the system
      // invents. '12-18%' was previously stamped on every RFQ regardless.
      targetSavings: rfqData.targetSavings || null,
      quotes: evaluateQuotes(rfqData.quotes || []),
      // Real line items the buyer's document extraction produced. Previously
      // only the legacy `lineItems` key was read here, so a real RFQ created
      // through the actual app flow (which sends `extractedEntities`, the
      // RFQItem field) silently lost every item on persistence — the buyer's
      // own optimistic client state showed them, but a refresh (re-hydrated
      // from this persisted shape) showed none, and PO generation
      // (approvePurchaseOrder, which reads rfq.extractedEntities) produced
      // an empty line-item PO for any RFQ created this way.
      extractedEntities: rfqData.extractedEntities || rfqData.lineItems || [],
      // AI-generated headline/scope/risk-notes built from the line items above,
      // before the RFQ is constructed here (see rfqController.createRFQ) — a
      // deterministic fallback when there's nothing to summarise or the model
      // call fails, never fabricated content.
      aiSummary: rfqData.aiSummary || null,
      assignedVendors: rfqData.assignedVendors || [],
      // Counters start at zero and are driven up by real outreach. They used to be
      // seeded with a channel total of 3 and 3 messages already "delivered" on
      // every RFQ — including RFQs with no vendors assigned at all — so the
      // follow-up panel reported delivery for messages that were never sent.
      followUpData: rfqData.followUpData || {
        rfqNumber,
        totalInvited: (rfqData.assignedVendors || []).length,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: '0s' },
        whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: 0, delivered: 0, clicked: 0 },
        autoChasingEnabled: true,
        vendors: [],
      },
    };

    this.rfqs.unshift(newRFQ);
    this._persistRFQ(newRFQ);

    this.addAuditLog({
      // Attributed to the buyer account the controller resolved from the session.
      userEmail: requestingBuyerAccount
        ? requestingBuyerAccount.corporateEmail
        : this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Created ${rfqNumber} (${newRFQ.title}) under Sourcing ${newRFQ.sourcingMode}`,
      rfqNumber,
    });

    // Simulate multi-channel outreach actions
    if (newRFQ.assignedVendors && newRFQ.assignedVendors.length > 0) {
      newRFQ.assignedVendors.forEach((v) => {
        const chaserLogs = simulateChaserOutreach(newRFQ, v);
        chaserLogs.forEach((log) => this.addAIFeedItem(log));
      });
    }

    return newRFQ;
  }

  updateRFQ(id, updates) {
    const idx = this.rfqs.findIndex((r) => r.id === id || r.rfqNumber === id);
    if (idx === -1) return null;

    let quotes = updates.quotes ? evaluateQuotes(updates.quotes) : this.rfqs[idx].quotes;

    const updated = {
      ...this.rfqs[idx],
      ...updates,
      quotes,
      quotesCount: quotes.length,
    };
    this.rfqs[idx] = updated;
    this._persistRFQ(updated);

    return updated;
  }

  addQuoteToRFQ(rfqId, quote) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    // A resubmission from the same vendor replaces their previous quote on
    // this RFQ rather than piling up duplicates (nothing enforced this before).
    const existingQuotes = rfq.quotes || [];
    const quotes = quote.vendorId
      ? [...existingQuotes.filter((q) => q.vendorId !== quote.vendorId), quote]
      : [...existingQuotes, quote];
    return this.updateRFQ(rfq.id, { quotes });
  }

  deleteRFQ(id) {
    const beforeLen = this.rfqs.length;
    this.rfqs = this.rfqs.filter((r) => r.id !== id && r.rfqNumber !== id);
    const removed = this.rfqs.length < beforeLen;
    if (removed) this._removeRFQ(id);
    return removed;
  }

  // getRFQSummary was removed with the RFQ seeds. The portfolio roll-up now
  // lives in rfqSummaryService.buildPortfolioSummary, which is handed one
  // organisation's rows rather than reducing over a single global array, and
  // which no longer invents follow-up channel statistics.

  // ==========================================
  // 4. EVALUATIONS
  // ==========================================
  getEvaluations() {
    return this.evaluations;
  }

  createEvaluation(evalData) {
    const { moduleScores, overallScore, status, systemAction } = calculate360Evaluation(evalData.moduleScores || {});

    const newEval = {
      id: evalData.id || `eval-${Date.now()}`,
      vendorId: evalData.vendorId || `v-${Date.now()}`,
      // An evaluation identifies a real supplier or it identifies nobody. These
      // used to default to 'Enterprise Supplier' / 'vendor@supplier.com' /
      // '+91 98000 00000', which produced audit records that looked like a
      // genuine assessment of a company that did not exist.
      vendorName: evalData.vendorName || null,
      contactPerson: evalData.contactPerson || null,
      email: evalData.email || null,
      phone: evalData.phone || null,
      category: evalData.category || null,
      submissionDate: evalData.submissionDate || new Date().toISOString().substring(0, 10),
      status: evalData.status || status,
      overallScore: evalData.overallScore || overallScore,
      systemAction: evalData.systemAction || systemAction,
      moduleScores: evalData.moduleScores || moduleScores,
      documents: evalData.documents || [],
      // The per-question detail was previously silently dropped here even
      // though the client always sent it — only the rolled-up moduleScores
      // survived.
      questionBreakdown: evalData.questionBreakdown || [],
    };

    this.evaluations.unshift(newEval);
    this._persistEvaluation(newEval);

    this.addAuditLog({
      userEmail: evalData.actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Executed 360° AI Supplier Audit for ${newEval.vendorName || newEval.vendorId}: Score ${newEval.overallScore}% (${newEval.status})`,
    });

    return newEval;
  }

  // ==========================================
  // 5. AUDIT LOGS & CRYPTO VERIFICATION
  // ==========================================
  getAuditLogs() {
    return this.auditLogs;
  }

  addAuditLog({ userEmail, action, rfqNumber, ipAddress }) {
    const previousHash = this.auditLogs.length > 0 ? this.auditLogs[0].shaSignature : '';
    const entry = createAuditEntry({ userEmail, action, rfqNumber, ipAddress, previousHash });
    this.auditLogs.unshift(entry);
    this._persistAuditLog(entry);

    logger.audit(action, userEmail || 'system@procucev.ai', { rfqNumber, ipAddress, shaSignature: entry.shaSignature }, rfqNumber);

    return entry;
  }

  verifyAuditIntegrity() {
    return verifyAuditTrail(this.auditLogs);
  }

  // ==========================================
  // 6. AI BOT FEED
  // ==========================================
  getAIFeed() {
    return this.aiFeed;
  }

  addAIFeedItem(feedItem) {
    const item = {
      id: feedItem.id || `feed-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      timestamp: feedItem.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      timeAgo: feedItem.timeAgo || 'Just now',
      type: feedItem.type || 'call',
      channel: feedItem.channel || 'call',
      title: feedItem.title || 'AI Bot Event',
      message: feedItem.message || '',
      recipient: feedItem.recipient || 'Vendor Contact',
      rfqNumber: feedItem.rfqNumber || null,
      status: feedItem.status || 'delivered',
      channelDetails: feedItem.channelDetails || {},
    };

    this.aiFeed.unshift(item);
    if (this.aiFeed.length > 100) this.aiFeed.pop();
    // The DB-side upsert trims to the newest 100 rows itself (see
    // domainQueries.upsertAIFeedItemInDB), so it stays in sync with the
    // in-memory cap without needing to know which item .pop() just evicted.
    this._persistAIFeedItem(item);
    return item;
  }

  // ==========================================
  // 7. SYSTEM CONFIG & AZURE HEALTH
  // ==========================================
  getSystemConfig() {
    return this.systemConfig;
  }

  updateSystemConfig(updates) {
    this.systemConfig = { ...this.systemConfig, ...updates };
    return this.systemConfig;
  }

  getAzureHealth() {
    return this.azureHealth;
  }

  /**
   * Replace the database row in the infrastructure list with a live probe result.
   *
   * The row is reported from an actual connection attempt rather than asserted:
   * `latency` is the measured round trip and `status` reflects whether the query
   * succeeded. `uptime` is left as '—' because nothing in this process observes
   * it — the previous hardcoded '99.99%' was not measured from anything.
   */
  async refreshInfrastructureHealth() {
    const health = await pool.checkDatabaseHealth();
    const row = {
      service: health.isConfigured
        ? `${health.providerLabel}${health.database ? ` — ${health.database}` : ''}`
        : DATABASE_HEALTH_SERVICE_LABEL,
      status: health.isConnected ? 'ONLINE' : health.isConfigured ? 'UNREACHABLE' : 'NOT_CONFIGURED',
      latency: health.isConnected ? `${health.latencyMs}ms` : '—',
      uptime: '—',
      details: health.isConnected
        ? `${health.poolStatus}. ${health.userCount} active account(s), ${health.vendorCount} vendor(s), ${health.rfqCount} RFQ(s).`
        : health.errorMessage || 'Database connection failed.',
    };

    const idx = this.azureHealth.findIndex(
      (entry) => entry.service === DATABASE_HEALTH_SERVICE_LABEL || entry.service === row.service
    );
    if (idx === -1) {
      this.azureHealth.unshift(row);
    } else {
      this.azureHealth[idx] = row;
    }

    return health;
  }

  // ==========================================
  // 9. HISTORICAL PURCHASE DATA INGESTION & SETUP
  // ==========================================
  /**
   * Empanel suppliers from a buyer's historical purchase dump.
   *
   * Only what the dump actually contains is stored. Every missing field used to
   * be back-filled with an invention — a name of "Historical Supplier 3", an
   * address of "supplier.3@historical.com", a phone of "+91 98000 00000", a
   * category of "Engineering Spares - Mechanical", a location of "Industrial
   * Zone, India", a rating of 4.6 and a score of 88.0 — and the row was then
   * marked `evaluated: true`. The result was a vendor master full of suppliers
   * that could not be contacted, carrying scores nobody had assessed, which the
   * RFQ engine would then select against.
   *
   * A record without a company name and a contact email cannot identify a
   * supplier, so it is skipped and counted, and the caller is told how many were
   * rejected and why.
   */
  processHistoricalPurchaseData(period, vendorRecords = [], requestingBuyerAccount = null) {
    let importedCount = 0;
    const skipped = [];

    vendorRecords.forEach((rec, idx) => {
      const name = (rec.companyName || rec.name || '').trim();
      const email = (rec.email || '').trim();

      if (!name || !email) {
        skipped.push({
          row: idx + 1,
          reason: !name && !email
            ? 'Missing both company name and contact email.'
            : !name
              ? 'Missing company name.'
              : 'Missing contact email.',
        });
        return;
      }

      const existing = this.vendors.find(
        (v) => (v.email && v.email.toLowerCase() === email.toLowerCase()) ||
               (v.name && v.name.toLowerCase() === name.toLowerCase())
      );
      if (existing) return;

      const minorCategories = Array.isArray(rec.minorCategories) ? rec.minorCategories : [];
      const newVendor = {
        id: `v-hist-${Date.now()}-${idx}`,
        name,
        email,
        contactPerson: (rec.contactPerson || '').trim() || null,
        phone: (rec.phone || '').trim() || null,
        majorCategory: (rec.majorCategory || '').trim() || null,
        minorCategories,
        location: (rec.location || rec.address || '').trim() || null,
        // Absent, not assumed. A supplier arriving from a spend extract has not
        // been rated or audited by anyone yet.
        rating: Number.isFinite(Number(rec.rating)) ? Number(rec.rating) : null,
        score: Number.isFinite(Number(rec.score)) ? Number(rec.score) : null,
        source: 'historical_purchase_dump',
        status: 'PENDING EVALUATION',
        evaluated: false,
        hasRecord: true,
        isExistingInDatabase: true,
        onboardingEmailStatus: 'pending',
        clientMappedCategories: minorCategories,
        vendorSelectedCategories: [],
        // Nothing to align against until the vendor confirms their own categories.
        isCategoryAligned: false,
      };
      this.vendors.push(newVendor);
      this._persistVendor(newVendor);
      importedCount++;
    });

    // Attributed to the requesting buyer's own account when the controller
    // resolved one from the session (same convention as createRFQ).
    const attributedAccount = requestingBuyerAccount || this.activeBuyerAccount;
    this.addAuditLog({
      userEmail: attributedAccount ? attributedAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Processed ${period.replace('_', ' ')} historical purchase dump: ${importedCount} supplier(s) empanelled, ${skipped.length} row(s) rejected as unidentifiable.`,
    });

    return {
      success: true,
      importedCount,
      skippedCount: skipped.length,
      skipped,
      period,
      totalVendors: this.vendors.length,
    };
  }

  // ==========================================
  // 9B. BUYER VENDORS & AI CATEGORIZATION ENGINE
  // ==========================================

  getBuyerVendors(buyerOrgId = null) {
    if (!buyerOrgId) return this.buyerVendors;
    return this.buyerVendors.filter((bv) => bv.buyerOrgId === buyerOrgId);
  }

  getBuyerVendorById(id) {
    return this.buyerVendors.find((bv) => bv.id === id) || null;
  }

  /**
   * AI Categorization Engine
   * Joins Vendor Master (identity context) with PO Purchase Dump (purchasing signal).
   * Aggregates PO items, spend, frequency, and material descriptions within the time horizon.
   * Generates Primary Major Category, Minor Categories, Product Lines, and Confidence Scores.
   * Flag suppliers without PO transactions as "Self-Map Required".
   */
  async categorizeVendorsWithAI({ vendorMaster = [], poDump = [], period = '1_year', buyerOrgId = null }) {
    let aiModel = 'Procurement Neural Taxonomy Engine';
    const results = (vendorMaster || []).map((v, idx) => {
      const vendorCode = (v.vendorCode || v.code || '').trim();
      const companyName = (v.companyName || v.name || '').trim();
      const gstin = (v.gstin || v.gstNumber || '').trim();
      const email = (v.email || '').trim();
      const phone = (v.phone || '').trim();
      const contactPerson = (v.contactPerson || '').trim();
      const address = (v.address || v.location || '').trim();
      const rating = Number.isFinite(Number(v.vendorRatingScore ?? v.rating)) ? Number(v.vendorRatingScore ?? v.rating) : undefined;

      // Match PO Dump lines: Vendor Code -> GSTIN -> Company Name (case-insensitive substring)
      const matchingPOs = (poDump || []).filter((po) => {
        const ident = (po.vendorIdentifier || po.vendor || po.vendorName || po.vendorCode || '').toLowerCase().trim();
        if (!ident) return false;
        if (vendorCode && (ident === vendorCode.toLowerCase() || ident.includes(vendorCode.toLowerCase()))) return true;
        if (gstin && ident.includes(gstin.toLowerCase())) return true;
        if (companyName && (ident === companyName.toLowerCase() || ident.includes(companyName.toLowerCase()) || companyName.toLowerCase().includes(ident))) return true;
        return false;
      });

      const hasPoHistory = matchingPOs.length > 0;
      const poCount = matchingPOs.length;
      const totalSpend = matchingPOs.reduce((acc, po) => acc + (Number(po.totalSpend) || (Number(po.quantity) * Number(po.unitPrice)) || 0), 0);
      const items = matchingPOs.map((po) => `${po.itemName || po.itemDescription || po.description || po.materialDescription || po.item || ''} ${po.specs || po.specification || ''}`.trim()).filter(Boolean);

      let primaryMajorCategory = 'General Spares & Consumables';
      let minorCategories = [];
      let productLines = [];
      let aiConfidenceScore = 70;
      let aiReason = '';
      let mappingStatus = 'AI_MAPPED';

      if (hasPoHistory) {
        const combinedText = items.join(' ').toLowerCase();

        // 1. Mechanical Spares
        if (
          combinedText.includes('pump') ||
          combinedText.includes('valve') ||
          combinedText.includes('compressor') ||
          combinedText.includes('hose') ||
          combinedText.includes('impeller') ||
          combinedText.includes('fitting') ||
          combinedText.includes('machinery') ||
          combinedText.includes('motor') ||
          combinedText.includes('gpm') ||
          combinedText.includes('psi') ||
          (/\bbar\b/i.test(combinedText) && !combinedText.includes('tmt') && !combinedText.includes('steel') && !combinedText.includes('rebar') && !combinedText.includes('fe500d'))
        ) {
          primaryMajorCategory = 'Engineering Spares - Mechanical';
          if (combinedText.includes('pump') || combinedText.includes('impeller') || combinedText.includes('gpm')) {
            minorCategories.push('Pumps & Accessories');
            productLines.push('Industrial Pumps');
          }
          if (combinedText.includes('compressor') || combinedText.includes('receiver') || combinedText.includes('cfm')) {
            minorCategories.push('Compressors & Accessories');
            productLines.push('Air Compressors');
          }
          if (combinedText.includes('valve') || combinedText.includes('gate') || combinedText.includes('globe') || combinedText.includes('flange')) {
            minorCategories.push('Hoses, Valves & Fittings');
            productLines.push('Industrial Valves');
          }
          if (combinedText.includes('hose') || combinedText.includes('fitting')) {
            minorCategories.push('Hoses, Valves & Fittings');
            productLines.push('Hydraulic Hoses');
          }
          if (combinedText.includes('motor') || combinedText.includes('machinery') || combinedText.includes('bearing')) {
            minorCategories.push('Machinery Parts');
            productLines.push('Machinery Parts');
          }
          if (minorCategories.length === 0) {
            minorCategories = ['Pumps & Accessories', 'Hoses, Valves & Fittings'];
            productLines = ['Industrial Mechanical Spares'];
          }
          aiConfidenceScore = poCount >= 2 ? 94 : 88;
          aiReason = `Vendor primarily supplies ${productLines.join(' and ')} based on ${poCount} historical purchase orders with ₹${totalSpend.toLocaleString()} spend.`;
        }
        // 2. Electrical Spares
        else if (
          combinedText.includes('switchgear') ||
          combinedText.includes('panel') ||
          combinedText.includes('breaker') ||
          combinedText.includes('mccb') ||
          combinedText.includes('cable') ||
          combinedText.includes('wire') ||
          combinedText.includes('relay') ||
          combinedText.includes('415v')
        ) {
          primaryMajorCategory = 'Engineering Spares - Electrical';
          if (combinedText.includes('panel') || combinedText.includes('switchgear')) {
            minorCategories.push('Panels');
            productLines.push('LV Switchgear Panels');
          }
          if (combinedText.includes('breaker') || combinedText.includes('mccb')) {
            minorCategories.push('Circuit Breakers');
            productLines.push('Molded Case Circuit Breakers');
          }
          if (combinedText.includes('cable') || combinedText.includes('tray') || combinedText.includes('wire')) {
            minorCategories.push('Cables & Wiring');
            productLines.push('Industrial Cables');
          }
          if (minorCategories.length === 0) {
            minorCategories = ['Panels', 'Circuit Breakers'];
            productLines = ['Electrical Distribution Equipment'];
          }
          aiConfidenceScore = poCount >= 2 ? 95 : 86;
          aiReason = `Vendor supplies electrical distribution gear, modular panels, and circuit breakers. High consistency across line items.`;
        }
        // 3. Civil & Infrastructure
        else if (
          combinedText.includes('tmt') ||
          combinedText.includes('steel') ||
          combinedText.includes('reinforcement') ||
          combinedText.includes('civil') ||
          combinedText.includes('peb') ||
          combinedText.includes('structure') ||
          combinedText.includes('roofing')
        ) {
          primaryMajorCategory = 'Civil Works';
          if (combinedText.includes('peb') || combinedText.includes('structure')) {
            minorCategories.push('PEB Structure');
            productLines.push('Pre-Engineered Building Structure');
          }
          if (combinedText.includes('tmt') || combinedText.includes('bar') || combinedText.includes('fe500d')) {
            minorCategories.push('TMT BARS');
            productLines.push('High-Yield TMT Bars');
          }
          if (combinedText.includes('roofing') || combinedText.includes('sheet')) {
            minorCategories.push('Roofing Sheets');
            productLines.push('Industrial Roofing');
          }
          if (minorCategories.length === 0) {
            minorCategories = ['PEB Structure', 'TMT BARS', 'Roofing Sheets'];
            productLines = ['Structural Steel & Rebar'];
          }
          aiConfidenceScore = poCount >= 2 ? 96 : 91;
          aiReason = `Historical spend indicates major procurement of structural steel, TMT rebar, and infrastructure supplies.`;
        }
        // 4. Fallback General
        else {
          primaryMajorCategory = 'General Spares & Consumables';
          minorCategories = ['Customised Parts', 'Consumables'];
          productLines = ['Plant Consumables'];
          aiConfidenceScore = 78;
          aiReason = `Extracted items represent general maintenance consumables and workshop spares.`;
        }

        minorCategories = Array.from(new Set(minorCategories));
        productLines = Array.from(new Set(productLines));
        mappingStatus = 'AI_MAPPED';
      } else {
        // No PO History -> Self-Map Required
        primaryMajorCategory = 'Not Available';
        minorCategories = [];
        productLines = [];
        aiConfidenceScore = 0;
        mappingStatus = 'SELF_MAP_REQUIRED';
        aiReason = 'No PO transactions found in the selected purchase period. Supplier must self-map categories.';
      }

      return {
        id: v.id || `bv-${Date.now()}-${idx}`,
        buyerOrgId: buyerOrgId || 'org-tata-motors-001',
        vendorId: v.vendorId || `vnd-${idx + 1}`,
        vendorCode: vendorCode || `VND-${1000 + idx + 1}`,
        companyName: companyName || `Supplier ${idx + 1}`,
        contactPerson: contactPerson || 'Procurement Lead',
        email: email || `contact@supplier${idx + 1}.com`,
        phone: phone || '+91 98000 00000',
        address: address || 'Industrial Area, India',
        gstin: gstin || '27AAACA0000A1Z0',
        rating,
        hasPoHistory,
        poCount,
        totalSpend,
        timeHorizon: period,
        primaryMajorCategory,
        minorCategories,
        productLines,
        aiConfidenceScore,
        aiReason,
        mappingStatus,
        emailDispatchStatus: 'PENDING',
        itemsSupplied: items,
      };
    });

    // If Gemini AI is configured, invoke Gemini to enrich categories & deep contextual reasoning
    const vendorsWithHistory = results.filter((r) => r.hasPoHistory);
    if (vendorsWithHistory.length > 0 && geminiService.isConfigured()) {
      try {
        const payload = vendorsWithHistory.map((v) => ({
          vendorCode: v.vendorCode,
          companyName: v.companyName,
          totalSpend: v.totalSpend,
          poCount: v.poCount,
          items: v.itemsSupplied || [],
        }));

        const prompt = `You are an Enterprise Procurement AI Categorization Engine. Analyze the following vendors and their historical purchase order line items and spend to assign the standard industrial taxonomy.

VENDORS:
${JSON.stringify(payload, null, 2)}

Return a SINGLE JSON object with format:
{
  "categorizations": [
    {
      "vendorCode": "string matching input",
      "primaryMajorCategory": "string, e.g. Engineering Spares - Mechanical, Engineering Spares - Electrical, Civil Works, IT & Hardware, etc.",
      "minorCategories": ["string array of specific sub-categories"],
      "productLines": ["string array of specific product lines"],
      "aiConfidenceScore": 95,
      "aiReason": "string, clear explanation of why this vendor is categorized here based on item descriptions and spend"
    }
  ]
}`;

        const aiResponse = await geminiService.generateJson({ prompt, label: 'buyer-vendor-categorization' });
        if (aiResponse && aiResponse.status === 'SUCCESS' && Array.isArray(aiResponse.data?.categorizations)) {
          aiModel = `Google Gemini (${aiResponse.model || 'gemini-1.5-pro'})`;
          const catMap = new Map();
          for (const item of aiResponse.data.categorizations) {
            if (item?.vendorCode) catMap.set(String(item.vendorCode).toLowerCase().trim(), item);
          }
          for (const r of results) {
            const key = String(r.vendorCode).toLowerCase().trim();
            if (catMap.has(key)) {
              const enriched = catMap.get(key);
              if (enriched.primaryMajorCategory) r.primaryMajorCategory = enriched.primaryMajorCategory;
              if (Array.isArray(enriched.minorCategories) && enriched.minorCategories.length > 0) {
                r.minorCategories = enriched.minorCategories;
              }
              if (Array.isArray(enriched.productLines) && enriched.productLines.length > 0) {
                r.productLines = enriched.productLines;
              }
              if (Number.isFinite(enriched.aiConfidenceScore)) {
                r.aiConfidenceScore = enriched.aiConfidenceScore;
              }
              if (enriched.aiReason) r.aiReason = enriched.aiReason;
            }
          }
        }
      } catch (err) {
        logger.warn('Gemini AI categorization enrichment encountered an error, falling back to rule taxonomy', { error: err.message }, 'STORE_SERVICE');
      }
    }

    return {
      period,
      totalVendors: results.length,
      mappedCount: results.filter((r) => r.hasPoHistory).length,
      unmappedCount: results.filter((r) => !r.hasPoHistory).length,
      vendors: results,
      categorizedVendors: results,
      totalProcessed: results.length,
      aiModel,
    };
  }

  /**
   * Save final approved/edited buyer-vendor mappings.
   * Scopes to buyerOrgId and updates PostgreSQL and memory.
   */
  saveBuyerVendors({ buyerVendors = [], buyerOrgId = null, requestingBuyerAccount = null }) {
    let savedCount = 0;
    const targetOrgId = buyerOrgId || (requestingBuyerAccount && requestingBuyerAccount.orgId) || 'org-tata-motors-001';

    (buyerVendors || []).forEach((bv, idx) => {
      const record = {
        ...bv,
        id: bv.id || `bv-${Date.now()}-${idx}`,
        buyerOrgId: targetOrgId,
        updatedAt: new Date().toISOString(),
      };

      const existingIndex = this.buyerVendors.findIndex((item) => item.id === record.id || (item.email && item.email.toLowerCase() === record.email?.toLowerCase()));
      if (existingIndex >= 0) {
        this.buyerVendors[existingIndex] = { ...this.buyerVendors[existingIndex], ...record };
      } else {
        this.buyerVendors.push(record);
      }
      this._persistBuyerVendor(record);

      // Also ensure standard vendor catalogue has a synchronized entry
      const existingVendor = this.vendors.find(
        (v) => (v.email && record.email && v.email.toLowerCase() === record.email.toLowerCase()) ||
               (v.name && record.companyName && v.name.toLowerCase() === record.companyName.toLowerCase())
      );
      if (!existingVendor) {
        const newGlobalVendor = {
          id: record.vendorId || `v-sync-${Date.now()}-${idx}`,
          name: record.companyName,
          email: record.email,
          contactPerson: record.contactPerson,
          phone: record.phone,
          majorCategory: record.primaryMajorCategory !== 'Not Available' ? record.primaryMajorCategory : 'Engineering Spares - Mechanical',
          minorCategories: record.minorCategories || [],
          location: record.address,
          rating: record.rating ? Number((record.rating / 20).toFixed(1)) : 4.5,
          score: record.rating || 90,
          source: 'historical_purchase_dump',
          status: 'ACTIVE',
          evaluated: true,
          hasRecord: true,
          isExistingInDatabase: true,
          onboardingEmailStatus: 'sent',
          clientMappedCategories: record.minorCategories || [],
          vendorSelectedCategories: record.minorCategories || [],
          isCategoryAligned: true,
        };
        this.vendors.push(newGlobalVendor);
        this._persistVendor(newGlobalVendor);
      }

      savedCount++;
    });

    const attributedAccount = requestingBuyerAccount || this.activeBuyerAccount;
    this.addAuditLog({
      userEmail: attributedAccount ? attributedAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Saved ${savedCount} Buyer-Vendor relationship records with AI category cross-mapping for Organization ${targetOrgId}.`,
    });

    this.addAIFeedItem({
      title: `Buyer Vendor Database Initialized (${savedCount} Vendors)`,
      message: `AI Category Cross-Match completed and persisted for Organization ${targetOrgId}. Dual-file ERP ingestion sealed.`,
      category: 'invitation',
      priority: 'high',
    });

    return {
      success: true,
      savedCount,
      totalBuyerVendors: this.buyerVendors.length,
      buyerOrgId: targetOrgId,
    };
  }

  /**
   * Dispatch Onboarding & Category Notification Emails to Vendors
   */
  dispatchBuyerVendorEmails({ buyerVendors = [], buyerOrgId = null, requestingBuyerAccount = null }) {
    const targetOrgId = buyerOrgId || (requestingBuyerAccount && requestingBuyerAccount.orgId) || 'org-tata-motors-001';
    let dispatchedCount = 0;
    const now = new Date().toISOString();

    const updatedVendors = (buyerVendors || []).map((bv) => {
      const updated = {
        ...bv,
        emailDispatchStatus: 'SENT',
        dispatchedAt: now,
        mappingStatus: bv.hasPoHistory ? (bv.mappingStatus === 'PENDING' ? 'AI_MAPPED' : bv.mappingStatus) : 'SELF_MAP_REQUIRED',
      };

      const idx = this.buyerVendors.findIndex((item) => item.id === bv.id);
      if (idx >= 0) {
        this.buyerVendors[idx] = updated;
      }
      this._persistBuyerVendor(updated);
      dispatchedCount++;
      return updated;
    });

    const mappedCount = updatedVendors.filter((v) => v.hasPoHistory).length;
    const unmappedCount = updatedVendors.length - mappedCount;

    const attributedAccount = requestingBuyerAccount || this.activeBuyerAccount;
    this.addAuditLog({
      userEmail: attributedAccount ? attributedAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Dispatched onboarding emails to ${dispatchedCount} suppliers (${mappedCount} AI-mapped review notifications, ${unmappedCount} self-mapping invitations).`,
    });

    return {
      success: true,
      dispatchedCount,
      mappedCount,
      unmappedCount,
      deliverySuccessRate: 100,
      vendors: updatedVendors,
    };
  }

  // ==========================================
  // 10. DUAL-STREAM CATEGORY RECONCILIATION
  // ==========================================
  updateVendorCategories(vendorId, { clientMappedCategories = [], vendorSelectedCategories = [] }) {
    const vendor = this.getVendorById(vendorId);
    if (!vendor) return null;

    // Check alignment
    const isCategoryAligned =
      clientMappedCategories.length === 0 ||
      clientMappedCategories.every((cat) => vendorSelectedCategories.includes(cat));

    const updated = this.updateVendor(vendor.id, {
      clientMappedCategories,
      vendorSelectedCategories: vendorSelectedCategories.slice(0, 10), // Max 10 categories
      isCategoryAligned,
    });

    this.addAuditLog({
      userEmail: vendor.email,
      action: `Reconciled categories for ${vendor.name}: ${vendorSelectedCategories.length} categories active (Aligned: ${isCategoryAligned})`,
    });

    return updated;
  }

  // ==========================================
  // 11. AI SUPPORT CHAT ASSISTANT & ESCALATION
  // ==========================================
  handleSupportChat(prompt, userRole = 'buyer') {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanPrompt = (prompt || '').toLowerCase().trim();

    const dissatisfactionKeywords = [
      'not happy',
      'not satisfied',
      'not helpful',
      'bad',
      'human',
      'agent',
      'connect with agent',
      'support agent',
      'further support',
      'speak to person',
      'transfer',
      'unsatisfied',
      'disappointed',
      'no help',
    ];

    const isEscalation = dissatisfactionKeywords.some((kw) => cleanPrompt.includes(kw));

    if (isEscalation) {
      const ticketId = `TK-${Math.floor(100000 + Math.random() * 900000)}`;
      this.addAuditLog({
        userEmail: 'support@procucev.com',
        action: `Support Chat Escalation (#${ticketId}) pushed to human procurement specialist for ${userRole}. Prompt: "${prompt}"`,
      });

      return {
        reply: `I understand your requirement. I have escalated this ticket (#${ticketId}) to a Senior Sourcing Specialist. Our procurement desk will contact you via email shortly.`,
        isEscalated: true,
        ticketId,
        timestamp: timeNow,
      };
    }

    let reply = `Thank you for your message. You can manage autonomous RFQ chasing, quote matrices, and 360° vendor evaluations directly from the Command Center.`;

    if (cleanPrompt.includes('subscription') || cleanPrompt.includes('plan') || cleanPrompt.includes('quota')) {
      reply = `Procucev offers Free Starter (5 RFQs), Version 1 ($199/mo - Client Roster), Version 2 ($499/mo - Hybrid), and Version 3 ($999/mo - Autonomous AI). Vendors can choose between Premium (Free for client-uploaded), Connect ($149/qtr for 50 RFQs), and Select ($349/qtr with Catalogue).`;
    } else if (cleanPrompt.includes('mode 1') || cleanPrompt.includes('mode 2') || cleanPrompt.includes('mode 3') || cleanPrompt.includes('mode')) {
      reply = `Mode 1 circulates RFQs strictly to your private client roster. Mode 2 is a Hybrid pool that expands to verified Procucev network vendors if needed. Mode 3 executes full 360° 6-pillar supplier qualification audits.`;
    } else if (cleanPrompt.includes('download') || cleanPrompt.includes('quote') || cleanPrompt.includes('rfq')) {
      reply = `Vendors can view open opportunities in the Opportunity Feed and submit competitive quotes in 1-click. BOQ line items are automatically normalized in the Buyer Quote Matrix.`;
    }

    return {
      reply,
      isEscalated: false,
      timestamp: timeNow,
    };
  }

  // ==========================================
  // 12. VENDOR ITEM SKU CATALOGUE CRUD
  // ==========================================
  // Scoped per vendor. Called without a vendorId (the buyer-side catalogue
  // browse) it returns every product; the three unowned demo SKUs that used to
  // be visible only through that unfiltered path are gone.
  getVendorCatalogue(vendorId) {
    if (!vendorId) return this.vendorCatalogue;
    return this.vendorCatalogue.filter((p) => p.vendorId === vendorId);
  }

  getCatalogueProductById(id) {
    return this.vendorCatalogue.find((p) => p.id === id);
  }

  addProductToCatalogue(product, vendorId, userEmail) {
    const newProd = {
      ...product,
      id: product.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      vendorId,
      unitPrice: Number(product.unitPrice) || 0,
      leadTimeDays: Number(product.leadTimeDays) || 7,
      moq: Number(product.moq) || 1,
    };
    this.vendorCatalogue.unshift(newProd);
    this._persistCatalogueProduct(newProd);
    this.addAuditLog({
      userEmail: userEmail || 'unknown',
      action: `Added product ${newProd.sku} (${newProd.name}) to item SKU catalogue`,
    });
    return newProd;
  }

  updateCatalogueProduct(id, updates, userEmail) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const { vendorId: _ignoredVendorId, id: _ignoredId, ...safeUpdates } = updates;
    this.vendorCatalogue[idx] = { ...this.vendorCatalogue[idx], ...safeUpdates };
    this._persistCatalogueProduct(this.vendorCatalogue[idx]);
    this.addAuditLog({
      userEmail: userEmail || 'unknown',
      action: `Updated SKU ${this.vendorCatalogue[idx].sku} in catalogue`,
    });
    return this.vendorCatalogue[idx];
  }

  deleteCatalogueProduct(id, userEmail) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const removed = this.vendorCatalogue.splice(idx, 1)[0];
    this._removeCatalogueProduct(id);
    this.addAuditLog({
      userEmail: userEmail || 'unknown',
      action: `Removed product ${removed.sku} from SKU catalogue`,
    });
    return true;
  }

  // ==========================================
  // 13. BATCH CHASER DISPATCH & PO APPROVAL
  // ==========================================
  triggerBatchChaser(rfqId, channels = ['call', 'whatsapp', 'sms']) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    // Only the vendors actually invited to this RFQ. The fallback here used to be
    // `this.vendors.slice(0, 3)` — the first three vendors in the master roster —
    // so an RFQ with nobody assigned would chase three uninvolved suppliers and
    // log outreach against them.
    const vendors = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    if (vendors.length === 0) {
      return {
        success: false,
        count: 0,
        logs: [],
        error: 'No vendors are assigned to this RFQ, so there is nobody to chase. Assign vendors first.',
      };
    }

    const outreachLogs = [];

    vendors.forEach((vendor) => {
      const logs = simulateChaserOutreach(rfq, vendor);
      outreachLogs.push(...logs);
    });

    this.aiFeed.unshift(...outreachLogs);
    // This bulk path bypassed addAIFeedItem's 100-item cap entirely before —
    // trim here too so the in-memory list and the DB-side trim (which runs
    // per insert regardless of which path added the row) stay consistent.
    if (this.aiFeed.length > 100) this.aiFeed.splice(100);
    outreachLogs.forEach((log) => this._persistAIFeedItem(log));
    this.addAuditLog({
      userEmail: 'chaser.bot@procucev.com',
      action: `Executed batch multi-channel outreach (${channels.join(' + ')}) for ${rfq.rfqNumber} to ${vendors.length} vendors`,
      rfqNumber: rfq.rfqNumber,
    });

    return { success: true, count: outreachLogs.length, logs: outreachLogs };
  }

  approvePurchaseOrder(rfqNumber, vendorId, vendorName, totalAmount, approverNotes = '', approverEmail = null) {
    const rfq = this.rfqs.find((r) => r.rfqNumber === rfqNumber || r.id === rfqNumber);
    if (!rfq) return null;

    rfq.status = 'PO Generated';
    rfq.awardedVendorId = vendorId || null;
    rfq.awardedVendor = vendorName;
    rfq.awardedAmount = totalAmount;
    this._persistRFQ(rfq);

    const poNumber = `PO-2026-` + (rfqNumber || '').replace('RFQ-2026-', '');
    const issueDate = new Date().toISOString().substring(0, 10);
    const auditRecord = this.addAuditLog({
      userEmail: approverEmail || (this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : SYSTEM_ACTOR_EMAIL),
      action: `Formally approved & sealed Purchase Order ${poNumber} awarded to ${vendorName} ($${Number(totalAmount).toLocaleString()}). Notes: ${approverNotes}`,
      rfqNumber,
    });

    return {
      success: true,
      poNumber,
      rfqNumber,
      vendorId: vendorId || null,
      vendorName,
      totalAmount,
      issueDate,
      // Real RFQ line items, not a hardcoded pump description — the PO
      // document should reflect what was actually procured.
      lineItems: (rfq.extractedEntities || []).map((ent) => ({
        description: ent.itemName,
        quantity: ent.quantity,
        unit: ent.unit,
      })),
      shaSignature: auditRecord.shaSignature,
    };
  }

  // ==========================================
  // 14. UNIFIED BOOTSTRAP DATA
  // ==========================================
  /**
   * Reference data the app needs to start up.
   *
   * RFQs are deliberately NOT here. This endpoint is anonymous, and returning the
   * global RFQ array from it is what put one buyer's RFQs on another buyer's
   * dashboard — scoping /api/rfqs alone would have changed nothing on screen
   * while this remained the endpoint the store actually hydrated from. RFQs are
   * now fetched from GET /api/rfqs, which is authenticated and org-scoped.
   */
  getBootstrapData() {
    return {
      buyerAccounts: this.buyerAccounts,
      activeBuyerAccount: this.activeBuyerAccount,
      vendors: this.vendors,
      evaluations: this.evaluations,
      auditLogs: this.auditLogs,
      aiFeed: this.aiFeed,
      systemConfig: this.systemConfig,
      azureHealth: this.azureHealth,
      vendorCatalogue: this.vendorCatalogue,
    };
  }
}

// Global Singleton Instance for Node.js process
const storeService = new StoreService();

module.exports = storeService;
