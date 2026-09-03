const {
  SEED_BUYER_ACCOUNTS,
  SEED_VENDORS,
  SEED_RFQS,
  SEED_EVALUATIONS,
  SEED_AUDIT_LOGS,
  SEED_AI_FEED,
} = require('../db/seed');
const { INITIAL_SYSTEM_CONFIG, INITIAL_AZURE_HEALTH } = require('../config/constants');
const domainPool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const { createAuditEntry, verifyAuditTrail } = require('./auditService');
const { evaluateQuotes, calculate360Evaluation, calculateRevisedRating } = require('./evaluationService');
const { simulateChaserOutreach } = require('./aiChaserService');
const { logger } = require('./loggerService');

/**
 * Whether to preload the demo RFQs, AI feed and audit trail.
 *
 * These ship with the repo so a fresh checkout has something to show, but they
 * are written into the same store a buyer's real RFQs land in, and the portfolio
 * summary derives every KPI from that store. The result was a screen reporting
 * demo spend, quote counts and vendor engagement next to genuine work, with no
 * way to tell them apart.
 *
 * The test suite uses them as fixtures, so seeding stays on under NODE_ENV=test.
 * Set SEED_DEMO_RFQS=true to get them back in a running app, or false to switch
 * them off during a test run.
 *
 * Vendors, buyer accounts and evaluations are deliberately not gated: the active
 * buyer account and the vendor directory are load-bearing for sign-in and vendor
 * selection rather than illustrative.
 */
function shouldSeedDemoRFQs() {
  if (process.env.SEED_DEMO_RFQS !== undefined) {
    return process.env.SEED_DEMO_RFQS === 'true';
  }
  return process.env.NODE_ENV === 'test';
}

class StoreService {
  constructor() {
    this.buyerAccounts = JSON.parse(JSON.stringify(SEED_BUYER_ACCOUNTS));
    this.activeBuyerAccount = this.buyerAccounts[0] || null;
    this.vendors = JSON.parse(JSON.stringify(SEED_VENDORS));
    // Demo RFQs and the feed/audit narrative around them are opt-in. Once
    // hydrated they are indistinguishable from a buyer's own work, so the RFQ
    // portfolio summary reported fabricated spend, quote counts and vendor
    // engagement alongside real RFQs. See shouldSeedDemoRFQs.
    const seedDemo = shouldSeedDemoRFQs();
    this.rfqs = seedDemo ? JSON.parse(JSON.stringify(SEED_RFQS)) : [];
    this.evaluations = JSON.parse(JSON.stringify(SEED_EVALUATIONS));
    this.auditLogs = seedDemo ? JSON.parse(JSON.stringify(SEED_AUDIT_LOGS)) : [];
    this.aiFeed = seedDemo ? JSON.parse(JSON.stringify(SEED_AI_FEED)) : [];
    this.systemConfig = JSON.parse(JSON.stringify(INITIAL_SYSTEM_CONFIG));
    this.azureHealth = JSON.parse(JSON.stringify(INITIAL_AZURE_HEALTH));
    this.isHydratedFromDB = false;
    this.vendorCatalogue = [
      {
        id: 'prod-1',
        name: 'SS316 High-Pressure Impeller',
        category: 'Pumps & Fluid Dynamics',
        sku: 'SKU-PUMP-316',
        specs: '5-Axis CNC machined, ANSI standard, NBR double mechanical seals',
        unitPrice: 4250,
        leadTimeDays: 12,
        moq: 10,
      },
      {
        id: 'prod-2',
        name: 'Double Mechanical Cartridge Seal',
        category: 'Mechanical Spares',
        sku: 'SKU-SEAL-890',
        specs: 'Silicon Carbide faces, Hastelloy-C springs, 40 bar rating',
        unitPrice: 890,
        leadTimeDays: 7,
        moq: 25,
      },
      {
        id: 'prod-3',
        name: 'High-Temperature Industrial Gate Valve (DN150)',
        category: 'Valves & Actuators',
        sku: 'SKU-VALVE-150',
        specs: 'Class 600, Cast Steel WCB body, Stellite hard-faced trim',
        unitPrice: 12400,
        leadTimeDays: 14,
        moq: 5,
      },
    ];
  }

  /**
   * All seven domain collections (vendors, RFQs, evaluations, vendor
   * catalogue, buyer accounts, AI feed, audit logs) hydrate from Neon
   * Postgres when DATABASE_URL is configured, falling back to the in-memory
   * seed per-collection when its table is empty (e.g. right after the schema
   * was first created, before `db:migrate` has seeded it) so one empty table
   * doesn't blank out an otherwise-healthy boot. `isHydratedFromDB` is a
   * single shared flag — true if ANY collection actually loaded real rows —
   * matching how it was already being read by several controllers before
   * this covered more than vendors/RFQs; system config stays a static
   * in-memory default regardless.
   *
   * User accounts are a separate exception: they are read from and written to
   * the shared MySQL identity schema via db/identityQueries.js.
   */
  async hydrateFromDB() {
    if (!domainPool.pool) {
      this.isHydratedFromDB = false;
      return { hydrated: false, source: 'in_memory_seed' };
    }

    try {
      const [vendors, rfqs, evaluations, vendorCatalogue, buyerAccountsResult, aiFeed, auditLogs] = await Promise.all([
        domainQueries.getVendorsFromDB(),
        domainQueries.getRFQsFromDB(),
        domainQueries.getEvaluationsFromDB(),
        domainQueries.getVendorCatalogueFromDB(),
        domainQueries.getBuyerAccountsFromDB(),
        domainQueries.getAIFeedFromDB(),
        domainQueries.getAuditLogsFromDB(),
      ]);

      if (vendors.length > 0) this.vendors = vendors;
      if (rfqs.length > 0) this.rfqs = rfqs;
      if (evaluations.length > 0) this.evaluations = evaluations;
      if (vendorCatalogue.length > 0) this.vendorCatalogue = vendorCatalogue;
      if (buyerAccountsResult.accounts.length > 0) {
        this.buyerAccounts = buyerAccountsResult.accounts;
        // activeBuyerAccount must stay a reference into this.buyerAccounts
        // (same invariant the constructor and every mutator already keep),
        // not a separately-hydrated duplicate.
        this.activeBuyerAccount =
          this.buyerAccounts.find((a) => a.id === buyerAccountsResult.activeId) || this.buyerAccounts[0] || null;
      }
      if (aiFeed.length > 0) this.aiFeed = aiFeed;
      if (auditLogs.length > 0) this.auditLogs = auditLogs;

      const hydrated =
        vendors.length > 0 ||
        rfqs.length > 0 ||
        evaluations.length > 0 ||
        vendorCatalogue.length > 0 ||
        buyerAccountsResult.accounts.length > 0 ||
        aiFeed.length > 0 ||
        auditLogs.length > 0;
      this.isHydratedFromDB = hydrated;
      return { hydrated, source: hydrated ? 'persisted' : 'in_memory_seed' };
    } catch (err) {
      logger.error('Failed to hydrate domain data from the database', err, 'STORE_SERVICE');
      this.isHydratedFromDB = false;
      return { hydrated: false, source: 'in_memory_seed' };
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

  addVendor(vendorData) {
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
    };

    this.vendors.unshift(newVendor);
    this._persistVendor(newVendor);
    this.addAuditLog({
      userEmail: 'procurement@enterprise.com',
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

  deleteVendor(id) {
    const beforeLen = this.vendors.length;
    this.vendors = this.vendors.filter((v) => v.id !== id);
    if (this.vendors.length < beforeLen) {
      this._removeVendor(id);
      return true;
    }
    return false;
  }

  reviseVendorRating(vendorId, ratingData) {
    const vendor = this.getVendorById(vendorId);
    if (!vendor) return null;

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
      buyerCompany: buyerCompany || 'Enterprise Buyer',
      buyerName: buyerName || 'Procurement Manager',
      buyerEmail: buyerEmail || 'buyer@enterprise.com',
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
      userEmail: buyerEmail || 'buyer@enterprise.com',
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

  createRFQ(rfqData) {
    const nextNum = this.rfqs.length + 893;
    const rfqNumber = rfqData.rfqNumber || `RFQ-2026-0${nextNum}`;
    const id = rfqData.id || `rfq-${Date.now()}`;

    const newRFQ = {
      id,
      rfqNumber,
      title: rfqData.title || 'Untitled RFQ',
      category: rfqData.category || 'Engineering Spares - Mechanical',
      createdAt: rfqData.createdAt || new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      deadline: rfqData.deadline || rfqData.targetDeliveryDate || '2026-09-20',
      // Budget was previously dropped here, so an RFQ saved through the API came
      // back from hydration with no budget at all: the portfolio value totalled
      // zero and the quote matrix crashed reading it. It is validated as a
      // required positive number by VALIDATION_SCHEMAS.createRFQ.
      budget: Number(rfqData.budget) || 0,
      // Vendors price freight against these, so they round-trip with the RFQ.
      deliveryLocation: rfqData.deliveryLocation || '',
      deliveryPincode: rfqData.deliveryPincode || '',
      // Metadata only. The bytes live on disk under rfqAttachmentService, so the
      // bootstrap payload stays a fixed size no matter how much is attached.
      attachments: Array.isArray(rfqData.attachments) ? rfqData.attachments : [],
      status: rfqData.status || 'open',
      sourcingMode: rfqData.sourcingMode || 'mode_1',
      quotesCount: rfqData.quotes ? rfqData.quotes.length : 0,
      chasingActive: rfqData.chasingActive !== undefined ? rfqData.chasingActive : true,
      allocatedTime: rfqData.allocatedTime || '24 hrs',
      elapsedTime: rfqData.elapsedTime || '0 hrs',
      targetSavings: rfqData.targetSavings || '12-18%',
      quotes: evaluateQuotes(rfqData.quotes || []),
      lineItems: rfqData.lineItems || [],
      assignedVendors: rfqData.assignedVendors || [],
      followUpData: rfqData.followUpData || {
        rfqNumber,
        totalInvited: (rfqData.assignedVendors || []).length || 3,
        respondedCount: 0,
        callStats: { total: 3, connected: 0, avgDuration: '0s' },
        whatsappStats: { total: 3, delivered: 3, read: 0, replied: 0 },
        smsStats: { total: 3, delivered: 3, clicked: 0 },
        autoChasingEnabled: true,
        vendors: [],
      },
    };

    this.rfqs.unshift(newRFQ);
    this._persistRFQ(newRFQ);

    this.addAuditLog({
      userEmail: 'buyer@enterprise.com',
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

  /**
   * Aggregate the buyer RFQ portfolio for the RFQ Summary screen.
   *
   * Mirrors the roll-ups the Java BuyerDashboardServiceImpl computed by walking
   * the pipeline list: portfolio counts, spend, and breakdowns by status, sourcing
   * mode and intake source, plus the multi-channel follow-up totals. Everything is
   * derived from the RFQ list so the summary can never disagree with the table
   * rendered beside it.
   */
  getRFQSummary() {
    const rfqs = this.getRFQs();

    const countBy = (keyFor) =>
      rfqs.reduce((acc, rfq) => {
        const key = keyFor(rfq);
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const sumChannel = (channel, field) =>
      rfqs.reduce((total, rfq) => {
        const stats = rfq.followUpData && rfq.followUpData[channel];
        return total + ((stats && Number(stats[field])) || 0);
      }, 0);

    const totalQuotes = rfqs.reduce((total, rfq) => total + (Number(rfq.quotesCount) || 0), 0);

    return {
      totalRFQs: rfqs.length,
      // An RFQ still chasing vendors is the buyer's actionable workload.
      activeRFQs: rfqs.filter((r) => r.chasingActive).length,
      awaitingQuotes: rfqs.filter((r) => (Number(r.quotesCount) || 0) === 0).length,
      totalQuotesReceived: totalQuotes,
      totalBudget: rfqs.reduce((total, rfq) => total + (Number(rfq.budget) || 0), 0),
      averageQuotesPerRFQ: rfqs.length === 0 ? 0 : Math.round((totalQuotes / rfqs.length) * 10) / 10,
      byStatus: countBy((r) => r.status),
      bySourcingMode: countBy((r) => r.sourcingMode),
      bySource: countBy((r) => r.source || r.intakeSource),
      followUps: {
        vendorsInvited: rfqs.reduce(
          (total, rfq) => total + ((rfq.followUpData && Number(rfq.followUpData.totalInvited)) || 0),
          0
        ),
        vendorsResponded: rfqs.reduce(
          (total, rfq) => total + ((rfq.followUpData && Number(rfq.followUpData.respondedCount)) || 0),
          0
        ),
        calls: sumChannel('callStats', 'total'),
        callsConnected: sumChannel('callStats', 'connected'),
        whatsapp: sumChannel('whatsappStats', 'total'),
        whatsappRead: sumChannel('whatsappStats', 'read'),
        sms: sumChannel('smsStats', 'total'),
      },
    };
  }

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
      vendorName: evalData.vendorName || 'Enterprise Supplier',
      contactPerson: evalData.contactPerson || 'Vendor Lead',
      email: evalData.email || 'vendor@supplier.com',
      phone: evalData.phone || '+91 98000 00000',
      category: evalData.category || 'Engineering Spares - Mechanical',
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
      userEmail: 'auditor@procucev.ai',
      action: `Executed 360° AI Supplier Audit for ${newEval.vendorName}: Score ${newEval.overallScore}% (${newEval.status})`,
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

  // ==========================================
  // 9. HISTORICAL PURCHASE DATA INGESTION & SETUP
  // ==========================================
  processHistoricalPurchaseData(period, vendorRecords = []) {
    let importedCount = 0;
    const dateStr = new Date().toISOString().substring(0, 10);

    vendorRecords.forEach((rec, idx) => {
      const existing = this.vendors.find(
        (v) => (v.email && rec.email && v.email.toLowerCase() === rec.email.toLowerCase()) ||
               (v.name && rec.companyName && v.name.toLowerCase() === rec.companyName.toLowerCase())
      );

      if (!existing) {
        const newVendor = {
          id: `v-hist-${Date.now()}-${idx}`,
          name: rec.companyName || rec.name || `Historical Supplier ${idx + 1}`,
          contactPerson: rec.contactPerson || 'Procurement Contact',
          email: rec.email || `supplier.${idx + 1}@historical.com`,
          phone: rec.phone || '+91 98000 00000',
          majorCategory: rec.majorCategory || 'Engineering Spares - Mechanical',
          minorCategories: rec.minorCategories || ['Pumps & Accessories', 'Machinery Parts'],
          location: rec.location || rec.address || 'Industrial Zone, India',
          rating: rec.rating || 4.6,
          score: rec.score || 88.0,
          source: 'historical_purchase_dump',
          status: 'PREFERRED ENTERPRISE SUPPLIER',
          evaluated: true,
          hasRecord: true,
          isExistingInDatabase: true,
          onboardingEmailStatus: 'sent',
          clientMappedCategories: rec.minorCategories || ['Pumps & Accessories'],
          vendorSelectedCategories: rec.minorCategories || ['Pumps & Accessories'],
          isCategoryAligned: true,
        };
        this.vendors.push(newVendor);
        this._persistVendor(newVendor);
        importedCount++;

      }
    });

    this.addAuditLog({
      userEmail: this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : 'buyer@enterprise.com',
      action: `Processed ${period.replace('_', ' ')} historical purchase dump: ${importedCount} unique suppliers empanelled into vendor master roster.`,
    });

    return { success: true, importedCount, period, totalVendors: this.vendors.length };
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
  // Was one global array with no vendorId anywhere — every vendor shared and
  // could read/mutate the same catalogue. Now scoped per vendor; the seeded
  // demo items have no owner and are excluded once a real vendorId is given.
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

    const vendors = rfq.assignedVendors || this.vendors.slice(0, 3);
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
      userEmail: approverEmail || (this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : 'buyer@enterprise.com'),
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
  getBootstrapData() {
    return {
      buyerAccounts: this.buyerAccounts,
      activeBuyerAccount: this.activeBuyerAccount,
      vendors: this.vendors,
      rfqs: this.rfqs,
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

// Every caller shares the singleton, so the seeding predicate is hung off it
// rather than exported separately, keeping `require('./storeService')` unchanged.
storeService.shouldSeedDemoRFQs = shouldSeedDemoRFQs;

module.exports = storeService;
