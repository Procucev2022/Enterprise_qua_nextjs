import { NextResponse } from 'next/server';
import { seedInitialDataToPostgres } from '@/lib/db/seed';
import { checkDBHealth } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const seedResult = await seedInitialDataToPostgres();
    const health = await checkDBHealth();

    return NextResponse.json({
      success: seedResult.success,
      message: seedResult.message,
      counts: seedResult.counts,
      health,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Database synchronization failed.',
      },
      { status: 500 }
    );
  }
}
