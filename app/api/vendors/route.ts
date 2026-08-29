import { NextRequest, NextResponse } from 'next/server';
import { getVendorsFromDB, upsertVendorInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { INITIAL_BUYER_VENDORS } from '@/lib/mock-data';
import { VendorEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (pool) {
      const dbVendors = await getVendorsFromDB();
      if (dbVendors && dbVendors.length > 0) {
        return NextResponse.json({ success: true, source: 'postgres', data: dbVendors });
      }
    }
    return NextResponse.json({ success: true, source: 'memory_fallback', data: INITIAL_BUYER_VENDORS });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message, data: INITIAL_BUYER_VENDORS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: VendorEntry = await req.json();
    if (!body.id || !body.name || !body.email) {
      return NextResponse.json({ success: false, error: 'id, name, and email are required' }, { status: 400 });
    }

    if (pool) {
      await upsertVendorInDB(body);
      return NextResponse.json({ success: true, source: 'postgres', data: body });
    }

    return NextResponse.json({ success: true, source: 'memory_fallback', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
