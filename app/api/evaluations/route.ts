import { NextRequest, NextResponse } from 'next/server';
import { getEvaluationsFromDB, upsertEvaluationInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { INITIAL_VENDOR_EVALUATIONS } from '@/lib/mock-data';
import { VendorEvaluationRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (pool) {
      const dbEvals = await getEvaluationsFromDB();
      if (dbEvals && dbEvals.length > 0) {
        return NextResponse.json({ success: true, source: 'postgres', data: dbEvals });
      }
    }
    return NextResponse.json({ success: true, source: 'memory_fallback', data: INITIAL_VENDOR_EVALUATIONS });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message, data: INITIAL_VENDOR_EVALUATIONS });
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
      return NextResponse.json({ success: true, source: 'postgres', data: body });
    }

    return NextResponse.json({ success: true, source: 'memory_fallback', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
