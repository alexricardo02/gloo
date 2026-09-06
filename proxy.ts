import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

const intlMiddleware = createMiddleware({
  locales: ['en', 'de', 'es', 'fr', 'it'],
  defaultLocale: 'en',
});

/**
 * H-3 fix: Auth check based on the REAL session cookie (gloo_user_id), not
 * on the boolean guest flag.
 *
 * Previous vulnerability: only users with gloo_is_guest === "true" were
 * redirected. An unauthenticated user who simply had no cookies — or cleared
 * them — bypassed the redirect entirely and reached protected pages.
 *
 * Fix: on any protected route, the absence of gloo_user_id means
 * unauthenticated → redirect to /login. The guest-paywall redirect is kept
 * as a secondary, UX-only path (show paywall modal on the discovery page
 * instead of a login screen for users who explicitly chose to browse as guests).
 */
export default function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const isProtectedRoute = /\/(messages|chat|profile)/.test(pathname);

  if (isProtectedRoute) {
    const userId = req.cookies.get('gloo_user_id')?.value;

    if (!userId) {
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

