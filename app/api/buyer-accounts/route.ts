import { NextRequest, NextResponse } from 'next/server';
import { getBuyerAccountsFromDB, upsertBuyerAccountInDB } from '@/lib/db/queries';
import { pool } from '@/lib/db';
import { BuyerAccount } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const buyers = await getBuyerAccountsFromDB();
    return NextResponse.json({ success: true, source: 'postgresql', data: buyers });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: BuyerAccount = await req.json();
    if (!body.id || !body.organizationName || !body.corporateEmail) {
      return NextResponse.json(
        { success: false, error: 'id, organizationName, and corporateEmail are required' },
        { status: 400 }
      );
    }

    await upsertBuyerAccountInDB(body);
    return NextResponse.json({ success: true, source: 'postgresql', data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
