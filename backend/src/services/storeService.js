const {
  SEED_BUYER_ACCOUNTS,
  SEED_VENDORS,
  SEED_RFQS,
  SEED_EVALUATIONS,
  SEED_AUDIT_LOGS,
  SEED_AI_FEED,
} = require('../db/seed');
const { INITIAL_SYSTEM_CONFIG, INITIAL_AZURE_HEALTH } = require('../config/constants');
const { createAuditEntry, verifyAuditTrail } = require('./auditService');
const { evaluateQuotes, calculate360Evaluation, calculateRevisedRating } = require('./evaluationService');
const { simulateChaserOutreach } = require('./aiChaserService');
const { logger } = require('./loggerService');

class StoreService {
  constructor() {
    this.buyerAccounts = JSON.parse(JSON.stringify(SEED_BUYER_ACCOUNTS));
    this.activeBuyerAccount = this.buyerAccounts[0] || null;
    this.vendors = JSON.parse(JSON.stringify(SEED_VENDORS));
    this.rfqs = JSON.parse(JSON.stringify(SEED_RFQS));
    this.evaluations = JSON.parse(JSON.stringify(SEED_EVALUATIONS));
    this.auditLogs = JSON.parse(JSON.stringify(SEED_AUDIT_LOGS));
    this.aiFeed = JSON.parse(JSON.stringify(SEED_AI_FEED));
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
   * Domain records (buyer accounts, vendors, RFQs, evaluations, audit logs and
   * system config) are served from the reference seed dataset held in this
   * process.
   *
   * User accounts are the exception: they are read from and written to the
   * shared MySQL identity schema via db/identityQueries.js. This backend has no
   * PostgreSQL connection.
   *
   * Kept as an async no-op so the bootstrap path and callers keep a stable
   * contract if a domain persistence layer is introduced later.
   */
  async hydrateFromDB() {
    this.isHydratedFromDB = false;
    return { hydrated: false, source: 'in_memory_seed' };
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

    if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
      this.activeBuyerAccount = updated;
    }

    return updated;
  }

  deleteBuyerAccount(id) {
    const beforeLen = this.buyerAccounts.length;
    this.buyerAccounts = this.buyerAccounts.filter((a) => a.id !== id);
    if (this.buyerAccounts.length < beforeLen) {
      if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
        this.activeBuyerAccount = this.buyerAccounts[0] || null;
      }
      return true;
    }
    return false;
  }

  alignActiveBuyerAccount(id) {
    const target = this.buyerAccounts.find((a) => a.id === id);
    if (!target) return null;
    this.activeBuyerAccount = target;
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
    const newVendor = {
      ...vendorData,
      id: vendorData.id || `v-${Date.now().toString().slice(-4)}`,
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
    this.addAuditLog({
      userEmail: 'procurement@enterprise.com',
      action: `Registered vendor ${newVendor.name} in category ${newVendor.majorCategory}`,
    });

    return newVendor;
  }

  updateVendor(id, updates) {
    const idx = this.vendors.findIndex((v) => v.id === id);
    if (idx === -1) return null;

    const updated = { ...this.vendors[idx], ...updates };
    this.vendors[idx] = updated;

    return updated;
  }

  deleteVendor(id) {
    const beforeLen = this.vendors.length;
    this.vendors = this.vendors.filter((v) => v.id !== id);
    if (this.vendors.length < beforeLen) {
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
      deadline: rfqData.deadline || '2026-09-20',
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

    return updated;
  }

  addQuoteToRFQ(rfqId, quote) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    const quotes = [...(rfq.quotes || []), quote];
    return this.updateRFQ(rfq.id, { quotes });
  }

  deleteRFQ(id) {
    const beforeLen = this.rfqs.length;
    this.rfqs = this.rfqs.filter((r) => r.id !== id && r.rfqNumber !== id);
    return this.rfqs.length < beforeLen;
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
    };

    this.evaluations.unshift(newEval);

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
  getVendorCatalogue() {
    return this.vendorCatalogue;
  }

  addProductToCatalogue(product) {
    const newProd = {
      ...product,
      id: product.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      unitPrice: Number(product.unitPrice) || 0,
      leadTimeDays: Number(product.leadTimeDays) || 7,
      moq: Number(product.moq) || 1,
    };
    this.vendorCatalogue.unshift(newProd);
    this.addAuditLog({
      userEmail: 'vendor@apex.com',
      action: `Added product ${newProd.sku} (${newProd.name}) to item SKU catalogue`,
    });
    return newProd;
  }

  updateCatalogueProduct(id, updates) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.vendorCatalogue[idx] = { ...this.vendorCatalogue[idx], ...updates };
    this.addAuditLog({
      userEmail: 'vendor@apex.com',
      action: `Updated SKU ${this.vendorCatalogue[idx].sku} in catalogue`,
    });
    return this.vendorCatalogue[idx];
  }

  deleteCatalogueProduct(id) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const removed = this.vendorCatalogue.splice(idx, 1)[0];
    this.addAuditLog({
      userEmail: 'vendor@apex.com',
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
    this.addAuditLog({
      userEmail: 'chaser.bot@procucev.com',
      action: `Executed batch multi-channel outreach (${channels.join(' + ')}) for ${rfq.rfqNumber} to ${vendors.length} vendors`,
      rfqNumber: rfq.rfqNumber,
    });

    return { success: true, count: outreachLogs.length, logs: outreachLogs };
  }

  approvePurchaseOrder(rfqNumber, vendorName, totalAmount, approverNotes = '') {
    const rfq = this.rfqs.find((r) => r.rfqNumber === rfqNumber || r.id === rfqNumber);
    if (rfq) {
      rfq.status = 'PO Generated';
      rfq.awardedVendor = vendorName;
      rfq.awardedAmount = totalAmount;
    }

    const poNumber = `PO-2026-` + (rfqNumber || '').replace('RFQ-2026-', '');
    const auditRecord = this.addAuditLog({
      userEmail: this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : 'buyer@enterprise.com',
      action: `Formally approved & sealed Purchase Order ${poNumber} awarded to ${vendorName} ($${Number(totalAmount).toLocaleString()}). Notes: ${approverNotes}`,
      rfqNumber,
    });

    return {
      success: true,
      poNumber,
      rfqNumber,
      vendorName,
      totalAmount,
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

module.exports = storeService;
