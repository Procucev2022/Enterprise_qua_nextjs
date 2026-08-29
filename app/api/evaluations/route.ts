import { NextRequest, NextResponse } from 'next/server';
import { getEvaluationsFromDB, upsertEvaluationInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { VendorEvaluationRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({ success: false, error: 'DATABASE_URL is not configured.' }, { status: 500 });
    }
    const dbEvals = await getEvaluationsFromDB();
    return NextResponse.json({ success: true, source: 'postgresql', data: dbEvals });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: VendorEvaluationRecord = await req.json();
    if (!body.id || !body.vendorId) {
      return NextResponse.json({ success: false, error: 'id and vendorId are required' }, { status: 400 });
    }

    if (pool) {
      await upsertEvaluationInDB(body);
      return NextResponse.json({ success: true, source: 'postgresql', data: body });
    }

    return NextResponse.json({ success: false, error: 'No database connection' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
