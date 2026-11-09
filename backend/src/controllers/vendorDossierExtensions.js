const storeService = require('../services/storeService');
const domainQueries = require('../db/domainQueries');
const pool = require('../db/pool');
const zohoReconciliationService = require('../services/zohoReconciliationService');
const { logger } = require('../services/loggerService');
const { VENDOR_FREE_CREDITS_LIMIT } = require('../config/constants');

function assertCategoryManagerOrAdmin(req, res) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'category_manager' || user.role === 'admin') return true;
  res.status(403).json({ success: false, error: 'Unauthorized: Only category managers and admins can allocate quote credits.' });
  return false;
}

function assertCategoryManagerOrVendor(req, res, vendorOrEmail = null) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'category_manager' || user.role === 'admin') return true;
  if (user.role === 'vendor') {
    if (!vendorOrEmail) return true;
    const vendorEmail = (typeof vendorOrEmail === 'string' && vendorOrEmail.includes('@') ? vendorOrEmail : vendorOrEmail?.email) || '';
    const vendorId = typeof vendorOrEmail === 'object' ? vendorOrEmail?.id : (typeof vendorOrEmail === 'string' && !vendorOrEmail.includes('@') ? vendorOrEmail : null);
    if (user.email && vendorEmail && vendorEmail.toLowerCase() === user.email.toLowerCase()) {
      return true;
    }
    if (vendorId && (user.vendorId === vendorId || user.id === vendorId || user.sub === vendorId)) {
      return true;
    }
  }
  res.status(403).json({ success: false, error: 'You do not have permission to access supplier dossier.' });
  return false;
}

async function resolveVendor(id, user) {
  let vendor = storeService.getVendorById(id, 'all');
  if (!vendor) {
    vendor = await storeService.getVendorByIdWithDBFallback(id, 'all');
  }
  if (!vendor && user?.role === 'vendor' && user.email) {
    vendor = storeService.getVendorById(user.email, 'all');
    if (!vendor) {
      vendor = await storeService.getVendorByIdWithDBFallback(user.email, 'all');
    }
  }
  return vendor;
}

async function getCreditHistory(req, res, next) {
  try {
    const { id } = req.params;
    if (!assertCategoryManagerOrVendor(req, res)) return;
    const vendor = await resolveVendor(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Vendor ${id} not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const creditInfo = storeService.getVendorRfqCredits(vendor.id);
    let transactions = await domainQueries.getVendorCreditTransactionsFromDB(vendor.id, 100);

    const alloc = creditInfo.freeCreditsAllocated || 5;
    if (!transactions || transactions.length === 0) {
      await domainQueries.recordCreditTransactionInDB({
        id: `vtx-init-${vendor.id.slice(0, 8)}`,
        vendorId: vendor.id,
        rfqId: null,
        transactionType: 'INITIAL_ALLOCATION',
        amount: alloc,
        balanceAfter: alloc,
        idempotencyKey: `init-${vendor.id}`,
      });

      const unlockedIds = creditInfo.unlockedRfqIds || [];
      let runningBal = alloc;
      for (const rfqId of unlockedIds) {
        if (runningBal > 0) {
          runningBal = Math.max(0, runningBal - 1);
          try {
            await domainQueries.recordCreditTransactionInDB({
              id: `vtx-rfq-${vendor.id.slice(0, 5)}-${String(rfqId).slice(0, 8)}`,
              vendorId: vendor.id,
              rfqId: String(rfqId),
              transactionType: 'RFQ_UNLOCK',
              amount: -1,
              balanceAfter: runningBal,
              idempotencyKey: `unlock-${vendor.id}-${rfqId}`,
            });
          } catch (err) {
            logger.warn('Failed to record initial unlock transaction for vendor', { vendorId: vendor.id, rfqId, error: err.message }, 'VENDOR_DOSSIER');
          }
        }
      }

      transactions = await domainQueries.getVendorCreditTransactionsFromDB(vendor.id, 100);
    }

    let totalAllocated = 0;
    let totalConsumed = 0;
    let purchasedCredits = 0;
    let adjustedCredits = 0;

    for (const t of transactions) {
      const type = String(t.transaction_type || '').toUpperCase();
      const amt = Math.abs(Number(t.amount || 0));
      if (/INITIAL|ALLOCATION|ADDITION/.test(type)) {
        totalAllocated += amt;
      } else if (/PURCHASE|UPGRADE/.test(type)) {
        purchasedCredits += amt;
        totalAllocated += amt;
      } else if (/ADJUSTMENT|REFUND/.test(type)) {
        adjustedCredits += amt;
      } else if (Number(t.amount || 0) < 0 || type.includes('UNLOCK')) {
        totalConsumed += amt;
      }
    }

    if (totalAllocated === 0) {
      totalAllocated = alloc;
    }

    if (totalConsumed === 0 && Number(creditInfo.freeCreditsUsed || 0) > 0) {
      totalConsumed = Number(creditInfo.freeCreditsUsed);
    }

    const curBal = creditInfo.freeCreditsRemaining ?? Math.max(0, totalAllocated - totalConsumed);
    const summary = {
      totalCreditsAllocated: totalAllocated,
      totalCreditsConsumed: totalConsumed,
      remainingFreeCredits: curBal,
      purchasedCredits,
      adjustedCredits,
      currentCreditBalance: curBal,
      isSubscribed: Boolean(creditInfo.isSubscribed),
      subscriptionPlan: creditInfo.subscriptionPlan || vendor.subscriptionPlan || 'Free Tier',
    };

    const formattedTransactions = (transactions || []).map((t) => {
      const amt = Number(t.amount || 0);
      const isDeduction = amt < 0 || String(t.transaction_type).includes('UNLOCK');
      const txType = t.transaction_type || (isDeduction ? 'Credits Consumed' : 'Credits Added');
      let creditSource = 'Qua Quotation Engine';
      if (String(txType).includes('INITIAL')) {
        creditSource = 'Free Tier Allocation';
      } else if (String(txType).includes('UPGRADE')) {
        creditSource = 'Subscription Upgrade';
      }

      const balAfter = Number(t.balance_after ?? 0);
      return {
        id: t.id,
        transactionId: t.id,
        transactionDate: t.created_at || new Date().toISOString(),
        transactionType: txType,
        creditSource,
        creditsAdded: isDeduction ? 0 : Math.abs(amt),
        creditsConsumed: isDeduction ? Math.abs(amt) : 0,
        previousBalance: balAfter + (isDeduction ? Math.abs(amt) : -Math.abs(amt)),
        updatedBalance: balAfter,
        relatedRfqId: t.rfq_id || null,
        paymentReference: t.idempotency_key || null,
        status: 'COMPLETED',
        description: t.description || (isDeduction ? `Quotation submission unlock for RFQ ${t.rfq_id || 'Direct'}` : 'Quotation credit allocation'),
      };
    });

    return res.json({ success: true, summary, transactions: formattedTransactions });
  } catch (err) {
    logger.error('Error fetching vendor credit history', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function getVendorCommunications(req, res, next) {
  try {
    const { id } = req.params;
    if (!assertCategoryManagerOrVendor(req, res)) return;
    const vendor = await resolveVendor(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Vendor ${id} not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const paymentDuesQueries = require('../db/paymentDuesQueries');
    const comms = await paymentDuesQueries.getCommunicationHistory(vendor.id);
    return res.json({ success: true, data: comms });
  } catch (err) {
    logger.error('Error fetching vendor communications', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function recordVendorCommunication(req, res, next) {
  try {
    const { id } = req.params;
    if (!assertCategoryManagerOrVendor(req, res)) return;
    const vendor = await resolveVendor(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Vendor ${id} not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const {
      channel,
      recipient,
      subject,
      message,
      notes,
      metadata,
      callOutcome,
      duration,
      nextFollowupDate,
      followupPriority,
      followupAssigneeId,
      followupAssigneeName,
      followupNotes,
    } = req.body || {};
    const paymentDuesQueries = require('../db/paymentDuesQueries');
    const internalTaskQueries = require('../db/internalTaskQueries');

    const normalizedChannel = (channel || 'EMAIL').toUpperCase();
    const commNotes = [
      callOutcome ? `Call Outcome: ${callOutcome}` : null,
      duration ? `Duration: ${duration}` : null,
      notes || null,
    ].filter(Boolean).join(' | ');

    const isStaff = !req.user || ['admin', 'category_manager', 'support'].includes(req.user?.role);
    const smsService = require('../services/smsService');
    const normalizedVendorPhone = smsService.formatMobileNumber(recipient);
    const emailTo = (recipient && recipient.includes('@')) ? recipient : vendor.email;
    const smsTo = (normalizedVendorPhone && normalizedVendorPhone.length === 10)
      ? normalizedVendorPhone
      : vendor.phone;
    const shouldDispatchEmail = isStaff && normalizedChannel === 'EMAIL' && Boolean(emailTo);
    const shouldDispatchSms = isStaff && normalizedChannel === 'SMS' && Boolean(smsTo);
    const deliveryPending = shouldDispatchEmail || shouldDispatchSms;

    const record = await paymentDuesQueries.recordCommunication({
      accountId: vendor.id,
      accountType: 'vendor',
      channel: normalizedChannel,
      subject: subject || null,
      message: message || '',
      notificationStatus: deliveryPending ? 'Delivery Pending' : 'Delivered',
      deliveryStatus: deliveryPending ? 'Pending' : 'Delivered',
      acknowledgementStatus: deliveryPending ? 'Delivery Pending' : 'Acknowledgement Pending',
      communicatedBy: req.user?.fullName || req.user?.name || req.user?.email || 'Category Manager',
      notes: commNotes || null,
      metadata: {
        ...(metadata || {}),
        callOutcome: callOutcome || null,
        duration: duration || null,
        nextFollowupDate: nextFollowupDate || null,
        ...(shouldDispatchEmail ? {
          deliveryEmailSubject: `[Procucev] ${subject || 'Supplier Communication'}`,
          ...(req.user?.email ? { deliveryReplyTo: req.user.email } : {}),
        } : {}),
        ...(shouldDispatchSms ? {
          deliveryRecipientName: vendor.companyName || vendor.name || 'Supplier',
          deliveryEntityType: 'supplier_dossier',
        } : {}),
      },
      recipient: shouldDispatchEmail
        ? emailTo
        : shouldDispatchSms
          ? smsTo
          : recipient || vendor.email || vendor.phone || '',
    });

    let deliveryRecord = record;
    if (deliveryPending && pool.hasStorage()) {
      try {
        const eventOutboxService = require('../services/eventOutboxService');
        await eventOutboxService.dispatchDueEventOutboxJobs(1);
      } catch (dispatchError) {
        logger.error('Immediate supplier dossier delivery failed; durable recovery will retry', {
          error: dispatchError,
          vendorId: vendor.id,
          communicationId: record.id,
        }, 'VENDOR_CONTROLLER');
      }
      try {
        const current = await paymentDuesQueries.getCommunicationById(record.id);
        if (current) deliveryRecord = current;
        else logger.error('Supplier dossier communication disappeared after durable delivery was queued', {
          vendorId: vendor.id,
          communicationId: record.id,
        }, 'VENDOR_CONTROLLER');
      } catch (lookupError) {
        logger.error('Supplier dossier delivery state could not be reloaded after queueing', {
          error: lookupError,
          vendorId: vendor.id,
          communicationId: record.id,
        }, 'VENDOR_CONTROLLER');
      }
    } else {
      let deliveryError = null;
      if (shouldDispatchEmail) {
        try {
          const mailerService = require('../services/mailerService');
          if (typeof mailerService.deliver !== 'function') {
            throw new Error('Shared email delivery service is unavailable.');
          }
          const result = await mailerService.deliver({
            to: emailTo,
            subject: '[Procucev] ' + (subject || 'Supplier Communication'),
            text: message || commNotes || '',
            replyTo: req.user?.email || undefined,
          }, 'SUPPLIER_DOSSIER_COMM');
          if (!result?.sent) deliveryError = new Error(result?.reason || 'Email provider did not accept the message.');
        } catch (error) {
          deliveryError = error;
          logger.error('Supplier dossier email dispatch failed', { error, vendorId: vendor.id, communicationId: record.id }, 'VENDOR_CONTROLLER');
        }
      } else if (shouldDispatchSms) {
        try {
          const result = await smsService.sendActionCenterSms({
            mobile: smsTo,
            recipientName: vendor.companyName || vendor.name || 'Supplier',
            message: message || subject || 'Supplier notification',
            entityType: 'supplier_dossier',
          });
          if (!result?.success) deliveryError = new Error(result?.error || 'SMS provider did not accept the message.');
        } catch (error) {
          deliveryError = error;
          logger.error('Supplier dossier SMS dispatch failed', { error, vendorId: vendor.id, communicationId: record.id }, 'VENDOR_CONTROLLER');
        }
      }

      if (deliveryPending) {
        const delivered = !deliveryError;
        const status = delivered ? 'Delivered' : 'Failed';
        try {
          const updated = await paymentDuesQueries.updateCommunicationDeliveryStatus({
            communicationId: record.id,
            notificationStatus: delivered ? 'Notification Sent' : 'Failed',
            deliveryStatus: status,
            acknowledgementStatus: delivered ? 'Acknowledgement Pending' : 'Failed',
          });
          if (updated) {
            deliveryRecord = updated;
          } else {
            logger.error('Supplier dossier delivery result could not be matched to its persisted communication', {
              vendorId: vendor.id,
              communicationId: record.id,
              deliveryStatus: status,
            }, 'VENDOR_CONTROLLER');
          }
        } catch (statusError) {
          logger.error('Supplier dossier delivery result could not be saved; communication remains pending', {
            error: statusError,
            vendorId: vendor.id,
            communicationId: record.id,
            providerAccepted: delivered,
          }, 'VENDOR_CONTROLLER');
        }
      }
    }

    const vendorLabel = vendor.companyName || vendor.name || vendor.businessName || 'Supplier';

    let completedTask = null;
    try {
      const channelLabel = normalizedChannel === 'CALL' ? 'Call' : normalizedChannel === 'WHATSAPP' ? 'WhatsApp' : normalizedChannel === 'SMS' ? 'SMS' : 'Email';
      const actor = req.user || { name: 'Category Manager', email: 'category.manager@procucev.com' };
      completedTask = await internalTaskQueries.createInternalTask({
        title: `[${channelLabel} Log / Completed] ${subject || vendorLabel}`,
        description: message || commNotes || 'Vendor communication activity recorded.',
        taskTypeId: 'itt_vendor_followup',
        priority: 'Medium',
        status: 'Completed',
        relatedEntityType: 'VENDOR',
        relatedEntityId: vendor.id,
        relatedEntityLabel: vendorLabel,
        assignedToUserId: actor.uuid || actor.id || null,
        assignedToName: actor.fullName || actor.name || actor.email || 'Category Manager',
        dueDate: new Date().toISOString(),
        notes: commNotes || '',
      }, actor);
    } catch (taskErr) {
      logger.warn('Failed to create completed internal task for vendor communication', { error: taskErr.message }, 'VENDOR_CONTROLLER');
    }

    let followupTask = null;
    if (nextFollowupDate) {
      try {
        const actor = req.user || { name: 'Category Manager', email: 'category.manager@procucev.com' };
        followupTask = await internalTaskQueries.createInternalTask({
          title: `[Follow-up] ${vendorLabel} - ${subject || 'Vendor Follow-up'}`,
          description: followupNotes || `Follow-up needed following ${normalizedChannel} outreach: ${message || ''}`,
          taskTypeId: 'itt_vendor_followup',
          priority: followupPriority || 'Medium',
          status: 'Pending',
          relatedEntityType: 'VENDOR',
          relatedEntityId: vendor.id,
          relatedEntityLabel: vendorLabel,
          assignedToUserId: followupAssigneeId || actor.uuid || actor.id || null,
          assignedToName: followupAssigneeName || actor.fullName || actor.name || actor.email || 'Category Manager',
          dueDate: nextFollowupDate,
          notes: followupNotes || '',
        }, actor);
      } catch (followupErr) {
        logger.warn('Failed to create pending follow-up internal task for vendor communication', { error: followupErr.message }, 'VENDOR_CONTROLLER');
      }
    }

    return res.status(201).json({ success: true, data: deliveryRecord, completedTask, followupTask });
  } catch (err) {
    logger.error('Error recording vendor communication', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function getVendorPaymentHistory(req, res, next) {
  try {
    const { id } = req.params;
    if (!assertCategoryManagerOrVendor(req, res)) return;
    const vendor = await resolveVendor(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Vendor ${id} not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    let links = await storeService.getPaymentLinksForVendor(vendor.id);
    const reconciled = await zohoReconciliationService.reconcilePendingLinks(links);
    if (reconciled > 0) {
      links = await storeService.getPaymentLinksForVendor(vendor.id);
    }

    const payments = [];
    const planName = vendor.subscriptionPlan || 'Preferred Partner';
    // Subscription state is not proof of a payment; only provider records count.
    for (const link of links) {
      const linkDate = link.createdAt || new Date().toISOString();
      payments.push({
        id: link.id,
        paymentId: link.id,
        invoiceNo: link.invoiceNumber || `SUP-INV-2026-${link.id.slice(0, 6).toUpperCase()}`,
        invoiceNumber: link.invoiceNumber || `SUP-INV-2026-${link.id.slice(0, 6).toUpperCase()}`,
        description: `Subscription Renewal: ${link.planId || planName}`,
        subscriptionPlan: link.planId || planName,
        amount: Number(link.amount || 0),
        currency: link.currency || 'INR',
        gateway: 'Zoho Payments',
        paymentMethod: 'Credit Card / NetBanking / UPI',
        status: String(link.status || 'CREATED').toUpperCase(),
        gatewayRef: link.zohoPaymentLinkId || link.id,
        date: linkDate,
        transactionDate: linkDate,
        receiptUrl: `/api/vendors/${vendor.id}/payment-links/${link.id}/invoice`,
      });
    }

    let totalPaid = 0;
    let totalSuccessful = 0;
    let pending = 0;
    let failed = 0;
    let refunded = 0;

    for (const p of payments) {
      const st = String(p.status).toUpperCase();
      if (st === 'PAID' || st === 'SUCCESS' || st === 'COMPLETED') {
        totalPaid += p.amount;
        totalSuccessful += 1;
      } else if (st === 'PENDING' || st === 'CREATED' || st === 'IN_PROGRESS') {
        pending += 1;
      } else if (st === 'FAILED' || st === 'EXPIRED') {
        failed += 1;
      } else if (st === 'REFUNDED') {
        refunded += p.amount;
      }
    }

    const summary = {
      totalAmountPaid: totalPaid,
      totalSuccessfulPayments: totalSuccessful,
      pendingPayments: pending,
      failedPayments: failed,
      totalRefundedAmount: refunded,
    };

    return res.json({ success: true, summary, payments });
  } catch (err) {
    logger.error('Error fetching vendor payment history', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}


/**
 * POST /api/vendors/:id/add-quote-credits
 * Category Manager / Admin allows adding quote credits strictly in range 1 to 5.
 */
async function addQuoteCredits(req, res, next) {
  try {
    if (!assertCategoryManagerOrAdmin(req, res)) return;
    const { id } = req.params;
    const vendor = await resolveVendor(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Seller "${id}" not found.` });
    }

    const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
    const pool = require('../db/pool');
    const crypto = require('crypto');

    const validation = validatePayload(VALIDATION_SCHEMAS.sellerAddQuoteCredits, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.amount || 'Quote credits must be an integer between 1 and 5.',
        details: validation.errors,
      });
    }

    const amount = Number(validation.sanitizedData.amount);
    const reason = validation.sanitizedData.reason || 'Manual quote credit addition by Category Manager';

    const currentBalance = vendor.freeQuotationCredits !== undefined
      ? Number(vendor.freeQuotationCredits)
      : (vendor.credits !== undefined ? Number(vendor.credits) : VENDOR_FREE_CREDITS_LIMIT);

    const updatedBalance = currentBalance + amount;

    const txId = `vtx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const tx = {
      id: txId,
      vendorId: vendor.id,
      rfqId: null,
      transactionType: 'Quote Credit Addition',
      amount,
      balanceAfter: updatedBalance,
      idempotencyKey: `quote-credit-${txId}`,
      description: reason,
      createdAt: new Date().toISOString(),
    };

    // Authoritative database update and audit trail within an atomic transaction block
    if (pool.hasStorage()) {
      const client = (pool.pool && typeof pool.pool.connect === 'function')
        ? await pool.pool.connect()
        : (typeof pool.connect === 'function' ? await pool.connect() : pool);
      let inTx = false;
      try {
        if (typeof client.query === 'function') {
          await client.query('BEGIN');
          inTx = true;
          await client.query(
            "UPDATE vendors SET credits = $1, raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{freeQuotationCredits}', $2) WHERE id = $3",
            [updatedBalance, JSON.stringify(updatedBalance), vendor.id]
          );
          await client.query(
            `INSERT INTO vendor_credit_transactions (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [tx.id, tx.vendorId, tx.rfqId, tx.transactionType, tx.amount, tx.balanceAfter, tx.idempotencyKey]
          );
          await client.query('COMMIT');
          inTx = false;
        }
      } catch (dbErr) {
        if (inTx && typeof client.query === 'function') {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            logger.error('Vendor quote-credit transaction rollback failed', {
              error: rollbackError,
              operation: 'rollback-vendor-quote-credit-transaction',
              vendorId: vendor.id,
              transactionId: tx.id,
            }, 'VENDOR_CONTROLLER');
          }
        }
        logger.error('Failed to update vendor credits atomically in PostgreSQL transaction', dbErr, 'VENDOR_CONTROLLER');
        return res.status(500).json({
          success: false,
          error: 'Failed to update vendor quote credits due to a database error.',
        });
      } finally {
        if (client && typeof client.release === 'function') {
          client.release();
        }
      }
    }

    try {
      const { queryCache } = require('../db/queryCache');
      if (queryCache && typeof queryCache.invalidate === 'function') {
        queryCache.invalidate('vendor_credits');
        queryCache.invalidate('vendors');
      }
    } catch (cacheError) {
      logger.warn('Vendor quote-credit write committed but local query-cache invalidation failed', {
        error: cacheError,
        operation: 'invalidate-vendor-quote-credit-cache',
        vendorId: vendor.id,
        cacheTags: ['vendor_credits', 'vendors'],
      }, 'VENDOR_CONTROLLER');
    }

    // Update in-memory vendor balance only after database transaction succeeds
    storeService.updateVendor(vendor.id, {
      freeQuotationCredits: updatedBalance,
      freeRfqDownloadCredits: updatedBalance,
      credits: updatedBalance,
    });

    const actor = req.user
      ? (req.user.fullName || req.user.name || req.user.email || 'Category Manager')
      : 'Category Manager';

    logger.info(`Quote credits added to vendor ${vendor.id}: +${amount} (New Balance: ${updatedBalance}) by ${actor}`, { vendorId: vendor.id, amount }, 'VENDOR_CONTROLLER');

    return res.json({
      success: true,
      message: `Successfully allocated ${amount} quote credits to ${vendor.name || vendor.id}.`,
      previousBalance: currentBalance,
      updatedBalance,
      transaction: tx,
    });
  } catch (err) {
    logger.error('Error adding vendor quote credits', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

/**
 * POST /api/vendors/:id/request-credit-approval
 * Submits quote credit allocation request for senior approver authorization.
 * Creates an internal task in CREDIT_MANAGEMENT and links to the approvals module.
 */
async function requestCreditApproval(req, res, next) {
  try {
    if (!assertCategoryManagerOrAdmin(req, res)) return;
    const { id } = req.params;
    const vendor = await resolveVendor(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Seller "${id}" not found.` });
    }

    const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
    const internalTaskQueries = require('../db/internalTaskQueries');
    const approvalQueries = require('../db/approvalQueries');

    const validation = validatePayload(VALIDATION_SCHEMAS.buyerCreditApprovalRequest, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on quote credit approval request.',
        details: validation.errors,
      });
    }

    const { amount, reason, approverName, initiatorName } = validation.sanitizedData;

    const vendorLabel = vendor.name || vendor.id;
    const taskReason = reason || `Requested quote credit top-up for ${vendorLabel}`;

    const task = await internalTaskQueries.createInternalTask(
      {
        taskCategory: 'CREDIT_MANAGEMENT',
        taskType: 'Add Credits',
        title: `Quote Credit Allocation Request: ${amount} Credits for ${vendorLabel}`,
        description: taskReason,
        priority: 'High',
        status: 'Pending Approval',
        approvalStatus: 'PENDING',
        assignedToName: approverName,
        assignedTeam: 'Management Approvers',
        creditAccountType: 'seller',
        creditAccountId: vendor.id,
        creditAccountName: vendorLabel,
        creditQuantity: amount,
        creditReason: reason,
        notes: `Initiated By: ${initiatorName}. Requires review and approval by ${approverName}.`,
        relatedEntityType: 'SELLER',
        relatedEntityId: vendor.id,
        relatedEntityLabel: vendorLabel,
      },
      {
        fullName: initiatorName,
        name: initiatorName,
        email: req.user?.email || 'cm@procucev.com',
        role: 'category_manager',
      }
    );

    // Link to Approvals section
    await approvalQueries.createApproval(
      {
        module: 'Seller Credit Addition',
        request_type: 'Seller Credit Addition',
        project: vendorLabel,
        applicant_name: vendorLabel,
        applicant_email: vendor.email || '',
        value_impact: `${amount} Quote Credits (${vendorLabel})`,
        amount,
        quantity: amount,
        available_balance: vendor.freeQuotationCredits ?? VENDOR_FREE_CREDITS_LIMIT,
        maker_name: initiatorName,
        maker_role: 'Category Manager',
        assigned_approver: approverName,
        status: 'Pending',
        details: taskReason,
        internal_task_id: task.id,
        seller_id: vendor.id,
        history: [
          {
            action: 'SUBMITTED',
            actor_name: initiatorName,
            actor_role: 'Category Manager',
            timestamp: new Date().toISOString(),
            remarks: reason || `Submitted quote credit addition for approval (${approverName}).`,
          },
        ],
      },
      {
        fullName: initiatorName,
        name: initiatorName,
        email: req.user?.email || 'cm@procucev.com',
        role: 'category_manager',
      }
    );

    logger.info(
      `Quote credit approval request created: ${task.task_number} (${amount} credits for ${vendor.name || vendor.id}) assigned to ${approverName}`,
      { sellerId: id, amount, approverName },
      'VENDOR_DOSSIER_EXTENSIONS'
    );

    return res.status(201).json({
      success: true,
      message: `Quote credit request submitted for approval by ${approverName}. Status: Pending Approval.`,
      task,
    });
  } catch (err) {
    logger.error('Error requesting quote credit approval for seller', err, 'VENDOR_DOSSIER_EXTENSIONS');
    next(err);
  }
}

module.exports = {
  assertCategoryManagerOrAdmin,
  assertCategoryManagerOrVendor,
  resolveVendor,
  getCreditHistory,
  getVendorCommunications,
  recordVendorCommunication,
  getVendorPaymentHistory,
  addQuoteCredits,
  requestCreditApproval,
};
