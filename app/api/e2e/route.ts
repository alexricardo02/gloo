import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopback(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(h) || h === '::ffff:127.0.0.1';
}

/**
 * Best-effort "request comes from this machine" check.
 * Route handlers do not expose the socket's remote address, so we require
 * both the requested host to be loopback AND any proxy forwarding headers
 * (which a reverse proxy/CDN would add) to name only loopback addresses.
 * This is defense in depth on top of the NODE_ENV / E2E_ENABLED gates.
 */
function isLocalRequest(request: NextRequest): boolean {
  if (!isLoopback(request.nextUrl.hostname)) return false;

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor && !forwardedFor.split(',').every((ip) => isLoopback(ip))) {
    return false;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp && !isLoopback(realIp)) return false;

  return true;
}

/** True only when every E2E gate is open. (Not exported: route files may only export handlers.) */
function isE2eApiEnabled(request: NextRequest): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.E2E_ENABLED === '1' &&
    isLocalRequest(request)
  );
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

/**
 * E2E test helper API – only reachable when ALL of these hold:
 *   - NODE_ENV !== "production"
 *   - E2E_ENABLED === "1" (set by playwright.config.ts for its own dev server)
 *   - the request comes from localhost
 *   - the x-e2e-secret header matches a non-empty E2E_TEST_SECRET
 * Otherwise it responds 404 so its existence is not revealed.
 *
 * Handles DB operations that the global-setup needs but can't do
 * via `npx tsx` due to Prisma engine binary issues on some platforms.
 *
 * POST /api/e2e
 * Body: { action: "verify" | "create-group", email: string, label?: string }
 */
export async function POST(request: NextRequest) {
  if (!isE2eApiEnabled(request)) return notFound();

  const expectedSecret = process.env.E2E_TEST_SECRET;
  const secret = request.headers.get('x-e2e-secret');
  if (!expectedSecret || secret !== expectedSecret) return notFound();

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
