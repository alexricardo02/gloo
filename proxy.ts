import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

const intlMiddleware = createMiddleware({
  locales: ['en', 'de', 'es', 'fr', 'it'],
  defaultLocale: 'en',
});

/**
 * H-3 fix: protected routes redirect when there is no session cookie at all,
 * not only for users flagged as guests.
 *
 * This is a cheap UX check: it only tests whether the `gloo_session` cookie
 * EXISTS. It does not validate it (no DB access in the proxy). Real validation
 * (hashed-token lookup + expiry) happens in getOptionalUserId() / requireUserId()
 * in lib/session.ts, which every server action and route handler uses. A forged
 * cookie therefore gets past this redirect but is rejected by every data access.
 *
 * The guest-paywall redirect is kept as a secondary, UX-only path (show paywall
 * modal on the discovery page instead of a login screen for users who explicitly
 * chose to browse as guests).
 */
export default function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const isProtectedRoute = /\/(messages|chat|profile)/.test(pathname);

  if (isProtectedRoute) {
    const hasSessionCookie = req.cookies.has('gloo_session');

    if (!hasSessionCookie) {
      // Derive locale from the path segment (e.g. /en/, /de/) with a safe fallback.
      const localeMatch = pathname.match(/^\/([a-z]{2})\//);
      const locale = localeMatch ? localeMatch[1] : 'en';

      const isGuest = req.cookies.get('gloo_is_guest')?.value === 'true';

      if (isGuest) {
        // Guest users get a friendly paywall on the discovery feed.
        const redirectUrl = new URL(`/${locale}/search-groups`, req.url);
        redirectUrl.searchParams.set('showPaywall', 'true');
        return NextResponse.redirect(redirectUrl);
      }

      // Fully unauthenticated → send to login.
      return NextResponse.redirect(new URL(`/${locale}/login`, req.url));
    }
  }

  return intlMiddleware(req);
}


export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};

