'use strict';

const pool = require('../db/pool');
const purchaseOrderQueries = require('../db/purchaseOrderQueries');
const { createAuditEntry } = require('./auditService');
const { logger } = require('./loggerService');
const { SYSTEM_ACTOR_EMAIL } = require('../config/constants');

function purchaseOrderResponse(rfq, values, shaSignature) {
  return {
    success: true,
    poNumber: values.poNumber,
    rfqNumber: values.rfqNumber,
    vendorId: values.vendorId || null,
    vendorName: values.vendorName,
    totalAmount: values.totalAmount,
    issueDate: values.issueDate,
    lineItems: (rfq.extractedEntities || []).map((entity) => ({
      description: entity.itemName,
      quantity: entity.quantity,
      unit: entity.unit,
    })),
    shaSignature,
  };
}

function isFinalized(rfq) {
  return rfq.status === 'PO Generated' && rfq.poFinalised;
}

function getCachedRFQ(store, rfqNumber) {
  return store.rfqs.find((candidate) => candidate.rfqNumber === rfqNumber || candidate.id === rfqNumber);
}

function updateRFQCache(store, rfq) {
  const index = store.rfqs.findIndex((candidate) => candidate.id === rfq.id || candidate.rfqNumber === rfq.rfqNumber);
  if (index >= 0) store.rfqs[index] = rfq;
  else store.rfqs.unshift(rfq);
  store._lastRfqSyncTime = 0;
  store._lastRfqSyncMap.clear();
}

function recordCommittedAudit(store, entry) {
  store.auditLogs.unshift(entry);
  logger.audit(entry.action, entry.userEmail || SYSTEM_ACTOR_EMAIL, {
    rfqNumber: entry.rfqNumber,
    ipAddress: entry.ipAddress,
    shaSignature: entry.shaSignature,
  }, entry.rfqNumber);
}

function notifyCommittedAward(store, rfq, values) {
  try {
    store.notifyBuyer(rfq.buyerAccountId || values.approverEmail, {
      kind: 'po_approved',
      title: `Pre-PO Approved — ${rfq.rfqNumber}`,
      message: `Pre-Purchase order ${values.poNumber} awarded to ${values.vendorName} (₹${Number(values.totalAmount).toLocaleString()}).`,
      meta: {
        poNumber: values.poNumber,
        rfqNumber: rfq.rfqNumber,
        vendorId: values.vendorId,
        vendorName: values.vendorName,
        totalAmount: values.totalAmount,
      },
    });
  } catch (error) {
    logger.error('Purchase order was saved but buyer notification processing failed', {
      error,
      rfqId: rfq.id,
      rfqNumber: rfq.rfqNumber,
    }, 'PURCHASE_ORDER');
  }

  if (!values.vendorId) return;
  try {
    const vendorNotification = store._buildNotification({
      recipientType: 'vendor',
      recipientId: values.vendorId,
      kind: 'po_awarded',
      rfq,
      title: `Pre-Purchase Order Awarded — ${rfq.rfqNumber}`,
      message: `Congratulations! ${rfq.buyerAccountName || 'The buyer'} has approved and awarded pre-purchase order ${values.poNumber} to you.`,
      meta: {
        poNumber: values.poNumber,
        rfqNumber: rfq.rfqNumber,
        totalAmount: values.totalAmount,
      },
    });
    store.notifications.unshift(vendorNotification);
    store._persistNotification(vendorNotification);
  } catch (error) {
    logger.error('Purchase order was saved but vendor notification processing failed', {
      error,
      rfqId: rfq.id,
      rfqNumber: rfq.rfqNumber,
      vendorId: values.vendorId,
    }, 'PURCHASE_ORDER');
  }
}

async function approvePurchaseOrderDurably(store, rfqNumber, vendorId, vendorName, totalAmount, approverNotes = '', approverEmail = null) {
  if (!pool.hasStorage()) {
    return store.approvePurchaseOrder(rfqNumber, vendorId, vendorName, totalAmount, approverNotes, approverEmail);
  }

  await store.getRFQByIdAsync(rfqNumber);
  const rfq = getCachedRFQ(store, rfqNumber);
  if (!rfq) return null;
  if (isFinalized(rfq)) {
    return store.approvePurchaseOrder(rfqNumber, vendorId, vendorName, totalAmount, approverNotes, approverEmail);
  }

  const poNumber = rfq.poNumber || (`PO-2026-` + (rfqNumber || '').replace('RFQ-2026-', ''));
  const issueDate = rfq.poIssueDate || new Date().toISOString().substring(0, 10);
  const actorEmail = approverEmail || (store.activeBuyerAccount
    ? store.activeBuyerAccount.corporateEmail
    : SYSTEM_ACTOR_EMAIL);
  const auditAction = `Formally approved & sealed Pre-Purchase Order ${poNumber} awarded to ${vendorName} (₹${Number(totalAmount).toLocaleString()}). Notes: ${approverNotes}`;
  const auditEntry = createAuditEntry({
    userEmail: actorEmail,
    action: auditAction,
    rfqNumber,
    previousHash: store.auditLogs[0]?.shaSignature || '',
  });

  const quotes = Array.isArray(rfq.quotes)
    ? rfq.quotes.map((quote) => {
      const isAwarded = (vendorId && quote.vendorId === vendorId) ||
        (vendorName && quote.vendorName && quote.vendorName.toLowerCase().trim() === vendorName.toLowerCase().trim());
      return {
        ...quote,
        status: isAwarded ? 'Awarded' : (quote.status || 'Submitted'),
        awarded: isAwarded,
      };
    })
    : rfq.quotes;
  const updatedRFQ = {
    ...rfq,
    status: 'PO Generated',
    awardedVendorId: vendorId || null,
    awardedVendor: vendorName,
    awardedAmount: totalAmount,
    poNumber,
    poIssueDate: issueDate,
    poFinalised: true,
    ...(Array.isArray(quotes) ? { quotes } : {}),
    poShaSignature: auditEntry.shaSignature,
  };
  const values = { rfqNumber, vendorId, vendorName, totalAmount, issueDate, poNumber, approverEmail };

  let committed;
  try {
    committed = await purchaseOrderQueries.approvePurchaseOrderInDB({
      rfqIdOrNumber: rfqNumber,
      updates: {
        status: updatedRFQ.status,
        awardedVendorId: updatedRFQ.awardedVendorId,
        awardedVendor: updatedRFQ.awardedVendor,
        awardedAmount: updatedRFQ.awardedAmount,
        poNumber: updatedRFQ.poNumber,
        poIssueDate: updatedRFQ.poIssueDate,
        poFinalised: updatedRFQ.poFinalised,
        ...(Array.isArray(quotes) ? { quotes } : {}),
        poShaSignature: updatedRFQ.poShaSignature,
      },
      auditEntry,
    });
  } catch (error) {
    logger.error('Failed to save purchase-order approval', {
      error,
      rfqId: rfq.id,
      rfqNumber,
      operation: 'approve-purchase-order',
    }, 'PURCHASE_ORDER');
    const persistError = new Error('The purchase order could not be saved. Try again.');
    persistError.statusCode = error.statusCode || 503;
    persistError.code = error.code || 'PERSISTENCE_UNAVAILABLE';
    persistError.cause = error;
    throw persistError;
  }

  if (!committed) {
    await store.getRFQByIdAsync(rfqNumber);
    const latestRFQ = getCachedRFQ(store, rfqNumber);
    if (latestRFQ && isFinalized(latestRFQ)) {
      return store.approvePurchaseOrder(rfqNumber, vendorId, vendorName, totalAmount, approverNotes, approverEmail);
    }
    return null;
  }

  updateRFQCache(store, committed.rfq);
  recordCommittedAudit(store, committed.auditEntry);
  notifyCommittedAward(store, committed.rfq, values);
  return purchaseOrderResponse(committed.rfq, values, committed.auditEntry.shaSignature);
}

module.exports = { approvePurchaseOrderDurably, purchaseOrderResponse, isFinalized };
