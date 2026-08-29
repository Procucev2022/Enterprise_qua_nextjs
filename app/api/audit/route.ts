import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogsFromDB, insertAuditLogInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { AuditLogEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({ success: false, error: 'DATABASE_URL is not configured.' }, { status: 500 });
    }
    const dbLogs = await getAuditLogsFromDB();
    return NextResponse.json({ success: true, source: 'postgresql', data: dbLogs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: AuditLogEntry = await req.json();
    if (!body.id || !body.action) {
      return NextResponse.json({ success: false, error: 'id and action are required' }, { status: 400 });
    }

    if (pool) {
      await insertAuditLogInDB(body);
      return NextResponse.json({ success: true, source: 'postgresql', data: body });
    }

    return NextResponse.json({ success: false, error: 'No database connection' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
