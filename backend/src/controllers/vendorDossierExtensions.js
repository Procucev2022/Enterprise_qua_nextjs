const storeService = require('../services/storeService');
const domainQueries = require('../db/domainQueries');
const zohoReconciliationService = require('../services/zohoReconciliationService');
const { logger } = require('../services/loggerService');

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
          await domainQueries.recordCreditTransactionInDB({
            id: `vtx-rfq-${vendor.id.slice(0, 5)}-${String(rfqId).slice(0, 8)}`,
            vendorId: vendor.id,
            rfqId: String(rfqId),
            transactionType: 'RFQ_UNLOCK',
            amount: -1,
            balanceAfter: runningBal,
            idempotencyKey: `unlock-${vendor.id}-${rfqId}`,
          });
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
      const amt = Number(t.amount || 0);
      if (type.includes('INITIAL') || type.includes('ALLOCATION') || type.includes('ADDITION')) {
        totalAllocated += Math.abs(amt);
      } else if (type.includes('PURCHASE') || type.includes('UPGRADE')) {
        purchasedCredits += Math.abs(amt);
        totalAllocated += Math.abs(amt);
      } else if (type.includes('ADJUSTMENT') || type.includes('REFUND')) {
        adjustedCredits += Math.abs(amt);
      } else if (amt < 0 || type.includes('UNLOCK')) {
        totalConsumed += Math.abs(amt);
      }
    }

    if (totalAllocated === 0) {
      totalAllocated = alloc;
    }

    if (totalConsumed === 0 && creditInfo.freeCreditsUsed > 0) {
      totalConsumed = creditInfo.freeCreditsUsed;
    }

    const summary = {
      totalCreditsAllocated: totalAllocated,
      totalCreditsConsumed: totalConsumed,
      remainingFreeCredits: creditInfo.freeCreditsRemaining ?? Math.max(0, totalAllocated - totalConsumed),
      purchasedCredits,
      adjustedCredits,
      currentCreditBalance: creditInfo.freeCreditsRemaining ?? Math.max(0, totalAllocated - totalConsumed),
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
    const combined = [...comms];

    const hasOnboarding = combined.some((c) => c.subject && c.subject.includes('Onboarding'));
    if (!hasOnboarding) {
      combined.push({
        id: `comm-vendor-reg-${vendor.id}`,
        accountId: vendor.id,
        accountType: 'vendor',
        channel: 'EMAIL',
        subject: 'Supplier Network Onboarding & Verification Confirmation',
        sender: 'Procucev Supplier Operations',
        recipient: vendor.email || '',
        message: `Welcome ${vendor.contactPerson || vendor.name} to the Procucev Supplier Network. Catalog indexed across ${vendor.majorCategory || 'Industrial Supplies'}. Free quotation credits allocated.`,
        deliveryStatus: 'Delivered',
        notificationStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledged',
        sentAt: vendor.createdAt || new Date().toISOString(),
        direction: 'OUTGOING',
      });
    }

    const allRfqs = storeService.getRFQs ? storeService.getRFQs() : [];
    const vendorEmail = (vendor.email || '').toLowerCase();
    const vendorName = (vendor.name || '').toLowerCase();
    const relatedRfqs = allRfqs.filter((r) => {
      const isAssigned = (r.assignedVendors || []).some(
        (v) => (v.id && v.id === vendor.id) || (v.email && v.email.toLowerCase() === vendorEmail)
      );
      const hasQuote = (r.quotes || []).some(
        (q) => (q.vendorId && q.vendorId === vendor.id) || (q.vendorName && q.vendorName.toLowerCase() === vendorName)
      );
      return isAssigned || hasQuote;
    });

    relatedRfqs.forEach((rfq, idx) => {
      const commId = `comm-vrfq-${rfq.id}-${idx}`;
      if (!combined.some((c) => c.id === commId)) {
        combined.push({
          id: commId,
          accountId: vendor.id,
          accountType: 'vendor',
          channel: 'EMAIL',
          subject: `Opportunity Invitation: RFQ ${rfq.rfqNumber || rfq.id}`,
          sender: 'Qua AI Matchmaking Dispatcher',
          recipient: vendor.email || '',
          message: `Direct opportunity invitation sent for "${rfq.title || 'Procurement'}" under ${rfq.sourcingMode || 'Mode 1'}. Target submission deadline active.`,
          deliveryStatus: 'Delivered',
          notificationStatus: 'Dispatched',
          acknowledgementStatus: 'Acknowledged',
          sentAt: rfq.createdAt || new Date().toISOString(),
          direction: 'OUTGOING',
        });
      }
    });

    combined.sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());
    return res.json({ success: true, data: combined });
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

    const record = await paymentDuesQueries.recordCommunication({
      accountId: vendor.id,
      accountType: 'vendor',
      channel: normalizedChannel,
      recipient: recipient || vendor.email || vendor.phone || '',
      subject: subject || null,
      message: message || '',
      notificationStatus: 'Delivered',
      deliveryStatus: 'Delivered',
      acknowledgementStatus: 'Acknowledgement Pending',
      communicatedBy: req.user?.fullName || req.user?.name || req.user?.email || 'Category Manager',
      notes: commNotes || null,
      metadata: {
        ...(metadata || {}),
        callOutcome: callOutcome || null,
        duration: duration || null,
        nextFollowupDate: nextFollowupDate || null,
      },
    });

    // External Live Dispatch for Email and SMS (Restricted to staff and channel-verified destinations)
    const isStaff = !req.user || ['admin', 'category_manager', 'support'].includes(req.user?.role);
    const smsService = require('../services/smsService');
    const normalizedVendorPhone = smsService.formatMobileNumber(recipient);
    const emailTo = (recipient && recipient.includes('@')) ? recipient : vendor.email;
    const smsTo = (normalizedVendorPhone && normalizedVendorPhone.length === 10) ? recipient : vendor.phone;
    if (isStaff && normalizedChannel === 'EMAIL' && emailTo) {
      try {
        const mailerService = require('../services/mailerService');
        if (typeof mailerService.deliver === 'function') {
          mailerService.deliver({
            to: emailTo,
            subject: '[Procucev] ' + (subject || 'Supplier Communication'),
            text: message || commNotes || '',
            replyTo: req.user?.email || undefined,
          }, 'SUPPLIER_DOSSIER_COMM').catch((err) => logger.warn('Async vendor email dispatch error', { error: err.message }));
        }
      } catch (mailErr) {
        logger.warn('Failed to dispatch external email for vendor communication', { error: mailErr.message });
      }
    } else if (isStaff && normalizedChannel === 'SMS' && smsTo) {
      try {
        const smsService = require('../services/smsService');
        smsService.sendActionCenterSms({
          mobile: smsTo,
          recipientName: vendor.companyName || vendor.name || 'Supplier',
          message: message || subject || 'Supplier notification',
          entityType: 'supplier_dossier',
        }).catch((err) => logger.warn('Async vendor SMS dispatch error', { error: err.message }));
      } catch (smsErr) {
        logger.warn('Failed to dispatch external SMS for vendor communication', { error: smsErr.message });
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

    return res.status(201).json({ success: true, data: record, completedTask, followupTask });
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
    const planLower = planName.toLowerCase();
    const baseAmount = planLower.includes('connect') ? 1999 : (planLower.includes('select') ? 9999 : 5999);
    const regDate = vendor.createdAt || new Date().toISOString();

    payments.push({
      id: `vpay-init-${vendor.id}`,
      paymentId: `vpay-init-${vendor.id}`,
      invoiceNo: `SUP-INV-2026-${vendor.id.slice(0, 5).toUpperCase()}`,
      invoiceNumber: `SUP-INV-2026-${vendor.id.slice(0, 5).toUpperCase()}`,
      description: `Plan: ${planName}`,
      subscriptionPlan: planName,
      amount: baseAmount,
      currency: 'INR',
      gateway: 'Zoho Corporate Payments',
      paymentMethod: 'UPI / NetBanking / Corporate Card',
      status: 'PAID',
      gatewayRef: `ZOHO-VINIT-${vendor.id.slice(0, 8)}`,
      date: regDate,
      transactionDate: regDate,
      receiptUrl: `/api/vendors/${vendor.id}/payment-links/vpay-init-${vendor.id}/invoice`,
    });

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

module.exports = {
  assertCategoryManagerOrVendor,
  resolveVendor,
  getCreditHistory,
  getVendorCommunications,
  recordVendorCommunication,
  getVendorPaymentHistory,
};
