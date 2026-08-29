import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogsFromDB, insertAuditLogInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { INITIAL_AUDIT_LOG } from '@/lib/mock-data';
import { AuditLogEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (pool) {
      const dbLogs = await getAuditLogsFromDB();
      if (dbLogs && dbLogs.length > 0) {
        return NextResponse.json({ success: true, source: 'postgres', data: dbLogs });
      }
    }
    return NextResponse.json({ success: true, source: 'memory_fallback', data: INITIAL_AUDIT_LOG });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message, data: INITIAL_AUDIT_LOG });
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
      return NextResponse.json({ success: true, source: 'postgres', data: body });
    }

    return NextResponse.json({ success: true, source: 'memory_fallback', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
