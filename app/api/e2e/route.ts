import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * E2E test helper API – only available in development.
 * Handles DB operations that the global-setup needs but can't do
 * via `npx tsx` due to Prisma engine binary issues on some platforms.
 *
 * POST /api/e2e
 * Body: { action: "verify" | "create-group", email: string, label?: string }
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, email, label } = body;

    if (action === 'verify') {
      if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });
      await prisma.user.update({ where: { email }, data: { isVerified: true } });
      return NextResponse.json({ success: true, action: 'verify', email });
    }

    if (action === 'create-group') {
      if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });
      const groupLabel = label || 'test';

      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

      await prisma.group.create({
        data: {
          userId: user.id,
          membersCount: 4,
          ageMin: 20,
          ageMax: 28,
          gender: 'MIXED',
          searchGender: 'MIXED',
          searchAgeMin: 18,
          searchAgeMax: 35,
          maxDistance: 20,
          publicProfile: true,
          latitude: 49.9929,
          longitude: 8.2473,
          photos: ['/images/bg-fallback.jpg'],
          instagram: [`@${groupLabel.toLowerCase()}_e2e`],
          description: `E2E test group for ${groupLabel}`,
        },
      });
      return NextResponse.json({ success: true, action: 'create-group', email, label: groupLabel });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    console.error('[e2e-api] Error:', e);
    return NextResponse.json({ error: (e as Error)?.message || 'Internal error' }, { status: 500 });
  }
}
