const pool = require('./pool');
const {
  RFQ_COMPARISON_RETRY_DELAY_MS,
  RFQ_COMPARISON_MAX_ATTEMPTS,
  RFQ_COMPARISON_QUEUE_MAX_LIMIT,
  RFQ_COMPARISON_ERROR_MAX_LENGTH,
} = require('../config/constants');

async function insertRFQComparisonJobInDB({ id, rfqId, rfqNumber, fireAt }) {
  if (!pool.hasStorage()) return null;
  await pool.query(
    `INSERT INTO rfq_comparison_queue (id, rfq_id, rfq_number, status, fire_at)
     VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT (rfq_id) DO NOTHING`,
    [id, rfqId, rfqNumber, fireAt],
    { d1: true }
  );
  return { id, rfqId, rfqNumber, fireAt };
}

async function getPendingRFQComparisonJobsFromDB(limit = 100) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const limitValue = hasLimit ? Math.min(Number(limit), 1000) : 1000;
  const sql = `SELECT id, rfq_id, rfq_number, fire_at
     FROM rfq_comparison_queue
     WHERE status='pending'
     ORDER BY fire_at ASC
     LIMIT $1`;
  const result = await pool.query(sql, [limitValue], { d1: true, d1Text: sql });
  return result.rows || [];
}

async function claimDueRFQComparisonJobsFromDB(now, staleBefore, limit = 25, jobId = null) {
  if (!pool.hasStorage()) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), RFQ_COMPARISON_QUEUE_MAX_LIMIT);
  const jobIdClause = jobId ? ' AND id=$4' : '';
  const params = jobId
    ? [now, staleBefore, safeLimit, jobId]
    : [now, staleBefore, safeLimit];
  const sql = `UPDATE rfq_comparison_queue
     SET status='processing', attempts=attempts+1, updated_at=$1
     WHERE id IN (
       SELECT id FROM rfq_comparison_queue
       WHERE ((status='pending' AND fire_at <= $1)
          OR (status='processing' AND updated_at <= $2))${jobIdClause}
       ORDER BY fire_at ASC
       LIMIT $3
     )
     RETURNING id, rfq_id, rfq_number, fire_at, attempts, email_completed_at, sms_completed_at`;
  const result = await pool.query(sql, params, { d1: true, d1Text: sql });
  return result.rows || [];
}

async function markRFQComparisonJobCompleteInDB(id) {
  if (!pool.hasStorage()) return;
  const completedAt = new Date().toISOString();
  await pool.query(
    `UPDATE rfq_comparison_queue
     SET status='complete', completed_at=$2, updated_at=$2, last_error=NULL
     WHERE id=$1`,
    [id, completedAt],
    { d1: true }
  );
}

async function markRFQComparisonChannelCompleteInDB(id, channel) {
  if (!pool.hasStorage()) return;
  const completionColumn = channel === 'email'
    ? 'email_completed_at'
    : channel === 'sms'
      ? 'sms_completed_at'
      : null;
  if (!completionColumn) throw new Error(`Unsupported RFQ comparison channel: ${channel}`);
  const completedAt = new Date().toISOString();
  await pool.query(
    `UPDATE rfq_comparison_queue
     SET ${completionColumn}=COALESCE(${completionColumn}, $2), updated_at=$2
     WHERE id=$1`,
    [id, completedAt],
    { d1: true }
  );
}

async function markRFQComparisonJobFailedInDB(id, errorMessage) {
  if (!pool.hasStorage()) return;
  const safeError = String(errorMessage || 'unknown').slice(0, RFQ_COMPARISON_ERROR_MAX_LENGTH);
  const retryAt = new Date(Date.now() + RFQ_COMPARISON_RETRY_DELAY_MS).toISOString();
  await pool.query(
    `UPDATE rfq_comparison_queue
     SET status=CASE WHEN attempts < $4 THEN 'pending' ELSE 'failed' END,
         fire_at=CASE WHEN attempts < $4 THEN $2 ELSE fire_at END,
         last_error=$3,
         updated_at=$2
     WHERE id=$1`,
    [id, retryAt, safeError, RFQ_COMPARISON_MAX_ATTEMPTS],
    { d1: true }
  );
}

module.exports = {
  insertRFQComparisonJobInDB,
  getPendingRFQComparisonJobsFromDB,
  claimDueRFQComparisonJobsFromDB,
  markRFQComparisonJobCompleteInDB,
  markRFQComparisonChannelCompleteInDB,
  markRFQComparisonJobFailedInDB,
};
