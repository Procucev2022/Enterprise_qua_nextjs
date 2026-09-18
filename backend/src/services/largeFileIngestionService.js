// ==============================================================================
// LARGE FILE STREAMING INGESTION SERVICE
// ==============================================================================
// Handles streaming ingestion of large Excel and CSV files (up to 1,000,000+ rows)
// without memory spikes. Processes rows in configurable chunks, persists live
// progress to `ingestion_jobs` and `vendor_ingestion_sessions`, and continues
// asynchronously in the background even if the buyer closes the modal or browser.
// ==============================================================================

const fs = require('fs');
const readline = require('readline');
const queries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const { logger } = require('./loggerService');
const {
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
} = require('../config/constants');

const LOG_CATEGORY = 'LARGE_FILE_INGESTION';
const DEFAULT_BATCH_SIZE = 500;

/** Resolve organization ID from session user or session database record */
async function resolveOrganizationId(sessionUser, sessionId = null) {
  if (sessionUser) {
    if (sessionUser.organizationId) return sessionUser.organizationId;
    if (sessionUser.organization_id) return sessionUser.organization_id;
    if (sessionUser.orgId) return sessionUser.orgId;
    if (sessionUser.sub) {
      try {
        const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.sub);
        if (lookup && lookup.found && lookup.profile && lookup.profile.organizationId) {
          return lookup.profile.organizationId;
        }
      } catch (e) {
        // continue
      }
    }
    if (sessionUser.userId || sessionUser.id) {
      try {
        const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.userId || sessionUser.id);
        if (lookup && lookup.found && lookup.profile && lookup.profile.organizationId) {
          return lookup.profile.organizationId;
        }
      } catch (e) {
        // continue
      }
    }
  }

  if (sessionId) {
    try {
      const sess = await queries.findSessionById(sessionId);
      if (sess && sess.organizationId) {
        return sess.organizationId;
      }
    } catch (e) {
      // continue
    }
  }

  return null;
}

/** Split a CSV line respecting quotes */
function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Fuzzy map header names to standard keys */
function extractHeaderIndices(headers, type) {
  const map = {};
  const cleaned = headers.map((h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  function findIndex(aliases) {
    for (const alias of aliases) {
      const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      const idx = cleaned.findIndex((c) => c === aliasClean || c.includes(aliasClean) || aliasClean.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  if (type === 'VENDOR_MASTER') {
    map.vendorCode = findIndex(['vendorcode', 'vendor code', 'code', 'vendor id', 'supplier code', 'id']);
    map.companyName = findIndex(['companyname', 'company name', 'vendor name', 'supplier', 'name', 'vendor', 'supplier name']);
    map.contactPerson = findIndex(['contactperson', 'contact person', 'contact', 'person', 'representative', 'contact person name']);
    map.email = findIndex(['email', 'email id', 'email_id', 'mail', 'corporate email']);
    map.phone = findIndex(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number']);
    map.address = findIndex(['address', 'location', 'city', 'plant location', 'street', 'office address']);
    map.gstin = findIndex(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no']);
    map.rating = findIndex(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score']);
  } else {
    // PO_DUMP
    map.poNumber = findIndex(['ponumber', 'po number', 'po #', 'po no', 'pono', 'order id', 'order number', 'order no']);
    map.poDate = findIndex(['podate', 'po date', 'date', 'order date', 'creation date']);
    map.vendorIdentifier = findIndex(['vendor name', 'vendor identifier', 'vendor', 'supplier name', 'supplier', 'company name', 'vendor code', 'vendor id']);
    map.itemName = findIndex(['line item description', 'line item', 'item description', 'description', 'item name', 'product description', 'product name', 'material description', 'material', 'service description', 'service', 'item']);
    map.specs = findIndex(['specs', 'specification', 'technical specs', 'specifications', 'details', 'item specs', 'grade']);
    map.quantity = findIndex(['quantity', 'qty', 'units', 'count', 'ordered qty', 'volume']);
    map.unit = findIndex(['unit', 'uom', 'unit of measure', 'units']);
    map.unitPrice = findIndex(['unit price inr', 'unit price', 'unit rate', 'rate inr', 'rate', 'price inr', 'price', 'item price']);
    map.spend = findIndex(['total spend inr', 'total spend (inr)', 'total spend rs', 'total spend', 'total amount inr', 'total amount (inr)', 'total amount', 'total inr', 'total (inr)', 'spend inr', 'spend', 'amount inr', 'amount', 'total value', 'po amount', 'total']);
    map.department = findIndex(['department', 'dept', 'cost center', 'plant', 'division', 'category', 'function']);
  }

  return map;
}

/** Map row values array to object using header indices */
function mapRowValues(values, headerMap, type, rowIdx) {
  const get = (key) => {
    const idx = headerMap[key];
    if (idx !== undefined && idx !== -1 && values[idx] !== undefined) {
      return String(values[idx]).trim();
    }
    return '';
  };

  if (type === 'VENDOR_MASTER') {
    const companyName = get('companyName') || `Supplier ${rowIdx + 1}`;
    const vendorCode = get('vendorCode') || `VND-${1000 + rowIdx + 1}`;
    const contactPerson = get('contactPerson') || 'Operations Lead';
    const email = get('email') || `contact@${companyName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'vendor'}.com`;
    const phone = get('phone') || '+91 98000 00000';
    const address = get('address') || 'Industrial Zone, India';
    const gstin = get('gstin') || '27AAACA0000A1Z0';
    const ratingRaw = get('rating');
    const rating = ratingRaw && !isNaN(Number(ratingRaw)) ? Math.min(100, Math.max(0, Math.round(Number(ratingRaw)))) : null;

    return {
      sourceRowNumber: rowIdx + 1,
      vendorCode,
      companyName,
      contactPerson,
      email,
      phone,
      address,
      gstNumber: gstin,
      rating,
    };
  } else {
    // PO_DUMP
    const poNumber = get('poNumber') || `PO-2025-${(1000 + rowIdx).toString()}`;
    const poDate = get('poDate') || '2025-06-15';
    const vendorName = get('vendorIdentifier') || 'Apex Supplies Ltd.';
    const itemDescription = get('itemName') || 'Industrial Spares';
    const specification = get('specs') || null;
    const qtyRaw = get('quantity');
    const quantity = qtyRaw && !isNaN(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) ? Math.max(1, Math.round(Number(String(qtyRaw).replace(/[^0-9.]/g, '')))) : 1;
    const uom = get('unit') || 'Units';
    const unitPriceRaw = get('unitPrice');
    const spendRaw = get('spend');

    const parsedUnitPrice = unitPriceRaw && !isNaN(Number(String(unitPriceRaw).replace(/[^0-9.]/g, ''))) ? Number(String(unitPriceRaw).replace(/[^0-9.]/g, '')) : 0;
    const parsedSpend = spendRaw && !isNaN(Number(String(spendRaw).replace(/[^0-9.]/g, ''))) ? Number(String(spendRaw).replace(/[^0-9.]/g, '')) : 0;

    let spend = parsedSpend;
    if (spend === 0 && parsedUnitPrice > 0) {
      spend = parsedUnitPrice * quantity;
    } else if (spend === 0 && parsedUnitPrice === 0) {
      spend = 500 * quantity;
    }

    const department = get('department') || 'General';

    return {
      sourceRowNumber: rowIdx + 1,
      poNumber,
      poDate,
      vendorName,
      vendorCode: vendorName.startsWith('VND-') ? vendorName : null,
      itemDescription,
      specification,
      quantity,
      uom,
      spend,
      currency: 'INR',
      department,
    };
  }
}

/**
 * Process a batch of Vendor Master records into the database
 */
async function processVendorMasterBatch(sessionId, organizationId, batch) {
  const valid = [];
  const invalid = [];

  for (const row of batch) {
    if (!row.companyName || row.companyName.trim() === '') {
      invalid.push({ row, reason: 'Company Name is required' });
      continue;
    }
    valid.push(row);
  }

  let imported = 0;
  let skipped = invalid.length;

  if (valid.length > 0) {
    try {
      const stored = await queries.bulkUpsertVendorMasterRecords(sessionId, organizationId, valid);
      imported = stored.length;
    } catch (err) {
      logger.error('Failed to upsert vendor master batch', err, LOG_CATEGORY);
      skipped += valid.length;
    }
  }

  return { imported, skipped, failed: invalid.length, errors: invalid.slice(0, 5) };
}

/**
 * Process a batch of PO Dump records into the database
 */
async function processPoDumpBatch(sessionId, organizationId, batch, session) {
  const valid = [];
  const invalid = [];

  for (const row of batch) {
    if (!row.vendorName && !row.vendorCode) {
      invalid.push({ row, reason: 'Vendor Name or Vendor Code is required' });
      continue;
    }
    
    // Stamp inHorizon
    const inHorizon = session && session.horizonStart && session.horizonEnd
      ? row.poDate >= session.horizonStart && row.poDate <= session.horizonEnd
      : true;

    valid.push({
      ...row,
      inHorizon,
    });
  }

  let imported = 0;
  let skipped = invalid.length;

  if (valid.length > 0) {
    try {
      const stored = await queries.bulkInsertPoLineItems(sessionId, organizationId, valid);
      imported = stored.length;
    } catch (err) {
      logger.error('Failed to insert PO dump batch', err, LOG_CATEGORY);
      skipped += valid.length;
    }
  }

  return { imported, skipped, failed: invalid.length, errors: invalid.slice(0, 5) };
}

/**
 * Execute background streaming ingestion of a CSV or TXT file
 */
async function streamProcessCsvFile({ jobId, sessionId, organizationId, filePath, fileName, jobType, batchSize = DEFAULT_BATCH_SIZE }) {
  try {
    const session = await queries.findSession(sessionId, organizationId);
    if (!session) {
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: 'Session not found',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    let totalLines = 0;
    let processedRecords = 0;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    const recentErrors = [];

    try {
      // 1. First quick pass to count lines for exact total progress
      const fileStreamCount = fs.createReadStream(filePath);
      const rlCount = readline.createInterface({ input: fileStreamCount, crlfDelay: Infinity });
      for await (const line of rlCount) {
        if (line.trim().length > 0) totalLines++;
      }
      totalLines = Math.max(0, totalLines - 1); // Exclude header line

      await queries.updateIngestionJobProgress(jobId, organizationId, {
        totalRecords: totalLines,
        status: 'PROCESSING',
      });

      // 2. Stream and process in batches
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let isHeader = true;
      let headerMap = null;
      let currentBatch = [];
      let delimiter = ',';

      for await (const line of rl) {
        if (!line || line.trim().length === 0) continue;

        if (isHeader) {
          if (line.includes('\t')) delimiter = '\t';
          else if (line.includes(';') && !line.includes(',')) delimiter = ';';
          const headers = parseCsvLine(line, delimiter);
          headerMap = extractHeaderIndices(headers, jobType);
          isHeader = false;
          continue;
        }

        const values = parseCsvLine(line, delimiter);
        const record = mapRowValues(values, headerMap, jobType, processedRecords);
        currentBatch.push(record);

        if (currentBatch.length >= batchSize) {
          let result;
          if (jobType === 'VENDOR_MASTER') {
            result = await processVendorMasterBatch(sessionId, organizationId, currentBatch);
          } else {
            result = await processPoDumpBatch(sessionId, organizationId, currentBatch, session);
          }

          processedRecords += currentBatch.length;
          importedRecords += result.imported;
          skippedRecords += result.skipped;
          failedRecords += result.failed;
          if (result.errors && result.errors.length > 0) {
            recentErrors.push(...result.errors);
          }

          currentBatch = [];

          // Update progress in database
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            processedRecords,
            importedRecords,
            skippedRecords,
            failedRecords,
            errorDetails: recentErrors.slice(-10),
          });
        }
      }

      // Process remainder batch
      if (currentBatch.length > 0) {
        let result;
        if (jobType === 'VENDOR_MASTER') {
          result = await processVendorMasterBatch(sessionId, organizationId, currentBatch);
        } else {
          result = await processPoDumpBatch(sessionId, organizationId, currentBatch, session);
        }

        processedRecords += currentBatch.length;
        importedRecords += result.imported;
        skippedRecords += result.skipped;
        failedRecords += result.failed;
        if (result.errors && result.errors.length > 0) {
          recentErrors.push(...result.errors);
        }
      }

      // Finalize session counts and state
      if (jobType === 'VENDOR_MASTER') {
        const totalStored = await queries.countVendorMasterRecords(sessionId, organizationId);
        await queries.updateSession(sessionId, organizationId, {
          vendorMasterFileName: fileName,
          vendorMasterRowCount: totalStored,
          status:
            session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
              ? VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED
              : session.status,
          currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.PO_DUMP),
        });
      } else {
        const counts = await queries.countPoLineItems(sessionId, organizationId);
        await queries.updateSession(sessionId, organizationId, {
          poFileName: fileName,
          poRowCount: counts.total,
          poInHorizonCount: counts.inHorizon,
          poOutsideHorizonCount: counts.outsideHorizon,
          status: VENDOR_INGESTION_SESSION_STATUS.PO_STORED,
          currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN),
        });
      }

      // Mark job completed
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        totalRecords: Math.max(totalLines, processedRecords),
        processedRecords,
        importedRecords,
        skippedRecords,
        failedRecords,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        errorDetails: recentErrors.slice(-10),
      });

      logger.info(`Ingestion job ${jobId} completed`, { processedRecords, importedRecords, skippedRecords, failedRecords }, LOG_CATEGORY);
    } catch (err) {
      logger.error(`Ingestion job ${jobId} failed`, err, LOG_CATEGORY);
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: err.message || 'Stream processing failure',
        completedAt: new Date().toISOString(),
      });
    }
  } finally {
    // Clean up temporary file unconditionally
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanErr) {
      logger.warn('Failed to clean up temporary upload file', { filePath, error: cleanErr.message }, LOG_CATEGORY);
    }
  }
}

/**
 * Process memory array or parsed chunks in background
 */
async function processArrayJob({ jobId, sessionId, organizationId, rows, fileName, jobType, batchSize = DEFAULT_BATCH_SIZE }) {
  try {
    const session = await queries.findSession(sessionId, organizationId);
    if (!session) {
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: 'Session not found',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    let processedRecords = 0;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    const recentErrors = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      let result;
      if (jobType === 'VENDOR_MASTER') {
        result = await processVendorMasterBatch(sessionId, organizationId, chunk);
      } else {
        result = await processPoDumpBatch(sessionId, organizationId, chunk, session);
      }

      processedRecords += chunk.length;
      importedRecords += result.imported;
      skippedRecords += result.skipped;
      failedRecords += result.failed;
      if (result.errors && result.errors.length > 0) {
        recentErrors.push(...result.errors);
      }

      await queries.updateIngestionJobProgress(jobId, organizationId, {
        processedRecords,
        importedRecords,
        skippedRecords,
        failedRecords,
        errorDetails: recentErrors.slice(-10),
      });
    }

    if (jobType === 'VENDOR_MASTER') {
      const totalStored = await queries.countVendorMasterRecords(sessionId, organizationId);
      await queries.updateSession(sessionId, organizationId, {
        vendorMasterFileName: fileName,
        vendorMasterRowCount: totalStored,
        status:
          session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
            ? VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED
            : session.status,
        currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.PO_DUMP),
      });
    } else {
      const counts = await queries.countPoLineItems(sessionId, organizationId);
      await queries.updateSession(sessionId, organizationId, {
        poFileName: fileName,
        poRowCount: counts.total,
        poInHorizonCount: counts.inHorizon,
        poOutsideHorizonCount: counts.outsideHorizon,
        status: VENDOR_INGESTION_SESSION_STATUS.PO_STORED,
        currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN),
      });
    }

    await queries.updateIngestionJobProgress(jobId, organizationId, {
      totalRecords: Math.max(rows.length, processedRecords),
      processedRecords,
      importedRecords,
      skippedRecords,
      failedRecords,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      errorDetails: recentErrors.slice(-10),
    });
  } catch (err) {
    logger.error(`Array Ingestion job ${jobId} failed`, err, LOG_CATEGORY);
    await queries.updateIngestionJobProgress(jobId, organizationId, {
      status: 'FAILED',
      errorMessage: err.message || 'Processing failure',
      completedAt: new Date().toISOString(),
    });
  }
}

/**
 * Start a background ingestion job for an uploaded file or array
 */
async function startIngestionJob({ sessionUser, sessionId, filePath, rows, fileName, jobType, totalHint = 0 }) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) {
    throw new Error('Organization not linked to user');
  }

  const total = rows ? rows.length : totalHint;

  // Create job in database
  const job = await queries.createIngestionJob({
    sessionId,
    organizationId,
    jobType,
    fileName,
    totalRecords: total,
  });

  if (filePath) {
    setImmediate(() => {
      streamProcessCsvFile({
        jobId: job.id,
        sessionId,
        organizationId,
        filePath,
        fileName,
        jobType,
      }).catch((err) => {
        logger.error('Background ingestion job error', err, LOG_CATEGORY);
      });
    });
    return job;
  } else if (Array.isArray(rows)) {
    if (rows.length <= 5000) {
      await processArrayJob({
        jobId: job.id,
        sessionId,
        organizationId,
        rows,
        fileName,
        jobType,
      });
      const updated = await queries.findIngestionJob(job.id, organizationId);
      return updated || {
        ...job,
        status: 'COMPLETED',
        totalRecords: rows.length,
        processedRecords: rows.length,
        importedRecords: rows.length,
        skippedRecords: 0,
        failedRecords: 0,
      };
    } else {
      setImmediate(() => {
        processArrayJob({
          jobId: job.id,
          sessionId,
          organizationId,
          rows,
          fileName,
          jobType,
        }).catch((err) => {
          logger.error('Background array ingestion job error', err, LOG_CATEGORY);
        });
      });
      return job;
    }
  }

  return job;
}

/**
 * Get the status of an ingestion job or active jobs for a session
 */
async function getJobStatus(sessionUser, sessionId, jobId = null, jobType = null) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) return null;

  if (jobId) {
    return queries.findIngestionJob(jobId, organizationId);
  }

  if (jobType) {
    return queries.findLatestIngestionJob(sessionId, organizationId, jobType);
  }

  const activeJobs = await queries.findActiveIngestionJobs(sessionId, organizationId);
  if (activeJobs.length > 0) return activeJobs[0];

  return queries.findLatestIngestionJob(sessionId, organizationId);
}

module.exports = {
  resolveOrganizationId,
  startIngestionJob,
  getJobStatus,
  streamProcessCsvFile,
  processArrayJob,
  processVendorMasterBatch,
  processPoDumpBatch,
  parseCsvLine,
  extractHeaderIndices,
  mapRowValues,
};
