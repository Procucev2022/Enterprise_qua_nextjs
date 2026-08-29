import { NextResponse } from 'next/server';
import {
  getBuyerAccountsFromDB,
  getVendorsFromDB,
  getRFQsFromDB,
  getEvaluationsFromDB,
  getAuditLogsFromDB,
} from '@/lib/db/queries';
import { query, pool } from '@/lib/db';
import { INITIAL_SYSTEM_CONFIG } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({
        success: false,
        error: 'DATABASE_URL is not configured.',
      }, { status: 500 });
    }

    // Execute queries in parallel against PostgreSQL
    const [buyerAccounts, vendors, rfqs, evaluations, auditLogs, aiFeedRes, configRes] = await Promise.all([
      getBuyerAccountsFromDB(),
      getVendorsFromDB(),
      getRFQsFromDB(),
      getEvaluationsFromDB(),
      getAuditLogsFromDB(),
      query(`SELECT id, timestamp, time_ago AS "timeAgo", type, channel, title, message, recipient, rfq_number AS "rfqNumber", status, channel_details AS "channelDetails" FROM ai_bot_feed ORDER BY created_at DESC LIMIT 50`),
      query(`SELECT value FROM system_config WHERE key = 'main_config' LIMIT 1`),
    ]);

    const aiFeed = aiFeedRes.rows || [];
    const systemConfig = configRes.rows[0]?.value || INITIAL_SYSTEM_CONFIG;

    return NextResponse.json({
      success: true,
      source: 'postgresql',
      data: {
        buyerAccounts,
        vendors,
        rfqs,
        evaluations,
        auditLogs,
        aiFeed,
        systemConfig,
      },
    });
  } catch (error: any) {
    console.error('[API /api/bootstrap Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to bootstrap application data from database.',
      },
      { status: 500 }
    );
  }
}
