const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { RFQ_MODES, RFQ_MODE_LABELS } = require('../config/constants');

const LOG_CATEGORY = 'REPORTS_CONTROLLER';

function parseDateRange(startDateStr, endDateStr) {
  const now = new Date();
  let fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (startDateStr) {
    const parsed = new Date(startDateStr);
    if (!isNaN(parsed.getTime())) {
      fromDate = parsed;
    }
  }
  fromDate.setHours(0, 0, 0, 0);

  let toDate = new Date(now);
  if (endDateStr) {
    const parsed = new Date(endDateStr);
    if (!isNaN(parsed.getTime())) {
      toDate = parsed;
    }
  }
  toDate.setHours(23, 59, 59, 999);

  return { fromDate, toDate };
}

function formatMode(mode) {
  if (!mode) return RFQ_MODE_LABELS[RFQ_MODES.MODE_0] || 'Mode 0';
  return RFQ_MODE_LABELS[mode] || mode;
}

function formatDateISO(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

function formatDateTimeISO(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').substring(0, 19);
}

function str(val, fallback = '') {
  return val ? String(val) : fallback;
}

function findBuyer(allBuyers, rfq) {
  return allBuyers.find((b) => {
    if (rfq.buyerAccountId && b.id === rfq.buyerAccountId) return true;
    if (rfq.buyerAccountName && b.organizationName === rfq.buyerAccountName) return true;
    if (rfq.raisedByEmail && b.corporateEmail === rfq.raisedByEmail) return true;
    return false;
  }) || null;
}

function findVendor(allVendors, id, name) {
  return allVendors.find((v) => {
    if (id && v.id === id) return true;
    if (name && v.name === name) return true;
    return false;
  }) || null;
}

/**
 * GET /api/reports/seller-report
 */
async function getSellerReports(req, res, next) {
  try {
    const { requestType = 'sellerReport', startDate, endDate } = req.query;
    const { fromDate, toDate } = parseDateRange(startDate, endDate);

    logger.info('Generating seller report', { requestType, startDate, endDate }, LOG_CATEGORY);

    const allVendors = Array.isArray(storeService.vendors) ? storeService.vendors : [];
    const allRfqs = Array.isArray(storeService.rfqs) ? storeService.rfqs : [];

    const rows = [];

    if (requestType === 'sellerReport') {
      for (const rfq of allRfqs) {
        const rfqDate = rfq.createdAt ? new Date(rfq.createdAt) : null;
        if (rfqDate && (rfqDate < fromDate || rfqDate > toDate)) continue;

        const assigned = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
        const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];

        const vendorMap = new Map();
        assigned.forEach((av) => {
          vendorMap.set(str(av.id, av.name || av.email), { assigned: av, quote: null });
        });
        quotes.forEach((q) => {
          const key = str(q.vendorId, q.vendorName);
          const existing = vendorMap.get(key);
          if (existing) {
            existing.quote = q;
          } else {
            vendorMap.set(key, { assigned: null, quote: q });
          }
        });

        if (vendorMap.size === 0) {
          rows.push({
            RFQDate: formatDateISO(rfq.createdAt),
            RFQID: str(rfq.rfqNumber, rfq.id),
            SellerCompanyName: 'Open Network',
            Email: '',
            MobileNo: '',
            CompanyLocation: '',
            DeliveryLocation: str(rfq.deliveryLocation),
            LastLogin: '',
            SourceType: str(rfq.source, 'web_portal'),
            RFQDownloadDate: '',
            QuoteSubmittedDate: '',
            SourcingMode: formatMode(rfq.sourcingMode),
            Status: str(rfq.status, 'Quotes Pending'),
            Query: str(rfq.title),
          });
        } else {
          for (const [_, item] of vendorMap) {
            const vId = item.quote ? item.quote.vendorId : (item.assigned ? item.assigned.id : null);
            const vName = item.quote ? item.quote.vendorName : (item.assigned ? item.assigned.name : null);
            const vProfile = findVendor(allVendors, vId, vName);

            rows.push({
              RFQDate: formatDateISO(rfq.createdAt),
              RFQID: str(rfq.rfqNumber, rfq.id),
              SellerCompanyName: str(vName, str(vProfile ? vProfile.name : null, 'Verified Vendor')),
              Email: str(vProfile ? vProfile.email : (item.assigned ? item.assigned.email : '')),
              MobileNo: str(vProfile ? vProfile.phone : (item.assigned ? item.assigned.phone : '')),
              CompanyLocation: str(vProfile ? vProfile.location || vProfile.city : (item.assigned ? item.assigned.city : '')),
              DeliveryLocation: str(rfq.deliveryLocation),
              LastLogin: formatDateTimeISO(vProfile ? (vProfile.updated_at || vProfile.created_at) : null),
              SourceType: str(vProfile ? vProfile.source : rfq.source, 'procucev_network'),
              RFQDownloadDate: formatDateISO(rfq.createdAt),
              QuoteSubmittedDate: formatDateISO(item.quote ? item.quote.submittedAt : null),
              SourcingMode: formatMode(rfq.sourcingMode),
              Status: item.quote ? 'Quote Submitted' : 'Pending Bid',
              Query: str(item.quote ? item.quote.remarks : rfq.title),
            });
          }
        }
      }
    } else if (requestType === 'sellerSummary') {
      for (const vendor of allVendors) {
        const vDate = vendor.created_at ? new Date(vendor.created_at) : new Date(0);
        if (vDate >= fromDate && vDate <= toDate) {
          rows.push({
            LoginDateTime: formatDateTimeISO(vendor.created_at),
            Name: str(vendor.contactPerson, str(vendor.name)),
            MobileNo: str(vendor.phone),
            CompanyName: str(vendor.name),
            EmailID: str(vendor.email),
            CompanyLocation: str(vendor.location, str(vendor.city)),
            MajorCategory: str(vendor.majorCategory),
            SubscriptionPlan: str(vendor.subscriptionPlan, 'standard'),
            RFQDownloadsUsed: vendor.rfqDownloadsUsed !== undefined ? vendor.rfqDownloadsUsed : 0,
            Status: str(vendor.status, 'ACTIVE'),
          });
        }
      }
    } else if (requestType === 'sellerCategoryReport') {
      for (const vendor of allVendors) {
        const cats = Array.isArray(vendor.minorCategories) ? vendor.minorCategories : [];
        const hasMajor = Boolean(vendor.majorCategory);
        const subCats = hasMajor ? cats : cats.slice(1);
        rows.push({
          CompanyName: str(vendor.name),
          Email: str(vendor.email),
          Mobile: str(vendor.phone),
          SellerPerson: str(vendor.contactPerson, str(vendor.name)),
          LastLogin: formatDateTimeISO(vendor.created_at),
          Category1: str(vendor.majorCategory, str(cats[0])),
          Category2: str(subCats[0]),
          Category3: str(subCats[1]),
          Category4: str(subCats[2]),
          Category5: str(subCats[3]),
        });
      }
    } else if (requestType === 'sellerSubscriptionReport') {
      for (const vendor of allVendors) {
        rows.push({
          CompanyName: str(vendor.name),
          ContactPerson: str(vendor.contactPerson),
          Email: str(vendor.email),
          Phone: str(vendor.phone),
          Plan: str(vendor.subscriptionPlan, 'premium'),
          DownloadsUsed: vendor.rfqDownloadsUsed !== undefined ? vendor.rfqDownloadsUsed : 0,
          FreeQuotationCredits: vendor.freeQuotationCredits !== undefined ? vendor.freeQuotationCredits : 10,
          QuotedRFQsCount: Array.isArray(vendor.quotedRfqIds) ? vendor.quotedRfqIds.length : 0,
          Status: str(vendor.status, 'ACTIVE'),
        });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Invalid requestType for seller report' });
    }

    return res.json({
      success: true,
      reportType: requestType,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      totalRecords: rows.length,
      data: rows,
    });
  } catch (err) {
    logger.error('Error in getSellerReports', err, LOG_CATEGORY);
    return next(err);
  }
}

/**
 * GET /api/reports/buyer-report
 */
async function getBuyerReports(req, res, next) {
  try {
    const { requestType = 'buyerReport', startDate, endDate } = req.query;
    const { fromDate, toDate } = parseDateRange(startDate, endDate);

    logger.info('Generating buyer report', { requestType, startDate, endDate }, LOG_CATEGORY);

    const allBuyers = Array.isArray(storeService.buyerAccounts) ? storeService.buyerAccounts : [];
    const allRfqs = Array.isArray(storeService.rfqs) ? storeService.rfqs : [];

    const rows = [];

    if (requestType === 'buyerReport') {
      for (const rfq of allRfqs) {
        const rfqDate = rfq.createdAt ? new Date(rfq.createdAt) : null;
        if (rfqDate && (rfqDate < fromDate || rfqDate > toDate)) continue;

        const buyer = findBuyer(allBuyers, rfq);
        const firstEntity = Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.length > 0 ? rfq.extractedEntities[0] : null;

        rows.push({
          RFQDate: formatDateISO(rfq.createdAt),
          RFQID: str(rfq.rfqNumber, rfq.id),
          BuyerName: str(buyer ? buyer.contactPerson : rfq.buyerAccountName, 'Enterprise Buyer'),
          EmailID: str(buyer ? buyer.corporateEmail : rfq.raisedByEmail),
          MobileNo: str(buyer ? buyer.mobileNumber : ''),
          CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName, 'Enterprise Corp'),
          CompanyLocation: str(buyer ? (buyer.city || buyer.primaryPlantLocation) : ''),
          ItemDescription: str(rfq.title, str(firstEntity ? firstEntity.itemName : '')),
          ItemCategory: str(rfq.category, str(firstEntity ? firstEntity.majorCategory : '')),
          SourcingMode: formatMode(rfq.sourcingMode),
          DeliveryLocation: str(rfq.deliveryLocation),
          LastLogin: formatDateTimeISO(buyer ? (buyer.syncTimestamp || buyer.createdDate) : null),
          RFQSource: str(rfq.source, 'web_portal'),
          RFQQueriesCount: Array.isArray(rfq.inquiries) ? rfq.inquiries.length : 0,
          Status: str(rfq.status, 'Quotes Pending'),
        });
      }
    } else if (requestType === 'buyerSummary') {
      for (const buyer of allBuyers) {
        const bDate = buyer.createdDate ? new Date(buyer.createdDate) : new Date(0);
        if (bDate >= fromDate && bDate <= toDate) {
          rows.push({
            LoginDateTime: formatDateTimeISO(buyer.syncTimestamp || buyer.createdDate),
            BuyerName: str(buyer.contactPerson, str(buyer.organizationName)),
            MobileNo: str(buyer.mobileNumber),
            CompanyName: str(buyer.organizationName),
            EmailID: str(buyer.corporateEmail),
            CompanyLocation: str(buyer.city, str(buyer.primaryPlantLocation)),
            SourcingMode: formatMode(buyer.sourcingMode),
            SubscriptionPlan: str(buyer.subscriptionPlan, 'standard'),
            TotalRFQsCreated: buyer.totalRFQsCreated !== undefined ? buyer.totalRFQsCreated : 0,
            TotalSpend: str(buyer.totalSpend, '₹0'),
            Status: str(buyer.status, 'ACTIVE_VERIFIED'),
          });
        }
      }
    } else if (requestType === 'buyerCategoryReport') {
      for (const buyer of allBuyers) {
        const majors = Array.isArray(buyer.supportedMajorCategories) ? buyer.supportedMajorCategories : [];
        rows.push({
          BuyerName: str(buyer.contactPerson, str(buyer.organizationName)),
          EmailID: str(buyer.corporateEmail),
          MobileNo: str(buyer.mobileNumber),
          CompanyName: str(buyer.organizationName),
          CompanyLocation: str(buyer.city, str(buyer.primaryPlantLocation)),
          LastLoginDate: formatDateTimeISO(buyer.syncTimestamp || buyer.createdDate),
          Category1: str(majors[0]),
          Category2: str(majors[1]),
          Category3: str(majors[2]),
          Category4: str(majors[3]),
          Category5: str(majors[4]),
        });
      }
    } else if (requestType === 'buyerCreditsReport') {
      for (const buyer of allBuyers) {
        const remFree = buyer.remainingFreeRFQs !== undefined ? buyer.remainingFreeRFQs : 5;
        rows.push({
          OrganizationName: str(buyer.organizationName),
          ContactPerson: str(buyer.contactPerson),
          CorporateEmail: str(buyer.corporateEmail),
          MobileNumber: str(buyer.mobileNumber),
          Plan: str(buyer.subscriptionPlan, 'free_trial'),
          SourcingMode: formatMode(buyer.sourcingMode),
          RemainingFreeRFQs: remFree,
          CreditsConsumed: Math.max(0, 5 - remFree),
          TotalRFQsCreated: buyer.totalRFQsCreated !== undefined ? buyer.totalRFQsCreated : 0,
          TotalSpend: str(buyer.totalSpend, '₹0'),
          Status: str(buyer.status, 'ACTIVE_VERIFIED'),
        });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Invalid requestType for buyer report' });
    }

    return res.json({
      success: true,
      reportType: requestType,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      totalRecords: rows.length,
      data: rows,
    });
  } catch (err) {
    logger.error('Error in getBuyerReports', err, LOG_CATEGORY);
    return next(err);
  }
}

/**
 * GET /api/reports/rfq-report
 */
async function getRfqReports(req, res, next) {
  try {
    const { requestType = 'rfqReport', startDate, endDate } = req.query;
    const { fromDate, toDate } = parseDateRange(startDate, endDate);

    logger.info('Generating RFQ report', { requestType, startDate, endDate }, LOG_CATEGORY);

    const allRfqs = Array.isArray(storeService.rfqs) ? storeService.rfqs : [];
    const allBuyers = Array.isArray(storeService.buyerAccounts) ? storeService.buyerAccounts : [];
    const allVendors = Array.isArray(storeService.vendors) ? storeService.vendors : [];

    const rows = [];

    if (requestType === 'rfqReport') {
      for (const rfq of allRfqs) {
        const rDate = rfq.createdAt ? new Date(rfq.createdAt) : null;
        if (rDate && (rDate < fromDate || rDate > toDate)) continue;

        const buyer = findBuyer(allBuyers, rfq);
        const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];
        const firstQuoteDate = quotes.length > 0 && quotes[0].submittedAt ? formatDateISO(quotes[0].submittedAt) : '';

        rows.push({
          RFQDate: formatDateISO(rfq.createdAt),
          RFQID: str(rfq.rfqNumber, rfq.id),
          BuyerName: str(buyer ? buyer.contactPerson : rfq.buyerAccountName, 'Enterprise Buyer'),
          EmailID: str(buyer ? buyer.corporateEmail : rfq.raisedByEmail),
          MobileNo: str(buyer ? buyer.mobileNumber : ''),
          CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName),
          CompanyLocation: str(buyer ? (buyer.city || buyer.primaryPlantLocation) : ''),
          ItemDescription: str(rfq.title),
          ItemCategory: str(rfq.category),
          SourcingMode: formatMode(rfq.sourcingMode),
          DeliveryLocation: str(rfq.deliveryLocation),
          TotalVendors: Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors.length : 0,
          NumberOfQuotesReceived: quotes.length,
          FirstQuoteDate: firstQuoteDate,
          Status: str(rfq.status, 'Quotes Pending'),
          AwardedAmount: rfq.awardedAmount ? `₹${rfq.awardedAmount.toLocaleString('en-IN')}` : '',
        });
      }
    } else if (requestType === 'rfqSummaryReport') {
      for (const rfq of allRfqs) {
        const rDate = rfq.createdAt ? new Date(rfq.createdAt) : null;
        if (rDate && (rDate < fromDate || rDate > toDate)) continue;

        const buyer = findBuyer(allBuyers, rfq);
        const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];

        if (quotes.length === 0) {
          rows.push({
            RFQDate: formatDateISO(rfq.createdAt),
            RFQID: str(rfq.rfqNumber, rfq.id),
            BuyerName: str(buyer ? buyer.contactPerson : rfq.buyerAccountName),
            EmailID: str(buyer ? buyer.corporateEmail : rfq.raisedByEmail),
            MobileNo: str(buyer ? buyer.mobileNumber : ''),
            CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName),
            SourcingMode: formatMode(rfq.sourcingMode),
            DeliveryLocation: str(rfq.deliveryLocation),
            SellerCompanyName: 'None Yet',
            SellerMobile: '',
            SellerEmailID: '',
            SellerLocation: '',
            SellerCategories: '',
            RFQDownloadDate: formatDateISO(rfq.createdAt),
            RFQForwardDate: formatDateISO(rfq.createdAt),
            QuoteSubmittedDate: '',
            QuotedPrice: '',
            Query: str(rfq.title),
          });
        } else {
          for (const q of quotes) {
            const vProfile = findVendor(allVendors, q.vendorId, q.vendorName);
            rows.push({
              RFQDate: formatDateISO(rfq.createdAt),
              RFQID: str(rfq.rfqNumber, rfq.id),
              BuyerName: str(buyer ? buyer.contactPerson : rfq.buyerAccountName),
              EmailID: str(buyer ? buyer.corporateEmail : rfq.raisedByEmail),
              MobileNo: str(buyer ? buyer.mobileNumber : ''),
              CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName),
              SourcingMode: formatMode(rfq.sourcingMode),
              DeliveryLocation: str(rfq.deliveryLocation),
              SellerCompanyName: str(q.vendorName, str(vProfile ? vProfile.name : '')),
              SellerMobile: str(vProfile ? vProfile.phone : ''),
              SellerEmailID: str(vProfile ? vProfile.email : ''),
              SellerLocation: str(vProfile ? (vProfile.location || vProfile.city) : ''),
              SellerCategories: str(vProfile ? vProfile.majorCategory : ''),
              RFQDownloadDate: formatDateISO(rfq.createdAt),
              RFQForwardDate: formatDateISO(rfq.createdAt),
              QuoteSubmittedDate: formatDateISO(q.submittedAt),
              QuotedPrice: q.totalPrice ? `₹${q.totalPrice.toLocaleString('en-IN')}` : '',
              Query: str(q.remarks, str(rfq.title)),
            });
          }
        }
      }
    } else if (requestType === 'dailyRfqDispatchReport') {
      for (const rfq of allRfqs) {
        const rDate = rfq.createdAt ? new Date(rfq.createdAt) : null;
        if (rDate && (rDate < fromDate || rDate > toDate)) continue;

        rows.push({
          RFQDate: formatDateISO(rfq.createdAt),
          RFQID: str(rfq.rfqNumber, rfq.id),
          Title: str(rfq.title),
          BuyerName: str(rfq.buyerAccountName),
          SourcingMode: formatMode(rfq.sourcingMode),
          Category: str(rfq.category),
          Budget: rfq.budget ? `₹${Number(rfq.budget).toLocaleString('en-IN')}` : '',
          ChaserActive: rfq.chasingActive ? 'YES' : 'NO',
          AssignedVendorsCount: Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors.length : 0,
          QuotesCount: Array.isArray(rfq.quotes) ? rfq.quotes.length : 0,
          Status: str(rfq.status, 'Quotes Pending'),
        });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Invalid requestType for RFQ report' });
    }

    return res.json({
      success: true,
      reportType: requestType,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      totalRecords: rows.length,
      data: rows,
    });
  } catch (err) {
    logger.error('Error in getRfqReports', err, LOG_CATEGORY);
    return next(err);
  }
}

/**
 * GET /api/reports/daily-activity
 */
async function getDailyActivityReport(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const { fromDate, toDate } = parseDateRange(startDate, endDate);

    const allRfqs = Array.isArray(storeService.rfqs) ? storeService.rfqs : [];
    const allBuyers = Array.isArray(storeService.buyerAccounts) ? storeService.buyerAccounts : [];
    const allVendors = Array.isArray(storeService.vendors) ? storeService.vendors : [];
    const allAuditLogs = Array.isArray(storeService.auditLogs) ? storeService.auditLogs : [];

    const rfqsInRange = allRfqs.filter((r) => {
      const d = r.createdAt ? new Date(r.createdAt) : null;
      return d && d >= fromDate && d <= toDate;
    });

    const buyersInRange = allBuyers.filter((b) => {
      const d = b.createdDate ? new Date(b.createdDate) : null;
      return d && d >= fromDate && d <= toDate;
    });

    const vendorsInRange = allVendors.filter((v) => {
      const d = v.created_at ? new Date(v.created_at) : null;
      return d && d >= fromDate && d <= toDate;
    });

    let totalQuotesReceived = 0;
    rfqsInRange.forEach((r) => {
      if (Array.isArray(r.quotes)) {
        totalQuotesReceived += r.quotes.length;
      }
    });

    return res.json({
      success: true,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      summary: {
        rfqsCreated: rfqsInRange.length,
        quotesReceived: totalQuotesReceived,
        newBuyersRegistered: buyersInRange.length,
        newVendorsRegistered: vendorsInRange.length,
        totalAuditEvents: allAuditLogs.length,
      },
    });
  } catch (err) {
    logger.error('Error in getDailyActivityReport', err, LOG_CATEGORY);
    return next(err);
  }
}

module.exports = {
  getSellerReports,
  getBuyerReports,
  getRfqReports,
  getDailyActivityReport,
  parseDateRange,
  formatMode,
  formatDateISO,
  formatDateTimeISO,
  str,
  findBuyer,
  findVendor,
};
