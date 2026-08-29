import { NextRequest, NextResponse } from 'next/server';
import { getRFQsFromDB, upsertRFQInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { RFQItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({ success: false, error: 'DATABASE_URL is not configured.' }, { status: 500 });
    }
    const dbRfqs = await getRFQsFromDB();
    return NextResponse.json({ success: true, source: 'postgresql', data: dbRfqs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
      return NextResponse.json({ success: true, source: 'postgresql', data: body });
    }

    return NextResponse.json({ success: false, error: 'No database connection' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
