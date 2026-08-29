import { NextResponse } from 'next/server';
import { checkDBHealth } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const health = await checkDBHealth();
    return NextResponse.json({
      success: true,
      data: health,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to check database health',
      },
      { status: 500 }
    );
  }
}
