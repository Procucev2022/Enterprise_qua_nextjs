import { NextRequest, NextResponse } from 'next/server';
import { getRFQsFromDB, upsertRFQInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { INITIAL_RFQS } from '@/lib/mock-data';
import { RFQItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (pool) {
      const dbRfqs = await getRFQsFromDB();
      if (dbRfqs && dbRfqs.length > 0) {
        return NextResponse.json({ success: true, source: 'postgres', data: dbRfqs });
      }
    }
    return NextResponse.json({ success: true, source: 'memory_fallback', data: INITIAL_RFQS });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message, data: INITIAL_RFQS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: RFQItem = await req.json();
    if (!body.id || !body.rfqNumber) {
      return NextResponse.json({ success: false, error: 'id and rfqNumber are required' }, { status: 400 });
    }

    if (pool) {
      await upsertRFQInDB(body);
      return NextResponse.json({ success: true, source: 'postgres', data: body });
    }

    return NextResponse.json({ success: true, source: 'memory_fallback', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
