import { NextResponse } from 'next/server';
import { initializeSchema, checkDBHealth } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const initResult = await initializeSchema();
    const health = await checkDBHealth();

    return NextResponse.json({
      success: initResult.success,
      message: initResult.message,
      tablesCreated: initResult.tablesCreated,
      health,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Schema initialization failed.',
      },
      { status: 500 }
    );
  }
}
