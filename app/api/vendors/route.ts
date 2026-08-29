import { NextRequest, NextResponse } from 'next/server';
import { getVendorsFromDB, upsertVendorInDB, insertRatingRevisionInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { VendorEntry, VendorRatingRevisionRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!pool) {
      return NextResponse.json({ success: false, error: 'DATABASE_URL is not configured.' }, { status: 500 });
    }
    const dbVendors = await getVendorsFromDB();
    return NextResponse.json({ success: true, source: 'postgresql', data: dbVendors });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
      return NextResponse.json({ success: true, source: 'postgresql', data: body });
    }

    return NextResponse.json({ success: false, error: 'No database connection' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, vendor, revision } = body;

    if (action === 'rating_revision' && revision) {
      await insertRatingRevisionInDB(revision as VendorRatingRevisionRecord);
      if (vendor) {
        await upsertVendorInDB(vendor as VendorEntry);
      }
      return NextResponse.json({ success: true, source: 'postgresql' });
    }

    if (vendor) {
      await upsertVendorInDB(vendor as VendorEntry);
      return NextResponse.json({ success: true, source: 'postgresql', data: vendor });
    }

    return NextResponse.json({ success: false, error: 'Invalid action payload' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
