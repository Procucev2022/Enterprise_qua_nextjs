import { NextRequest, NextResponse } from 'next/server';
import { query, pool } from '@/lib/db';
import { INITIAL_SYSTEM_CONFIG } from '@/lib/constants';
import { SystemConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({ success: true, source: 'default', data: INITIAL_SYSTEM_CONFIG });
    }
    const res = await query(`SELECT value FROM system_config WHERE key = 'main_config' LIMIT 1`);
    if (res.rows.length === 0) {
      await query(
        `INSERT INTO system_config (id, key, value, updated_at) VALUES ('sys-cfg-1', 'main_config', $1, CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify(INITIAL_SYSTEM_CONFIG)]
      );
      return NextResponse.json({ success: true, source: 'postgresql', data: INITIAL_SYSTEM_CONFIG });
    }
    const config = res.rows[0]?.value || INITIAL_SYSTEM_CONFIG;
    return NextResponse.json({ success: true, source: 'postgresql', data: config });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: SystemConfig = await req.json();

    if (pool) {
      await query(
        `
        INSERT INTO system_config (id, key, value, updated_at)
        VALUES ('sys-cfg-1', 'main_config', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = CURRENT_TIMESTAMP
      `,
        [JSON.stringify(body)]
      );
    }

    return NextResponse.json({ success: true, source: 'postgresql', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
