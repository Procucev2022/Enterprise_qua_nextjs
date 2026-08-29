import { NextRequest, NextResponse } from 'next/server';
import { query, pool } from '@/lib/db';
import { AIBotFeedItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({ success: true, source: 'empty', data: [] });
    }
    const res = await query(`
      SELECT
        id,
        timestamp,
        time_ago AS "timeAgo",
        type,
        channel,
        title,
        message,
        recipient,
        rfq_number AS "rfqNumber",
        status,
        channel_details AS "channelDetails"
      FROM ai_bot_feed
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return NextResponse.json({ success: true, source: 'postgresql', data: res.rows });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: AIBotFeedItem = await req.json();
    if (!body.id || !body.title) {
      return NextResponse.json({ success: false, error: 'id and title are required' }, { status: 400 });
    }

    if (pool) {
      await query(
        `
        INSERT INTO ai_bot_feed (
          id, timestamp, time_ago, type, channel, title, message, recipient, rfq_number, status, channel_details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `,
        [
          body.id,
          body.timestamp || new Date().toISOString(),
          body.timeAgo || 'Just now',
          body.type || 'system',
          body.channel || 'system',
          body.title,
          body.message || '',
          body.recipient || null,
          body.rfqNumber || null,
          body.status || 'delivered',
          JSON.stringify(body.channelDetails || {}),
        ]
      );
    }

    return NextResponse.json({ success: true, source: 'postgresql', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
