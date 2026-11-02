const storeService = require('../services/storeService');
const pool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const { logger } = require('../services/loggerService');
const { RFQ_MODES, RFQ_MODE_LABELS, VENDOR_FREE_CREDITS_LIMIT } = require('../config/constants');

const LOG_CATEGORY = 'REPORTS_CONTROLLER';

function parseDateRange(startDateStr, endDateStr) {
  const now = new Date();
  const hasStart = startDateStr !== undefined && startDateStr !== null && String(startDateStr).trim() !== '' && String(startDateStr).trim().toLowerCase() !== 'all';
  const hasEnd = endDateStr !== undefined && endDateStr !== null && String(endDateStr).trim() !== '' && String(endDateStr).trim().toLowerCase() !== 'all';

  const isExplicitAll =
    (startDateStr !== undefined && (startDateStr === '' || String(startDateStr).trim().toLowerCase() === 'all')) ||
    (endDateStr !== undefined && (endDateStr === '' || String(endDateStr).trim().toLowerCase() === 'all'));

  let toDate;
  if (hasEnd) {
    const s = String(endDateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      toDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      const parsed = new Date(s);
      toDate = !isNaN(parsed.getTime()) ? parsed : new Date(now);
      toDate.setHours(23, 59, 59, 999);
    }
  } else {
    toDate = new Date(now);
    toDate.setHours(23, 59, 59, 999);
  }

  let fromDate;
  if (hasStart) {
    const s = String(startDateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      fromDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      const parsed = new Date(s);
      fromDate = !isNaN(parsed.getTime()) ? parsed : new Date(0);
      fromDate.setHours(0, 0, 0, 0);
    }
  } else if (hasEnd || isExplicitAll) {
    // End-only or explicitly unbounded range (Clear dates / 'all'): start from beginning of time
    fromDate = new Date(0);
  } else {
    // Default when no dates are specified at all (undefined / omitted)
    fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    fromDate.setHours(0, 0, 0, 0);
  }

  if (hasStart && fromDate > toDate) {
    fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    fromDate.setHours(0, 0, 0, 0);
  }

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

function getBuyerLocation(buyer, rfq = null) {
  if (buyer) {
    if (buyer.city) {
      return `${buyer.city}${buyer.state ? ', ' + buyer.state : ''}`;
    }
    if (buyer.primaryPlantLocation) return String(buyer.primaryPlantLocation);
    if (buyer.location) return String(buyer.location);
    if (buyer.address) return String(buyer.address);
    if (buyer.country) return String(buyer.country);
  }
  return rfq && rfq.deliveryLocation ? String(rfq.deliveryLocation) : 'All India';
}

function getBuyerLastLogin(buyer, rfq = null) {
  if (buyer) {
    const rawVal = buyer.lastLogin || buyer.last_login_at || buyer.lastLoginDate;
    if (rawVal) return formatDateTimeISO(rawVal);
  }
  return '';
}

function getVendorLocation(vendor, fallback = 'India') {
  if (vendor) {
    if (vendor.location) return String(vendor.location);
    if (vendor.city) {
      return `${vendor.city}${vendor.state ? ', ' + vendor.state : ''}`;
    }
    if (vendor.country) return String(vendor.country);
  }
  return fallback;
}

function getVendorLastLogin(vendor, fallbackDate = null) {
  if (vendor) {
    const rawVal = vendor.lastLogin || vendor.last_login_at || vendor.lastLoginDate;
    if (rawVal) return formatDateTimeISO(rawVal);
  }
  return '';
}

function findBuyer(allBuyers, rfq) {
  return allBuyers.find((b) => {
    if (rfq.buyerAccountId && b.id === rfq.buyerAccountId) return true;
    if (rfq.buyerAccountName && b.organizationName && b.organizationName.toLowerCase() === String(rfq.buyerAccountName).toLowerCase()) return true;
    if (rfq.raisedByEmail && b.corporateEmail && b.corporateEmail.toLowerCase() === String(rfq.raisedByEmail).toLowerCase()) return true;
    return false;
  }) || null;
}

function findVendor(allVendorsOrMap, id, name, email) {
  if (!allVendorsOrMap) return null;
  if (allVendorsOrMap instanceof Map) {
    if (id && allVendorsOrMap.has(String(id))) return allVendorsOrMap.get(String(id));
    if (email && allVendorsOrMap.has(String(email).toLowerCase())) return allVendorsOrMap.get(String(email).toLowerCase());
    if (name && allVendorsOrMap.has(String(name).toLowerCase())) return allVendorsOrMap.get(String(name).toLowerCase());
    return null;
  }
  if (Array.isArray(allVendorsOrMap)) {
    return allVendorsOrMap.find((v) => {
      if (id && v.id === id) return true;
      if (email && v.email && v.email.toLowerCase() === String(email).toLowerCase()) return true;
      if (name && v.name && v.name.toLowerCase() === String(name).toLowerCase()) return true;
      return false;
    }) || null;
  }
  return null;
}

async function enrichVendorsForRfqs(rfqs, existingVendors = []) {
  const vendorMap = new Map();
  if (Array.isArray(existingVendors)) {
    for (const v of existingVendors) {
      if (v.id) vendorMap.set(String(v.id), v);
      if (v.email) vendorMap.set(String(v.email).toLowerCase(), v);
      if (v.name) vendorMap.set(String(v.name).toLowerCase(), v);
    }
  }

  const missingIds = new Set();
  for (const rfq of rfqs) {
    for (const av of rfq.assignedVendors || []) {
      const hasId = av.id && vendorMap.has(String(av.id));
      const hasEmail = av.email && vendorMap.has(String(av.email).toLowerCase());
      const hasName = av.name && vendorMap.has(String(av.name).toLowerCase());
      if (!hasId && !hasEmail && !hasName) {
        if (av.id) missingIds.add(String(av.id));
      }
    }
    for (const q of rfq.quotes || []) {
      const hasId = q.vendorId && vendorMap.has(String(q.vendorId));
      const hasName = q.vendorName && vendorMap.has(String(q.vendorName).toLowerCase());
      if (!hasId && !hasName) {
        if (q.vendorId) missingIds.add(String(q.vendorId));
      }
    }
  }

  if (pool.hasStorage() && missingIds.size > 0) {
    const idsArray = Array.from(missingIds);
    const chunkSize = 100;
    for (let i = 0; i < idsArray.length; i += chunkSize) {
      const chunk = idsArray.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => '$' + (idx + 1)).join(', ');
      try {
        const res = await pool.query(
          `SELECT id, email, created_at, updated_at, raw FROM vendors WHERE id IN (${placeholders})`,
          chunk,
          { d1: true, useCache: true, tag: 'vendors', ttlMs: 60000 }
        );
        for (const r of (res.rows || [])) {
          const v = typeof r.raw === 'string' ? JSON.parse(r.raw) : (r.raw || {});
          if (r.created_at && !v.created_at) v.created_at = r.created_at;
          if (r.updated_at && !v.updated_at) v.updated_at = r.updated_at;
          if (!v.lastLogin) {
            v.lastLogin = v.last_login_at || v.lastLoginDate || v.loginDateTime || null;
          }
          if (!v.location && v.city) {
            v.location = `${v.city}${v.state ? ', ' + v.state : ''}`;
          }
          vendorMap.set(String(r.id), v);
          if (v.email) vendorMap.set(String(v.email).toLowerCase(), v);
          if (v.name) vendorMap.set(String(v.name).toLowerCase(), v);

          if (Array.isArray(storeService.vendors) && !storeService.vendors.some((ev) => ev.id === v.id)) {
            storeService.vendors.push(v);
          }
        }
      } catch (err) {
        logger.warn('Failed to batch load missing vendors for report', { error: err.message }, LOG_CATEGORY);
      }
    }
  }

  return vendorMap;
}

async function loadAllVendorsForReport() {
  if (pool.hasStorage()) {
    try {
      const res = await domainQueries.getVendorsPageFromDB({ limit: 5000, offset: 0 });
      if (res && Array.isArray(res.rows) && res.rows.length > 0) {
        return res.rows;
      }
    } catch (err) {
      logger.warn('Failed to load vendors from DB for report, falling back to cache', { error: err.message }, LOG_CATEGORY);
    }
  }
  return Array.isArray(storeService.vendors) ? storeService.vendors : [];
}

/**
 * GET /api/reports/seller-report
 */
async function getSellerReports(req, res, next) {
  try {
    const { requestType = 'sellerReport', startDate, endDate } = req.query;
    const { fromDate, toDate } = parseDateRange(startDate, endDate);

    logger.info('Generating seller report', { requestType, startDate, endDate }, LOG_CATEGORY);

    if (pool.hasStorage()) {
      await storeService.syncRFQsFromDB();
    }

    const allVendors = (requestType === 'sellerReport')
      ? (Array.isArray(storeService.vendors) ? storeService.vendors : [])
      : await loadAllVendorsForReport();
    const allRfqs = storeService.getRFQs();

    const rows = [];

    if (requestType === 'sellerReport') {
      const vendorMap = await enrichVendorsForRfqs(allRfqs, allVendors);

      for (const rfq of allRfqs) {
        const rfqDate = rfq.createdAt ? new Date(rfq.createdAt) : null;
        if (rfqDate && (rfqDate < fromDate || rfqDate > toDate)) continue;

        const assigned = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
        const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];

        const rfqVendorMap = new Map();
        assigned.forEach((av) => {
          rfqVendorMap.set(str(av.id, av.name || av.email), { assigned: av, quote: null });
        });
        quotes.forEach((q) => {
          const key = str(q.vendorId, q.vendorName);
          const existing = rfqVendorMap.get(key);
          if (existing) {
            existing.quote = q;
          } else {
            rfqVendorMap.set(key, { assigned: null, quote: q });
          }
        });

        if (rfqVendorMap.size === 0) {
          rows.push({
            RFQDate: formatDateISO(rfq.createdAt),
            RFQID: str(rfq.rfqNumber, rfq.id),
            SellerCompanyName: 'Open Network',
            Email: '',
            MobileNo: '',
            CompanyLocation: str(rfq.deliveryLocation, 'India'),
            DeliveryLocation: str(rfq.deliveryLocation, 'All India'),
            LastLogin: formatDateISO(rfq.createdAt),
            SourceType: str(rfq.source, 'web_portal'),
            RFQDownloadDate: '',
            QuoteSubmittedDate: '',
            SourcingMode: formatMode(rfq.sourcingMode),
            Status: str(rfq.status, 'Quotes Pending'),
            Query: str(rfq.title),
          });
        } else {
          for (const [_, item] of rfqVendorMap) {
            const vId = item.quote ? item.quote.vendorId : (item.assigned ? item.assigned.id : null);
            const vName = item.quote ? item.quote.vendorName : (item.assigned ? item.assigned.name : null);
            const vEmail = item.assigned ? item.assigned.email : null;
            const vProfile = findVendor(vendorMap, vId, vName, vEmail);

            const vendorLoc = vProfile
              ? getVendorLocation(vProfile, item.assigned ? getVendorLocation(item.assigned, str(rfq.deliveryLocation, 'India')) : str(rfq.deliveryLocation, 'India'))
              : (item.assigned ? getVendorLocation(item.assigned, str(rfq.deliveryLocation, 'India')) : str(rfq.deliveryLocation, 'India'));

            const vendorLastLogin = vProfile
              ? getVendorLastLogin(vProfile, item.assigned?.createdAt || item.assigned?.created_at || rfq.createdAt)
              : (item.assigned ? getVendorLastLogin(item.assigned, rfq.createdAt) : formatDateTimeISO(rfq.createdAt));

            rows.push({
              RFQDate: formatDateISO(rfq.createdAt),
              RFQID: str(rfq.rfqNumber, rfq.id),
              SellerCompanyName: str(vName, str(vProfile ? vProfile.name : (item.assigned ? item.assigned.name : 'Verified Vendor'))),
              Email: str(vProfile ? vProfile.email : (item.assigned ? item.assigned.email : '')),
              MobileNo: str(vProfile ? (vProfile.phone || vProfile.mobile) : (item.assigned ? (item.assigned.phone || item.assigned.mobile) : '')),
              CompanyLocation: vendorLoc,
              DeliveryLocation: str(rfq.deliveryLocation, str(vProfile ? (vProfile.deliveryLocation || vProfile.location) : 'All India')),
              LastLogin: vendorLastLogin,
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
        const vDate = vendor.created_at ? new Date(vendor.created_at) : (vendor.createdAt ? new Date(vendor.createdAt) : new Date(0));
        if (vDate >= fromDate && vDate <= toDate) {
          const lastLoginVal = getVendorLastLogin(vendor, vendor.created_at || vendor.createdAt);
          const deliveryLoc = vendor.deliveryLocation || vendor.serviceLocations || vendor.location || vendor.city || 'India';
          rows.push({
            LoginDateTime: lastLoginVal,
            LastLogin: lastLoginVal,
            Name: str(vendor.contactPerson, str(vendor.name)),
            MobileNo: str(vendor.phone || vendor.mobile),
            CompanyName: str(vendor.name),
            EmailID: str(vendor.email),
            CompanyLocation: getVendorLocation(vendor, 'India'),
            DeliveryLocation: typeof deliveryLoc === 'string' ? deliveryLoc : (Array.isArray(deliveryLoc) ? deliveryLoc.join(', ') : 'India'),
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
        const lastLoginVal = getVendorLastLogin(vendor, vendor.created_at || vendor.createdAt);
        const deliveryLoc = vendor.deliveryLocation || vendor.serviceLocations || vendor.location || vendor.city || 'India';
        rows.push({
          CompanyName: str(vendor.name),
          Email: str(vendor.email),
          Mobile: str(vendor.phone || vendor.mobile),
          SellerPerson: str(vendor.contactPerson, str(vendor.name)),
          CompanyLocation: getVendorLocation(vendor, 'India'),
          DeliveryLocation: typeof deliveryLoc === 'string' ? deliveryLoc : (Array.isArray(deliveryLoc) ? deliveryLoc.join(', ') : 'India'),
          LastLogin: lastLoginVal,
          LastLoginDate: lastLoginVal,
          Category1: str(vendor.majorCategory, str(cats[0])),
          Category2: str(subCats[0]),
          Category3: str(subCats[1]),
          Category4: str(subCats[2]),
          Category5: str(subCats[3]),
        });
      }
    } else if (requestType === 'sellerSubscriptionReport') {
      for (const vendor of allVendors) {
        const lastLoginVal = getVendorLastLogin(vendor, vendor.created_at || vendor.createdAt);
        rows.push({
          CompanyName: str(vendor.name),
          ContactPerson: str(vendor.contactPerson),
          Email: str(vendor.email),
          Phone: str(vendor.phone || vendor.mobile),
          CompanyLocation: getVendorLocation(vendor, 'India'),
          LastLogin: lastLoginVal,
          Plan: str(vendor.subscriptionPlan, 'premium'),
          DownloadsUsed: vendor.rfqDownloadsUsed !== undefined ? vendor.rfqDownloadsUsed : 0,
          FreeQuotationCredits: vendor.freeQuotationCredits !== undefined ? vendor.freeQuotationCredits : VENDOR_FREE_CREDITS_LIMIT,
          QuotedRFQsCount: Array.isArray(vendor.quotedRfqIds) ? vendor.quotedRfqIds.length : 0,
          Status: str(vendor.status, 'ACTIVE'),
        });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Invalid requestType for seller report' });
    }

    const parsedLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const dataRows = (parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0)
      ? rows.slice(0, Math.min(parsedLimit, 5000))
      : (rows.length > 5000 ? rows.slice(0, 5000) : rows);

    return res.json({
      success: true,
      reportType: requestType,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      totalRecords: rows.length,
      data: dataRows,
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
          MobileNo: str(buyer ? (buyer.mobileNumber || buyer.phone) : ''),
          CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName, 'Enterprise Corp'),
          CompanyLocation: getBuyerLocation(buyer, rfq),
          ItemDescription: str(rfq.title, str(firstEntity ? firstEntity.itemName : '')),
          ItemCategory: str(rfq.category, str(firstEntity ? firstEntity.majorCategory : '')),
          SourcingMode: formatMode(rfq.sourcingMode),
          DeliveryLocation: str(rfq.deliveryLocation, 'All India'),
          LastLogin: getBuyerLastLogin(buyer, rfq),
          RFQSource: str(rfq.source, 'web_portal'),
          RFQQueriesCount: Array.isArray(rfq.inquiries) ? rfq.inquiries.length : 0,
          Status: str(rfq.status, 'Quotes Pending'),
        });
      }
    } else if (requestType === 'buyerSummary') {
      for (const buyer of allBuyers) {
        const bDate = buyer.createdDate ? new Date(buyer.createdDate) : (buyer.created_at ? new Date(buyer.created_at) : new Date(0));
        if (bDate >= fromDate && bDate <= toDate) {
          const lastLoginVal = getBuyerLastLogin(buyer);
          rows.push({
            LoginDateTime: lastLoginVal,
            LastLogin: lastLoginVal,
            BuyerName: str(buyer.contactPerson, str(buyer.organizationName)),
            MobileNo: str(buyer.mobileNumber || buyer.phone),
            CompanyName: str(buyer.organizationName),
            EmailID: str(buyer.corporateEmail),
            CompanyLocation: getBuyerLocation(buyer),
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
        const lastLoginVal = getBuyerLastLogin(buyer);
        rows.push({
          BuyerName: str(buyer.contactPerson, str(buyer.organizationName)),
          EmailID: str(buyer.corporateEmail),
          MobileNo: str(buyer.mobileNumber || buyer.phone),
          CompanyName: str(buyer.organizationName),
          CompanyLocation: getBuyerLocation(buyer),
          LastLogin: lastLoginVal,
          LastLoginDate: lastLoginVal,
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
        const lastLoginVal = getBuyerLastLogin(buyer);
        rows.push({
          OrganizationName: str(buyer.organizationName),
          ContactPerson: str(buyer.contactPerson),
          CorporateEmail: str(buyer.corporateEmail),
          MobileNumber: str(buyer.mobileNumber || buyer.phone),
          CompanyLocation: getBuyerLocation(buyer),
          LastLogin: lastLoginVal,
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

    const parsedLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const dataRows = (parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0)
      ? rows.slice(0, Math.min(parsedLimit, 5000))
      : (rows.length > 5000 ? rows.slice(0, 5000) : rows);

    return res.json({
      success: true,
      reportType: requestType,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      totalRecords: rows.length,
      data: dataRows,
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
          MobileNo: str(buyer ? (buyer.mobileNumber || buyer.phone) : ''),
          CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName),
          CompanyLocation: getBuyerLocation(buyer, rfq),
          DeliveryLocation: str(rfq.deliveryLocation, 'All India'),
          LastLogin: getBuyerLastLogin(buyer, rfq),
          ItemDescription: str(rfq.title),
          ItemCategory: str(rfq.category),
          SourcingMode: formatMode(rfq.sourcingMode),
          TotalVendors: Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors.length : 0,
          NumberOfQuotesReceived: quotes.length,
          FirstQuoteDate: firstQuoteDate,
          Status: str(rfq.status, 'Quotes Pending'),
          AwardedAmount: rfq.awardedAmount ? `₹${rfq.awardedAmount.toLocaleString('en-IN')}` : '',
        });
      }
    } else if (requestType === 'rfqSummaryReport') {
      const vendorMap = await enrichVendorsForRfqs(allRfqs, allVendors);

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
            MobileNo: str(buyer ? (buyer.mobileNumber || buyer.phone) : ''),
            CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName),
            CompanyLocation: getBuyerLocation(buyer, rfq),
            DeliveryLocation: str(rfq.deliveryLocation, 'All India'),
            LastLogin: getBuyerLastLogin(buyer, rfq),
            SourcingMode: formatMode(rfq.sourcingMode),
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
            const vProfile = findVendor(vendorMap, q.vendorId, q.vendorName);
            rows.push({
              RFQDate: formatDateISO(rfq.createdAt),
              RFQID: str(rfq.rfqNumber, rfq.id),
              BuyerName: str(buyer ? buyer.contactPerson : rfq.buyerAccountName),
              EmailID: str(buyer ? buyer.corporateEmail : rfq.raisedByEmail),
              MobileNo: str(buyer ? (buyer.mobileNumber || buyer.phone) : ''),
              CompanyName: str(buyer ? buyer.organizationName : rfq.buyerAccountName),
              CompanyLocation: getBuyerLocation(buyer, rfq),
              DeliveryLocation: str(rfq.deliveryLocation, 'All India'),
              LastLogin: getBuyerLastLogin(buyer, rfq),
              SourcingMode: formatMode(rfq.sourcingMode),
              SellerCompanyName: str(q.vendorName, str(vProfile ? vProfile.name : '')),
              SellerMobile: str(vProfile ? (vProfile.phone || vProfile.mobile) : ''),
              SellerEmailID: str(vProfile ? vProfile.email : ''),
              SellerLocation: getVendorLocation(vProfile, str(q.vendorLocation, 'India')),
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

        const buyer = findBuyer(allBuyers, rfq);
        rows.push({
          RFQDate: formatDateISO(rfq.createdAt),
          RFQID: str(rfq.rfqNumber, rfq.id),
          Title: str(rfq.title),
          BuyerName: str(rfq.buyerAccountName),
          CompanyLocation: getBuyerLocation(buyer, rfq),
          DeliveryLocation: str(rfq.deliveryLocation, 'All India'),
          LastLogin: getBuyerLastLogin(buyer, rfq),
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

    const parsedLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const dataRows = (parsedLimit && Number.isInteger(parsedLimit) && parsedLimit > 0)
      ? rows.slice(0, Math.min(parsedLimit, 5000))
      : (rows.length > 5000 ? rows.slice(0, 5000) : rows);

    return res.json({
      success: true,
      reportType: requestType,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      totalRecords: rows.length,
      data: dataRows,
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
    const startDate = req.query.startDate || req.query.from;
    const endDate = req.query.endDate || req.query.to;
    const { fromDate, toDate } = parseDateRange(startDate, endDate);

    let newVendorsRegistered = 0;
    if (pool.hasStorage()) {
      await storeService.syncRFQsFromDB();
      await storeService.getBuyerAccounts();
      newVendorsRegistered = await domainQueries.countVendorsCreatedBetween(fromDate, toDate);
    } else {
      const allVendors = Array.isArray(storeService.vendors) ? storeService.vendors : [];
      newVendorsRegistered = allVendors.filter((v) => {
        const d = (v.created_at || v.createdAt) ? new Date(v.created_at || v.createdAt) : null;
        return d && d >= fromDate && d <= toDate;
      }).length;
    }

    const allRfqs = storeService.getRFQs();
    const allBuyers = Array.isArray(storeService.buyerAccounts) ? storeService.buyerAccounts : [];
    const allAuditLogs = Array.isArray(storeService.auditLogs) ? storeService.auditLogs : [];

    const rfqsInRange = allRfqs.filter((r) => {
      const d = r.createdAt ? new Date(r.createdAt) : null;
      return d && d >= fromDate && d <= toDate;
    });

    const buyersInRange = allBuyers.filter((b) => {
      const d = (b.createdDate || b.created_at) ? new Date(b.createdDate || b.created_at) : null;
      return d && d >= fromDate && d <= toDate;
    });

    let totalQuotesReceived = 0;
    allRfqs.forEach((r) => {
      if (Array.isArray(r.quotes)) {
        r.quotes.forEach((q) => {
          const rawDate = q.submittedAt || q.createdAt || r.createdAt;
          if (rawDate) {
            const qDate = new Date(rawDate);
            if (!isNaN(qDate.getTime()) && qDate >= fromDate && qDate <= toDate) {
              totalQuotesReceived++;
            }
          }
        });
      }
    });

    const auditLogsInRange = allAuditLogs.filter((l) => {
      const rawDate = l.timestamp || l.createdAt;
      if (!rawDate) return false;
      const d = new Date(rawDate);
      return !isNaN(d.getTime()) && d >= fromDate && d <= toDate;
    });

    return res.json({
      success: true,
      dateRange: { startDate: formatDateISO(fromDate), endDate: formatDateISO(toDate) },
      summary: {
        rfqsCreated: rfqsInRange.length,
        quotesReceived: totalQuotesReceived,
        newBuyersRegistered: buyersInRange.length,
        newVendorsRegistered,
        totalAuditEvents: auditLogsInRange.length,
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
  getBuyerLocation,
  getBuyerLastLogin,
  getVendorLocation,
  getVendorLastLogin,
  findBuyer,
  findVendor,
};
